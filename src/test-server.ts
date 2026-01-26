import { broadcastHeartRate } from './server';

// Start the server (importing server.ts starts it)
// This script will send test heart rate data at 1 update per second

const DEVICE_ID = 'test-device-001';
let heartRate = 60;
let interval: NodeJS.Timeout | null = null;

console.log('Starting test server with heart rate broadcasts...');
console.log('Broadcasting 1 update per second...\n');

// Start broadcasting heart rate data every second
interval = setInterval(() => {
  // Simulate heart rate variation (60-100 bpm)
  heartRate = 60 + Math.floor(Math.random() * 40);
  broadcastHeartRate(DEVICE_ID, heartRate);
  console.log(`Broadcasted: HR=${heartRate} bpm`);
}, 1000);

// Run for 20 seconds
setTimeout(() => {
  console.log('\nStopping test server...');
  if (interval) {
    clearInterval(interval);
  }
  process.exit(0);
}, 20000);
