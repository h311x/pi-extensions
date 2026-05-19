import * as os from "node:os";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Scope = "current" | "all";
export type PanelAction = { type: "switch"; path: string } | undefined;

/** Minimal theme interface covering methods used by SessionViewerPanel */
export interface Theme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

/** Minimal TUI handle interface covering methods used by the panel factory */
export interface TuiHandle {
	requestRender(): void;
}

function shortenPath(path: string): string {
	const home = os.homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function formatAge(date: Date): string {
	const ms = Date.now() - date.getTime();
	const min = Math.floor(ms / 60_000);
	const hr = Math.floor(ms / 3_600_000);
	const day = Math.floor(ms / 86_400_000);
	if (min < 1) return "now";
	if (min < 60) return `${min}m ago`;
	if (hr < 24) return `${hr}h ago`;
	if (day < 7) return `${day}d ago`;
	return date.toLocaleDateString();
}

function sessionTitle(session: SessionInfo): string {
	return (session.name || session.firstMessage || "Untitled session").replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

function lineWithRight(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	const availableLeft = Math.max(0, width - rightWidth - 1);
	const clippedLeft = truncateToWidth(left, availableLeft, "…");
	const spaces = Math.max(1, width - visibleWidth(clippedLeft) - rightWidth);
	return truncateToWidth(`${clippedLeft}${" ".repeat(spaces)}${right}`, width, "");
}

export class SessionViewerPanel {
	private selected = 0;
	private scroll = 0;
	private pendingRemovePath: string | undefined;
	private removing = false;

	constructor(
		private sessions: SessionInfo[],
		private readonly currentSessionPath: string | undefined,
		private readonly scope: Scope,
		private readonly theme: Theme,
		private readonly done: (action?: PanelAction) => void,
		private readonly requestRender: () => void,
		private readonly removeSession: (path: string) => Promise<boolean>,
	) {}

	invalidate(): void {}

	private filtered(): SessionInfo[] {
		return this.sessions;
	}

	handleInput(data: string): void {
		const filtered = this.filtered();

		if (this.removing) return;

		if (this.pendingRemovePath) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q" || data === "n" || data === "N") {
				this.pendingRemovePath = undefined;
				this.requestRender();
				return;
			}

			if (matchesKey(data, Key.enter) || data === "y" || data === "Y") {
				const path = this.pendingRemovePath;
				this.pendingRemovePath = undefined;
				this.removing = true;
				void this.removeSession(path)
					.then((removed) => {
						if (!removed) return;
						this.sessions = this.sessions.filter((session) => session.path !== path);
						this.selected = Math.min(this.selected, Math.max(0, this.sessions.length - 1));
					})
					.finally(() => {
						this.removing = false;
						this.requestRender();
					});
				this.requestRender();
				return;
			}

			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.done();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			const selected = filtered[this.selected];
			if (selected) this.done({ type: "switch", path: selected.path });
			return;
		}

		if (data === "r" || data === "R") {
			const selected = filtered[this.selected];
			if (selected) {
				if (selected.path === this.currentSessionPath) return;
				this.pendingRemovePath = selected.path;
				this.requestRender();
			}
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.selected = Math.max(0, this.selected - 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.down)) {
			this.selected = Math.min(Math.max(0, filtered.length - 1), this.selected + 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.home)) {
			this.selected = 0;
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.end)) {
			this.selected = Math.max(0, filtered.length - 1);
			this.requestRender();
			return;
		}
	}

	render(width: number): string[] {
		const theme = this.theme;
		const filtered = this.filtered();
		this.selected = Math.min(this.selected, Math.max(0, filtered.length - 1));

		const lines: string[] = [];
		lines.push(theme.fg("accent", theme.bold(this.scope === "all" ? "Sessions (all projects)" : "Sessions")));
		lines.push(
			this.removing
				? theme.fg("warning", "Removing session...")
				: this.pendingRemovePath
					? theme.fg("warning", "Remove selected session? enter/y confirm · n/esc cancel")
					: theme.fg("dim", "↑↓ navigate · enter switch · r remove · q/esc close"),
		);
		lines.push(theme.fg("borderMuted", "─".repeat(Math.max(1, width))));

		const maxItems = 8;
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + maxItems) this.scroll = this.selected - maxItems + 1;
		const visible = filtered.slice(this.scroll, this.scroll + maxItems);

		if (visible.length === 0) {
			lines.push(theme.fg("muted", "No sessions found."));
		} else {
			for (let i = 0; i < visible.length; i++) {
				const index = this.scroll + i;
				const session = visible[i]!;
				const isSelected = index === this.selected;
				const isCurrent = this.currentSessionPath !== undefined && session.path === this.currentSessionPath;
				const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
				const titleColor = isCurrent ? "accent" : session.name ? "warning" : "text";
				const title = theme.fg(titleColor, sessionTitle(session));
				const right = theme.fg("dim", `${session.messageCount} msgs · ${formatAge(session.modified)}`);
				let first = lineWithRight(`${cursor}${title}`, right, width);
				if (isSelected) first = theme.bg("selectedBg", first);
				lines.push(first);

				const subtitleParts = [session.id.slice(0, 8)];
				if (isCurrent) subtitleParts.push("current");
				if (this.scope === "all" && session.cwd) subtitleParts.push(shortenPath(session.cwd));
				const subtitle = `  ${subtitleParts.join(" · ")}`;
				lines.push(theme.fg("muted", truncateToWidth(subtitle, width, "…")));
			}
		}

		lines.push(theme.fg("borderMuted", "─".repeat(Math.max(1, width))));
		const count = `${filtered.length}/${this.sessions.length}`;
		lines.push(lineWithRight(theme.fg("dim", "sessions"), theme.fg("dim", count), width));

		// Force the right-side overlay to occupy the full terminal height. The TUI
		// clips to maxHeight, so these blank rows just fill unused vertical space.
		while (lines.length < 200) lines.push("");

		return lines.map((line) => truncateToWidth(line, width, ""));
	}
}
