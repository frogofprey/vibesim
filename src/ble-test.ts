import noble, { Peripheral, Service, Characteristic } from 'noble-winrt';
// Import server to start WebSocket server
import './server';
import { broadcastHeartRate } from './server';

// Heart Rate Service UUID
const HEART_RATE_SERVICE_UUID = '180d';
// Heart Rate Measurement Characteristic UUID
const HEART_RATE_MEASUREMENT_CHAR_UUID = '2a37';

// Track connected device for cleanup
let connectedDevice: Peripheral | null = null;

// Track noble event listeners for cleanup
let nobleStateChangeHandler: ((state: string) => void) | null = null;
let nobleDiscoverHandler: ((peripheral: Peripheral) => void) | null = null;
let nobleScanStopHandler: (() => void) | null = null;

/**
 * Decode Heart Rate Measurement data according to BLE HRM specification
 * Format: Flags (1 byte) + Heart Rate Value (1 or 2 bytes) + optional fields
 * Flags bit 0: 0 = 8-bit HR, 1 = 16-bit HR
 */
function decodeHeartRateMeasurement(data: Buffer): number | null {
  if (data.length < 2) {
    console.error('Invalid HRM data: too short');
    return null;
  }

  const flags = data.readUInt8(0);
  const is16Bit = (flags & 0x01) !== 0;
  
  let heartRate: number;
  if (is16Bit) {
    if (data.length < 3) {
      console.error('Invalid HRM data: expected 16-bit value but buffer too short');
      return null;
    }
    heartRate = data.readUInt16LE(1);
  } else {
    heartRate = data.readUInt8(1);
  }

  return heartRate;
}

/**
 * Handle disconnect event - cleanup listeners
 */
function handleDisconnect(peripheral: Peripheral, characteristic: Characteristic | null, disconnectHandler: (error?: string) => void, readHandler: (data: Buffer, isNotification: boolean) => void): void {
  console.log(`\nDevice ${peripheral.address} disconnected. Cleaning up...`);
  
  // Clear the connected device reference
  if (connectedDevice === peripheral) {
    connectedDevice = null;
  }
  
  if (characteristic) {
    // Unsubscribe from notifications
    characteristic.unsubscribe((error) => {
      if (error) {
        console.error(`Error unsubscribing: ${error}`);
      }
    });
    
    // Remove characteristic listeners
    characteristic.removeListener('read', readHandler);
  }
  
  // Remove peripheral disconnect listener
  peripheral.removeListener('disconnect', disconnectHandler);
  
  console.log('Cleanup complete.');
  console.log('Exiting...');
  process.exit(0);
}

/**
 * Connect to a peripheral and set up heart rate monitoring
 */
