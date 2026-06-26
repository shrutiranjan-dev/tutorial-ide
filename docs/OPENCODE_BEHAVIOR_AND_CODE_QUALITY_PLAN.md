# OpenCode Behavior And Code Quality Comparison Plan

Manual audit date: 2026-06-26

This document compares the current Code Workbench implementation with the vendored OpenCode codebase. It is intentionally different from `docs/OPENCODE_PARITY_MATRIX.md`: that generated file measures route/API coverage, while this file measures behavior, runtime logic, safety, large-codebase handling, tool orchestration, UI fidelity, and code quality.

## Goal

Make Code Workbench behave like a GUI-native OpenCode/Codex-style assistant while preserving our product identity:

- no OpenCode branding in the UI,
- local Ollama-first model selection,
- OpenCode provider compatibility,
- GUI composer instead of launching the OpenCode TUI,
- engine behavior parity for sessions, tools, permissions, files, diffs, context, and streaming.

## Source Map

### Our Codebase

| Area | Main files |
| --- | --- |
| Electron bridge | `electron/main.cjs`, `electron/opencode-client.cjs`, `electron/preload.cjs` |
| GUI runtime | `src/App.tsx`, `src/agentRuntime.ts`, `src/types.ts`, `src/browserApi.ts` |
| Styling | `src/styles.css` |
| Generated API parity | `scripts/generate-opencode-parity.cjs`, `docs/OPENCODE_PARITY_MATRIX.md` |
| Project memory | `read.md`, `SESSION_CONTEXT.md` |

### Vendored OpenCode

| Area | Main files |
| --- | --- |
| Prompt turn lifecycle | `vendor/code/packages/opencode/src/cli/cmd/run/stream.transport.ts`, `vendor/code/packages/opencode/src/cli/cmd/run.ts` |
| Session processing | `vendor/code/packages/opencode/src/session/prompt.ts`, `vendor/code/packages/opencode/src/session/tools.ts`, `vendor/code/packages/opencode/src/session/session.ts`, `vendor/code/packages/opencode/src/session/message-v2.ts` |
| Permissions | `vendor/code/packages/opencode/src/permission/index.ts`, `vendor/code/packages/opencode/src/permission/arity.ts` |
| Tools | `vendor/code/packages/opencode/src/tool/read.ts`, `write.ts`, `edit.ts`, `glob.ts`, `grep.ts`, `shell.ts`, `task.ts`, `lsp.ts`, `truncate.ts` |
| Diffs/revert | `vendor/code/packages/opencode/src/session/revert.ts`, `vendor/code/packages/opencode/src/snapshot` |
| Prompts/modes | `vendor/code/packages/opencode/src/session/prompt/*.txt`, `vendor/code/packages/opencode/src/tool/plan.ts` |

## Executive Verdict

The current app is **API-surface close** but **behavior-parity incomplete**.

`npm run check:parity` can show full route coverage, but that does not mean:

- large output is preserved,
- message completion is correct,
- tool state is faithfully rendered,
- permissions match OpenCode rules,
- file reads/writes are scalable,
- context is attached the way OpenCode expects,
- session history and compaction work like OpenCode,
- code quality is maintainable.

The biggest remaining gap is not the existence of endpoints. It is that our GUI still wraps OpenCode with custom polling, custom context strings, custom file IPC, broad wildcard permissions, and summarized tool output. OpenCode already has deeper logic for all of these.

## Current Evidence Snapshot

This section records the concrete code areas that prove the current state. Use it when deciding whether a future change is real parity work or only UI polish.

### Code Workbench Anchors

