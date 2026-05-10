import { z } from "zod";

import { defineDynamicSettings } from "./registry";

let settingsCatalogLoaded = false;

const ntfyTopicUrlSchema = z.string().trim().refine(
	(value) => value.length === 0 || z.string().url().safeParse(value).success,
	"Invalid url",
);

export function ensureSettingsCatalogLoaded(): void {
	if (settingsCatalogLoaded) {
		return;
	}

	settingsCatalogLoaded = true;

	defineDynamicSettings({
		id: "ntfy-topic-url",
		label: "Ntfy Topic URL",
		description: "Default ntfy topic endpoint used by notification senders, for example https://ntfy.sh/mytopic.",
		type: ntfyTopicUrlSchema,
		default: async () => "",
		group: {
			id: "notifications",
			label: "Notifications",
			order: 100,
		},
		secret: false,
		editor: {
			kind: "string",
			placeholder: "https://ntfy.sh/mytopic",
		},
		order: 100,
	});
}