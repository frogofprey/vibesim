import noble, { Peripheral, Service, Characteristic } from 'noble-winrt';
import { broadcastHeartRate } from './server';

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

/**
 * Connect to a peripheral and set up heart rate monitoring
 */
function connectToPeripheral(peripheral: Peripheral): void {
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
        return;
      }
      
      // Discover characteristics
      heartRateService.discoverCharacteristics([], (error, characteristics) => {
        if (error) {
          console.error(`Characteristic discovery error: ${error}`);
          peripheral.disconnect();
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
          return;
        }
        
        // Subscribe to notifications
        heartRateCharacteristic.subscribe((error) => {
          if (error) {
            console.error(`Subscribe error: ${error}`);
            peripheral.disconnect();
            return;
          }
          
          console.log('Subscribed to heart rate notifications');
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
