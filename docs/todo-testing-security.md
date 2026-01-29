# Testing & Security Todo List (by segment)

## Segment 1: Testing – Pure logic (no I/O)

**Goal:** Add unit tests for pure functions and small modules that don’t need servers or BLE.

1. **BLE controller – validation and decoding**
   - [ ] Add `ble-controller.test.ts` (or similar) that tests:
     - `normalizeAddress()` for valid/invalid formats (colons, no colons, wrong length, non-hex).
     - `isValidBleDeviceId()` for valid 12‑hex IDs and invalid cases.
     - `decodeHeartRateMeasurement()` for 8‑bit and 16‑bit HR payloads and invalid/short buffers.
   - Use Vitest; mock or avoid `noble`/`server` if needed (e.g. test file that only imports the functions you export or extract for testing).

2. **Server – port and message parsing**
   - [ ] Add `server.test.ts` that tests:
     - Port resolution from `process.env.WS_PORT` and `process.argv` (e.g. `--ws-port`), and fallback to default; invalid port handling.
     - Parsing of incoming message text: `"scan"`, `"stop"`, `"connect:XX:XX:..."`, empty/whitespace, very long string (if you add a max length).
   - May require starting the server in tests or refactoring so “resolve port” and “parse message” are in testable functions.

3. **Replay controller – CSV and interpolation**
   - [ ] Add `replay-controller.test.ts` that tests:
     - `parseCSV()` with valid CSV, empty lines, invalid numbers, missing columns (if exposed or via a small test helper).
     - Interpolation logic (e.g. `interpolateDataPoints()` or the function that uses it) for a fixed input: expected number of points and that interpolated points sit between originals.
     - `skipAheadOneMinute()` behavior (e.g. current index or time advances by 60s worth of data) with a minimal in-memory dataset.
   - Use fixtures (e.g. small CSV strings/files in `src/__fixtures__` or inline) and avoid relying on `profile1.csv` in repo root if you want tests to be hermetic.

4. **Simulator – extend coverage**
   - [ ] Add tests for edge cases: variance 0, very large variance, `validateProfileParameters()` with invalid/missing fields (if you expose or refactor it).
   - [ ] Add tests for `getBaseHeartRate()` (or equivalent) for all four profiles at a few time points to lock in expected curves.

**Exit criteria for Segment 1:** All new tests run with `npm run test:unit`; no new failing tests.

---

## Segment 2: Testing – Integration (servers, WebSocket, Socket.io)

**Goal:** Automate tests that hit the real WebSocket server and/or dashboard (no BLE hardware).

5. **WebSocket server – commands and replies**
   - [ ] Add an integration test (e.g. `server.integration.test.ts` or a small Node script run by Vitest) that:
     - Connects a client to the WebSocket server (start server in test or use a known port).
     - Sends `scan`, `stop`, `connect:AA:BB:CC:DD:EE:FF` and asserts reply shape (e.g. `action`, `error` or `what`) and status.
     - Optionally: new client kicks previous one (single-client policy).
   - Use `ws` client; consider `beforeAll`/`afterAll` to start/stop server.

6. **Dashboard – state and Socket.io**
   - [ ] Add integration tests that:
     - Connect to the dashboard HTTP + Socket.io (e.g. port 3001 in test to avoid clashing with dev).
     - Emit `setMode`, `setProfile`, `start`, `stop`, `setNoiseVariance`, `setReplayDataRate` with valid values and assert:
       - `state` events or one-off state response match (e.g. `mode`, `isRunning`, `profile`).
     - Emit invalid or out-of-range values and assert an `error` event or equivalent.
   - Start dashboard in test lifecycle or use a test script; keep tests fast (e.g. short timeouts).

7. **Optional: graceful shutdown**
   - [ ] Add a test that starts the app (or dashboard + WS server), triggers shutdown (e.g. send a custom Socket.io event that calls graceful shutdown, or trigger the same path as ‘q’), and asserts process exits with code 0 within a timeout (e.g. 5s). This can live in the same integration suite or a small script.

**Exit criteria for Segment 2:** Integration tests run in CI (or via `npm run test:integration` if you add the script); no flakiness from port conflicts.

---

## Segment 3: Testing – Documentation and CI

**Goal:** Make test coverage and runs explicit and repeatable.