| Concern | Current file/function | What it proves |
| --- | --- | --- |
| Permission presets | `electron/main.cjs` `permissionRulesForMode()` and `normalizePermissionRules()` | The backend can send OpenCode-shaped rules, but our default UI still creates broad wildcard allow/ask/deny rules. |
| Session keying | `electron/main.cjs` `openCodeSessionKey()` | Sessions are keyed by project, model, permission signature, and agent. This is useful, but can create multiple threads when a busy session should maybe queue or fork explicitly. |
| GUI prompt execution | `electron/main.cjs` `runGuiAgentCommand()` | The GUI still owns completion loops, message polling, event bridging, slash-command fallback, and final-result selection. |
| Engine event stream | `electron/main.cjs` `streamOpenCodeEvents()` | We are consuming OpenCode events, but only a normalized subset reaches React. Full part metadata is not yet rendered. |
| Message reads | `electron/main.cjs` `readOpenCodeMessages()` | The GUI still depends on bounded message reads for final output recovery. This is fragile in long sessions. |
| Manual explorer tree | `electron/main.cjs` `listFiles()` | The explorer recursively loads directories, skipping common heavy folders but not lazy-loading every node like a large workspace needs. |
| Manual workspace search | `electron/main.cjs` `searchWorkspace()` and `symbolSearch()` | Search and symbols are local JS implementations with file-size caps and regex heuristics, not full OpenCode/ripgrep/LSP parity. |
| Manual editor IO | `electron/main.cjs` `files:read` and `files:write` IPC handlers | Manual file open/save is full-buffer UTF-8. It bypasses OpenCode's read/write safety, truncation, binary detection, and diagnostics. |
| GUI context builder | `src/App.tsx` `contextPrompt()` | We inject bounded context as prompt text. This works, but it is not the same as OpenCode's structured file parts and tool-first inspection model. |
| Tool cards | `src/App.tsx` tool summarizers and `src/agentRuntime.ts` reducer | The GUI displays tool activity, but still compresses some details that OpenCode keeps as metadata, attachments, output paths, and states. |

### OpenCode Anchors

| Concern | OpenCode file/function | What OpenCode does |
| --- | --- | --- |
| Read safety | `vendor/code/packages/opencode/src/tool/read.ts` `ReadTool` | Streams files, supports `offset`/`limit`, caps bytes and line length, detects binary files, supports images/PDFs, warms LSP, asks read permission. |
| Write safety | `vendor/code/packages/opencode/src/tool/write.ts` `WriteTool` | Asks edit permission with diff metadata, preserves BOM, writes directories safely, formats, emits filesystem events, returns diagnostics. |
| Edit safety | `vendor/code/packages/opencode/src/tool/edit.ts` `EditTool` | Validates exact replacements, rejects risky empty edits, locks files, preserves line endings/BOM, formats, reports diagnostics. |
| Search | `vendor/code/packages/opencode/src/tool/glob.ts` and `grep.ts` | Uses ripgrep services, permission checks, result limits, and truncation hints. |
| Shell | `vendor/code/packages/opencode/src/tool/shell.ts` and `tool/shell/prompt.ts` | Parses commands, asks command-pattern permissions, handles cwd/external dirs/timeouts, truncates output and stores full output. |
| Tool orchestration | `vendor/code/packages/opencode/src/session/tools.ts` `resolve()` | Resolves model/provider/agent-specific tools, MCP resources, plugin hooks, permission context, and tool metadata. |
| Permission engine | `vendor/code/packages/opencode/src/permission/index.ts` `evaluate()` | Uses ordered wildcard rules by permission and pattern; last matching rule wins. |
| Completion | `vendor/code/packages/opencode/src/cli/cmd/run.ts` run loop and stream transport | Watches event stream and `session.status`; completion is status-driven, not guessed from stable text. |
| Compaction/history | `vendor/code/packages/opencode/src/session/compaction.ts`, `summary.ts`, `message-v2.ts` | Treats messages, summaries, and replay as first-class session data rather than renderer-local state. |

## Parity Scorecard

This is a practical estimate of behavior parity, not an API-route score.

| Domain | Current closeness | Why |
| --- | ---: | --- |
| API route surface | 95-100% | Generated matrix shows all expected OpenCode v2 routes are bridged. |
| Model/provider selection | 80-90% | Ollama-first selection works well and still allows provider/model refs. Provider auth UI is present but not fully polished. |
| Basic prompt execution | 70-80% | GUI prompts reach OpenCode and return useful results, but final message selection and long-session handling still need messageID-based fidelity. |
| Streaming display | 60-70% | Text and tool events render, but not every OpenCode part update/state/attachment/output path is preserved. |
| Tool execution power | 80-90% | The actual engine executes OpenCode tools. The GUI does not yet expose all tool metadata and controls. |
| Permission parity | 45-60% | Runtime asks work, but composer presets are too broad compared with OpenCode pattern rules. |
| Large codebase handling | 40-55% | OpenCode tools are safe, but our manual explorer/editor/search IO can still be heavy. |
| Diffs/revert/fork | 55-70% | Routes and UI exist, but engine-backed per-turn diff confidence and per-file workflows need hardening. |
| LSP/formatter parity | 35-50% | Status endpoints exist; editor diagnostics and symbol workflows are not fully driven by them. |
| Code maintainability | 35-50% | Core files are too large and mixed-responsibility compared with OpenCode's modular services. |

## Big-Codebase Read/Write Logic Comparison

### Current GUI Path

