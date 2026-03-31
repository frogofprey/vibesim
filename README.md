# BLE Heart Rate Service Scanner

A Node.js TypeScript project for scanning Bluetooth Low Energy (BLE) devices that broadcast the Heart Rate Service on Windows 11.

## Prerequisites

- **Node.js 20, 22, or 24+** (required for development and unit tests; Vitest 4 matches this engine range). Running only prebuilt `dist/` output without devDependencies may work on older Node, but it is not the supported setup.
- Windows 11
- Bluetooth adapter enabled

## Installation

1. Install dependencies:
```bash
npm install
```

**Note:** `noble-winrt` is a pure JavaScript package that doesn't require native compilation, so no Visual Studio build tools are needed!

**Supply chain:** `package.json` defines npm **`overrides`** so **`noble`** and **`noble-winrt`** use a current **`debug`** release (their transitive versions on npm are outdated). After install, **`npm audit`** should report zero vulnerabilities.

2. Build the TypeScript project:
```bash
npm run build
```

## Configuration

### WebSocket server port

The WebSocket server port defaults to **8080**. You can change it when starting the app:

- **Environment variable:** `WS_PORT=8081 npm start` or `WS_PORT=8081 npm run dashboard`
- **CLI argument:** `npm start -- --ws-port 8081` or `node dist/main.js --ws-port 8081`

Port must be between 1 and 65535. Invalid values are ignored and the default (8080) is used.

## Usage

### Main Application
Run the complete system (Dashboard + WebSocket Server). Ensure you have built first (`npm run build`); run a new build after changing TypeScript.

```bash
npm start
```

This will start:
- WebSocket server on port 8080 (configurable via `WS_PORT` or `--ws-port`)
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

The WebSocket server is automatically started when you run the app (`npm start` or `npm run dashboard`). The server runs on port 8080 by default (see [Configuration](#websocket-server-port)) and enforces a single-client connection policy - if a new client connects, the existing one is automatically disconnected.

The dashboard shows the current WebSocket URL (e.g. `ws://localhost:8080`) at the top so you know what to connect to.

To run the server standalone (without dashboard):
```bash
npm run server
```

#### WebSocket client commands

A remote client can send plain-text messages to trigger actions:

| Message | Description |
|--------|-------------|
| `scan` | Start a 60-second HRM device discovery scan. Results are streamed as `scan_device` and `scan_complete` JSON. Not allowed when a stream is active or a scan is already running. Reply: `scan_started` or `scan_rejected` with error. |
| `connect:<deviceId>` | Start a live BLE session by connecting to a specific device. Example: `connect:A0:9E:1A:DD:2D:5F`. The server scans for that address (with HRM service), connects, and streams HR as normal. Device ID must be a valid BLE address (6 hex octets, e.g. `A0:9E:1A:DD:2D:5F` or `A09E1ADD2D5F`). Not allowed when a stream is active or HRM scan is in progress. Reply: `connect_started`, `connect_rejected`, or `connect_failed`. |

**Connect error codes:** `session_already_active`, `scan_in_progress`, `invalid_device_id`, `device_not_found` (timeout 30s), `connection_failed`.

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

The simulator module provides five fitness profiles with realistic heart rate curves:

- **`getFitter`** - HIIT spikes: 20-second high-intensity intervals (120-180 BPM) followed by 40-second recovery
- **`loseWeight`** - Steady-state Zone 2: Consistent Zone 2 heart rate (130-140 BPM)
- **`getStronger`** - Bursts: 15-second strength training bursts (110-170 BPM) with 75-second rest periods
- **`feelBetter`** - Low intensity: Gentle exercise (90-110 BPM)
- **`warmupRecovery`** - Warmup/recovery curve (same shape as `feelBetter`; different default parameters, e.g. base HR 80)

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

**Run tests** (Vitest 4; sources under `src/**/*.test.ts`):
```bash
npm run test:unit
npm run test:watch
```

The tests verify:
- Gaussian noise distribution is correct
- Noise stays within 2 BPM of the base curve
- All profiles produce expected heart rate patterns

### Web Dashboard

A local web dashboard is available on port 3000 with a user-friendly interface:

**Start the dashboard:**
```bash
npm run dashboard
```

Then open your browser to `http://localhost:3000`

**Features:**
- **Mode Toggle**: Switch between Live (BLE), Sim (simulator), and Replay (CSV replay) modes
- **WebSocket server**: Displays current WS URL and port (configurable at startup)
- **Sim / Replay**: Profile dropdown, data rate, interpolation, skip-ahead (Replay)
- **Scan for HRM**: 60s discovery-only scan; results shown in UI and sent to WebSocket client
- **Start/Stop**: Control the active stream (Live, Sim, or Replay)
- **System Log**: Real-time scrollable log; copy to clipboard

The dashboard uses Socket.io for real-time communication. HR data is broadcast over the WebSocket server (port 8080) to a single remote client.

## Features

- Verifies Noble state changes to 'poweredOn' before scanning
- Scans specifically for Heart Rate Service devices
- Logs device name, address, RSSI, and service UUIDs
- Handles state changes and errors gracefully

## Dependencies

Runtime (see `package.json` for versions):

- `noble-winrt` — Windows Runtime BLE (no native compilation for this path)
- `ws`, `express`, `socket.io` — WebSocket server and dashboard

Development:

- `typescript`, `@types/*` — compile-time types
- `vitest` — unit tests (`npm run test:unit`)

Functional requirements and NFRs are summarized in [`docs/requirements.md`](docs/requirements.md).
