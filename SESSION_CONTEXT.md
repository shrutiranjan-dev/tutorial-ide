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

### Wave 7 — Step 6-9 OpenCode Parity Surfaces
- Session context bridge: `opencode:sessionContext` reads `/api/session/:id/context` with legacy fallback
- Agent context UI: compact counts for messages, tools, todos, diff, permissions, tokens, and recent messages
- VCS bridge: `opencode:vcsStatus`, `opencode:vcsDiff`, `opencode:vcsStage`, `opencode:vcsUnstage` try engine routes first and fall back to local git
- GUI VCS controls: agent strip exposes refresh, diff, stage, and unstage without opening the terminal UI
- MCP bridge: `opencode:mcpConnect` / `opencode:mcpDisconnect` call engine MCP connection routes
- MCP GUI controls: MCP popover shows configured servers, connection status, connect/disconnect actions, integrations, and engine commands
- Global config bridge: `opencode:globalConfig` and `opencode:writeGlobalConfig` expose `/global/config` read/write fallback routes
- Provider/auth surface: compact provider readiness/auth-needed status and credential-aware connect/manage actions remain in the Codex-style panel

### Wave 8 — Steps 1-2 Parity Audit + Engine Client
- Added `npm run check:parity` to generate `docs/OPENCODE_PARITY_MATRIX.md` from `vendor/code/specs/v2/api.html`
- Parity matrix compares upstream operations against `electron/main.cjs`, `electron/opencode-client.cjs`, `electron/preload.cjs`, and `src/types.ts`
- Previous generated counts: 67 upstream operations, 15 exact route matches, 41 partial surfaces, 11 missing surfaces
- Added `electron/opencode-client.cjs` as the central Code engine HTTP adapter
- Existing `openCodeFetch`, `openCodeFetchFirst`, query helpers, JSON helpers, unwrap, and array helpers now delegate through the client
- Session context, VCS status/diff/stage/unstage, MCP connect/disconnect, and global config read/write route-family helpers now call typed client methods

### Wave 9 — Steps 3-5 Composer, Runtime Fidelity, Patch Apply
- Composer model selection now calls the active-session model switch handler instead of only changing local UI state
- Selected Code agent now reaches the backend prompt path; session keys include agent name so agent switches do not reuse the wrong `build` session
- Runtime reducer now preserves long assistant responses and treats “Code completed with N tool steps” as a fallback only, not a replacement for real text
- Final polling waits longer before accepting tool-only completion and refreshes messages once before settling
- Added engine-first `vcs.applyPatch` client support for `/api/vcs/patch`, `/api/vcs/apply`, `/vcs/patch`, and `/vcs/apply`
- Added `opencode:vcsPatch` / `opencode:vcsApply` IPC and preload/browser/type coverage with local `git apply` fallback
- Agent diff cards now expose an `Apply patch` action when patch content is available
- Current generated parity counts: 67 upstream operations, 16 exact route matches, 40 partial surfaces, 11 missing surfaces

### Wave 10 — Steps 6-9 Formatter, FS, LSP, PTY Parity
- Added engine-first client support for formatter status, LSP status, file tree, file read, file search, grep, and PTY create/list/get/update/delete route families
- Added IPC handlers for `opencode:formatterStatus`, `opencode:lspStatus`, `opencode:fsTree`, `opencode:fsFile`, `opencode:fsSearch`, `opencode:fsGrep`, and `opencode:pty*`
- `workspace:search` now tries the engine `fs.grep` path first, then falls back to local workspace search
- Added preload bridge, browser-preview stubs, and TypeScript bridge contract coverage for the new engine route families
- Updated `scripts/generate-opencode-parity.cjs` so formatter, FS, LSP, PTY, and VCS patch/apply routes count against parity
- Current generated parity counts: 67 upstream operations, 27 exact route matches, 40 partial surfaces, 0 missing surfaces

### Wave 11 — Steps 10-12 Full Route Parity Closure
- Added exact v2 client adapters for session diff/todo/wait, config get/update, auth CRUD/activate, catalog model list/get, event subscribe, MCP prompt/resource/server/OAuth routes, permission list/reply, question list/reply/reject, VCS get, project, and workspace routes
- Existing session diff/todo, permission, event stream, config read, VCS, question, project-list, and workspace/project bridges now prefer exact engine routes where practical while keeping old fallbacks
- Added IPC, preload, browser-preview stubs, and TypeScript bridge coverage for the new callable surfaces
- Updated parity generation so all new route families are tracked against their explicit bridge methods
- Current generated parity counts: 67 upstream operations, 67 exact route matches, 0 partial surfaces, 0 missing surfaces

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
| Parity matrix | Generated by `npm run check:parity`; use it as the source of truth for next gap selection |
| `/api/provider` / `/api/integration` | Provider/integration state is integrated, but provider UX can still be refined |
| `/api/integration/:id/connect/key` | API-key auth is available through provider actions, but needs better non-prompt forms |
| `/vcs/apply` | Integrated through engine-first patch/apply routes with local `git apply` fallback and GUI diff action |
| `/project/*` | Exact engine project routes are now bridged; current UI still mainly uses local project picker flows |
| `/experimental/*` | None exposed |
| `/global/config` PATCH | Bridge exists; dedicated global-config editor is still light |
| PTY WebSocket | HTTP polling only; no WS `/api/pty/:id/connect` |
| Formatter/FS/LSP/PTY HTTP routes | Integrated through engine-first adapters with local/browser fallbacks where practical |

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

Latest verification after Wave 11:

```bash
node --check electron/main.cjs
node --check electron/opencode-client.cjs
node --check electron/preload.cjs
node --check scripts/generate-opencode-parity.cjs
npm run check:bridge
npm run build
npm run check:parity
npm audit --audit-level=moderate
git diff --check
```

All passed. Current Vite output is ~659KB JS + 136KB CSS with the existing large-chunk warning.