The GUI has two separate file paths:

1. **Agent path**: the model calls OpenCode tools such as `read`, `grep`, `glob`, `edit`, `write`, or `bash`. This is the strong path because OpenCode owns permissions, truncation, diagnostics, and output metadata.
2. **Manual IDE path**: the user clicks files in the explorer or saves editor content. This currently uses our own Electron IPC handlers and does not inherit OpenCode's safety behavior.

Manual path risks:

- `files:read` reads the whole file as UTF-8.
- `files:write` writes the whole file as UTF-8.
- `listFiles()` recursively walks directories and returns a full nested tree.
- `searchWorkspace()` reads matching files into memory up to a local cap.
- `symbolSearch()` uses regex heuristics instead of LSP where available.

### OpenCode Path

OpenCode's equivalent behavior is more defensive:

- `ReadTool` uses line offsets, line limits, byte caps, binary detection, media attachment handling, and LSP warm-up.
- `WriteTool` and `EditTool` ask for edit permission with diff metadata, preserve BOM/line behavior, format, publish filesystem events, and collect diagnostics.
- `GlobTool` and `GrepTool` use ripgrep with result limits and clear truncation messages.
- `ShellTool` stores large output to a truncation file and reports a path for follow-up reads.

### Required Convergence

The IDE should keep manual file editing fast, but it needs OpenCode-grade guardrails:

- add file stat before open,
- add binary detection before editor load,
- add large-file read-only mode,
- add `files:readRange`,
- add lazy tree loading,
- route workspace search through ripgrep/engine search,
- run formatter/LSP diagnostics after manual save,
- show a clear difference between "manual editor save" and "agent edit".

## Tool Calling Logic Comparison

### Current GUI Logic

- The GUI sends the prompt to the engine.
- OpenCode chooses and executes tools.
- The renderer listens for normalized events.
- Final output is recovered from messages and summarized tool parts.
- Permission presets are sent as wildcard rules.

This means the **engine has the power**, but the **GUI projection is incomplete**.

### OpenCode Logic

OpenCode resolves tools through a layered pipeline:

1. agent and model are selected,
2. registry returns model/provider-compatible tools,
3. MCP resource tools are added when available,
4. plugin hooks run before and after tool execution,
5. permission context is injected into every tool,
6. tool calls update running state,
7. completed tool calls store title, input, output, metadata, attachments, and diagnostics,
8. session status moves back to idle when the processor is finished.

### Required Convergence

The GUI must stop treating tool activity as only "cards":

- preserve tool call ID, message ID, part ID,
- render `input`, `output`, `metadata`, `attachments`, `outputPath`, and `time`,
- show permission context and exact patterns,
- show shell command/cwd/timeout/exit code,
- show read line ranges and truncation,
- show edit/write diagnostics and affected files,
- support opening full saved tool output.

## Comparison Matrix

### 1. Engine Startup And Server Discovery

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Startup | `electron/main.cjs` spawns the engine, parses stdout for a localhost URL, health-checks it, then stores `openCodeServer`. | OpenCode CLI/TUI runs inside its own scoped runtime and SDK client lifecycle. | Our lifecycle is centralized in one large main-process file and has limited structured state. | Create an `engineManager` module with explicit states: `starting`, `ready`, `failed`, `restarting`, `stopped`. |
| HTTP client | `electron/opencode-client.cjs` wraps fetch with route fallbacks. | SDK/client code is typed and domain-organized. | Our client is useful but still broad and string-route-heavy. | Move all route families into typed client sections with test coverage. |
| Failure recovery | Basic catch/fallback behavior. | Scoped cleanup and effect-style failure propagation. | Engine crash/restart behavior is not fully deterministic. | Add engine crash detection, restart button, and clear UI status. |

### 2. Session Creation, Caching, And Status

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Session cache | `ensureOpenCodeSession()` caches by project/model/permission/agent and creates a new session if existing is busy. | Prompt queue enforces one turn at a time; active session state is managed by runtime. | Creating a new session on busy can split conversation unexpectedly. | Prefer queueing or explicit fork/new thread semantics. |
| Session status | We poll `/session/status` in the GUI bridge. | OpenCode listens to `session.status` events and polls status as fallback. | We still rely on polling plus message reads. | Use event stream as source of truth and only poll as fallback. |
| Message reads | `readOpenCodeMessages()` requests only `limit: 80`. | OpenCode supports message streaming/pagination/replay. | Long sessions can lose the target assistant message. | Track by `messageID`; page as needed; never depend on count slicing alone. |

