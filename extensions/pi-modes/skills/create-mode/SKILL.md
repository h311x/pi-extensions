---
name: create-mode
description: Create a new agent mode interactively with AI assistance
---

# Create Mode

You are helping the user create a new pi agent mode. Follow this process precisely.

## Mode Format

Each mode is a directory at `~/.pi/agent/modes/<name>/` containing:

- **`mode.json`** — mode manifest (required)
- **`system-prompt.md`** — system prompt (required)

### mode.json schema

```json
{
  "description": "Human-readable label for the mode selector",
  "icon": "emoji or short text",
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "tools": ["tool1", "tool2"],
  "model": "provider/model-id"
}
```

Fields:
- `description` — **required**. Shown in the mode selector UI.
- `icon` — optional. Emoji or short text shown in the footer.
- `thinkingLevel` — optional. Omit to keep the user's current level.
- `tools` — optional. Array of tool names to enable when the mode is active. Omit to enable all tools. Empty array `[]` means no tools.
- `model` — optional. Format: `"provider/model-id"` or bare `"model-id"`. Omit to keep the user's current model.

### system-prompt.md

The complete system prompt for the mode. It **always replaces** the default pi system prompt entirely — write it as a self-contained instruction set.

## Creation Process

1. **Ask the user what kind of mode they want.** Use ask_user to understand the mode's purpose, persona, and behavior. Ask focused questions:
   - What should the agent do in this mode? What's its role?
   - Should it be constrained in any way (read-only, specific tools only)?
   - Any personality or tone preferences?
   - Should a specific model or thinking level be used?

2. **Draft the system prompt.** Based on the user's answers, write a complete `system-prompt.md`. The prompt should:
   - Define the agent's role and persona clearly
   - List specific behavioral guidelines
   - Specify any constraints (e.g., "never modify files", "only use these tools")
   - Be self-contained — it replaces the entire default system prompt

3. **Determine the tool policy.** Based on the mode's purpose, decide which tools should be enabled. Available tools include: `read`, `bash`, `edit`, `write`, `ask_user`, `finish_character`, and any other registered tools. Use `bash` to run `pi --list-tools` if you need to discover available tools.

4. **Determine the mode name.** Derive a short, kebab-case name from the mode's purpose (e.g., `roleplay`, `code-review`, `planner`).

5. **Present the draft to the user.** Show them:
   - The mode name
   - The `mode.json` content
   - A summary of the `system-prompt.md`
   Ask if they want to adjust anything before saving.

6. **Write the files.** Create the directory and write both files:
   - `~/.pi/agent/modes/<name>/mode.json`
   - `~/.pi/agent/modes/<name>/system-prompt.md`

7. **Confirm activation.** After creating the mode, ask the user if they want to switch to it immediately with `/mode <name>`.

## Companion Extensions

If the mode requires custom tools or commands that don't already exist, offer to create a companion pi extension. A companion extension is a standard pi extension placed at `~/.pi/agent/extensions/pi-<name>/` that registers the mode-specific tools and commands. The mode's `tools` array in `mode.json` should then list those tool names so they're enabled when the mode is active.

Companion extension structure:
```
~/.pi/agent/extensions/pi-<name>/
├── package.json
├── index.ts
└── README.md
```

The `index.ts` should register tools with `pi.registerTool()` and commands with `pi.registerCommand()`.

## Iteration

After a mode is created, the user can iterate on it by asking you to edit `system-prompt.md` or `mode.json` directly. You can also test the mode by switching to it and seeing how the agent behaves.