function connectToPeripheral(peripheral: Peripheral): void {
  let heartRateCharacteristic: Characteristic | null = null;
  let readHandler: ((data: Buffer, isNotification: boolean) => void) | null = null;
  
  // Set up disconnect handler
  const disconnectHandler = (error?: string) => {
    if (error) {
      console.error(`Disconnect error: ${error}`);
    }
    if (readHandler) {
      handleDisconnect(peripheral, heartRateCharacteristic, disconnectHandler, readHandler);
    }
  };
  
  peripheral.on('disconnect', disconnectHandler);
  
  // Connect to the peripheral
  peripheral.connect((error) => {
    if (error) {
      console.error(`Connection error: ${error}`);
      return;
    }
    
    console.log(`Connected to ${peripheral.advertisement.localName || peripheral.address}`);
    
    // Discover all services and characteristics
    peripheral.discoverAllServicesAndCharacteristics((error, services) => {
      if (error) {
        console.error(`Service discovery error: ${error}`);
        peripheral.disconnect();
        return;
      }
      
      console.log(`Discovered ${services.length} service(s)`);
      
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
      
      console.log('Found Heart Rate Service, discovering characteristics...');
      
      // Discover characteristics in the Heart Rate Service
      heartRateService.discoverCharacteristics([], (error, characteristics) => {
        if (error) {
          console.error(`Characteristic discovery error: ${error}`);
          peripheral.disconnect();
          return;
        }
        
        console.log(`Discovered ${characteristics.length} characteristic(s)`);
        
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
        
        console.log('Found Heart Rate Measurement characteristic');
        
        // Subscribe to notifications
        heartRateCharacteristic.subscribe((error) => {
          if (error) {
            console.error(`Subscribe error: ${error}`);
            peripheral.disconnect();
            return;
          }
          
          console.log('Subscribed to heart rate notifications. Waiting for data...\n');
        });
        
        // Handle heart rate data notifications
        readHandler = (data: Buffer, isNotification: boolean) => {
          if (isNotification) {
            const heartRate = decodeHeartRateMeasurement(data);
            if (heartRate !== null) {
              console.log(`❤️  Heart Rate: ${heartRate} bpm`);
              
              // Broadcast heart rate data through WebSocket server
              const deviceId = peripheral.address || peripheral.id;
              broadcastHeartRate(deviceId, heartRate);
              console.log(`📡 Broadcasted HR data to WebSocket client`);
            }
          }
        };
        heartRateCharacteristic.on('read', readHandler);
      });
    });
  });
}

/**
 * Initialize Noble and scan for Heart Rate Service devices
 */
