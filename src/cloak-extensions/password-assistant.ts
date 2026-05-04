import fs from "fs/promises";
import path from "path";
import type { CloakProfile, CloakKit } from "../kits/cloak-kit";
import type { CloakExtension } from "./extension-downloader";

const PASSWORD_ASSISTANT_EXTENSION_PATH = path.join(
	process.cwd(),
	"extensions",
	"iscan-password-assistant",
);

export class PasswordAssistantExtension implements CloakExtension {
	id = "password-assistant";

	async onProfilePreLaunch(profile: CloakProfile, kit: CloakKit): Promise<void> {
		const manifestPath = path.join(PASSWORD_ASSISTANT_EXTENSION_PATH, "manifest.json");
		try {
			await fs.access(manifestPath);
		} catch {
			throw new Error(`Password assistant extension is missing: ${manifestPath}`);
		}

		if (!profile.extensions) {
			profile.extensions = [];
		}

		if (!profile.extensions.includes(PASSWORD_ASSISTANT_EXTENSION_PATH)) {
			profile.extensions.push(PASSWORD_ASSISTANT_EXTENSION_PATH);
			await kit.logToProfile(profile, `PasswordAssistant: enabled from ${PASSWORD_ASSISTANT_EXTENSION_PATH}`);
		}
	}
}