### 3. Prompt Turn Completion

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Completion logic | Recently changed to wait for `session.status idle` instead of guessed timeout. | `runPromptTurn()` arms a wait, marks the turn live on events, and completes when status is idle. | We still use a custom outer loop and message polling. | Use OpenCode-style `session.wait` or event-driven deferred completion directly. |
| `message.updated` | Now ignored as completion. | OpenCode treats it as metadata/role/usage, not completion. | Fixed in main bridge, but renderer assumptions must stay checked. | Add regression test: `message.updated` must never finish a turn. |
| Timeouts | No default hard timeout after the latest fix; only explicit timeout is honored. | OpenCode does not end turns from stable text; abort is explicit. | Need tests to prevent reintroducing guessed timeouts. | Add bridge test for long-running streaming response. |

### 4. Streaming And Response Rendering

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Text deltas | `streamOpenCodeEvents()` listens to `message.part.delta` when field is text. | OpenCode reducers process delta, updated parts, role metadata, blockers, shell, questions, subagents, permissions. | We do not fully mirror part state transitions. | Add event adapter for every important event family. |
| Final answer selection | `bestAssistantText()` picks the longest new assistant text. | OpenCode tracks message and part identity precisely. | Longest text can be wrong if multiple assistant/subagent messages exist. | Select by admitted `messageID`, not longest text. |
| UI runtime | `agentRuntime.ts` safely renders malformed values and stores tools/diffs/permissions. | OpenCode has session reducers and scrollback commits. | Our reducer is custom and smaller; good safety, less fidelity. | Keep safe render, but map OpenCode events more faithfully. |

### 5. Tool Resolution And Invocation

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Tool selection | When user submits a prompt, OpenCode engine chooses tools. Good. | `SessionTools.resolve()` builds model-specific schemas from the registry, plugin hooks, MCP, and permissions. | We do not display the full tool manifest or all tool states. | Show resolved tools, current running tool, and final output metadata. |
| Slash commands | GUI expands local slash commands unless engine command exists. | OpenCode command system supports templates, MCP prompts, subtask commands. | Local expansion can diverge from engine command behavior. | Prefer engine command list and engine command execution where possible. |
| Tool output | Summarized to cards from message parts. | Tool outputs include metadata, attachments, output paths, diffs, diagnostics. | Some details are lost or capped. | Preserve `metadata`, `outputPath`, `attachments`, `input`, and state transitions. |

### 6. Permission Logic

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Rule shape | UI creates broad wildcard rules for each tool: allow/ask/deny. | Permission engine evaluates ordered rules by `permission` and `pattern`, with last matching rule winning. | We cannot express `bash: allow git * but deny rm *` well in composer UI. | Add advanced permission editor with ordered pattern rows. |
| Runtime asks | We surface `permission.asked` and reply once/always/reject. | OpenCode stores pending asks, approved rules, saved permissions. | UI display is improving, but still not full rule-context parity. | Show permission name, patterns, always patterns, diff/command metadata. |
| Shell permissions | UI has `bash`, matching OpenCode's compatibility tool id. | Shell tool parses command and asks for command patterns. | Composer only shows broad `bash`; users cannot set command-level patterns quickly. | Add command pattern controls for risky commands. |

### 7. Agent File Reading

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Agent reads | If model calls `read`, OpenCode handles it. Good. | `ReadTool` streams file content, caps bytes, supports `offset`/`limit`, binary detection, image/PDF attachment handling, LSP warm-up. | Engine path is strong; GUI display may hide truncation context. | Render read metadata: line range, total lines, truncated state, loaded instructions. |
| Manual editor reads | `files:read` returns full file as UTF-8. | OpenCode read tool avoids full unbounded reads. | Large files can freeze editor/renderer. | Add large-file guard, paged read, binary guard, and read-only large file mode. |
| Explorer tree | Recursive `listFiles()` skips a few heavy dirs but recurses fully. | OpenCode uses ripgrep/glob and scoped tools with limits. | Huge repos can make explorer expensive. | Lazy tree loading and virtualized file tree. |

### 8. Agent File Writing And Editing

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Agent edits | Engine edit/write tools run through OpenCode. Good. | `EditTool` locks per file, checks old/new text, preserves line endings/BOM, asks permission with diff, formats, publishes watcher events, returns diagnostics. | GUI must preserve and show this metadata completely. | Diff UI should use engine metadata first. |
| Manual editor save | Direct `fsp.writeFile`. | OpenCode tool writes with permission, formatting, diagnostics. | Manual save is expected IDE behavior, but lacks diagnostics/format hooks. | Keep direct save but optionally run formatter/LSP diagnostics after save. |
| Patch apply | GUI can apply diff-derived patch locally. | OpenCode has revert/unrevert/snapshot logic. | Local patch apply can bypass engine history. | Prefer engine revert/unrevert/workspace commit APIs for agent changes. |

