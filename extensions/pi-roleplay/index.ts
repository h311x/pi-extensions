import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StoredCharacter } from "./characters.js";
import {
	listCharacters,
	saveCharacter,
	deleteCharacter,
	formatCharacterLabel,
	findCharacter,
	characterNotFoundMessage,
} from "./characters.js";

interface CreateSubsessionPayload {
	mode?: string;
	sessionName?: string;
	parentSession?: string;
	customEntries?: Array<{ customType: string; data?: unknown }>;
	customMessages?: Array<{
		customType: string;
		content: string;
		display?: boolean;
		details?: unknown;
	}>;
}

function decodePayload(encoded: string): CreateSubsessionPayload {
	return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

export default function roleplayExtension(pi: ExtensionAPI) {
	// ----- Subsession creation -----

	async function runCreateSubsession(payload: CreateSubsessionPayload, ctx: ExtensionContext): Promise<boolean> {
		await ctx.waitForIdle();

		const result = await ctx.newSession({
			parentSession: payload.parentSession ?? ctx.sessionManager.getSessionFile(),
			setup: async (sm) => {
				if (payload.mode) sm.appendCustomEntry("mode-state", { name: payload.mode });
				for (const entry of payload.customEntries ?? []) {
					if (entry.customType) sm.appendCustomEntry(entry.customType, entry.data);
				}
				for (const message of payload.customMessages ?? []) {
					if (message.customType && message.content) {
						sm.appendCustomMessageEntry(message.customType, message.content, message.display ?? true, message.details);
					}
				}
				if (payload.sessionName) sm.appendSessionInfo(payload.sessionName);
			},
			withSession: async (nextCtx) => {
				nextCtx.ui.notify(
					`Created session${payload.sessionName ? `: ${payload.sessionName}` : ""}. Change model if desired, then send your first message.`,
					"info",
				);
			},
		});

		if (result.cancelled) {
			ctx.ui.notify("Subsession creation cancelled", "warning");
			return false;
		}
		return true;
	}

	async function createRoleplaySessionFromCharacter(character: StoredCharacter, ctx: ExtensionContext): Promise<boolean> {
		const payload: CreateSubsessionPayload = {
			mode: "roleplay",
			sessionName: `Roleplay: ${character.name}`,
			parentSession: ctx.sessionManager.getSessionFile(),
			customMessages: [
				{
					customType: "roleplay-character-sheet",
					content: character.markdown,
					display: true,
					details: {
						characterName: character.name,
						characterId: character.id,
						sourceSession: ctx.sessionManager.getSessionFile(),
						createdAt: new Date().toISOString(),
					},
				},
			],
		};
		return runCreateSubsession(payload, ctx);
	}

	// ----- finish_character tool -----

	pi.registerTool({
		name: "finish_character",
		label: "Finish Character",
		description:
			"Finalize a roleplay character as a Markdown character sheet and prepare a new roleplay session from it.",
		promptSnippet: "Finalize a roleplay character and prepare a new roleplay session.",
		promptGuidelines: [
			"Use finish_character only when the user asks to finalize, export, or start roleplay with the completed character.",
			"When using finish_character, pass only the final Markdown character sheet, not the full creation conversation.",
		],
		parameters: Type.Object({
			characterName: Type.String({ description: "The character's display name or a concise fallback title." }),
			markdown: Type.String({ description: "The final Markdown character sheet to carry into roleplay." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const characterName = params.characterName.trim() || "Unnamed Character";
			const markdown = params.markdown.trim();

			if (!markdown) {
				return {
					content: [{ type: "text", text: "Cannot finalize the character because the Markdown sheet is empty." }],
					isError: true,
				};
			}

			const saved = saveCharacter(characterName, markdown);

			ctx.ui.notify(`Character saved: ${saved.name}. Use /rp to start roleplay from saved characters.`, "info");

			return {
				content: [
					{
						type: "text",
						text: `Character finalized and saved as "${saved.name}" (id: ${saved.id}). Use /rp to start roleplay from saved characters.\n\n${saved.markdown}`,
					},
				],
				details: { characterName: saved.name, characterId: saved.id },
			};
		},
	});

	// ----- /rp command -----

	async function chooseCharacter(
		ctx: ExtensionContext,
		characters: StoredCharacter[],
		prompt: string,
	): Promise<StoredCharacter | undefined> {
		const labels = characters.map(formatCharacterLabel);
		const choice = await ctx.ui.select(prompt, labels);
		if (!choice) return undefined;
		return characters[labels.indexOf(choice)];
	}

	async function pickRoleplayCharacter(
		args: string | undefined,
		ctx: ExtensionContext,
		prompt = "Start roleplay with:",
	): Promise<StoredCharacter | undefined> {
		const query = args?.trim() ?? "";
		const characters = listCharacters();
		if (characters.length === 0) {
			ctx.ui.notify("No saved characters yet. Use /rp, then choose Create character.", "info");
			return undefined;
		}

		if (query) {
			const selected = findCharacter(characters, query);
			if (selected === "ambiguous" || !selected) {
				ctx.ui.notify(characterNotFoundMessage(query, characters), selected === "ambiguous" ? "warning" : "error");
				return undefined;
			}
			return selected;
		}

		return chooseCharacter(ctx, characters, prompt);
	}

	pi.registerCommand("rp", {
		description: "Roleplay hub: create, start, list, or delete characters",
		handler: async (_args, ctx) => {
			const choice = await ctx.ui.select("Roleplay:", [
				"Start from saved character",
				"Create character",
				"List saved characters",
				"Delete saved character",
			]);
			if (!choice) return;

			if (choice === "Start from saved character") {
				const selected = await pickRoleplayCharacter(undefined, ctx);
				if (selected) await createRoleplaySessionFromCharacter(selected, ctx);
			} else if (choice === "Create character") {
				// Switch to roleplay-cc mode via /mode command
				pi.sendUserMessage("/mode roleplay-cc");
			} else if (choice === "List saved characters") {
				const characters = listCharacters();
				if (characters.length === 0) {
					ctx.ui.notify("No saved characters", "info");
					return;
				}
				await ctx.ui.select(`Saved characters (${characters.length}):`, characters.map(formatCharacterLabel));
			} else if (choice === "Delete saved character") {
				const selected = await pickRoleplayCharacter(undefined, ctx, "Delete which character:");
				if (selected && (await ctx.ui.select(`Delete ${selected.name}?`, ["No", "Yes"])) === "Yes") {
					deleteCharacter(selected.id);
					ctx.ui.notify(`Deleted character: ${selected.name}`, "info");
				}
			}
		},
	});

	// ----- /create-subsession command -----

	pi.registerCommand("create-subsession", {
		description: "Create a new session from an encoded payload",
		handler: async (args, ctx) => {
			let payload: CreateSubsessionPayload;
			try {
				payload = decodePayload(args.trim());
			} catch (err) {
				ctx.ui.notify(`Invalid create-subsession payload: ${err instanceof Error ? err.message : String(err)}`, "error");
				return;
			}

			await runCreateSubsession(payload, ctx);
		},
	});
}
