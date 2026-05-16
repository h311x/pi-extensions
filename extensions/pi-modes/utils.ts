import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModeConfig, ModesConfig, ModesSettings } from "./types.js";

/** Root directory for all mode configuration */
export function getModesConfigDir(): string {
	return join(getAgentDir(), "modes");
}

/** Discover all custom modes from ~/.pi/agent/modes/<name>/ */
export function discoverModes(): ModesConfig {
	const configDir = getModesConfigDir();
	const modes: ModesConfig = {};

	if (!existsSync(configDir)) return modes;

	const entries = readdirSync(configDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const modeDir = join(configDir, entry.name);
		const manifestPath = join(modeDir, "mode.json");

		if (!existsSync(manifestPath)) {
			console.error(`[modes] Skipping ${entry.name}: no mode.json found`);
			continue;
		}

		try {
			const raw = readFileSync(manifestPath, "utf-8");
			const config = JSON.parse(raw) as ModeConfig;

			if (!config.description) {
				console.error(`[modes] Skipping ${entry.name}: missing description`);
				continue;
			}

			// Verify system-prompt.md exists
			const promptPath = join(modeDir, "system-prompt.md");
			if (!existsSync(promptPath)) {
				console.error(`[modes] Skipping ${entry.name}: no system-prompt.md found`);
				continue;
			}

			modes[entry.name] = config;
		} catch (err) {
			console.error(`[modes] Failed to load mode ${entry.name}: ${err}`);
		}
	}

	return modes;
}

/** Read the system prompt for a mode from its system-prompt.md */
export function resolveSystemPrompt(modeName: string): string | undefined {
	const promptPath = join(getModesConfigDir(), modeName, "system-prompt.md");
	if (!existsSync(promptPath)) return undefined;

	try {
		return readFileSync(promptPath, "utf-8");
	} catch (err) {
		console.error(`[modes] Failed to read ${promptPath}: ${err}`);
		return undefined;
	}
}

/** Load settings from ~/.pi/agent/modes/settings.json */
export function loadSettings(): ModesSettings {
	const settingsPath = join(getModesConfigDir(), "settings.json");

	if (!existsSync(settingsPath)) {
		return { defaultMode: "default" };
	}

	try {
		return JSON.parse(readFileSync(settingsPath, "utf-8")) as ModesSettings;
	} catch (err) {
		console.error(`[modes] Failed to load settings: ${err}`);
		return { defaultMode: "default" };
	}
}

/** Save settings to ~/.pi/agent/modes/settings.json */
export function saveSettings(settings: ModesSettings): void {
	const configDir = getModesConfigDir();
	mkdirSync(configDir, { recursive: true });
	const settingsPath = join(configDir, "settings.json");
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}
