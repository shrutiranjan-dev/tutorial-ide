# Tutorial IDE / Code Workbench Progress Memory

This file is backup context memory for the local `tutorial-ide` project. It records the current product direction, implemented architecture, major fixes, and historical notes so future work can resume without rediscovering everything.

## Current Product Direction

As of 2026-06-25, the learning-roadmap and AI tutor direction is deprecated.

New concept:

- A VS Code-like code editor with a Codex-style GenAI coding agent.
- The local product name is **Code**.
- The app owns the GUI. Do not make the upstream terminal UI the primary product surface.
- Do not launch or embed the upstream terminal UI from product buttons; the right panel must be a Codex-style GUI chat backed by the engine.
- The full upstream coding-agent source has been vendored into `vendor/code` for engine integration.
- Preserve the upstream provider/model behavior instead of inventing a separate provider system.
- Ollama local/cloud models are first-class in the UI.
- Provider/model values use engine style: `provider/model`.
- Examples:
  - `ollama/qwen2.5:latest`
  - `ollama/nemotron-3-nano:30b-cloud`
  - `openrouter/moonshotai/kimi-k2`
- OpenRouter, Zen, Z.AI, ZenMux, LM Studio, llama.cpp, GitHub Copilot, Anthropic, OpenAI, and other providers should remain accessible through provider-native engine commands.

## Current UX Shape

The app is now a Code workbench:

- Left activity bar for Explorer, Code Agent, Terminal, and Providers.
- Left sidebar with project picker and project file explorer.
- Main editor workspace with Monaco tabs.
- Bottom terminal powered by xterm.js and `node-pty`.
- Right Code agent panel with:
  - Engine status/version.
  - Ollama local model discovery.
  - Manual `provider/model` entry for OpenRouter, Zen, Z.AI, etc.
  - Provider reference cards showing `/connect` commands.
  - Prompt runner through the engine command runner.
  - GUI chat transcript and composer. No terminal UI launcher.
- Roadmap, lesson, guide, and beginner tutor UI are no longer part of the visible product.

## Code Engine Integration Notes

- `opencode-ai@1.17.10` is installed.
- Full source fork is vendored at `vendor/code` without upstream `.git` history.
- `vendor/code/README.md` documents local Code branding and integration direction.
- `vendor/code/README.upstream.md` preserves the upstream README for attribution.
- `vendor/code/FORK.md` records what was renamed and what remains compatibility-sensitive.
- `vendor/code/packages/opencode/bin/code` is a local CLI wrapper beside the compatibility wrapper.
- `src/App.tsx` has been rewritten around project/editor/Code workflows.
- `electron/main.cjs` exposes:
  - `project:default`
  - `project:open`
  - `opencode:info`
  - `opencode:providers`
  - `opencode:models`
  - `opencode:syncOllama`
  - `opencode:command`
- `opencode:syncOllama` writes/merges `opencode.json` into the current project with:
  - provider `ollama`
  - npm package `@ai-sdk/openai-compatible`
  - `baseURL: http://localhost:11434/v1`
  - discovered Ollama models
- The IPC namespace and some internal package/config names still use upstream compatibility identifiers. Do not blindly global-rename them; replace subsystem-by-subsystem with tests.
- Direct engine smoke test passed:

```bash
OPENCODE_CONFIG_CONTENT='{"provider":{"ollama":{"npm":"@ai-sdk/openai-compatible","name":"Ollama (local)","options":{"baseURL":"http://localhost:11434/v1"},"models":{"qwen2.5:latest":{"name":"qwen2.5:latest"}}}},"model":"ollama/qwen2.5:latest"}' code models ollama
```

Output:

```text
ollama/qwen2.5:latest
```

Build verification after pivot:

```bash
npm run build
node --check electron/main.cjs
node --check electron/preload.cjs
```

All passed.

Latest verification after vendoring Code source:

```bash
npm run build
```

Passed on 2026-06-25. Vite dev server ignores `vendor/code/**` so the vendored engine source does not trigger reload storms during GUI development.

Latest OpenCode parity upgrade on 2026-06-26:

