# pi-roleplay

Roleplay tools and character management for pi.

## Features

- `/rp` — Roleplay hub: create, start, list, or delete characters
- `finish_character` tool — Finalize a character sheet and start a roleplay session
- `/create-subsession` — Create a new session from an encoded payload

## Character storage

Characters are stored as JSON files in this extension's `characters/` directory. Each character has a Markdown character sheet.

## Companion mode

This extension is designed to work with the `roleplay` and `roleplay-cc` modes defined in `~/.pi/agent/modes/`. Those modes' `tools` arrays include `finish_character` so the tool is available when the mode is active.