8. **Scripts and docs**
   - [ ] Add `npm run test:integration` (or `test:ws` / `test:dashboard`) that runs the integration tests from Segment 2.
   - [ ] In README (or `docs/testing.md`), document: unit tests (`test:unit`), integration tests, and manual BLE test (`npm test` / `ble-test.js`).
   - [ ] Optionally: add `npm run test:coverage` (Vitest coverage) and document current coverage (simulator vs rest of codebase).

9. **CI**
   - [ ] Add a CI workflow (e.g. GitHub Actions) that runs `npm ci`, `npm run build`, `npm run test:unit`, and integration tests if feasible (and optionally coverage). Exclude BLE tests or run them only on Windows if needed.

**Exit criteria for Segment 3:** One command runs all automated tests; README/CI describe how to run them.

---

## Segment 4: Security – Input validation and hardening

**Goal:** Reduce risk from malicious or malformed input without changing product behavior for normal use.

10. **WebSocket server**
    - [ ] Reject or truncate oversized messages (e.g. max length 512 or 1024 bytes for text commands) to avoid DoS or memory issues.
    - [ ] After parsing `connect:<deviceId>`, ensure deviceId is validated (e.g. length and format) before passing to dashboard; document that `isValidBleDeviceId()` is the single source of truth.
    - [ ] Log (and optionally metrics) repeated invalid or rejected commands from the same client to detect abuse.

11. **Dashboard Socket.io**
    - [ ] Validate every incoming event payload: type and range (e.g. `setMode`: one of `Live` | `Sim` | `Replay`; `setNoiseVariance`: number in [0, 10]; `setReplayDataRate`: number in [0.1, 2]; `setProfile`, `setReplayProfile`: allowed enum values).
    - [ ] Validate `setProfileParameters`: require `profile` and `params` to exist, and validate `params` per profile (e.g. numbers in expected ranges, no NaN/Infinity). Reject malformed payloads with a generic error message (no stack trace to client).
    - [ ] Ensure no Socket.io handler passes client input into `eval`, `Function`, or file paths; confirm replay only uses `profile1`/`profile2`/`profile3` for file names (already the case in current code).

12. **Replay and file access**
    - [ ] Keep replay file loading strictly to the three profiles (no user-supplied paths). If you ever add “custom CSV path”, validate and sanitize (e.g. resolve to a single directory and reject `..`).
    - [ ] Optionally: add a simple schema or type guard for parsed CSV rows (time number, heartRate number, both finite) before using them in interpolation.

**Exit criteria for Segment 4:** All external inputs (WS messages, Socket.io events) are validated and bounded; no new path traversal or injection surfaces.

---

## Segment 5: Security – Auth, CORS, and operations

**Goal:** Document and, if needed, narrow exposure; optional hardening for non-local use.

13. **Document security model**
    - [ ] In `docs/requirements.md` or a new `docs/security.md`, document:
      - No authentication; dashboard and WebSocket server are for local/trusted use only.
      - CORS: Socket.io allows any origin (`*`); acceptable because use case is local.
      - Recommend not exposing the app to the public internet without adding auth and locking CORS.
    - [ ] Add a short “Security” section in README pointing to that doc and to “run only on localhost / trusted network”.

14. **Optional: tighten CORS**
    - [ ] If the dashboard is only ever used from one origin (e.g. `http://localhost:3000`), restrict Socket.io CORS to that origin instead of `*` (e.g. in dashboard server options).

15. **Dependencies**
    - [ ] Run `npm audit` and document or fix high/critical issues; add `npm run audit` or `npm audit` to README/CI.
    - [ ] Pin major versions in `package.json` where reasonable (you already use `^`; document that `npm ci` is preferred for reproducible installs).

**Exit criteria for Segment 5:** Security assumptions and optional hardening are documented; dependency audit is run regularly.

---

## Suggested order of work

| Order | Segment   | Focus                          |
|-------|-----------|---------------------------------|
| 1     | Segment 1 | Unit tests for BLE, server, replay, simulator |
| 2     | Segment 4 | Input validation and message size limits |
| 3     | Segment 2 | WebSocket and dashboard integration tests |
| 4     | Segment 3 | Scripts, README, CI             |
| 5     | Segment 5 | Security docs, CORS, audit      |

You can do Segment 1 and 4 in parallel (different files). Segment 2 depends on Segment 1 only in the sense that having solid unit tests makes integration failures easier to interpret.
