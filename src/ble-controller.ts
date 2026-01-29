import noble, { Peripheral, Service, Characteristic } from 'noble-winrt';
import { broadcastHeartRate, broadcastScanResult } from './server';

export interface HRMScanDevice {
  name: string;
  deviceId: string;
}

export interface HRMScanOptions {
  durationMs: number;
  onDevice?: (device: HRMScanDevice) => void;
  onComplete?: (devices: HRMScanDevice[]) => void;
}

/**
 * Normalize BLE address to 12-char lowercase hex (strip colons/dashes).
 * Returns empty string if not exactly 12 hex chars.
 */
function normalizeAddress(addr: string): string {
  const hex = (addr || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return hex.length === 12 ? hex : '';
}

/**
 * Validate device ID as a BLE address (6 octets = 12 hex digits, optional colons).
 */
export function isValidBleDeviceId(deviceId: string): boolean {
  return normalizeAddress(deviceId).length === 12;
}

// Heart Rate Service UUID
const HEART_RATE_SERVICE_UUID = '180d';
// Heart Rate Measurement Characteristic UUID
const HEART_RATE_MEASUREMENT_CHAR_UUID = '2a37';

// Track connected device for cleanup
let connectedDevice: Peripheral | null = null;
let isScanning = false;
let isRunning = false;
let currentDeviceId: string | null = null;
let lastHeartRate: number | null = null; // For low pass filter

// Track noble event listeners for cleanup
let nobleStateChangeHandler: ((state: string) => void) | null = null;
let nobleDiscoverHandler: ((peripheral: Peripheral) => void) | null = null;
let nobleScanStopHandler: (() => void) | null = null;
let disconnectHandler: ((error?: string) => void) | null = null;
let readHandler: ((data: Buffer, isNotification: boolean) => void) | null = null;
let heartRateCharacteristic: Characteristic | null = null;

// Connect-by-device-id state (scan for specific address then connect)
const CONNECT_BY_ID_TIMEOUT_MS = 30000;
let connectByDeviceIdDiscoverHandler: ((peripheral: Peripheral) => void) | null = null;
let connectByDeviceIdStateChangeHandler: ((state: string) => void) | null = null;
let connectByDeviceIdTimeoutId: ReturnType<typeof setTimeout> | null = null;
let connectByDeviceIdCallbacks: { onSuccess: () => void; onError: (error: string) => void } | null = null;
let connectByDeviceIdTargetNormalized: string | null = null;

// HRM scan-only state (discovery only, no connect)
let hrmScanActive = false;
let hrmScanDiscoverHandler: ((peripheral: Peripheral) => void) | null = null;
let hrmScanStateChangeHandler: ((state: string) => void) | null = null;
let hrmScanTimeoutId: ReturnType<typeof setTimeout> | null = null;
let hrmScanOptions: HRMScanOptions | null = null;

/**
 * Decode Heart Rate Measurement data according to BLE HRM specification
 */
function decodeHeartRateMeasurement(data: Buffer): number | null {
  if (data.length < 2) {
    return null;
  }

  const flags = data.readUInt8(0);
  const is16Bit = (flags & 0x01) !== 0;
  
  let heartRate: number;
  if (is16Bit) {
    if (data.length < 3) {
      return null;
    }
    heartRate = data.readUInt16LE(1);
  } else {
    heartRate = data.readUInt8(1);
  }

  return heartRate;
}

/**
 * Send disconnected message
 */
function sendDisconnected(): void {
  if (currentDeviceId) {
    const message = {
      device_id: currentDeviceId,
      date: new Date().toISOString(),
      hr: '0',
      action: 'disconnected'
    };
    // Use the WebSocket server's broadcast function but with disconnected action
    // We'll need to modify server.ts to support this
    broadcastHeartRateWithAction(currentDeviceId, 0, 'disconnected');
  }
}

/**
 * Broadcast heart rate with custom action
 */
function broadcastHeartRateWithAction(deviceId: string, heartRate: number, action: 'hr' | 'disconnected'): void {
  broadcastHeartRate(deviceId, heartRate, action);
}

/**
 * Handle disconnect event - cleanup listeners
 */
function handleDisconnect(peripheral: Peripheral): void {
  console.log(`Device ${peripheral.address} disconnected`);
  sendDisconnected();
  
  if (heartRateCharacteristic && readHandler) {
    heartRateCharacteristic.removeListener('read', readHandler);
  }
  
  if (peripheral && disconnectHandler) {
    peripheral.removeListener('disconnect', disconnectHandler);
  }
  
  connectedDevice = null;
  currentDeviceId = null;
  heartRateCharacteristic = null;
  readHandler = null;
  disconnectHandler = null;
}

export interface ConnectCallbacks {
  onConnectionFailure?: () => void;
  onConnectionSuccess?: () => void;
}

/**
 * Connect to a peripheral and set up heart rate monitoring
 */
function connectToPeripheral(peripheral: Peripheral, callbacks?: ConnectCallbacks): void {
  const onFail = callbacks?.onConnectionFailure;
  const onSuccess = callbacks?.onConnectionSuccess;

  disconnectHandler = (error?: string) => {
    if (error) {
      console.error(`Disconnect error: ${error}`);
    }
    handleDisconnect(peripheral);
  };
  
  peripheral.on('disconnect', disconnectHandler);
  
  // Connect to the peripheral
  peripheral.connect((error) => {
    if (error) {
      console.error(`Connection error: ${error}`);
      onFail?.();
      return;
    }
    
    const deviceId = peripheral.address || peripheral.id;
    currentDeviceId = deviceId;
    console.log(`Connected to ${peripheral.advertisement.localName || deviceId}`);
    
    // Discover all services and characteristics
    peripheral.discoverAllServicesAndCharacteristics((error, services) => {
      if (error) {
        console.error(`Service discovery error: ${error}`);
        peripheral.disconnect();
        onFail?.();
        return;
      }
      
      // Find the Heart Rate Service
      const heartRateService = services.find(service => {
        const normalizedUuid = service.uuid.toLowerCase().replace(/-/g, '');
        return normalizedUuid.includes('180d');
      });
      
      if (!heartRateService) {
        console.error('Heart Rate Service not found');
        peripheral.disconnect();
        onFail?.();
        return;
      }
      
      // Discover characteristics
      heartRateService.discoverCharacteristics([], (error, characteristics) => {
        if (error) {
          console.error(`Characteristic discovery error: ${error}`);
          peripheral.disconnect();
          onFail?.();
          return;
        }
        
        // Find the Heart Rate Measurement characteristic
        heartRateCharacteristic = characteristics.find(char => {
          const normalizedUuid = char.uuid.toLowerCase().replace(/-/g, '');
          return normalizedUuid.includes('2a37');
        }) || null;
        
        if (!heartRateCharacteristic) {
          console.error('Heart Rate Measurement characteristic not found');
          peripheral.disconnect();
          onFail?.();
          return;
        }
        
        // Subscribe to notifications
        heartRateCharacteristic.subscribe((error) => {
          if (error) {
            console.error(`Subscribe error: ${error}`);
            peripheral.disconnect();
            onFail?.();
            return;
          }
          
          console.log('Subscribed to heart rate notifications');
          onSuccess?.();
        });
        
        // Handle heart rate data notifications
        readHandler = (data: Buffer, isNotification: boolean) => {
          if (isNotification) {
            const rawHeartRate = decodeHeartRateMeasurement(data);
            if (rawHeartRate !== null && currentDeviceId) {
              // Apply low pass filter: 0.6 * current + 0.4 * last
              let filteredHR: number;
              if (lastHeartRate !== null) {
                filteredHR = 0.6 * rawHeartRate + 0.4 * lastHeartRate;
              } else {
                // First measurement, no filter
                filteredHR = rawHeartRate;
              }
              lastHeartRate = filteredHR;
              
              const heartRate = Math.round(filteredHR);
              console.log(`❤️  Heart Rate: ${heartRate} bpm (filtered from ${rawHeartRate})`);
              broadcastHeartRateWithAction(currentDeviceId, heartRate, 'hr');
            }
          }
        };
        heartRateCharacteristic.on('read', readHandler);
      });
    });
  });
}

/**
 * Start BLE scanning and connection
 */
export function startBLE(): void {
  if (isRunning) {
    console.log('BLE scanner already running');
    return;
  }
  
  isRunning = true;
  isScanning = false;
  console.log('Starting BLE scanner...');
  
  // Wait for Noble to be powered on
  if (noble.state === 'poweredOn') {
    startScanning();
  } else {
    console.log(`Noble state: ${noble.state}. Waiting for 'poweredOn'...`);
    
    nobleStateChangeHandler = (state: string) => {
      console.log(`Noble state changed to: ${state}`);
      
      if (state === 'poweredOn' && isRunning) {
        console.log('Noble is now powered on. Starting scan...');
        startScanning();
      }
    };
    noble.on('stateChange', nobleStateChangeHandler);
  }
}

function startScanning(): void {
  if (!isRunning) return;
  
  console.log('Starting BLE scan for Heart Rate Service devices...');
  isScanning = true;
  noble.startScanning([], false);
  
  // Handle discovered peripherals
  nobleDiscoverHandler = (peripheral: Peripheral) => {
    if (!isRunning) return;
    
    const serviceUuids = peripheral.advertisement.serviceUuids || [];
    
    // Filter: Only devices that have '180d' in their service UUIDs
    const hasHeartRateService = serviceUuids.some(uuid => {
      const normalizedUuid = uuid.toLowerCase().replace(/-/g, '');
      return normalizedUuid.includes('180d');
    });
    
    if (!hasHeartRateService) {
      return;
    }
    
    const name = peripheral.advertisement.localName || 'Unknown';
    const address = peripheral.address;
    
    console.log(`Found HRM device: ${name} (${address})`);
    
    // Connect to the first discovered HRM device
    if (peripheral.state === 'disconnected' && !connectedDevice) {
      connectedDevice = peripheral;
      console.log(`Connecting to ${name} (${address})...`);
      noble.stopScanning();
      isScanning = false;
      connectToPeripheral(peripheral);
    }
  };
  
  noble.on('discover', nobleDiscoverHandler);
}

/**
 * Stop BLE scanning and disconnect
 */
export function stopBLE(): void {
  if (!isRunning) {
    return;
  }
  
  isRunning = false;
  isScanning = false;
  console.log('Stopping BLE scanner...');
  
  // Stop scanning
  if (noble.state === 'poweredOn') {
    noble.stopScanning();
  }
  
  // Disconnect device
  if (connectedDevice && connectedDevice.state === 'connected') {
    connectedDevice.disconnect();
  }
  
  // Clean up listeners
  if (nobleStateChangeHandler) {
    noble.removeListener('stateChange', nobleStateChangeHandler);
    nobleStateChangeHandler = null;
  }
  
  if (nobleDiscoverHandler) {
    noble.removeListener('discover', nobleDiscoverHandler);
    nobleDiscoverHandler = null;
  }
  
  if (nobleScanStopHandler) {
    noble.removeListener('scanStop', nobleScanStopHandler);
    nobleScanStopHandler = null;
  }
  
  connectedDevice = null;
  currentDeviceId = null;
  heartRateCharacteristic = null;
  readHandler = null;
  disconnectHandler = null;
  lastHeartRate = null; // Reset filter state
  
  console.log('BLE scanner stopped');
}

function cleanupConnectByDeviceId(): void {
  if (connectByDeviceIdTimeoutId != null) {
    clearTimeout(connectByDeviceIdTimeoutId);
    connectByDeviceIdTimeoutId = null;
  }
  if (connectByDeviceIdDiscoverHandler != null) {
    noble.removeListener('discover', connectByDeviceIdDiscoverHandler);
    connectByDeviceIdDiscoverHandler = null;
  }
  if (connectByDeviceIdStateChangeHandler != null) {
    noble.removeListener('stateChange', connectByDeviceIdStateChangeHandler);
    connectByDeviceIdStateChangeHandler = null;
  }
  connectByDeviceIdTargetNormalized = null;
  connectByDeviceIdCallbacks = null;
}

/**
 * Start a live BLE session by connecting to a specific device address (e.g. from WS "connect:...").
 * Scans until the device is seen (with HRM service), then connects. Times out after 30s if not found.
 */
export function startBLEWithDeviceId(
  deviceId: string,
  callbacks: { onSuccess: () => void; onError: (error: string) => void }
): void {
  if (isRunning) {
    callbacks.onError('session_already_active');
    return;
  }
  const targetNorm = normalizeAddress(deviceId);
  if (!targetNorm) {
    callbacks.onError('invalid_device_id');
    return;
  }

  isRunning = true;
  connectByDeviceIdTargetNormalized = targetNorm;
  connectByDeviceIdCallbacks = callbacks;

  const fail = (error: string): void => {
    const cb = connectByDeviceIdCallbacks;
    cleanupConnectByDeviceId();
    isRunning = false;
    if (noble.state === 'poweredOn') {
      noble.stopScanning();
    }
    cb?.onError(error);
  };

  const succeed = (): void => {
    cleanupConnectByDeviceId();
    connectByDeviceIdCallbacks?.onSuccess();
    connectByDeviceIdCallbacks = null;
  };

  const startScanForDevice = (): void => {
    connectByDeviceIdDiscoverHandler = (peripheral: Peripheral) => {
      const serviceUuids = peripheral.advertisement.serviceUuids || [];
      const hasHeartRateService = serviceUuids.some(uuid => {
        const normalizedUuid = uuid.toLowerCase().replace(/-/g, '');
        return normalizedUuid.includes('180d');
      });
      if (!hasHeartRateService) return;

      const addrNorm = normalizeAddress(peripheral.address || peripheral.id || '');
      if (addrNorm !== connectByDeviceIdTargetNormalized) return;
      if (peripheral.state !== 'disconnected' || connectedDevice) return;

      noble.stopScanning();
      if (connectByDeviceIdTimeoutId != null) {
        clearTimeout(connectByDeviceIdTimeoutId);
        connectByDeviceIdTimeoutId = null;
      }
      if (connectByDeviceIdDiscoverHandler) {
        noble.removeListener('discover', connectByDeviceIdDiscoverHandler);
        connectByDeviceIdDiscoverHandler = null;
      }
      connectedDevice = peripheral;
      console.log(`Connecting to device ${peripheral.address}...`);
      connectToPeripheral(peripheral, {
        onConnectionFailure: () => fail('connection_failed'),
        onConnectionSuccess: succeed
      });
    };

    noble.on('discover', connectByDeviceIdDiscoverHandler);
    noble.startScanning([], true);
    console.log(`Scanning for device ${deviceId} (30s timeout)...`);
    connectByDeviceIdTimeoutId = setTimeout(() => {
      if (connectByDeviceIdCallbacks) {
        fail('device_not_found');
      }
    }, CONNECT_BY_ID_TIMEOUT_MS);
  };

  if (noble.state === 'poweredOn') {
    startScanForDevice();
  } else {
    connectByDeviceIdStateChangeHandler = (state: string) => {
      if (state === 'poweredOn' && connectByDeviceIdCallbacks) {
        if (connectByDeviceIdStateChangeHandler) {
          noble.removeListener('stateChange', connectByDeviceIdStateChangeHandler);
          connectByDeviceIdStateChangeHandler = null;
        }
        startScanForDevice();
      }
    };
    noble.on('stateChange', connectByDeviceIdStateChangeHandler);
    console.log(`Noble state: ${noble.state}. Will scan when powered on.`);
  }
}

/**
 * Get current device ID
 */
export function getCurrentDeviceId(): string | null {
  return currentDeviceId;
}

/**
 * Check if BLE is running
 */
export function isBLERunning(): boolean {
  return isRunning;
}

/**
 * Derive a display name when advertisement.localName is missing (common on Windows:
 * name is often in scan response and Windows/noble-winrt may not merge it).
 * Uses known HRM vendor OUIs so e.g. Polar H10 shows "Polar H10 DD2D5F" instead of "Unknown".
 */
function fallbackNameForAddress(address: string): string | null {
  // Normalize: strip any non-hex so we handle "a0:9e:1a:dd:2d:5f", "a09e1add2d5f", "A0-9E-1A-DD-2D-5F", etc.
  const normalized = (address || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (normalized.length < 12) return null;
  // Polar Electro OUI A0:9E:1A (first 6 hex chars) - Polar H10 name is typically "Polar H10 XXXXXX" (suffix from MAC)
  if (normalized.startsWith('a09e1a')) {
    const lastThreeOctets = normalized.slice(-6); // last 3 bytes = 6 hex chars
    return `Polar H10 ${lastThreeOctets.toUpperCase()}`;
  }
  return null;
}

/**
 * Scan-only: discover BLE HRM devices for a duration, report names and device IDs.
 * Does not connect to any device. Not available when Live BLE stream is active.
 */
export function startHRMScan(options: HRMScanOptions): void {
  if (isRunning) {
    console.log('HRM scan skipped: BLE stream is active');
    options.onComplete?.([]);
    return;
  }
  if (hrmScanActive) {
    console.log('HRM scan already in progress');
    return;
  }

  const durationMs = Math.min(Math.max(options.durationMs || 60000, 1000), 60000);
  const durationSec = Math.round(durationMs / 1000);
  const seen = new Map<string, HRMScanDevice>(); // dedupe by address

  function finishScan(): void {
    if (!hrmScanActive) return;
    hrmScanActive = false;
    if (hrmScanTimeoutId != null) {
      clearTimeout(hrmScanTimeoutId);
      hrmScanTimeoutId = null;
    }
    if (noble.state === 'poweredOn') {
      noble.stopScanning();
    }
    if (hrmScanDiscoverHandler) {
      noble.removeListener('discover', hrmScanDiscoverHandler);
      hrmScanDiscoverHandler = null;
    }
    if (hrmScanStateChangeHandler) {
      noble.removeListener('stateChange', hrmScanStateChangeHandler);
      hrmScanStateChangeHandler = null;
    }
    const devices = Array.from(seen.values());
    hrmScanOptions?.onComplete?.(devices);
    broadcastScanResult({ action: 'scan_complete', devices, duration_sec: durationSec });
    if (devices.length === 0) {
      console.log('HRM scan complete: No HRM devices found.');
    } else {
      console.log(`HRM scan complete: ${devices.length} device(s) found.`);
      devices.forEach(d => console.log(`  - ${d.name} (${d.deviceId})`));
    }
    hrmScanOptions = null;
  }

  hrmScanActive = true;
  hrmScanOptions = options;

  hrmScanDiscoverHandler = (peripheral: Peripheral) => {
    if (!hrmScanActive) return;
    const serviceUuids = peripheral.advertisement.serviceUuids || [];
    const hasHeartRateService = serviceUuids.some(uuid => {
      const normalizedUuid = uuid.toLowerCase().replace(/-/g, '');
      return normalizedUuid.includes('180d');
    });
    if (!hasHeartRateService) return;

    const rawAddress = (peripheral.address || peripheral.id || '').toLowerCase();
    // Normalize key to 12-char hex so same device is always keyed the same (address may be "a0:9e:1a:dd:2d:5f" or "a09e1add2d5f")
    const addressKey = rawAddress.replace(/[^0-9a-f]/g, '');
    const addressForDisplay = rawAddress.includes(':') ? rawAddress : rawAddress.replace(/(.{2})(?=.)/g, '$1:').toLowerCase();
    const adv = peripheral.advertisement;
    const advertisedName = (adv.localName && adv.localName.trim()) || '';
    const fallbackName = fallbackNameForAddress(rawAddress);
    const name = advertisedName || fallbackName || 'Unknown';

    const existing = seen.get(addressKey);
    if (existing) {
      if (advertisedName && existing.name !== advertisedName) {
        existing.name = advertisedName;
        options.onDevice?.(existing);
        broadcastScanResult({ action: 'scan_device', device: existing });
      }
      return;
    }
    const device: HRMScanDevice = { name, deviceId: addressForDisplay };
    seen.set(addressKey, device);

    console.log(`Found HRM: ${name} (${addressForDisplay})`);
    options.onDevice?.(device);
    broadcastScanResult({ action: 'scan_device', device });
  };

  if (noble.state === 'poweredOn') {
    noble.on('discover', hrmScanDiscoverHandler);
    noble.startScanning([], true);
    console.log(`Scanning for HRM devices (${durationSec}s)...`);
    hrmScanTimeoutId = setTimeout(finishScan, durationMs);
  } else {
    hrmScanStateChangeHandler = (state: string) => {
      if (state === 'poweredOn' && hrmScanActive && hrmScanDiscoverHandler) {
        noble.on('discover', hrmScanDiscoverHandler);
        noble.startScanning([], true);
        console.log(`Scanning for HRM devices (${durationSec}s)...`);
      }
    };
    noble.on('stateChange', hrmScanStateChangeHandler);
    console.log(`Noble state: ${noble.state}. HRM scan will start when powered on.`);
    hrmScanTimeoutId = setTimeout(finishScan, durationMs);
  }
}

/**
 * Check if HRM scan (discovery-only) is active
 */
export function isHRMScanning(): boolean {
  return hrmScanActive;
}