- Added session-context bridge and GUI summary for active Code sessions.
- Added engine-first VCS status/diff/stage/unstage with git fallback.
- Added MCP connect/disconnect bridge and GUI controls inside the compact agent popover.
- Added global config read/write bridge for `/global/config`.
- Added compact provider/auth readiness, credential-aware connect/manage actions, MCP command insertion, skills, references, and VCS controls to the Codex-style side panel.
- Verification passed:

```bash
npm run build
npm run check:bridge
git diff --check
npm audit --audit-level=moderate
```

Steps 1-2 parity implementation on 2026-06-26:

- Added `electron/opencode-client.cjs` as the typed Code engine HTTP client boundary.
- Routed the existing main-process OpenCode fetch/query/json/unwrap helpers through that client.
- Moved session-context, VCS, MCP connection, and global-config helper behavior onto client methods while preserving existing IPC names.
- Added `scripts/generate-opencode-parity.cjs` and `npm run check:parity`.
- Generated `docs/OPENCODE_PARITY_MATRIX.md` from `vendor/code/specs/v2/api.html`.
- Latest parity count: 67 upstream operations, 15 exact route matches, 41 partial surfaces, 11 missing surfaces.

## Deprecated Learning IDE Context

Everything below documents the previous learning IDE direction for historical context only. Do not revive it unless the user explicitly asks.

## Important User Preferences

- Beginner language learning must behave like a real 0-to-intermediate course.
- W3Schools-style tutorial order is the reference for beginner tracks.
- Do not copy W3Schools text, examples, wording, or exercises.
- Do not ask useless/project-heavy interview questions for beginners.
- If learner says "need to learn Python/JavaScript/etc.", keep it fundamentals-focused.
- Do not suggest REST APIs, apps, automation, jobs, interviews, freelancing, portfolio, or frameworks unless explicitly requested.
- Lessons must be separate, clear, runnable/checkable, and not repeated copies of the same exercise.

## Data Locations

App-generated user data lives under Electron userData:

- `roadmaps.json`
- `progress.json`
- `progress-events.json`
- `generated-lessons/`
- `lesson-workspaces/`

Generated lessons use `lesson.json` plus a `starter/` folder.

## Backend Highlights

Main backend file: `electron/main.cjs`.

Important functions/constants:

- `agentPrompts`: stores the full prompt system.
- `w3schoolsTrackRegistry`: supported tutorial tracks and source URLs.
- `matchW3SchoolsTrack(answers)`: detects requested supported track.
- `closestW3SchoolsTracks(answers)`: suggestions for unsupported/uncertain tracks.
- `learningTimePlan(depth)`: converts time/depth answers into pace, target weeks, max lessons, estimated minutes.
- `shouldForceLocalInterviewPrompt(field, answers)`: forces safe local prompts for beginner language courses.
- `validateBeginnerInterviewQuestion(prompt, transcript)`: prevents unsafe Ollama interview questions reaching UI.
- `buildW3SchoolsCourseMilestones(answers, skillGap, capstone)`: creates catalog-first W3Schools-style roadmap modules.
- `normalizeRoadmapPlan(...)`: builds roadmap object with course metadata.
- `createGeneratedLesson(roadmap, index)`: creates one lesson folder at a time.
- `removeRoadmapData(roadmapId)`: deletes roadmap, generated lessons, workspace copies, progress entries, and related progress events.
- `learningStatusReducer(event, currentState)`: status/progress transitions.

## Supported W3Schools Tracks

The registry includes:

- Python
- JavaScript
- HTML
- CSS
- SQL
- MySQL
- PHP
- Java
- C
- C++
- C#
- R
- Kotlin
- TypeScript
- Node.js
- React
- Angular
- Vue
- Django
- PostgreSQL
- MongoDB
- NumPy
- SciPy
- Pandas
- Bash
- Git
- Swift
- Go
- DSA
- JSON/XML/data-related entries

Core executable/good-template support is strongest for:

- Python
- JavaScript
- Web: HTML/CSS/JavaScript
- SQL
- DSA in JavaScript

Other tracks currently use generic text-check lessons unless runtime support is added later.

## Prompt System

The backend now includes named prompt constants:

- `InterviewAgent`
- `BeginnerSafetyValidator`
- `TrackMatcher`
- `RoadmapGenerator`
- `RoadmapCritic`
- `LessonGenerator`
- `LessonCritic`
- `StatusEngine`
- `LearningIDEOrchestrator`

