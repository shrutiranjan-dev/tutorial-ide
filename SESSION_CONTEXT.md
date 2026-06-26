# Session Context — Code Workbench (tutorial-ide)

> Saved: 2026-06-26
> Branch: `code`
> Goal: Close all gaps between the Code Workbench Electron GUI and the opencode-ai engine v2 HTTP API to achieve 1:1 parity.

---

## Architecture

- **Stack**: Electron + React + Vite + TypeScript
- **IPC bridge**: `preload.cjs` exposes `window.tutorialIde` via `contextBridge`
- **Engine**: Vendored opencode-ai engine at `vendor/code/`, communicates via HTTP to `127.0.0.1:<dynamic-port>`
- **Config**: `opencode.json` per project; `.opencode/mcp.json` for MCP servers
- **CSS**: `src/styles.css` (~10k lines, consolidated from ~8.9k)

### Key files
| File | Lines | Purpose |
|---|---|---|
| `electron/main.cjs` | ~6070 | Main Electron process — IPC handlers, engine server, session/event logic |
| `electron/preload.cjs` | ~166 | Context bridge exposing `window.tutorialIde` API |
| `src/App.tsx` | ~4170 | React renderer — all UI (AgentPanel, Sidebar, Terminal, overlays) |
| `src/styles.css` | ~10002 | All component styles |
| `src/types.ts` | ~860 | TypeScript definitions for all IPC payloads and returns |
| `src/main.tsx` | ~12 | Entry point with error boundary |

---

## Completed Waves

### Wave 1 — CSS consolidation
- Deduplicated 15 duplicate `.opencode-agent` root blocks into one
- Added all 166 missing child selectors to final section
- CSS grew 8872 → 9429 lines (later ~10k with config/MCP styles)

### Wave 2a — SSE event streaming
- Replaced 700ms polling loop with SSE-driven message collection
- Added `POST /api/session/:id/wait` for long-poll fallback
- Expanded event handling from 6 → all 44+ event types
- Eliminated 257 unnecessary polling requests per session

### Wave 2b — Session CRUD v2
- Migrated from legacy `/session/*` to v2 `/api/session/*` with legacy fallback
- Added session compact API + UI
- Added revert stage / clear / commit (3-step revert workflow)
- Added cursor-based pagination for sessions and messages

### Wave 3a — Model/Agent API
- Replaced CLI `opencode models` parsing with `GET /api/model`
- Added per-session model switch: `POST /api/session/:id/model`
- Added per-session agent switch: `POST /api/session/:id/agent`
- Added agent listing from `GET /api/agent`

### Wave 3b — Provider/OAuth API
- Migrated provider listing from 12 hardcoded → `GET /api/integration`
- Migrated OAuth to v2 `/api/integration/:id/connect/*` with attemptID tracking
- Added OAuth attempt polling, cancel
- Added credential CRUD (list, update, delete)

### Wave 4a — Agent selector UI
- Replaced hardcoded `agent: "build"` with `selectedAgent` state
- Agent dropdown shows all agents from engine
- Agent passed through session creation and prompt payloads

### Wave 4b — Q&A / Skills / References
- Q&A: list requests, reply, reject with UI cards
- Skills listing from `GET /api/skill`
- References listing from `GET /api/reference`

### Wave 4c — Granular permissions
- Replaced 3 coarse modes with 13 per-tool toggles (allow/ask/deny)
- Saved permissions listing and revocation UI

### Wave 5a — Engine FS API
- `files:list` → `GET /api/fs/list`
- `files:read` → `GET /api/fs/read/*`
- `workspace:search` → `GET /api/fs/find`
- Writes (create/delete/rename/duplicate) kept as Electron IPC only

### Wave 5b — Engine PTY API
- Engine PTY attempted first; falls back to `node-pty`
- HTTP polling every 200ms for engine PTY output (no WebSocket)
- `POST /api/pty` create, `PUT /api/pty/:id` resize, `DELETE /api/pty/:id` kill

### Wave 6a — Server Management
- Health checks via `GET /api/health` (polled every 30s)
- Server location via `GET /api/location`
- Status bar shows green/red dot, uptime, port, version

### Wave 6b — Config Editing UI
- Structured config editor (General / Providers / Agents / Rules / JSON tabs)
- `opencode:readConfig` / `opencode:writeConfig` IPC handlers
- Engine config via `GET /config` and `GET /config/providers`

### Wave 6c — MCP / CLI / Project Copy
- MCP config editor: read/write `.opencode/mcp.json`, list/add/remove servers
- Project copy via `fsp.cp` (recursive)
- CLI command palette: `code run`, `code install`, `code update --check`, `code models`

---

## Bugs Fixed

| Bug | Root cause | Fix |
|---|---|---|
| `Unexpected identifier '$'` on `main.cjs:3003` | Unescaped `` \` `` in template literal | `` \`${profile.entryFile}\` `` → `` \`\\`${profile.entryFile}\\`\` `` |
| `Unexpected identifier '$'` on `main.cjs:3026` | Same pattern | `` \`\\`${profile.checkpointCommand}\\`\` `` |
| `Cannot access 'loadConfigIntoEditor' before initialization` | `const` TDZ — `loadConfigIntoEditor`/`loadMCPConfig` defined after `commands` array referencing them | Moved definitions above `commands` |
| `No handler registered for 'opencode:agents'` | 22 IPC preload methods never wired in `main.cjs` | Added all 22 handlers with correct v2 API routes |
| Wrong API paths in 10 handlers | OAuth, Q&A, credential, permission handlers used incorrect v2 routes | Fixed: `/api/permission` → `/api/permission/saved`, `/api/questions/` → `/api/session/:id/question/`, etc. |

---

## Remaining Feature Gaps (non-critical)

| Engine API | GUI Status |
|---|---|
| `/api/provider` / `/api/integration` | Uses hardcoded list + Ollama sync, not v2 provider API |
| `/api/integration/:id/connect/key` | Key-based auth not integrated |
| `/api/session/:id/context` | Session context not exposed |
| `/vcs/*` (diff/status/apply) | Uses git CLI directly, not engine API |
| `/mcp/:name/connect` / disconnect | GUI only reads/writes `mcp.json`, no connect/disconnect |
| `/project/*` | Not used |
| `/experimental/*` | None exposed |
| `/global/config` PATCH | No write endpoint for global config |
| PTY WebSocket | HTTP polling only; no WS `/api/pty/:id/connect` |

---

## Key Design Decisions

- **Try-v2-first with legacy fallback**: All v2 API integration attempts the v2 route first, falls back to legacy route for backward compatibility
- **SSE replaces polling**: Real-time events use SSE; `POST /api/session/:id/wait` replaces 180s polling
- **Writes stay on Electron IPC**: Create/delete/rename/duplicate files kept on IPC since engine has no write endpoints
- **Granular permissions**: 13 per-tool modes internally, converted to engine's permission rules format on prompt
- **Terminal uses engine PTY first**: Engine PTY via HTTP polling with node-pty as fallback

---

## Build & Run

```bash
npm run dev          # Start Vite + Electron concurrently
npx vite build       # Production build
npm start            # Run Electron-only (after build)
```

Current build: ~6s, 1710 modules, 623KB JS + 117KB CSS output.