### 9. Search, Glob, And Symbol Discovery

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Search | Local `searchWorkspace()` recursively reads files under 1MB and returns 500 results. | `GrepTool` uses ripgrep, permission checks, include patterns, 100-result truncation. | Local search is okay for UI, but not engine-grade. | Use ripgrep or engine FS search for large repos, stream results. |
| Glob | Local explorer tree; some bridge routes exist. | `GlobTool` uses ripgrep glob with truncation and permission. | GUI should expose engine glob result when asking agent-style search. | Add "agent search" pathway through OpenCode. |
| Symbols | Local regex-based symbol search. | OpenCode has LSP tool and LSP client. | Regex misses many languages. | Use LSP workspace symbols when available, regex fallback otherwise. |

### 10. Tool Output Truncation

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Output caps | GUI helper often caps detail to ~4000 chars. | `Truncate` caps by lines/bytes, writes full output to a truncation file, and tells the agent how to inspect it. | GUI can lose important output and not expose full file. | Render truncation file links and "open full output" actions. |
| Shell output | Local terminal captures output separately; engine shell output is summarized in tool cards. | Shell tool keeps tail, streams metadata, writes overflow to truncation file. | Engine shell output should be visible and inspectable like OpenCode. | Preserve `outputPath`, tail, timeout, exit code, command pattern. |

### 11. Shell And Terminal

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| User terminal | Local terminal/PTY for user commands. | OpenCode shell tool is for agent commands. | These are different concepts and should stay distinct. | Label clearly: user terminal vs agent shell tool. |
| Agent shell | Routed through OpenCode `/shell` or model tool calls. | Shell tool parses commands, asks permissions, handles external dirs, timeout, truncation. | UI needs richer permission/output for shell actions. | Show command, working dir, timeout, pattern, output file, exit status. |

### 12. MCP, Resources, Skills, And References

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| MCP endpoints | Bridge exposes connect/disconnect and resource-like surfaces. | OpenCode injects MCP instructions into system prompt and exposes MCP resource tools through session tools. | UI status exists but not full resource browsing/use flow. | Add MCP panel: servers, prompts, resources, auth state, permission status. |
| Skills | GUI shows skill counts and can expose skill data. | OpenCode has skill tool and system prompt section. | Need stronger UI for when skill is loaded/used. | Render skill tool calls and loaded skill context. |
| References | UI has references count. | OpenCode includes reference descriptions in system prompt. | References are underused visually. | Add references drawer with source and usage. |

### 13. LSP And Formatter

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Status | Bridge has formatter/LSP status surfaces. | OpenCode touches files, waits for diagnostics, reports after edits. | GUI does not fully use LSP for editor diagnostics or symbol search. | Problems panel should read engine LSP diagnostics. |
| Format | Manual save is direct; agent edit may format through engine. | `WriteTool` and `EditTool` call formatter and sync BOM. | Manual editor path lacks formatter behavior. | Add "Format on save" and "Format current file" through engine where possible. |

### 14. Diffs, Revert, Fork, And Workspace State

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Diff display | GUI displays diff cards and can apply patches. | OpenCode tracks session diffs and snapshots. | UI can bypass engine if patch is applied directly. | Prefer engine diff/revert APIs for agent-origin changes. |
| Revert | Bridge exposes revert/clear/commit surfaces. | OpenCode has snapshot/revert model. | Need confidence that UI always sends correct message/part ids. | Add tests for revert, unrevert, fork from diff. |
| Fork | UI can fork from message. | OpenCode supports session fork. | Needs stronger visual history. | Add timeline/sidebar session tree. |

### 15. Context Building

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| GUI context | `contextPrompt()` appends workspace path, session summary, current file, selected code, tabs, git changes, terminal tail. | OpenCode prompt pipeline builds structured model messages, system instructions, skills, MCP, environment, and file parts. | Our "whole project" mode does not attach the whole project; it provides metadata and relies on tools. | Rename "Whole project" to "Workspace context" or attach structured file parts intentionally. |
| File attachments | Mostly text injected into prompt or file path metadata. | OpenCode supports `file:`/`data:` parts and uses `ReadTool` for file URLs. | We risk token-heavy raw prompt injection. | Use structured `parts` for current file/selection/open tabs. |
| Session context | UI pulls summary/context surfaces. | OpenCode has compaction and session summary. | Good start; needs source-of-truth alignment. | Use engine context as primary, not re-summarized UI text. |

