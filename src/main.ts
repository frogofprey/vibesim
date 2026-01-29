// Main entry point - starts both WebSocket server and Dashboard
import { WS_SERVER_PORT } from './server';
import './dashboard'; // Start Dashboard on port 3000

// The dashboard will handle mode switching and control both BLE and Simulator
console.log('Starting Heart Rate Monitor System...');
console.log(`WebSocket server: ws://localhost:${WS_SERVER_PORT}`);
console.log('Dashboard: http://localhost:3000');