async function scanForHeartRateDevices(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Wait for Noble to be powered on
    if (noble.state === 'poweredOn') {
      startScanning();
    } else {
      console.log(`Noble state: ${noble.state}. Waiting for 'poweredOn'...`);
      
      nobleStateChangeHandler = (state: string) => {
        if (isExiting) return; // Don't process state changes during exit
        
        console.log(`Noble state changed to: ${state}`);
        
        if (state === 'poweredOn') {
          console.log('Noble is now powered on. Starting scan...');
          startScanning();
        } else {
          console.warn(`Noble state is not 'poweredOn' (current: ${state}). Cannot scan.`);
        }
      };
      noble.on('stateChange', nobleStateChangeHandler);
    }

    function startScanning(): void {
      console.log('Starting BLE scan for Heart Rate Service devices...');
      console.log(`Looking for devices with service UUID: ${HEART_RATE_SERVICE_UUID}\n`);

      // Start scanning (scan all devices, then filter by service UUID)
      // Note: We'll filter in the discover handler to ensure we only log HRM devices
      noble.startScanning([], false);

      // Handle discovered peripherals
      nobleDiscoverHandler = (peripheral: Peripheral) => {
        if (isExiting) return; // Don't process discoveries during exit
        // If we're already connected, ignore new discoveries
        if (connectedDevice && connectedDevice.state === 'connected') {
          return;
        }
        
        const serviceUuids = peripheral.advertisement.serviceUuids || [];
        
        // Filter: Only log devices that have '180d' in their service UUIDs
        // UUIDs can be in formats like '180d', '0000180d-0000-1000-8000-00805f9b34fb', etc.
        const hasHeartRateService = serviceUuids.some(uuid => {
          const normalizedUuid = uuid.toLowerCase().replace(/-/g, '');
          return normalizedUuid.includes('180d');
        });

        if (!hasHeartRateService) {
          // Skip devices that don't have the Heart Rate Service
          return;
        }

        const name = peripheral.advertisement.localName || 'Unknown';
        const address = peripheral.address;
        const rssi = peripheral.rssi;

        console.log('--- Heart Rate Device Found ---');
        console.log(`Name: ${name}`);
        console.log(`Address: ${address}`);
        console.log(`RSSI: ${rssi} dBm`);
        console.log(`Service UUIDs: ${serviceUuids.join(', ')}`);
        console.log('---\n');

        // Connect to the first discovered HRM device
        if (peripheral.state === 'disconnected' && !connectedDevice) {
          connectedDevice = peripheral;
          console.log(`Connecting to ${name} (${address})...`);
          // Stop scanning once we start connecting
          noble.stopScanning();
          connectToPeripheral(peripheral);
        }
      };
      
      noble.on('discover', nobleDiscoverHandler);

      let isResolved = false;
      let fallbackTimeout: NodeJS.Timeout | null = null;
      
      const doResolve = () => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(scanTimeout);
          if (fallbackTimeout) {
            clearTimeout(fallbackTimeout);
          }
          if (nobleScanStopHandler) {
            noble.removeListener('scanStop', nobleScanStopHandler);
          }
          resolve();
        }
      };

      // Stop scanning after 30 seconds (optional - remove if you want continuous scanning)
      const scanTimeout = setTimeout(() => {
        if (noble.state === 'poweredOn') {
          console.log('\nStopping scan after 30 seconds...');
          noble.stopScanning();
          // Fallback: resolve after 1 second if scanStop event doesn't fire
          fallbackTimeout = setTimeout(() => {
            console.log('Scan stop timeout - resolving anyway...');
            doResolve();
          }, 1000);
        } else {
          // If already stopped or powered off, resolve immediately
          doResolve();
        }
      }, 30000);

      // Handle scan stop - cleanup and resolve
      nobleScanStopHandler = () => {
        if (isExiting) {
          doResolve();
          return;
        }
        console.log('Scan stopped.');
        if (fallbackTimeout) {
          clearTimeout(fallbackTimeout);
        }
        doResolve();
      };
      noble.on('scanStop', nobleScanStopHandler);
    }

    // Handle errors
    noble.on('warning', (message: string) => {
      console.warn(`Noble warning: ${message}`);
    });
  });
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('Initializing Noble BLE scanner...');
    console.log(`Initial Noble state: ${noble.state}\n`);

    // Verify state before scanning
    if (noble.state !== 'poweredOn') {
      console.log('⚠️  Noble is not powered on. Waiting for state change...');
    }

    await scanForHeartRateDevices();
    
    // Keep the process running to receive heart rate data
    // The process will exit on disconnect or Ctrl+C
    console.log('\nMonitoring heart rate. Press Ctrl+C to exit...\n');
  } catch (error) {
    console.error('Error during BLE scan:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown on Ctrl+C
let isExiting = false;

function cleanupAndExit(): void {
  if (isExiting) {
    return;
  }
  isExiting = true;
  
  // Remove all noble event listeners to prevent further events
  if (nobleStateChangeHandler) {
    try {
      noble.removeListener('stateChange', nobleStateChangeHandler);
    } catch (error) {
      // Ignore errors
    }
  }
  if (nobleDiscoverHandler) {
    try {
      noble.removeListener('discover', nobleDiscoverHandler);
    } catch (error) {
      // Ignore errors
    }
  }
  if (nobleScanStopHandler) {
    try {
      noble.removeListener('scanStop', nobleScanStopHandler);
    } catch (error) {
      // Ignore errors
    }
  }
  
  // Stop scanning if active
  if (noble.state === 'poweredOn') {
    try {
      noble.stopScanning();
    } catch (error) {
      // Ignore errors when stopping scan
    }
  }
  
  // Disconnect from device if connected or connecting
  if (connectedDevice && (connectedDevice.state === 'connected' || connectedDevice.state === 'connecting')) {
    try {
      connectedDevice.disconnect(() => {
        // Exit immediately after disconnect
        process.exit(0);
      });
    } catch (error) {
      // Ignore disconnect errors
    }
  }
  
  // Always exit after a very short timeout, regardless of disconnect status
  setTimeout(() => {
    process.exit(0);
  }, 200);
}

process.on('SIGINT', () => {
  if (isExiting) {
    // Force exit immediately if already exiting
    process.exit(0);
    return;
  }
  
  console.log('\n\nReceived SIGINT. Disconnecting and exiting...');
  cleanupAndExit();
});

// Run the main function
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { scanForHeartRateDevices, HEART_RATE_SERVICE_UUID };
