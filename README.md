# vibesim

`vibesim` is a Node.js/TypeScript heart-rate streaming app with three operating modes:
- **Live**: Connect to a BLE HRM (Heart Rate Service `180d`)
- **Sim**: Generate synthetic heart-rate profiles
- **Replay**: Stream HR data from CSV timelines

Runtime surfaces:
- Dashboard UI on `http://localhost:3000`
- Single-client WebSocket server on `ws://localhost:8080` by default

## Prerequisites

- **Node.js 20, 22, or 24+** (development and unit-test baseline)
- **Windows 11** (for BLE Live mode via `noble-winrt`)
- Bluetooth adapter enabled (for Live mode)

## Install and Build

```bash
npm install
npm run build
```

`noble-winrt` is JavaScript-only in this setup (no native build tools required).  
`package.json` includes `overrides` so `noble`/`noble-winrt` use a current `debug` release.

## Run Options

Build first (`npm run build`), then choose one:

- Full app (dashboard + WebSocket server):
  ```bash
  npm start
  ```
- Dashboard process (also starts the WebSocket server module):
  ```bash
  npm run dashboard
  ```
- WebSocket server only:
  ```bash
  npm run server
  ```
- Simulator CLI:
  ```bash
  npm run simulator [profile] [deviceId] [variance]
  ```

Example simulator commands:
```bash
npm run simulator getFitter
npm run simulator loseWeight simulator-002 2
```

Optional BLE diagnostic scan script:
```bash
npm test
```

## Configuration

### WebSocket server port

Default port is `8080`. Configure with:

- Environment variable: `WS_PORT=8081 npm start`
- CLI arg: `npm start -- --ws-port 8081`

Valid range: `1..65535`. Invalid values fall back to `8080`.

## Runtime Behavior

- Dashboard controls mode/state for Live, Sim, and Replay.
- HRM discovery scan is separate from streaming and cannot run concurrently with an active stream.
- WebSocket server enforces **single-client** policy (new connection closes prior one).
- Graceful shutdown path is supported through Ctrl+C (`SIGINT`) or `q` + Enter in TTY mode.

## Remote WebSocket API

Remote clients send plain-text commands to the WS server:

| Message | Description |
|--------|-------------|
| `scan` | Start a 60s discovery scan (no stream). Replies with `scan_started` or `scan_rejected`; streams `scan_device` and `scan_complete`. |
| `connect:<deviceId>` | Start a Live BLE session for a specific device ID (BLE address with or without colons). Replies with `connect_started`, `connect_rejected`, or `connect_failed`. |
| `stop` | Stop the active HRM scan or stream session. Replies with `stopped` or `stop_rejected` (`nothing_to_stop`). |

Common connect errors:
- `session_already_active`
- `scan_in_progress`
- `invalid_device_id`
- `address_all_zeros`
- `device_not_found`
- `connection_failed`

Heart-rate broadcast payloads include:
- `device_id`
- `date` (ISO timestamp)
- `hr`
- `action` (`hr` or `disconnected`)

## Testing

Unit tests (Vitest):
```bash
npm run test:unit
npm run test:watch
```

Current unit coverage focuses on simulator behavior (including distribution and profile-shape expectations).

Manual WebSocket smoke test:
1. Start broadcaster:
   ```bash
   npm run test-server
   ```
2. Run test client:
   ```bash
   npm run test-client
   ```

`test-server` imports the server module, so do **not** run `npm run server` in parallel for this smoke path.

## References

- Behavior contracts: [`docs/requirements.md`](docs/requirements.md)
- Runtime/dependency scripts: [`package.json`](package.json)
