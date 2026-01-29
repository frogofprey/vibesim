# Vibesim – Functional and Non-Functional Requirements

## Functional Requirements

### BLE / Live Mode
- **FR-1** Scan for BLE devices advertising the Heart Rate Service (UUID `180d`) and report name and device ID (address).
- **FR-2** Run a discovery-only HRM scan for a configurable duration (default 60 s), with optional early stop; report devices via `scan_device` and `scan_complete`.
- **FR-3** Connect to a specific BLE HRM by device ID (12 hex chars, optional colons); validate format; scan until device is seen (with HRM service), then connect; timeout after 30 s if not found.
- **FR-4** After connection, discover Heart Rate Measurement characteristic (`2a37`), subscribe to notifications, decode 8- and 16-bit HR values per BLE HRM spec.
- **FR-5** Apply a low-pass filter (0.6×current + 0.4×last) to HR before broadcasting.
- **FR-6** On BLE disconnect, send a `disconnected` action over the WebSocket and clean up listeners.
- **FR-7** Support a “stop HRM scan” action that ends an in-progress scan with the same cleanup as the timeout (no second scan concurrently).

### WebSocket Server
- **FR-8** Expose a WebSocket server on a configurable port (default 8080; `WS_PORT` or `--ws-port`; port in 1–65535).
- **FR-9** Enforce a single-client policy: at most one connected WebSocket client; a new connection closes the previous one.
- **FR-10** Broadcast heart rate messages as JSON: `device_id`, `date`, `hr`, `action` (`hr` or `disconnected`).
- **FR-11** Accept plain-text commands and reply with JSON:
  - **`scan`**: Start 60 s HRM scan; reply `scan_started` or `scan_rejected`; stream `scan_device` / `scan_complete`. Not allowed if a stream is active or a scan is already running.
  - **`connect:<deviceId>`**: Start live BLE session for that device; reply `connect_started`, `connect_rejected`, or `connect_failed` with error code. Not allowed if stream active or scan in progress.
  - **`stop`**: If HRM scan active → stop scan, set `isScanning` false, emit state, reply `stopped` (what: scan). If stream active → stop stream (BLE/Sim/Replay), set `isRunning` false, emit state, reply `stopped` (what: stream, mode). Else reply `stop_rejected` (nothing_to_stop).
- **FR-12** Send scan results as JSON (`scan_device`, `scan_complete` with devices list and duration).

### Simulator
- **FR-13** Provide four fitness profiles with time-based HR curves: `getFitter` (HIIT), `loseWeight` (Zone 2), `getStronger` (bursts), `feelBetter` (low intensity).
- **FR-14** Add configurable Gaussian noise (default 2 BPM variance) to simulated HR; apply the same low-pass filter as Live.
- **FR-15** Allow configurable profile parameters (cycle lengths, HR bounds, etc.) and support changing profile and parameters while Sim is running.
- **FR-16** Emit simulated HR in the same JSON format as the WebSocket server; support start/stop and variance updates while running.

### Replay
- **FR-17** Replay HR from CSV files (e.g. `profile1.csv`, `profile2.csv`, `profile3.csv`) with columns time and heart rate.
- **FR-18** Support configurable replay data rate (0.1–2.0 Hz) and optional interpolation so replay can run at a different rate than the source data.
- **FR-19** Support “skip ahead” by one minute in replay time while replay is running.
- **FR-20** Apply configurable noise variance to replayed HR; support toggling interpolation on/off (when not running).

### Dashboard (UI and Control)
- **FR-21** Provide a web UI (HTTP on port 3000) with mode toggle: Live (BLE), Sim, Replay.
- **FR-22** Show WebSocket server URL and port; allow Start/Stop for the active stream (Live, Sim, or Replay).
- **FR-23** For Sim: profile dropdown, noise variance, and (when applicable) profile parameters; for Replay: profile, data rate, interpolation toggle, skip-ahead control.
- **FR-24** Provide “Scan for HRM” to start a 60 s discovery scan; show results in the UI and send them to the WebSocket client.
- **FR-25** Keep dashboard state in sync with the server (mode, isRunning, isScanning, profile, replay/data rate, etc.) via Socket.io (e.g. `state`, `setMode`, `start`, `stop`, `scanComplete`, `scanDevice`, etc.).
- **FR-26** Show a real-time, scrollable system log (console + app messages); support copying log to clipboard; optional filter (e.g. hide interpolated messages).

### Application Lifecycle
- **FR-27** Start both WebSocket server and dashboard from one entry point (`npm start` / `main`).
- **FR-28** Support graceful shutdown: stop any active stream (BLE/Sim/Replay), close Socket.io, close HTTP server, close WebSocket server, then exit with code 0.
- **FR-29** Support shutdown via keyboard: “q” + Enter in the terminal (when stdin is a TTY) to trigger the same graceful shutdown without relying on Ctrl+C.
- **FR-30** If shutdown does not complete within a set time (e.g. 4 s), exit anyway (timeout fallback); ensure shutdown runs only once (guard against repeated “q” or Ctrl+C).

---

## Non-Functional Requirements

### Platform and Environment
- **NFR-1** Run on Node.js (v16+), TypeScript build to JavaScript.
- **NFR-2** Support Windows 11 for BLE; use `noble-winrt` (no native compilation).
- **NFR-3** WebSocket server port configurable via environment (`WS_PORT`) or CLI (`--ws-port`); invalid port fallback to default 8080.

### Performance and Capacity
- **NFR-4** Retain at most the last 1000 log messages in memory; older entries are discarded.
- **NFR-5** Replay data rate limited to 0.1–2.0 Hz; simulator and replay use the same HR message format and filtering as Live.

### Usability and Robustness
- **NFR-6** Single WebSocket client: new connection displaces the previous one; no multi-client broadcast.
- **NFR-7** Reject invalid operations with clear replies (e.g. `scan_rejected`, `connect_rejected`, `stop_rejected`) and error codes/messages.
- **NFR-8** Do not allow starting a stream or connect while another stream is active or an HRM scan is in progress; do not allow starting a scan while a stream is active or a scan is already running.

### Reliability and Operability
- **NFR-9** On BLE disconnect, clean up listeners and broadcast `disconnected`; avoid leaving stale subscriptions.
- **NFR-10** Graceful shutdown must close Socket.io, then HTTP server, then WebSocket server, with a timeout so the process always exits (e.g. within 4 s).

### Maintainability and Quality
- **NFR-11** Use TypeScript and standard Node/Express/Socket.io/ws types where applicable.
- **NFR-12** Unit tests (e.g. Vitest) for simulator behavior (noise distribution, profile curves); optional test client/server for WebSocket single-client and message flow.

### Security and Configuration
- **NFR-13** No authentication in the current design; dashboard and WebSocket server are intended for local or controlled use.
- **NFR-14** CORS for Socket.io allowed for all origins (`*`) to support local dashboard access.

---

*Derived from the vibesim codebase (src/, public/, README.md, package.json).*
