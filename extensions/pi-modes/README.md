# pi-modes

Agent mode system for pi. Modes define tool sets, system prompts, and optional overrides.

## Features

- `/mode` — Show mode selector or switch to a specific mode
- `/default-mode` — Set which mode activates on pi startup
- `Ctrl+Shift+M` — Cycle through available modes
- `--agent-mode <name>` — Start pi in a specific mode (overrides defaultMode)
- `/skill:create-mode` — AI-assisted mode creation

## Mode format

Modes live at `~/.pi/agent/modes/<name>/`:

```
~/.pi/agent/modes/
├── settings.json            ← defaultMode setting
├── roleplay/
│   ├── mode.json            ← manifest
│   └── system-prompt.md     ← system prompt (replaces default)
└── code-review/
    ├── mode.json
    └── system-prompt.md
```

### mode.json

```json
{
  "description": "Human-readable label",
  "icon": "🎭",
  "thinkingLevel": "medium",
  "tools": ["read", "bash"],
  "model": "provider/model-id"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `description` | yes | Label shown in the mode selector |
| `icon` | no | Emoji or text shown in footer |
| `thinkingLevel` | no | Override thinking level |
| `tools` | no | Tools to enable (omit = all, empty = none) |
| `model` | no | Override model (`provider/id` or bare `id`) |

### system-prompt.md

Always replaces the default system prompt entirely. Must be present in every mode directory.

### settings.json

```json
{
  "defaultMode": "default"
}
```

Set via `/default-mode` command. Overridden by `--agent-mode` flag.

## Built-in default mode

The "default" mode is always available. It enables all tools, uses pi's standard system prompt, and doesn't override thinking level or model.
