import { randomUUID } from "node:crypto";

import { $storageKit } from "../../kits";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule } from "../module";

export type CoreNoteParams = {
	text: string;
};

export type CoreNoteResult = {
	id: string;
	createdAt: string;
	text: string;
	storage: "storage-kit";
	created: true;
};

export const coreNoteModule = defineModule<CoreNoteParams, CoreNoteResult>({
	id: "core/note",
	category: "core",
	description: "Create a quick runtime note and store it in the StorageKit database.",
	palette: {
		title: "note",
		keywords: ["memo", "scratch", "journal", "quick note"],
		subInput: {
			label: "Note",
			placeholder: "Write the note you want to save...",
			submitLabel: "Create note",
		},
	},
	executor: defineExecutor(async ({ params, getStorageKit, runtime }) => {
		const text = params.text.trim();
		if (text.length === 0) {
			throw new InvalidParamsError("text is required.");
		}

		const storageKit = getStorageKit()
			?? await runtime.attachKit($storageKit, { reason: "module:core/note" });

		const entry = {
			id: randomUUID(),
			createdAt: new Date().toISOString(),
			text,
		};

		const storedNote = storageKit.insertNote(entry);

		return {
			id: storedNote.id,
			createdAt: storedNote.created_at,
			text: storedNote.text,
			storage: "storage-kit",
			created: true,
		};
	}),
}).useDefault("text");