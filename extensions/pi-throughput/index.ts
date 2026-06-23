/**
 * pi-throughput — show response speed (output tokens/sec) in the footer.
 *
 * Measures wall-clock time from the start of each assistant message to its
 * finalization, then divides the reported output token count by that duration.
 * The result is shown as a persistent status entry in pi's footer:
 *
 *   ⚡ 48.2 tok/s (2.3k in 47s)
 *
 * The status persists between turns, so the last response's speed stays visible
 * until the next one finishes. Color signals throughput:
 *   - success (green):  ≥ 60 tok/s
 *   - accent:           ≥ 25 tok/s
 *   - warning:          below 25 tok/s
 *
 * Events used:
 *   - session_start:    reset state, show placeholder
 *   - message_start:     record assistant message start timestamp
 *   - message_end:       compute and display tok/sec from usage.output
 *   - session_shutdown:  clear timers
 *
 * Only assistant messages are timed (user / toolResult messages are ignored).
 * No-op in print / JSON modes where there is no footer UI (ctx.hasUI === false).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "throughput";
const MIN_ELAPSED_MS = 50; // below this, throughput is meaningless / unstable

function compact(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n)}`;
}

export default function (pi: ExtensionAPI) {
	let startTs: number | null = null;

	pi.on("session_start", async (_event, ctx) => {
		startTs = null;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "⚡ — tok/s"));
		}
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		startTs = Date.now();
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "⚡ generating…"));
		}
	});

	pi.on("message_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;

		const output = msg.usage?.output ?? 0;
		const elapsedMs = startTs != null ? Date.now() - startTs : 0;
		startTs = null;

		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;

		// Nothing measurable (empty/aborted response, missing usage, or too fast to be meaningful)
		if (!output || elapsedMs < MIN_ELAPSED_MS) {
			ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "⚡ — tok/s"));
			return;
		}

		const seconds = elapsedMs / 1000;
		const rate = output / seconds; // tok/s

		const color = rate >= 60 ? "success" : rate >= 25 ? "accent" : "warning";
		const text = `${compact(rate)} tok/s (${compact(output)} in ${seconds.toFixed(1)}s)`;
		ctx.ui.setStatus(STATUS_KEY, theme.fg(color, `⚡ ${text}`));
	});

	pi.on("session_shutdown", async () => {
		startTs = null;
	});
}
