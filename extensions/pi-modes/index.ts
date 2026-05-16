/**
 * Modes Extension — General-purpose mode system for pi
 *
 * Each mode defines a tool set, system prompt, and optional overrides.
 * Modes are discovered from directories under ~/.pi/agent/modes/.
 *
 * Built-in mode:
 * - default: Standard coding assistant with all standard tools
 *
 * Custom modes are loaded from:
 * - ~/.pi/agent/modes/<name>/mode.json + system-prompt.md
 *
 * Each mode config can specify:
 * - description: Human-readable label for the mode selector
 * - icon: Optional short icon/emoji shown in the footer status
 * - thinkingLevel: Override thinking level
 * - tools: Array of tool names to enable. Omit for all tools, empty for none.
 * - model: Override the active model (format: "provider/model-id" or just "model-id")
 *
 * A defaultMode can be set in ~/.pi/agent/modes/settings.json.
 *
 * Usage:
 * - /mode              Show mode selector
 * - /mode <name>       Switch to a specific mode
 * - Ctrl+Shift+M       Cycle through modes
 * - --agent-mode name  Start pi in a specific mode (overrides defaultMode)
 */

import { join } from "node:path";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { ModeConfig, ModesConfig, OriginalState } from "./types.js";
import { DEFAULT_MODE } from "./types.js";
import { discoverModes, resolveSystemPrompt, loadSettings, saveSettings, getModesConfigDir } from "./utils.js";