### 16. Plan Mode, Agent Modes, And Subagents

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Plan mode | GUI prepends "Plan mode is enabled..." to prompt. | OpenCode has plan agent/mode prompts and plan reminder instructions. | Prepending text is weaker than switching actual agent/mode. | Use OpenCode agent/mode configuration for plan/build switching. |
| Agent selection | GUI dropdown sends `agent`. | OpenCode agents have permissions, tools, descriptions, and modes. | Need display agent capabilities and selected agent constraints. | Add agent details popover and permissions preview. |
| Subagents | Engine supports task/subagents. | `TaskTool` handles subagent sessions and permissions. | GUI can show tool cards but not full subagent tabs/session tree. | Add subagent timeline and open-subagent-session action. |

### 17. Provider, Model, And Auth

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Model selection | Ollama-first dropdown works well and preserves provider-style model refs. | OpenCode supports provider models, auth, credentials, current model. | This is one of our strongest areas. | Keep Ollama-first UX but expose provider auth without cluttering composer. |
| Credentials | Bridge has credential CRUD surfaces. | OpenCode provider auth flows and credentials are richer. | UI for provider auth is still partial. | Add dedicated settings/auth drawer, not composer clutter. |

### 18. VCS And Git

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Git status | Local git fallback and engine surfaces. | OpenCode has VCS integration and session diff. | Basic but useful. | Add source-control sidebar parity: changes, stage, unstage, diff, commit. |
| Patches | GUI can apply patches. | OpenCode snapshots and VCS patch routes exist. | Need avoid conflicting local patch/apply behavior. | Route agent patches through engine workspace APIs first. |

### 19. Persistence, Replay, And Compaction

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Runtime state | `agentRuntime.ts` keeps UI messages, tools, diffs, permissions. | OpenCode persists sessions/messages and replays scrollback. | GUI state can drift from engine state. | Treat engine session as source of truth; UI is a projection. |
| Compaction | Bridge exposes compact endpoint. | OpenCode has compaction prompt and message filtering. | UI needs clear compaction visibility and recovery. | Show compaction events and summary content. |
| History | Session list exists. | OpenCode has session tree/replay/fork semantics. | Need better conversation/session navigation. | Add session history view with fork/continue/delete/archive. |

### 20. Error Handling And Robustness

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Renderer safety | Stronger now: safe render helpers reduce object-child crashes. | OpenCode TUI has reducers and structured state. | Good progress, still custom event mapping risk. | Add reducer tests with malformed engine events. |
| Main errors | Many catches return `{ ok: false, error }`; some are generic. | OpenCode uses typed errors and Effect failure channels. | UI cannot always choose good recovery. | Add `CodeEngineError` categories: network, route, auth, permission, session, timeout, malformed. |
| Idle crash | Previous crash from undefined `toast` fixed elsewhere. | OpenCode scoped runtime avoids React issues because it is TUI-native. | Need idle/long-run regression tests. | Add 60-second idle smoke and fake SSE tests. |

### 21. Performance And Scalability

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| Large tree | Recursive tree load in main process. | OpenCode tools use targeted glob/grep/read. | Huge repos can be slow. | Lazy tree, virtual rows, async children. |
| Large files | Full file read/write. | Read limits, streams, binary detection, truncation. | Editor can freeze. | Large-file mode and range reads. |
| Large chats | Renderer stores and renders many cards. | OpenCode scrollback/replay has specialized logic. | Long sessions can lag. | Virtualize chat/message list. |
| Bundle size | Current Vite build warns about >500KB chunks. | OpenCode is CLI/TUI, different bundle constraints. | GUI bundle can grow messy. | Dynamic import panels and split heavy components. |

### 22. Code Quality

| Topic | Our handling | OpenCode handling | Gap | Target |
| --- | --- | --- | --- | --- |
| File size | `electron/main.cjs`, `src/App.tsx`, and `src/styles.css` are very large. | OpenCode is split into session/tool/permission/config/runtime modules. | Hard to safely change; high regression risk. | Split into domain modules incrementally. |
| Types | TS in renderer; main process is CJS with manual shapes. | OpenCode uses typed schemas and Effect services. | Main bridge has weak compile-time contracts. | Add typed bridge DTOs or move main bridge modules to TS later. |
| Duplication | CSS has repeated `.opencode-agent` blocks; main has many fallback routes. | OpenCode separates concerns. | Styling/logic drift is likely. | Deduplicate CSS, centralize route fallback helpers. |
| Tests | Build/parity scripts exist; limited unit tests. | OpenCode has extensive tests for permissions, tools, sessions, run process, LSP, config. | Our behavior can regress quietly. | Add focused tests for bridge, reducer, permissions, file IO, event mapping. |
| Observability | Logs exist but are ad hoc. | OpenCode has trace spans and plugin hooks. | Hard to debug session mismatches. | Add structured event log with request/session/message IDs. |

