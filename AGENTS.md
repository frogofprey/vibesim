# AGENTS Guide for vibesim

## Purpose
Use this file as the first-stop context index for new agent sessions working in this repository.

## Project Snapshot
`vibesim` is a Node.js/TypeScript app for heart-rate streaming across three modes:
- **Live**: BLE heart-rate monitor input
- **Sim**: synthetic profile-driven heart-rate generation
- **Replay**: CSV-backed heart-rate playback

It exposes:
- A dashboard UI (`http://localhost:3000`)
- A single-client WebSocket stream server (default `ws://localhost:8080`)

Start with [`README.md`](README.md) for operational commands and runtime flow.

## Canonical Docs (Read First)
1. [`README.md`](README.md)  
   Setup, build/run commands, mode usage, and developer workflow.
2. [`docs/requirements.md`](docs/requirements.md)  
   Functional/non-functional contracts and behavior expectations.

When behavior is unclear, treat `docs/requirements.md` as the source of truth and align implementation/docs accordingly.

## Quickstart Commands
- Install deps: `npm install`
- Build: `npm run build`
- Start full app: `npm start`
- Dashboard only: `npm run dashboard`
- WebSocket server only: `npm run server`
- Unit tests: `npm run test:unit`

Platform notes:
- BLE path targets Windows 11 (`noble-winrt`)
- Development/test baseline is Node 20/22/24+

## High-Impact Behavior Guardrails
- Keep **single WebSocket client** policy intact.
- Preserve command semantics for `scan`, `connect:<deviceId>`, and `stop`.
- Preserve stream/scan mutual exclusion behavior.
- Preserve graceful shutdown/disconnect cleanup behavior.

See [`docs/requirements.md`](docs/requirements.md) for exact FR/NFR details and error semantics.

## Change Expectations
- If protocol or stream behavior changes, update tests.
- Before handoff, run at least:
  - `npm run build`
  - `npm run test:unit`
- If behavior or operator workflow changes, update:
  - [`README.md`](README.md)
  - [`docs/requirements.md`](docs/requirements.md)

## Session Checklist
Before coding:
- Read `README.md` and the relevant section(s) of `docs/requirements.md`.
- Confirm which mode(s) (Live/Sim/Replay) are affected.

Before handoff:
- Verify build/tests pass.
- Verify docs are updated for any behavior changes.
- Call out any assumptions or unresolved risks.
