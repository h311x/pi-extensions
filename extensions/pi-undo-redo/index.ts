import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** In-memory redo state — lost on restart, which is fine since the session reloads anyway. */
let redoTargetId: string | undefined;
let redoMessageText: string | undefined;

function extractUserText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part): part is { type: string; text?: string } =>
				typeof part === "object" && part !== null && "type" in part,
			)
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("");
	}
	return "";
}

export default function undoRedoExtension(pi: ExtensionAPI) {
	pi.registerCommand("undo", {
		description: "Move back before the last user message and restore it into the editor",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const branch = ctx.sessionManager.getBranch();
			let lastUserEntry:
				| { id: string; parentId: string | null; message: { role: string; content: unknown } }
				| undefined;

			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i] as {
					type: string;
					id: string;
					parentId: string | null;
					message?: { role: string; content: unknown };
				};
				if (entry.type === "message" && entry.message?.role === "user") {
					lastUserEntry = { id: entry.id, parentId: entry.parentId, message: entry.message };
					break;
				}
			}

			if (!lastUserEntry) {
				ctx.ui.notify("Nothing to undo: no user message in the current branch.", "warning");
				return;
			}

			if (lastUserEntry.parentId === null) {
				ctx.ui.notify(
					"Cannot undo the first message: no earlier entry to navigate to.",
					"warning",
				);
				return;
			}

			const oldLeafId = ctx.sessionManager.getLeafId();
			const messageText = extractUserText(lastUserEntry.message.content);

			const result = await ctx.navigateTree(lastUserEntry.parentId, {
				summarize: false,
			});

			if (result.cancelled) {
				ctx.ui.notify("Undo cancelled.", "warning");
				return;
			}

			// Save redo state in memory
			redoTargetId = oldLeafId ?? undefined;
			redoMessageText = messageText || undefined;

			// Restore the undone message into the editor
			if (messageText) ctx.ui.setEditorText(messageText);

			ctx.ui.notify("Undid last user turn. Message restored in editor.", "info");
		},
	});

	pi.registerCommand("redo", {
		description: "Return to the session state before the last /undo",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			if (!redoTargetId) {
				ctx.ui.notify("Nothing to redo.", "warning");
				return;
			}

			const targetId = redoTargetId;
			const messageText = redoMessageText;

			const result = await ctx.navigateTree(targetId);

			if (result.cancelled) {
				ctx.ui.notify("Redo cancelled.", "warning");
				return;
			}

			// Clear editor of any restored undo text
			if (messageText) {
				const currentEditorText = ctx.ui.getEditorText();
				if (currentEditorText === messageText) {
					ctx.ui.setEditorText("");
				}
			}

			// Clear redo state
			redoTargetId = undefined;
			redoMessageText = undefined;

			ctx.ui.notify("Redid last undo. Restored previous session state.", "info");
		},
	});
}
