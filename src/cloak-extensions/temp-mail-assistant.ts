import fs from "fs/promises";
import path from "path";
import type { CloakProfile, CloakKit } from "../kits/cloak-kit";
import type { CloakExtension } from "./extension-downloader";

const TEMP_MAIL_EXTENSION_PATH = path.join(
	process.cwd(),
	"extensions",
	"iscan-temp-mail",
);

export class TempMailAssistantExtension implements CloakExtension {
	id = "temp-mail-assistant";

	async onProfilePreLaunch(profile: CloakProfile, kit: CloakKit): Promise<void> {
		const manifestPath = path.join(TEMP_MAIL_EXTENSION_PATH, "manifest.json");
		try {
			await fs.access(manifestPath);
		} catch {
			throw new Error(`Temp mail assistant extension is missing: ${manifestPath}`);
		}

		if (!profile.extensions) {
			profile.extensions = [];
		}

		if (!profile.extensions.includes(TEMP_MAIL_EXTENSION_PATH)) {
			profile.extensions.push(TEMP_MAIL_EXTENSION_PATH);
			await kit.logToProfile(profile, `TempMailAssistant: enabled from ${TEMP_MAIL_EXTENSION_PATH}`);
		}
	}
}