export default function modesExtension(pi: ExtensionAPI) {
	let modes: ModesConfig = { default: DEFAULT_MODE };
	let activeModeName = "default";
	let activeMode: ModeConfig = DEFAULT_MODE;
	let originalState: OriginalState | undefined;

	// ----- Mode application -----

	async function applyMode(name: string, mode: ModeConfig, ctx: ExtensionContext): Promise<void> {
		// Snapshot current state before leaving default mode for the first time.
		// Default mode restores model/thinking defaults, but tools are always mode-explicit.
		if (activeModeName === "default" && name !== "default" && !originalState) {
			originalState = {
				model: ctx.model,
				thinkingLevel: pi.getThinkingLevel(),
			};
		}

		if (name === "default" && originalState) {
			if (originalState.model) await pi.setModel(originalState.model);
			pi.setThinkingLevel(originalState.thinkingLevel);
			originalState = undefined;
		} else if (name !== "default") {
			// Apply model override
			if (mode.model) {
				let model: Model<Api> | undefined;

				// Support "provider/model-id" or bare "model-id" format
				if (mode.model.includes("/")) {
					const [provider, ...rest] = mode.model.split("/");
					const modelId = rest.join("/");
					model = ctx.modelRegistry.find(provider!, modelId);
				} else {
					// Search across all providers
					for (const provider of ctx.modelRegistry.getProviders()) {
						model = ctx.modelRegistry.find(provider, mode.model);
						if (model) break;
					}
				}

				if (model) {
					const ok = await pi.setModel(model);
					if (!ok) ctx.ui.notify(`Mode "${name}": no API key for ${mode.model}`, "warning");
				} else {
					ctx.ui.notify(`Mode "${name}": model not found — ${mode.model}`, "warning");
				}
			}

			// Apply thinking level override
			if (mode.thinkingLevel) pi.setThinkingLevel(mode.thinkingLevel);
		}

		// Apply explicit tool policy. Omit tools = all available. Empty = none.
		const allNames = pi.getAllTools().map((t) => t.name);
		let enabled: string[];

		if (mode.tools === undefined) {
			// No tools specified = enable all
			enabled = allNames;
		} else {
			const valid = mode.tools.filter((t) => allNames.includes(t));
			const invalid = mode.tools.filter((t) => !allNames.includes(t));
			if (invalid.length > 0) {
				ctx.ui.notify(`Mode "${name}": unknown tools skipped: ${invalid.join(", ")}`, "warning");
			}
			enabled = valid;
		}
		pi.setActiveTools(enabled);

		activeModeName = name;
		activeMode = mode;
	}

	// ----- Status indicator -----

	function updateStatus(ctx: ExtensionContext): void {
		const icon = activeMode.icon ? `${activeMode.icon} ` : "";
		const label = `mode ${icon}${activeModeName}`;

		if (activeModeName === "default") {
			ctx.ui.setStatus("mode", ctx.ui.theme.fg("muted", label));
		} else {
			ctx.ui.setStatus("mode", ctx.ui.theme.fg("accent", ctx.ui.theme.bold(label)));
		}
	}

	// ----- CLI flag: --agent-mode <name> -----

	pi.registerFlag("agent-mode", {
		description: "Start in a specific agent mode (overrides defaultMode setting)",
		type: "string",
	});

	// ----- /mode command -----

	pi.registerCommand("mode", {
		description: "Switch agent mode (e.g., /mode roleplay)",
		handler: async (args, ctx) => {
			const name = args?.trim();

			if (!name) {
				// Show selector
				const modeNames = Object.keys(modes);
				if (modeNames.length === 0) {
					ctx.ui.notify("No modes available", "info");
					return;
				}
				const choice = await ctx.ui.select("Select mode:", modeNames);
				if (!choice) return;
				const mode = modes[choice];
				if (mode) {
					await applyMode(choice, mode, ctx);
					ctx.ui.notify(`Mode: ${choice} — ${mode.description}`, "info");
					updateStatus(ctx);
				}
				return;
			}

			const mode = modes[name];
			if (!mode) {
				ctx.ui.notify(`Unknown mode "${name}". Available: ${Object.keys(modes).join(", ")}`, "error");
				return;
			}
			await applyMode(name, mode, ctx);
			ctx.ui.notify(`Mode: ${name} — ${mode.description}`, "info");
			updateStatus(ctx);
		},
	});

	// ----- /default-mode command -----

	pi.registerCommand("default-mode", {
		description: "Set which mode activates on pi startup",
		handler: async (args, ctx) => {
			const name = args?.trim();

			if (!name) {
				// Show selector with current default
				const settings = loadSettings();
				const modeNames = ["default", ...Object.keys(modes).filter((n) => n !== "default")];
				const choice = await ctx.ui.select(
					`Default mode (current: ${settings.defaultMode}):`,
					modeNames,
				);
				if (!choice) return;

				settings.defaultMode = choice;
				saveSettings(settings);
				ctx.ui.notify(`Default mode set to: ${choice}`, "info");
				return;
			}

			if (name !== "default" && !modes[name]) {
				ctx.ui.notify(`Unknown mode "${name}". Available: ${Object.keys(modes).join(", ")}`, "error");
				return;
			}

			const settings = loadSettings();
			settings.defaultMode = name;
			saveSettings(settings);
			ctx.ui.notify(`Default mode set to: ${name}`, "info");
		},
	});

	// ----- Ctrl+Shift+M: cycle modes -----

	pi.registerShortcut(Key.ctrlShift("m"), {
		description: "Cycle agent modes",
		handler: async (ctx) => {
			const names = Object.keys(modes).sort();
			if (names.length <= 1) {
				ctx.ui.notify("No other modes available", "info");
				return;
			}
			const idx = names.indexOf(activeModeName);
			const next = names[(idx + 1) % names.length];
			const mode = modes[next];
			if (mode) {
				await applyMode(next, mode, ctx);
				ctx.ui.notify(`Mode: ${next} — ${mode.description}`, "info");
				updateStatus(ctx);
			}
		},
	});

	// ----- Register skills directory -----

	pi.on("resources_discover", async () => {
		return { skillPaths: [join(__dirname, "skills")] };
	});

	// ----- System prompt injection -----

	pi.on("before_agent_start", async (event) => {
		if (activeModeName === "default") return undefined;

		const prompt = resolveSystemPrompt(activeModeName);
		if (!prompt) return undefined;

		// Always replace — modes define their own complete system prompt
		return { systemPrompt: prompt };
	});

	// ----- Session lifecycle -----

	pi.on("session_start", async (_event, ctx) => {
		// Reload mode definitions
		modes = { default: DEFAULT_MODE, ...discoverModes() };

		// Check --agent-mode flag (overrides defaultMode)
		const flag = pi.getFlag("agent-mode");
		if (typeof flag === "string" && flag) {
			const mode = modes[flag];
			if (mode) {
				await applyMode(flag, mode, ctx);
				ctx.ui.notify(`Mode: ${flag} — ${mode.description}`, "info");
			} else {
				ctx.ui.notify(
					`Unknown mode "${flag}". Available: ${Object.keys(modes).join(", ")}`,
					"warning",
				);
				await applyMode("default", modes.default ?? DEFAULT_MODE, ctx);
			}
		} else {
			// Check for persisted mode in session
			const entries = ctx.sessionManager.getEntries();
			const entry = entries
				.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "mode-state")
				.pop() as { data?: { name: string } } | undefined;

			if (entry?.data?.name) {
				const mode = modes[entry.data.name];
				if (mode) {
					await applyMode(entry.data.name, mode, ctx);
				} else {
					// Mode no longer exists — fall back to default
					await applyMode("default", modes.default ?? DEFAULT_MODE, ctx);
				}
			} else {
				// Use defaultMode from settings
				const settings = loadSettings();
				const targetMode = settings.defaultMode;
				if (targetMode && targetMode !== "default" && modes[targetMode]) {
					await applyMode(targetMode, modes[targetMode], ctx);
				} else {
					await applyMode("default", modes.default ?? DEFAULT_MODE, ctx);
				}
			}
		}

		updateStatus(ctx);
	});

	// Persist mode on each turn so it survives resume
	pi.on("turn_start", async () => {
		pi.appendEntry("mode-state", { name: activeModeName });
	});
}
