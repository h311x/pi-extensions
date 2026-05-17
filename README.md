# pi-extensions

Custom [pi](https://pi.dev) extensions for enhanced agent workflows.

## Extensions

### pi-modes

General-purpose mode system. Switch between agent personas with different tool sets, system prompts, and optional model/thinking overrides.

**Commands:**
- `/mode` — Show mode selector or switch to a specific mode
- `/default-mode` — Set which mode activates on startup
- `Ctrl+Shift+M` — Cycle through modes
- `--agent-mode <name>` — Start pi in a specific mode

**Skill:**
- `/skill:create-mode` — AI-assisted mode creation

### pi-roleplay

Roleplay tools and character management. Create, save, and start roleplay sessions with custom characters.

**Commands:**
- `/rp` — Roleplay hub: create, start, list, or delete characters
- `/create-subsession` — Create a new session from an encoded payload

**Tool:**
- `finish_character` — Finalize a character sheet and save it

### pi-session-viewer

Interactive session browser with keyboard navigation.

**Commands:**
- `/sessions` — Browse sessions for the current project
- `/sessions all` — Browse all sessions across all projects
- `Ctrl+Shift+S` — Keyboard shortcut to open session viewer

### pi-web

Web search and fetch tools using DuckDuckGo and Mozilla Readability. Zero API costs.

**Tools:**
- `web_search` — Search the web via DuckDuckGo, returns up to 10 results with title, URL, and snippet
- `web_fetch` — Fetch a URL and extract main content (strips nav, sidebars, ads); also supports markdown, JSON, XML, and plain text

> **Note:** This extension requires `@mozilla/readability` and `jsdom` as npm dependencies. They are installed automatically via npm workspaces (see [Development](#development)).

### pi-wiki

Local wiki tools for scraping and searching documentation.

### pi-undo-redo

Undo/redo commands for pi sessions.

**Commands:**
- `/undo` — Rewind one user turn and restore the message in the editor
- `/redo` — Return to the state before the last undo

## Installation

### Manual (recommended for development)

Copy the extension directories into your pi agent extensions folder:

```bash
cp -r extensions/pi-modes ~/.pi/agent/extensions/
cp -r extensions/pi-roleplay ~/.pi/agent/extensions/
cp -r extensions/pi-session-viewer ~/.pi/agent/extensions/
cp -r extensions/pi-undo-redo ~/.pi/agent/extensions/
```

Then restart pi or run `/reload`.

### Via `pi install`

```bash
pi install git:github.com/h311x/pi-extensions
```

Then restart pi or run `/reload`.

**Updates:**
```bash
pi update
```

**Uninstall:**
```bash
pi remove git:github.com/h311x/pi-extensions
```

> **Note:** The `git:` shorthand (`git:github.com/user/repo`) may be converted to an invalid HTTPS URL. Use the full `ssh://` or `https://` URL format.

## Starter modes

This package includes example mode configurations. To use them:

```bash
mkdir -p ~/.pi/agent/modes
cp -r examples/modes/* ~/.pi/agent/modes/
```

The example modes (`roleplay`, `roleplay-cc`) require the `pi-roleplay` extension and `pi-modes` extension to be loaded.

## Mode configuration

Modes are configured in `~/.pi/agent/modes/<name>/`:

```
~/.pi/agent/modes/
├── settings.json              ← { "defaultMode": "default" }
├── roleplay/
│   ├── mode.json
│   └── system-prompt.md
└── my-custom-mode/
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

## Data directories

These directories are created and managed at runtime. They are **not** part of this package and persist across installs/removals.

| Data | Location | Created by |
|------|----------|-----------|
| Mode configs | `~/.pi/agent/modes/` | You (or `/skill:create-mode`) |
| Mode settings | `~/.pi/agent/modes/settings.json` | `/default-mode` command |
| Characters | `~/.pi/agent/pi-roleplay/characters/` | `finish_character` tool |

## Development

This repo is structured as a pi package monorepo with npm workspaces:

```
pi-extensions/
├── package.json              ← root manifest (extensions + skills + workspaces)
├── extensions/
│   ├── pi-modes/
│   ├── pi-roleplay/
│   ├── pi-session-viewer/
│   ├── pi-undo-redo/
│   ├── pi-web/               ← has its own package.json with npm dependencies
│   └── pi-wiki/
└── examples/
    └── modes/
```

The root `package.json` declares `"workspaces": ["extensions/*"]` so that `npm install` at the repo root also installs dependencies for each extension sub-package (e.g. `@mozilla/readability` and `jsdom` for `pi-web`).

When installed via `pi install`, pi runs `npm install` at the repo root after cloning — the workspaces config ensures extension-level dependencies are resolved correctly.

### Making changes

1. Edit files in `~/Projects/pi-extensions/`
2. If you added/changed npm dependencies in an extension, run `npm install` at the repo root
3. Commit and push
4. On machines using `pi install`: run `pi update`
5. On machines using manual copy: re-copy and `/reload`
