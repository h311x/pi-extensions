import type { Model, Api } from "@earendil-works/pi-ai";

export interface ModeConfig {
	/** Human-readable description shown in the mode selector */
	description: string;
	/** Optional short icon/emoji shown in the footer status */
	icon?: string;
	/** Thinking level override. Omit to keep current. */
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	/** Tools to enable when this mode is active. Omit for all tools, empty for none. */
	tools?: string[];
	/** Model override. Format: "provider/model-id" or bare "model-id". Omit to keep current. */
	model?: string;
}

export interface ModesConfig {
	[name: string]: ModeConfig;
}

export interface OriginalState {
	model: Model<Api> | undefined;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface ModesSettings {
	defaultMode: string;
}

/** Built-in default mode — always available, not stored on disk */
export const DEFAULT_MODE: ModeConfig = {
	description: "Default coding assistant — standard tools, standard system prompt",
	icon: "🛠",
};
