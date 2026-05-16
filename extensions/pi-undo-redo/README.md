# pi-undo-redo

Undo/redo commands for pi sessions.

## Features

- `/undo` — Move back before the last user message and restore it into the editor
- `/redo` — Return to the session state before the last `/undo`

## Usage

Type `/undo` to rewind one user turn. The undone message text is restored into the editor so you can edit and resend it. Type `/redo` to return to where you were before the undo.

Redo state is in-memory only — it is lost when pi restarts, which is fine because the session tree itself persists.