## Highest-Risk Current Gaps

1. **Message selection by assistant count and longest text**
   - Risk: incomplete or wrong final answer in long sessions.
   - Fix: track admitted `messageID` and stream/read that message.

2. **Full file read/write in GUI IPC**
   - Risk: freezes or memory spikes on large files.
   - Fix: range reads, file size guard, binary guard, large-file read-only mode.

3. **Tool output truncation without full-output access**
   - Risk: user sees partial tool results and thinks the agent failed.
   - Fix: display OpenCode `outputPath` and tool metadata.

4. **Route parity mistaken for behavior parity**
   - Risk: generated matrix says 100%, but UX still differs.
   - Fix: keep generated API matrix and this behavior plan separate.

5. **Broad wildcard permission UI**
   - Risk: permissions are either too permissive or too blocking.
   - Fix: pattern-based permission editor matching OpenCode.

6. **Context mode overpromises**
   - Risk: "Whole project" sounds like full codebase ingestion.
   - Fix: rename to "Workspace context" and let tools read files as needed.

## Gap Closure Plan

### Phase 1 — Prompt Turn Correctness

Goal: make GUI turn lifecycle behave like OpenCode.

Tasks:

- Store the admitted `messageID` from `prompt_async`.
- Stream events for that `messageID`.
- Replace assistant-count slicing with messageID-based lookup.
- Use engine `session.wait` or event-driven idle completion rather than custom polling where possible.
- Add regression tests:
  - `message.updated` does not complete a turn.
  - long streaming response does not truncate at idle gaps.
  - two assistant messages in one session do not confuse final output.

Acceptance:

- Long review responses remain visible after completion.
- Tool-only turns show a proper tool summary, not "No response".
- `/continue` resumes the same session without losing context.

### Phase 2 — Tool Event Fidelity

Goal: display OpenCode tools the way the engine knows them.

Tasks:

- Map `message.part.updated` states, not only `message.part.delta`.
- Preserve `input`, `output`, `metadata`, `attachments`, `outputPath`, `status`, `time`.
- Show running/completed/error states.
- Show shell command, cwd, timeout, output tail, full-output link.
- Show read line range/truncated state.
- Show edit/write diff metadata and diagnostics.

Acceptance:

- Tool cards explain exactly what happened.
- Large tool output can be opened from saved output.
- Permission requests show exact patterns and metadata.

### Phase 3 — Large Codebase File IO

Goal: make explorer/editor safe on large repos.

Tasks:

- Add file stat before `files:read`.
- Refuse or range-read files above a threshold.
- Add `files:readRange(workspacePath, path, offset, limit)`.
- Detect binary files before opening.
- Lazy-load directory children instead of recursive full tree.
- Virtualize file tree rows.
- Route search through ripgrep or engine grep for large projects.

Acceptance:

- Opening huge repos does not freeze.
- Opening large/binary files shows a professional empty/large-file state.
- Search remains responsive.

### Phase 4 — Permission Parity

Goal: match OpenCode's rule model.

Tasks:

- Replace simple allow/ask/deny dropdown with:
  - quick preset mode,
  - advanced ordered rule table,
  - permission key,
  - pattern,
  - action.
- Add shell command pattern shortcuts:
  - allow `git *`,
  - ask `npm install`,
  - deny `rm *`,
  - deny external destructive patterns.
- Display `always` patterns from permission requests.
- Persist and revoke saved permissions visibly.

Acceptance:

- User can reproduce OpenCode config examples such as `bash: { "*": "ask", "rm *": "deny", "git *": "allow" }`.
- Permission cards are compact and understandable.

### Phase 5 — Structured Context And Attachments

Goal: stop injecting everything as raw prompt text.

Tasks:

- Use OpenCode `parts` for file attachments where possible.
- Current file should be attached as file part or referenced for Read tool, not pasted blindly.
- Selection can be a small text part.
- Rename "Whole project" to "Workspace context".
- Add explicit "Let Code inspect files with tools" hint.
- Include git diff and terminal tail as structured bounded context.