Runtime behavior:

- Ollama interview calls use `InterviewAgent + BeginnerSafetyValidator`.
- Roadmap generation uses `LearningIDEOrchestrator + TrackMatcher + RoadmapGenerator + RoadmapCritic`.
- The app still keeps deterministic safety rules; beginner language prompts are overridden locally if Ollama suggests unsafe/project-heavy questions.

Core beginner language rule:

```text
If learner intent is "learn a language" and experience is beginner/new/from zero/no experience, use a zero-to-intermediate language course mode.
Do not ask project-outcome questions.
Do not suggest apps, APIs, automation, portfolio, jobs, interviews, freelancing, or frameworks.
Outcome should be fundamentals mastery, small programs, and beginner-to-intermediate confidence.
```

## Interview Flow

Required field order:

1. `goal`
2. `experience`
3. `stack`
4. `outcome`
5. `depth`
6. `learningStyle`
7. `constraints`

Rules:

- Ask only the next missing field.
- Never skip required fields.
- Never ask later fields early.
- Detect vague answers and clarify.
- Detect beginner wording like:
  - beginner
  - complete beginner
  - new
  - no experience
  - need to learn
  - first learn
  - learn completely
  - from zero
  - from scratch
  - zero knowledge

For beginner JavaScript/Python/language courses, safe outcome suggestions are like:

- Complete JavaScript fundamentals
- Practice every core topic
- Reach beginner-to-intermediate JavaScript

Bad suggestions must not appear:

- Build an app
- Create a REST API
- Automate tasks with Node.js
- Portfolio project
- Job/interview/freelancing goals

## Roadmap Engine

Roadmaps are catalog-first now:

- Match requested topic to W3Schools-supported track.
- Use W3Schools-style topic order as the sequence.
- Let Ollama personalize wording only, not reorder beginner prerequisites.
- For beginner language paths, force the local safe catalog path.
- Store course metadata on new roadmaps:
  - `courseSource`
  - `courseTrack`
  - `timePlan`
  - `depthLevel`
  - `topicOrder`

Beginner language order:

1. Setup and running code
2. Syntax and output
3. Comments
4. Variables
5. Data types
6. Operators
7. Strings
8. Conditions
9. Loops
10. Collections / arrays
11. Functions
12. Objects / classes where relevant
13. Errors and debugging
14. Files / DOM / database topics where relevant
15. Review
16. Capstone

## Lesson Generation

Every generated lesson should include:

- `README.md`
- `GUIDE.md`
- `TASK.md`
- `CHECKPOINT.md`
- starter file
- solution file
- runnable check/test file

Rules:

- No bare TODO-only starter files.
- Starter file must be meaningful and partially complete.
- Solution file must fully solve the task.
- Check file must test the real artifact, not only file existence.
- README/GUIDE/TASK must not reveal the full solution.
- Each lesson focuses on a distinct concept.

## Progress / Status Engine

Statuses:

- `locked`
- `ready`
- `in_progress`
- `ran`
- `failed_check`
- `passed_check`
- `skipped`
- `needs_review`
- `mastered`
- `blocked`

Important rules:

- Opening a lesson marks it ready.
- Run marks `ran`.
- Failed check marks `failed_check`.
- Multiple failed checks can mark `needs_review`.
- Passed check marks `mastered`.
- Skip marks `skipped` and unlocks next, but skipped does not count as mastery.
- Roadmap completion requires required lessons mastered.

## Roadmap Remove Feature

Roadmap rows now have a trash action.

The delete flow:

- Confirms with the user.
- Removes the roadmap from `roadmaps.json`.
- Deletes `generated-lessons/<lessonId>`.
- Deletes `lesson-workspaces/<lessonId>`.
- Removes progress entries for the deleted lessons.
- Removes related progress events.
- Clears the active workspace if the deleted roadmap was open.

Important fix:

- The roadmap row is a container with separate open/delete buttons.
- Do not put the delete action inside the open button.

## UI Fixes Already Done

