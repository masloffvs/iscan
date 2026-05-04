import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";
import type { Browser, BrowserContext } from "playwright-core";
import type { CloakProfile, CloakKit } from "../kits/cloak-kit";

export interface CloakExtension {
	id: string;
	onProfileLaunch?: (context: BrowserContext, profile: CloakProfile, kit: CloakKit) => Promise<void>;
	onProfilePreLaunch?: (profile: CloakProfile, kit: CloakKit) => Promise<void>;
}

export class ExtensionDownloader implements CloakExtension {
	id = "extension-downloader";

	async onProfilePreLaunch(profile: CloakProfile, kit: CloakKit): Promise<void> {
		if (!profile.webStoreExtensions || profile.webStoreExtensions.length === 0) return;

		const extensionsDir = path.join(process.cwd(), "data", "extensions");
		await fs.mkdir(extensionsDir, { recursive: true }).catch(() => {});

		if (!profile.extensions) profile.extensions = [];

		for (const extId of profile.webStoreExtensions) {
			const destDir = path.join(extensionsDir, extId);
			const exists = await fs.access(destDir).then(() => true).catch(() => false);

			if (!exists) {
				await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] Starting download process...`);
				try {
					await this.downloadAndUnpack(extId, destDir, profile, kit);
				} catch (err) {
					await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] ERROR: ${(err as Error).message}`);
					throw err;
				}
			}

			if (!profile.extensions.includes(destDir)) {
				profile.extensions.push(destDir);
			}
		}
	}

	private async downloadAndUnpack(extId: string, destDir: string, profile: CloakProfile, kit: CloakKit): Promise<void> {
		const chromeVersion = await kit.getChromiumVersion();
		const url = `https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64&os_arch=x86_64&nacl_arch=x86-64&prod=chromebrowser&prodchannel=&prodversion=${encodeURIComponent(chromeVersion)}&lang=en-US&acceptformat=crx2,crx3&x=id%3D${extId}%26installsource%3Dondemand%26uc`;
		
		try {
			await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] Connecting to Google servers using Chromium ${chromeVersion}...`);
			const response = await axios.get(url, { 
				responseType: "arraybuffer",
				timeout: 20000 
			});
			
			const crxBuffer = Buffer.from(response.data);
			if (response.status === 204 || crxBuffer.length === 0) {
				throw new Error(`Chrome Web Store returned no CRX payload (HTTP ${response.status}) for Chromium ${chromeVersion}`);
			}
			await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] Received ${crxBuffer.length} bytes.`);

			await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] Extracting ZIP payload from CRX...`);
			const zipStart = crxBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
			if (zipStart === -1) {
				throw new Error("Invalid CRX format: PK ZIP header not found.");
			}
			
			const zipBuffer = crxBuffer.slice(zipStart);
			const tempFile = path.join(process.cwd(), "data", `${extId}.zip`);
			await fs.writeFile(tempFile, zipBuffer);

			await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] Unpacking archive...`);
			await fs.mkdir(destDir, { recursive: true });
			
			try {
				execSync(`unzip -o "${tempFile}" -d "${destDir}"`, { stdio: 'ignore' });
				await kit.logToProfile(profile, `ExtensionDownloader: [${extId}] Successfully installed to ${destDir}`);
			} catch (e) {
				throw new Error("Failed to unpack. Please run: sudo apt install unzip");
			} finally {
				await fs.rm(tempFile).catch(() => {});
			}
		} catch (err) {
			const msg = axios.isAxiosError(err) ? err.message : (err as Error).message;
			throw new Error(msg);
		}
	}
}
