import { unlink } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { SessionViewerPanel, type Scope, type PanelAction, type Theme, type TuiHandle } from "./panel.js";

async function showSessions(ctx: ExtensionContext, scope: Scope): Promise<void> {
	const sessions = scope === "all" ? await SessionManager.listAll() : await SessionManager.list(ctx.cwd);
	sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

	const action = await ctx.ui.custom<PanelAction>(
		(tui: TuiHandle, theme: Theme, _keybindings: unknown, done: (action?: PanelAction) => void) =>
			new SessionViewerPanel(
				sessions,
				ctx.sessionManager.getSessionFile(),
				scope,
				theme,
				done,
				() => tui.requestRender(),
				async (path: string) => {
					const current = ctx.sessionManager.getSessionFile();
					if (path === current) {
						ctx.ui.notify("Cannot remove the current session", "warning");
						return false;
					}
					await unlink(path);
					ctx.ui.notify("Session removed", "info");
					return true;
				},
			),
		{
			overlay: true,
			overlayOptions: {
				anchor: "bottom-center",
				width: "100%",
				maxHeight: "40%",
				margin: { top: 0, right: 0, bottom: 0, left: 0 },
				visible: (termWidth: number) => termWidth >= 80,
			},
		},
	);

	if (!action) return;

	if (action.type === "switch" && action.path !== ctx.sessionManager.getSessionFile()) {
		await ctx.switchSession(action.path);
		return;
	}
}

export default function sessionViewerExtension(pi: ExtensionAPI) {
	pi.registerCommand("sessions", {
		description: "View saved sessions. Use /sessions all for all projects.",
		handler: async (args, ctx) => {
			await showSessions(ctx, args?.trim() === "all" ? "all" : "current");
		},
	});

	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "View sessions",
		handler: async (ctx) => {
			await showSessions(ctx, "current");
		},
	});
}
