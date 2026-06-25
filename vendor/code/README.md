# Code Engine

This directory vendors the full upstream coding-agent source tree for use inside Tutorial IDE under the local product name **Code**.

The goal for this project is to build our own Codex-style GUI while reusing the engine capabilities from the upstream project: providers, model routing, agents, sessions, tools, LSP/context handling, file edits, and command execution.

## Local Branding

- Local product name: **Code**
- Local source location: `vendor/code`
- Local CLI wrapper: `packages/opencode/bin/code`
- The Tutorial IDE UI should use **Code** wording, not OpenCode wording.

## Upstream Attribution

This is a vendored source fork of:

- Upstream repository: https://github.com/anomalyco/opencode
- Upstream package version used by this project: `1.17.10`
- License: MIT, preserved in `LICENSE`
- Original upstream README: `README.upstream.md`

Do not delete the upstream license or attribution. Product-facing UI can be rebranded to Code, but compatibility-level package names, provider names, config keys, and imports may still need upstream identifiers until the engine is fully integrated and tested.

## Integration Direction

Our app should not expose the upstream TUI as the primary product experience. The target architecture is:

1. Tutorial IDE owns the GUI.
2. Code engine powers provider/model/session/tool behavior.
3. The right panel behaves like a Codex-style agent chat.
4. Model selection uses local Ollama first, while preserving provider compatibility.
5. File edits and commands are shown as GUI tool cards with review/accept behavior.