- Terminal works even with no project/file by starting in the home folder.
- Terminal and Guide were separated; Guide moved to top drawer.
- Preview moved to left nav and no longer lives in terminal area.
- Preview hides right tutor and bottom terminal/guide.
- Added `Run` and `Check` as separate actions.
- Added resizable layout and neon separator rails.
- Added professional empty states in Tutorial Parts and Files.
- Added modern compact agent interview UI.
- Added W3Schools track display in interview, roadmap list, lesson rows, and guide drawer.

## Verification Status

Most recent checks after prompt-system integration:

```bash
node --check electron/main.cjs
npm run build
```

Both passed.

Most recent checks after Code/OpenCode steps 3-5 integration:

```bash
node --check electron/main.cjs
node --check electron/opencode-client.cjs
npm run check:bridge
npm run build
npm run check:parity
npm audit --audit-level=moderate
git diff --check
```

All passed.

Most recent checks after Code/OpenCode steps 6-9 integration:

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

All passed. Parity matrix now reports `done=27 partial=40 missing=0` across 67 upstream operations.

Most recent checks after Code/OpenCode steps 10-12 integration:

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

All passed. Parity matrix now reports `done=67 partial=0 missing=0` across 67 upstream operations.

Step 3-5 progress:

- Composer model selection now switches the active Code session model, not just the dropdown label.
- Selected Code agent is sent to backend prompt/session creation; sessions are keyed by project/model/permission/agent.
- Assistant runtime keeps the real long response and no longer replaces it with a tool-count summary unless no assistant text exists.
- Diff cards can apply available patch content through engine VCS apply routes, with local `git apply` fallback.
- Parity matrix now reports `done=16 partial=40 missing=11` across 67 upstream operations.

Step 6-9 progress:

- Formatter and LSP status are exposed through engine-first adapter, IPC, preload, browser stubs, and TypeScript bridge types.
- OpenCode FS tree/read/search/grep routes are exposed and workspace search now prefers engine grep before local fallback.
- PTY create/list/get/update/delete routes are exposed, with local node-pty fallback for list/get/update/delete where practical.
- Parity tooling now recognizes formatter, FS, LSP, PTY, and VCS patch/apply route families.
- Parity matrix now reports `done=27 partial=40 missing=0` across 67 upstream operations.

Step 10-12 progress:

- Added exact engine route adapters for the remaining partial API families: session diff/todo/wait, config, auth, catalog, event, MCP, permission, question, VCS get, project, and workspace.
- Added IPC/preload/type/browser coverage for the new callable surfaces.
- Existing session, permission, event, config, question, VCS, and project/workspace flows prefer exact engine routes where practical and keep legacy/local fallbacks.
- Parity matrix now reports `done=67 partial=0 missing=0` across 67 upstream operations.

Known warning:

- Vite reports a large chunk warning. This is existing/expected and not currently blocking.

## Important Failure Cases To Guard Against

Hard failures the backend/UI should prevent:

1. Beginner says "learn Python" but roadmap starts with API/app/project.
2. Interview asks "What project do you want to build?" too early.
3. Roadmap has vague modules like "Learn Basics".
4. Lesson starter file is empty.
5. Checkpoint only checks file existence, not actual output.
6. Solution is revealed inside README/GUIDE/TASK.
7. JavaScript learner gets React before JavaScript fundamentals.
8. Python learner gets Django before Python fundamentals.
9. Roadmap repeats the same calculator/task many times.
10. Status shows completed when user skipped lessons.
11. LLM invents unsupported tracks.
12. Roadmap has no prerequisites.
13. Module validation is not runnable.
14. Lesson does not create a clear artifact.
15. Interview jumps from goal directly to advanced outcome.

## Separate ProducerWave Context From Interrupted Turn

The user briefly asked about another project:

- Project path: `/home/user029/Documents/producers_wave`
- Next.js app running on port `14323`
- Request was to move producer profile edit from `/profile/edit/` to `/producer/profile/edit/`, then create user profile edit at `/profile/edit/` from Figma node:
  - `https://www.figma.com/design/lKkWrMxpSkuO5XX2O2ZtIP/ProducerWave--Copy-?node-id=467-15965&m=dev`

That turn was interrupted before implementation. No confirmed changes for ProducerWave should be assumed from this memory unless inspected.
