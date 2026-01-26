# BLE Heart Rate Service Scanner

A Node.js TypeScript project for scanning Bluetooth Low Energy (BLE) devices that broadcast the Heart Rate Service on Windows 11.

## Prerequisites

- Node.js (v16 or higher)
- Windows 11
- Bluetooth adapter enabled

## Installation

1. Install dependencies:
```bash
npm install
```

**Note:** `noble-winrt` is a pure JavaScript package that doesn't require native compilation, so no Visual Studio build tools are needed!

2. Build the TypeScript project:
```bash
npm run build
```

## Usage

### Main Application
Run the complete system (Dashboard + WebSocket Server):
```bash
npm start
```

This will start:
- WebSocket server on port 8080
- Web Dashboard on port 3000

Open your browser to `http://localhost:3000` to access the dashboard.

### BLE Heart Rate Scanner (Standalone)
Run the BLE scanner standalone:
```bash
node dist/ble-test.js
```

Or run the test script:
```bash
npm test
```

The script will:
1. Initialize Noble and wait for the state to change to 'poweredOn'
2. Scan for devices broadcasting the Heart Rate Service (UUID: 180d)
3. Log the Peripheral Name and Address for each discovered device
4. Continue scanning for 30 seconds, then stop

### WebSocket Server

The WebSocket server is automatically started when you run the BLE scanner (`npm start`). The server runs on port 8080 and enforces a single-client connection policy - if a new client connects, the existing one is automatically disconnected.

To run the server standalone (without BLE scanner):
```bash
npm run server
```

### Testing the WebSocket Server

In separate terminals:

1. Start the server:
```bash
npm run server
```

2. Start the test broadcaster (sends 1 HR update per second):
```bash
npm run test-server
```

3. Run the test client (verifies single-client policy and message reception):
```bash
npm run test-client
```

The test client will:
- Connect as Client 1 and receive messages for 5 seconds
- Connect as Client 2, which should kick off Client 1
- Verify that messages are received at ~1 per second
- Verify the single-client kick-off logic works correctly

### Heart Rate Simulator

The simulator module provides four fitness profiles with realistic heart rate curves:

- **`getFitter`** - HIIT spikes: 20-second high-intensity intervals (120-180 BPM) followed by 40-second recovery
- **`loseWeight`** - Steady-state Zone 2: Consistent Zone 2 heart rate (130-140 BPM)
- **`getStronger`** - Bursts: 15-second strength training bursts (110-170 BPM) with 75-second rest periods
- **`feelBetter`** - Low intensity: Gentle exercise (90-110 BPM)

All profiles include Gaussian noise (default 2 BPM variance) for realism.

**Run the simulator:**
```bash
npm run simulator [profile] [deviceId] [variance]
```

Examples:
```bash
npm run simulator getFitter
npm run simulator loseWeight simulator-002 2
npm run simulator getStronger my-device 1.5
```

**Run tests:**
```bash
npm run test:unit
```

The tests verify:
- Gaussian noise distribution is correct
- Noise stays within 2 BPM of the base curve
- All four profiles produce expected heart rate patterns

### Web Dashboard

A local web dashboard is available on port 3000 with a user-friendly interface:

**Start the dashboard:**
```bash
npm run dashboard
```

Then open your browser to `http://localhost:3000`

**Features:**
- **Mode Toggle**: Switch between "Live" (BLE scanner) and "Sim" (simulator) modes
- **Profile Dropdown**: Select from four fitness profiles when in Sim mode
- **Start/Stop Button**: Control the simulation or BLE scanner
- **System Log Window**: Real-time scrollable log of all system messages
- **Copy to Clipboard**: Copy all log contents with one click

The dashboard uses Socket.io for real-time communication, so all log messages from the server appear instantly in the UI.

## Features

- Verifies Noble state changes to 'poweredOn' before scanning
- Scans specifically for Heart Rate Service devices
- Logs device name, address, RSSI, and service UUIDs
- Handles state changes and errors gracefully

## Dependencies

- `noble-winrt`: Windows Runtime BLE library for Node.js (no native compilation required)
- `typescript`: TypeScript compiler
- `@types/node`: TypeScript definitions for Node.js
