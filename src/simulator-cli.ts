import { startSimulation, stopSimulation, Profile } from './simulator';
import './server'; // Start WebSocket server

const args = process.argv.slice(2);
const profile = (args[0] || 'loseWeight') as Profile;
const deviceId = args[1] || 'simulator-001';
const variance = args[2] ? parseFloat(args[2]) : 2;

const validProfiles: Profile[] = ['getFitter', 'loseWeight', 'getStronger', 'feelBetter'];

if (!validProfiles.includes(profile)) {
  console.error(`Invalid profile: ${profile}`);
  console.error(`Valid profiles: ${validProfiles.join(', ')}`);
  process.exit(1);
}

console.log(`Starting ${profile} simulation...`);
console.log(`Device ID: ${deviceId}`);
console.log(`Noise variance: ${variance} BPM`);
console.log('Press Ctrl+C to stop\n');

startSimulation(profile, deviceId, variance);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping simulation...');
  stopSimulation();
  process.exit(0);
});
