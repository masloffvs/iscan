import fsSync from "fs";
import path from "path";
import type { BrowserContext, Page } from "playwright-core";
import type { CloakProfile, CloakKit } from "../kits/cloak-kit";
import type { CloakExtension } from "./extension-downloader";

type DownloadResult = {
	success: boolean;
	message?: string;
};

const DOWNLOAD_REQUEST_PREFIX = "__ISCAN_DOWNLOAD_REQUEST__:";
const DOWNLOAD_DIALOG_MESSAGE = "__ISCAN_DOWNLOAD_REQUEST__";
const PATCHED_BUTTON_SELECTOR = '[data-iscan-store-button="1"]';

export class WebStoreIntegrator implements CloakExtension {
	id = "web-store-integrator";

	private debugLog(msg: string) {
		try {
			const line = `[${new Date().toISOString()}] [WebStoreIntegrator] ${msg}\n`;
			fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), line);
		} catch {}
	}

	async onProfileLaunch(context: BrowserContext, profile: CloakProfile, kit: CloakKit): Promise<void> {
		this.debugLog(`Initializing for profile: ${profile.name}`);
		this.debugLog("Console download bridge ready");

		context.on("page", (page) => this.setupPage(page, profile, kit));
		for (const page of context.pages()) {
			this.setupPage(page, profile, kit);
		}
	}

	private async handleDownloadRequest(extId: string, profile: CloakProfile, kit: CloakKit): Promise<DownloadResult> {
		this.debugLog(`[${extId}] Received download request from browser`);
		await kit.logToProfile(profile, `WebStoreIntegrator: [${extId}] Download triggered`);

		try {
			if (!profile.webStoreExtensions) profile.webStoreExtensions = [];
			if (!profile.webStoreExtensions.includes(extId)) {
				profile.webStoreExtensions.push(extId);
				await kit.saveProfile(profile);

				const downloader = kit.cloakExtensions?.find((extension) => extension.id === "extension-downloader");
				if (typeof downloader?.onProfilePreLaunch !== "function") {
					throw new Error("ExtensionDownloader not found");
				}

				this.debugLog(`[${extId}] Calling downloader.onProfilePreLaunch`);
				await downloader.onProfilePreLaunch(profile, kit);
				this.debugLog(`[${extId}] Download and unpack finished`);
				return { success: true };
			}

			return { success: false, message: "Already in profile" };
		} catch (err) {
			const message = (err as Error).message;
			this.debugLog(`[${extId}] ERROR: ${message}`);
			return { success: false, message };
		}
	}

	private setupPage(page: Page, profile: CloakProfile, kit: CloakKit) {
		page.on("dialog", dialog => {
			if (dialog.message() !== DOWNLOAD_DIALOG_MESSAGE) {
				this.debugLog(`BROWSER DIALOG: [${page.url()}] ${dialog.type()}: ${dialog.message()}`);
				void dialog.dismiss().catch(() => {});
				return;
			}

			const extId = dialog.defaultValue().trim() || this.extractExtensionId(page.url());
			void (async () => {
				await dialog.dismiss().catch(() => {});
				if (!extId) {
					this.debugLog(`Download dialog ignored because extension id could not be determined for ${page.url()}`);
					return;
				}

				this.debugLog(`[${extId}] Prompt download request received from ${page.url()}`);
				const result = await this.handleDownloadRequest(extId, profile, kit);
				await this.updateStoreButton(page, result);
			})();
		});

		// Forward browser console to our master log for debugging
		page.on("console", msg => {
			const text = msg.text();
			if (text.startsWith(DOWNLOAD_REQUEST_PREFIX)) {
				const extId = text.slice(DOWNLOAD_REQUEST_PREFIX.length).trim() || this.extractExtensionId(page.url());
				if (!extId) {
					this.debugLog(`Download request ignored because extension id could not be determined for ${page.url()}`);
					return;
				}
				void (async () => {
					this.debugLog(`[${extId}] Console download request received from ${page.url()}`);
					const result = await this.handleDownloadRequest(extId, profile, kit);
					await this.updateStoreButton(page, result);
				})();
				return;
			}

			this.debugLog(`BROWSER CONSOLE: [${page.url()}] ${msg.type()}: ${text}`);
		});

		page.on("framenavigated", async (frame) => {
			if (frame !== page.mainFrame()) return;
			if (page.url().includes("chromewebstore.google.com/detail/")) {
				this.debugLog(`Navigated to extension page: ${page.url()}`);
				await this.patchStoreButton(page);
			}
		});

		if (page.url().includes("chromewebstore.google.com/detail/")) {
			void this.patchStoreButton(page);
		}
	}

	private extractExtensionId(url: string): string | null {
		const match = url.match(/\/detail\/[^/]+\/([a-z]{32})(?:[/?#]|$)/i);
		return match?.[1] ?? null;
	}

	private async updateStoreButton(page: Page, result: DownloadResult) {
		try {
			let button = page.locator(PATCHED_BUTTON_SELECTOR).first();
			if (await button.count() === 0) {
				this.debugLog(`Patched store button not found during update on ${page.url()}, falling back to visible store button`);
				button = page.getByRole("button", { name: /Cloak|Chrome|Downloading/i }).first();
				if (await button.count() === 0) {
					return;
				}
			}

			await button.evaluate((buttonElement, payload) => {
				const button = buttonElement as Record<string, any>;
				const label = button.querySelector?.('[jsname="V67aGc"]') || button;
				const text = payload.success ? "Added to Cloak. Restart profile" : `Cloak error: ${payload.message || "unknown error"}`;

				if (label && "textContent" in label) {
					label.textContent = text;
				}

				button.disabled = !!payload.success ? true : false;
				button.setAttribute?.("aria-label", text);
				button.setAttribute?.("data-iscan-state", payload.success ? "done" : "error");
			}, result);
		} catch (error) {
			this.debugLog(`Failed to update patched store button: ${(error as Error).message}`);
		}
	}

	private async patchStoreButton(page: Page) {
		try {
			const extId = this.extractExtensionId(page.url());
			if (!extId) {
				this.debugLog(`Skipped store button patch because extension id could not be parsed from ${page.url()}`);
				return;
			}

			const button = page.getByRole("button", { name: /Add to Chrome/i }).first();
			await button.waitFor({ state: "visible", timeout: 10000 });
			this.debugLog(`Patching native store button for ${extId} on ${page.url()}`);

			await button.evaluate((buttonElement, payload) => {
				const globalScope = globalThis as Record<string, any>;
				const button = buttonElement as Record<string, any>;
				if (button.getAttribute?.("data-iscan-store-button") === "1") {
					return;
				}

				const label = button.querySelector?.('[jsname="V67aGc"]') || button;
				const setState = (text: string, disabled: boolean, state: string) => {
					if (label && "textContent" in label) {
						label.textContent = text;
					}

					button.disabled = disabled;
					button.setAttribute?.("aria-label", text);
					button.setAttribute?.("data-iscan-state", state);
					button.setAttribute?.("data-iscan-store-button", "1");
				};

				setState("Add to Cloak", false, "ready");
				button.addEventListener?.("click", (event: any) => {
					event?.preventDefault?.();
					event?.stopPropagation?.();
					event?.stopImmediatePropagation?.();
					setState("Downloading to Cloak...", true, "pending");
					if (typeof globalScope.prompt === "function") {
						globalScope.prompt(payload.downloadDialogMessage, payload.extId);
						return;
					}

					globalScope.console?.info?.(payload.downloadRequestPrefix + payload.extId);
				}, true);
			}, {
				downloadDialogMessage: DOWNLOAD_DIALOG_MESSAGE,
				downloadRequestPrefix: DOWNLOAD_REQUEST_PREFIX,
				extId,
			});
		} catch (e) {
			this.debugLog(`Native store button patch failed: ${(e as Error).message}`);
		}
	}
}
