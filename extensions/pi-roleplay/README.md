# pi-roleplay

Roleplay tools and character management for pi.

## Features

- `/rp` — Roleplay hub: create, start, list, or delete characters
- `finish_character` tool — Finalize a character sheet, save it, and create a roleplay session
- `/create-subsession` — Create a new session from an encoded payload

## Character storage

Characters are stored as JSON files in `~/.pi/agent/pi-roleplay/characters/`. Each character has a Markdown character sheet.

## Companion mode

This extension is designed to work with the `roleplay` and `roleplay-cc` modes defined in `~/.pi/agent/modes/`. Those modes' `tools` arrays include `finish_character` so the tool is available when the mode is active.
