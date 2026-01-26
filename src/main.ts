// Main entry point - starts both WebSocket server and Dashboard
import './server'; // Start WebSocket server on port 8080
import './dashboard'; // Start Dashboard on port 3000

// The dashboard will handle mode switching and control both BLE and Simulator
console.log('Starting Heart Rate Monitor System...');
console.log('WebSocket server: ws://localhost:8080');
console.log('Dashboard: http://localhost:3000');
