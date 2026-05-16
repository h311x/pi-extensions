import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface StoredCharacter {
	id: string;
	name: string;
	markdown: string;
	createdAt: string;
	updatedAt: string;
}

function getCharacterDir(): string {
	return join(getAgentDir(), "pi-roleplay", "characters");
}

function ensureCharacterDir(): void {
	mkdirSync(getCharacterDir(), { recursive: true });
}

export function listCharacters(): StoredCharacter[] {
	ensureCharacterDir();
	const dir = getCharacterDir();
	const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	const chars: StoredCharacter[] = [];

	for (const file of files) {
		const path = join(dir, file);
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8")) as StoredCharacter;
			if (parsed?.id && parsed?.name && parsed?.markdown) chars.push(parsed);
		} catch (err) {
			console.error(`[roleplay] Failed to parse character file ${path}: ${err}`);
		}
	}

	return chars.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function saveCharacter(name: string, markdown: string): StoredCharacter {
	ensureCharacterDir();
	const existing = listCharacters().find((c) => c.name.toLowerCase() === name.toLowerCase());
	const now = new Date().toISOString();
	const record: StoredCharacter = existing
		? {
				...existing,
				name,
				markdown,
				updatedAt: now,
			}
		: {
				id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				name,
				markdown,
				createdAt: now,
				updatedAt: now,
			};

	writeFileSync(join(getCharacterDir(), `${record.id}.json`), JSON.stringify(record, null, 2), "utf-8");
	return record;
}

export function deleteCharacter(id: string): boolean {
	const path = join(getCharacterDir(), `${id}.json`);
	if (!existsSync(path)) return false;
	unlinkSync(path);
	return true;
}

export function formatCharacterLabel(character: StoredCharacter): string {
	const updated = new Date(character.updatedAt).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return `${character.name} · ${updated} · ${character.id}`;
}

export function findCharacter(characters: StoredCharacter[], query: string): StoredCharacter | undefined | "ambiguous" {
	const q = query.trim().toLowerCase();
	if (!q) return undefined;

	const exact = characters.find((c) => c.id.toLowerCase() === q || c.name.toLowerCase() === q);
	if (exact) return exact;

	const partial = characters.filter(
		(c) => c.id.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q),
	);
	if (partial.length === 1) return partial[0];
	if (partial.length > 1) return "ambiguous";
	return undefined;
}

export function characterNotFoundMessage(query: string, characters: StoredCharacter[]): string {
	const match = findCharacter(characters, query);
	if (match === "ambiguous") return `Multiple characters match "${query}". Use /rp and pick from the list.`;
	return `Character not found: ${query}`;
}