Acceptance:

- Prompts stay smaller.
- The agent uses read/grep/glob naturally for codebase inspection.
- UI labels match what is actually sent.

### Phase 6 — Diff/Revert/Fork Confidence

Goal: make changes reversible and trustworthy.

Tasks:

- Prefer engine session diff and revert APIs.
- Avoid local patch apply for agent-origin changes unless engine route fails and user confirms.
- Track `messageID` and `partID` per diff card.
- Add per-file accept/reject where engine supports it.
- Add session fork UI from any assistant turn.

Acceptance:

- User can revert an agent turn reliably.
- Forking preserves history and context.

### Phase 7 — LSP, Formatter, And Problems Panel

Goal: use OpenCode's language intelligence in the GUI.

Tasks:

- Surface engine LSP status by language/server.
- Use LSP diagnostics in Problems panel.
- Add formatter status and "format current file".
- After agent edit, refresh diagnostics and show affected files.
- Use LSP workspace symbols before regex fallback.

Acceptance:

- Code edits show real diagnostics.
- Symbol search is language-aware when LSP is available.

### Phase 8 — Codebase Refactor For Maintainability

Goal: reduce risk in future changes.

Tasks:

- Split `electron/main.cjs`:
  - `engineServer`,
  - `engineClient`,
  - `sessionBridge`,
  - `fileBridge`,
  - `permissionBridge`,
  - `vcsBridge`,
  - `mcpBridge`.
- Split `src/App.tsx`:
  - `WorkbenchLayout`,
  - `ExplorerPane`,
  - `EditorArea`,
  - `AgentPanel`,
  - `Composer`,
  - `SessionTimeline`.
- Split `src/styles.css` into feature sections or CSS modules.
- Add unit tests for `agentRuntime.ts`.
- Add fake SSE tests for `streamOpenCodeEvents`.

Acceptance:

- New behavior can be changed without editing 5000-line files.
- Regression tests cover prior crashes and incomplete responses.

## Test And Benchmark Plan

### Core Prompts

Use these in the GUI after each phase:

1. `Who are you, what project are you running inside, and what model are you using?`
2. `Review this project. Explain the architecture in 5 bullet points, then list the 3 riskiest areas to test first.`
3. `Read package.json, src/App.tsx, electron/main.cjs, and src/agentRuntime.ts. Summarize how a prompt travels from GUI composer to engine and back.`
4. `Search for places where a React component might accidentally render an object directly. Explain the highest-risk file and line area.`
5. `Plan the safest small improvement to make the Code agent panel more stable. Do not edit files yet.`
6. `Create docs/GUI_BENCHMARK_RESULT.md with a checklist, then show the diff.`
7. `Do nothing for 60 seconds except wait, then say idle stability check complete.`
8. `Use tools to inspect this repository and propose one small patch. Ask before editing.`

### Required Checks

Run after implementation work:

```bash
node --check electron/main.cjs
node --check electron/opencode-client.cjs
node --check scripts/generate-opencode-parity.cjs
npm run check:parity
npm run check:gui-parity
npm run build
git diff --check
```

Optional:

```bash
npm audit --audit-level=moderate
```

## Behavior Parity Definition

Code Workbench reaches practical OpenCode behavior parity when:

- prompt completion is event/session-status driven,
- every tool call displays with state, input, output, metadata, and permissions,
- read/write/edit behavior preserves OpenCode safety and diagnostics,
- large repos/files do not freeze the GUI,
- permission rules support OpenCode-style pattern ordering,
- context is structured and bounded,
- diffs/reverts/forks are engine-backed,
- session history survives restart and can be replayed,
- model/provider/auth behavior remains compatible,
- the GUI never needs to launch OpenCode TUI for normal workflows.

## Code Quality Definition

The project is code-quality ready when:

- bridge logic is modular and testable,
- renderer runtime has reducer tests,
- CSS duplication is reduced,
- large-file behavior is tested,
- permission conversion is tested against OpenCode examples,
- SSE/event mapping is tested with recorded fixtures,
- generated route parity and manual behavior parity are both tracked.

## Next Recommended Implementation Order

1. MessageID-based prompt result tracking.
2. Full tool event metadata rendering.
3. Large-file safe read/range read.
4. Pattern-based permission editor.
5. Structured context parts.
6. Engine-backed diff/revert/fork polish.
7. LSP/formatter Problems panel.
8. Refactor main/App/styles into modules.

This order attacks correctness first, then scalability, then UX, then maintainability.
