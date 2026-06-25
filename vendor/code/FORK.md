# Code Fork Notes

This folder is a local vendored fork of the upstream OpenCode codebase.

## What Was Changed Immediately

- Source copied into `vendor/code` without upstream `.git` history.
- Root package metadata renamed from `opencode` to `code`.
- Main engine package metadata renamed from `opencode` to `code`.
- Added a `code` CLI wrapper beside the upstream-compatible wrapper.
- Moved upstream README to `README.upstream.md`.
- Added a local `README.md` explaining Code branding and integration direction.

## What Was Not Blindly Renamed

The upstream source contains thousands of compatibility-sensitive identifiers such as package scopes, config paths, provider adapters, environment variables, schema URLs, and release scripts. A blind global rename would break the engine before we can use it.

Safe strategy:

1. Remove OpenCode branding from our app UI.
2. Keep internal upstream identifiers until each subsystem is integrated.
3. Replace identifiers subsystem-by-subsystem with tests.
4. Preserve MIT license attribution.
