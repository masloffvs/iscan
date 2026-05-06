import { Buffer } from "node:buffer";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { launch, launchPersistentContext } from "cloakbrowser";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { Kit, type KitLifecycleContext } from "./kit";
import { MicrolinkUaKit } from "./microlink-ua-kit";
import { logger } from "../logger";

export const CLOAK_KIT_ID = "cloak";

const PROFILE_STARTUP_TAB_URLS = [
	"https://www.startpage.com/",
	"https://www.browserscan.net/",
] as const;

const PROFILE_CLONE_SKIP_NAMES = new Set([
	"ActorSafetyLists",
	"AmountExtractionHeuristicRegexes",
	"BrowserMetrics",
	"BrowserMetrics-spare.pma",
	"CaptchaProviders",
	"CertificateRevocation",
	"Code Cache",
	"component_crx_cache",
	"Crowd Deny",
	"crashpad",
	"extensions_crx_cache",
	"FirstPartySetsPreloaded",
	"GPUCache",
	"GraphiteDawnCache",
	"GrShaderCache",
	"hyphen-data",
	"MEIPreload",
	"OnDeviceHeadSuggestModel",
	"OriginTrials",
	"PKIMetadata",
	"Safe Browsing",
	"segmentation_platform",
	"ShaderCache",
	"SingletonCookie",
	"SingletonLock",
	"SingletonSocket",
	"Variations",
]);

function normalizePlaywrightKey(key: string, code?: string): string {
	if (key === " ") return "Space";
	if (key === "OS") return "Meta";
	if (key === "Esc") return "Escape";
	if (key === "Del") return "Delete";
	if (key === "Left") return "ArrowLeft";
	if (key === "Right") return "ArrowRight";
	if (key === "Up") return "ArrowUp";
	if (key === "Down") return "ArrowDown";
	if (key === "Dead") return code === "Space" ? "Space" : "Dead";
	return key;
}

export type CloakProfile = {
	id: string;
	name: string;
	proxy?: string;
	timezone?: string;
	locale?: string;
	userAgent?: string;
	viewportWidth?: number;
	viewportHeight?: number;
	searchEngine?: string;
	headless?: boolean;
	humanize?: boolean;
	userDataDir?: string;
	args?: string[];
	extensions?: string[]; // Paths to unpacked extensions folders
	webStoreExtensions?: string[]; // IDs from Chrome Web Store
};

type CloakLaunchProfileOptions = {
	headless?: boolean | "new";
	freshSession?: boolean;
	trackSession?: boolean;
};

type CloakScreencastOptions = {
	format?: "jpeg" | "png";
	quality?: number;
	everyNthFrame?: number;
	onFrame: (frame: { mimeType: string; bytes: Uint8Array }) => Promise<void> | void;
	onAudioChunk?: (chunk: { mimeType: string; bytes: Uint8Array }) => Promise<void> | void;
};

type CloakScreencastHandle = {
	audioMimeType?: string;
	stop: () => Promise<void>;
};

type CloakAudioCaptureHandle = {
	mimeType: string;
	stop: () => Promise<void>;
};

export type CloakProfileTab = {
	id: string;
	url: string;
	title?: string;
	active: boolean;
};

export type CloakProfileCookie = {
	domain: string;
	expires: number;
	httpOnly: boolean;
	name: string;
	path: string;
	sameSite?: "Lax" | "None" | "Strict";
	secure: boolean;
	value: string;
};

type GetProfileCookiesOptions = {
	autoLaunch?: boolean;
	domains?: readonly string[];
};

function normalizeCookieDomain(value: string): string {
	return value.replace(/^#HttpOnly_/u, "").replace(/^\.+/u, "").trim().toLowerCase();
}

function cookieMatchesDomain(cookieDomain: string, requestedDomain: string): boolean {
	const normalizedCookieDomain = normalizeCookieDomain(cookieDomain);
	const normalizedRequestedDomain = normalizeCookieDomain(requestedDomain);
	return normalizedCookieDomain === normalizedRequestedDomain
		|| normalizedCookieDomain.endsWith(`.${normalizedRequestedDomain}`);
}

function shouldCopyProfileEntry(sourcePath: string): boolean {
	const entryName = path.basename(sourcePath);
	if (PROFILE_CLONE_SKIP_NAMES.has(entryName)) {
		return false;
	}

	if (entryName.endsWith(".lock") || entryName.endsWith("-journal") || entryName.endsWith("-wal")) {
		return false;
	}

	return true;
}

import { ExtensionDownloader, type CloakExtension } from "../cloak-extensions/extension-downloader";
import { PasswordAssistantExtension } from "../cloak-extensions/password-assistant";
import { TempMailAssistantExtension } from "../cloak-extensions/temp-mail-assistant";
import { WebStoreIntegrator } from "../cloak-extensions/web-store-integrator";

export class CloakKit extends Kit {
	private profiles: CloakProfile[] = [];
	private activeSessions: Map<string, Browser | BrowserContext> = new Map();
	private activePageIds: Map<string, string> = new Map();
	private pageIds: WeakMap<Page, string> = new WeakMap();
	private trackedContexts: WeakSet<BrowserContext> = new WeakSet();
	private trackedPages: WeakSet<Page> = new WeakSet();
	private pageCounters: Map<string, number> = new Map();
	private profilesPath: string;
	private chromeVersionPromise: Promise<string> | null = null;
	public cloakExtensions: CloakExtension[] = [
		new TempMailAssistantExtension(),
		new PasswordAssistantExtension(),
		new ExtensionDownloader(),
		new WebStoreIntegrator()
	];

	constructor() {
		super({
			id: CLOAK_KIT_ID,
			name: "CloakBrowser Kit",
			description: "Manage and launch stealth Chromium profiles via Playwright",
		});
		this.profilesPath = path.join(process.cwd(), ".iscan", "cloak-profiles.json");
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		try {
			await fs.mkdir(path.dirname(this.profilesPath), { recursive: true });
			const data = await fs.readFile(this.profilesPath, "utf-8");
			this.profiles = JSON.parse(data);
		} catch {
			this.profiles = [];
		}
	}

	protected override async onStop(_context: KitLifecycleContext): Promise<void> {
		const closes = Array.from(this.activeSessions.values()).map(s => s.close().catch(() => {}));
		await Promise.all(closes);
		this.activeSessions.clear();
		this.activePageIds.clear();
		this.pageCounters.clear();
	}

	getProfiles(): CloakProfile[] {
		return [...this.profiles];
	}

	private resolveProfileOrNull(target: string): CloakProfile | null {
		const normalizedTarget = target.trim();
		if (normalizedTarget.length === 0) {
			return null;
		}

		const byId = this.profiles.find((profile) => profile.id === normalizedTarget);
		if (byId) {
			return byId;
		}

		const byName = this.profiles.filter((profile) => profile.name === normalizedTarget);
		if (byName.length === 1) {
			return byName[0] ?? null;
		}

		if (byName.length > 1) {
			throw new Error(`Profile target is ambiguous: ${normalizedTarget}`);
		}

		return null;
	}

	private resolveProfile(target: string): CloakProfile {
		const profile = this.resolveProfileOrNull(target);
		if (profile) {
			return profile;
		}

		throw new Error(`Profile ${target} not found. Use a profile id or a unique profile name.`);
	}

	private resolveProfilePath(userDataDir?: string): string | undefined {
		if (!userDataDir) return undefined;
		if (path.isAbsolute(userDataDir)) return userDataDir;
		return path.join(process.cwd(), "data", userDataDir);
	}

	private getOrAssignPageId(profileId: string, page: Page): string {
		const existingId = this.pageIds.get(page);
		if (existingId) {
			return existingId;
		}

		const nextCounter = (this.pageCounters.get(profileId) ?? 0) + 1;
		this.pageCounters.set(profileId, nextCounter);
		const pageId = `tab-${nextCounter}`;
		this.pageIds.set(page, pageId);
		return pageId;
	}

	private trackPage(profileId: string, page: Page): string {
		const pageId = this.getOrAssignPageId(profileId, page);
		if (this.trackedPages.has(page)) {
			return pageId;
		}

		this.trackedPages.add(page);
		page.on("close", () => {
			if (this.activePageIds.get(profileId) === pageId) {
				this.activePageIds.delete(profileId);
			}
		});
		return pageId;
	}

	private ensureContextTracking(profileId: string, context: BrowserContext): void {
		for (const page of context.pages()) {
			this.trackPage(profileId, page);
		}

		if (this.trackedContexts.has(context)) {
			return;
		}

		this.trackedContexts.add(context);
		context.on("page", (page) => {
			const pageId = this.trackPage(profileId, page);
			this.activePageIds.set(profileId, pageId);
		});
	}

	private async resolveActivePage(
		target: string,
		options: { createIfMissing?: boolean; activate?: boolean } = {},
	): Promise<{ profile: CloakProfile; context: BrowserContext; page: Page | null; pageId: string | null }> {
		const profile = this.resolveProfile(target);
		const context = await this.resolveBrowserContext(profile.id);
		this.ensureContextTracking(profile.id, context);

		let pages = context.pages();
		if (pages.length === 0 && options.createIfMissing !== false) {
			const newPage = await context.newPage();
			this.trackPage(profile.id, newPage);
			pages = context.pages();
		}

		for (const page of pages) {
			this.trackPage(profile.id, page);
		}

		const activePageId = this.activePageIds.get(profile.id);
		let page = activePageId
			? pages.find((candidate) => this.getOrAssignPageId(profile.id, candidate) === activePageId) ?? null
			: null;

		if (!page) {
			page = pages[0] ?? null;
		}

		if (!page) {
			return { profile, context, page: null, pageId: null };
		}

		const pageId = this.getOrAssignPageId(profile.id, page);
		if (options.activate !== false) {
			this.activePageIds.set(profile.id, pageId);
		}

		return { profile, context, page, pageId };
	}

	async listProfileTabs(target: string): Promise<CloakProfileTab[]> {
		const session = this.getRunningSession(target);
		if (!session) {
			return [];
		}

		const profile = this.resolveProfile(target);
		const context = await this.resolveBrowserContext(profile.id);
		this.ensureContextTracking(profile.id, context);
		const pages = context.pages();
		if (pages.length === 0) {
			return [];
		}

		const activePageId = this.activePageIds.get(profile.id);
		const resolvedActivePageId = activePageId ?? this.getOrAssignPageId(profile.id, pages[0]!);
		this.activePageIds.set(profile.id, resolvedActivePageId);

		return await Promise.all(pages.map(async (page) => {
			const pageId = this.trackPage(profile.id, page);
			const title = await page.title().catch(() => "");
			return {
				id: pageId,
				url: page.url(),
				title: title || undefined,
				active: pageId === resolvedActivePageId,
			};
		}));
	}

	async activateProfileTab(target: string, tabId: string): Promise<void> {
		const profile = this.resolveProfile(target);
		const context = await this.resolveBrowserContext(profile.id);
		this.ensureContextTracking(profile.id, context);
		const page = context.pages().find((candidate) => this.getOrAssignPageId(profile.id, candidate) === tabId);
		if (!page) {
			throw new Error(`Browser tab ${tabId} was not found for profile ${profile.name}.`);
		}

		this.activePageIds.set(profile.id, tabId);
		await page.bringToFront().catch(() => {});
	}

	async getChromiumVersion(): Promise<string> {
		if (!this.chromeVersionPromise) {
			this.chromeVersionPromise = (async () => {
				const fallbackVersion = "146.0.7680.177";

				try {
					const tempBrowser = await launch({ headless: true });
					const fullVersion = await tempBrowser.version();
					await tempBrowser.close();
					return fullVersion.split("/")[1] || fallbackVersion;
				} catch {
					return fallbackVersion;
				}
			})();
		}

		return this.chromeVersionPromise;
	}

	async fetchUserAgents(): Promise<string[]> {
		const userAgentKit = new MicrolinkUaKit();
		const userAgents = await userAgentKit.listUserAgents();
		if (userAgents.length > 0) {
			return userAgents;
		}

		return [
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
		];
	}

	async saveProfile(profile: CloakProfile): Promise<void> {
		const index = this.profiles.findIndex(p => p.id === profile.id);
		if (index >= 0) {
			this.profiles[index] = profile;
		} else {
			this.profiles.push(profile);
		}
		await fs.writeFile(this.profilesPath, JSON.stringify(this.profiles, null, 2));
	}

	async deleteProfile(id: string): Promise<void> {
		this.profiles = this.profiles.filter(p => p.id !== id);
		await fs.writeFile(this.profilesPath, JSON.stringify(this.profiles, null, 2));
	}

	async logToProfile(profile: CloakProfile, message: string) {
		const timestamp = new Date().toISOString();
		const logLine = `[${timestamp}] [${profile.name}] ${message}\n`;

		// Use system logger for TUI compatibility
		logger.info({ profile: profile.name }, message);

		// Also write to a master log in the root for guaranteed visibility
		try {
			fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), logLine);
		} catch {}

		try {
			const dir = profile.userDataDir ? this.resolveProfilePath(profile.userDataDir) : undefined;
			if (dir) {
				if (!fsSync.existsSync(dir)) {
					fsSync.mkdirSync(dir, { recursive: true });
				}
				const logPath = path.join(dir, "cloak.log");
				fsSync.appendFileSync(logPath, logLine);
			}
		} catch (e) {
			// Fail silently in TUI
		}
	}

	private normalizeStartupTabUrl(rawUrl: string): string {
		try {
			const parsed = new URL(rawUrl);
			const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
			return `${parsed.origin}${pathname}`;
		} catch {
			return rawUrl.trim().replace(/\/+$/, "") || rawUrl.trim();
		}
	}

	private isStartupTabMatch(pageUrl: string, targetUrl: string): boolean {
		return this.normalizeStartupTabUrl(pageUrl) === this.normalizeStartupTabUrl(targetUrl);
	}

	private async configureStartupTabs(userDataDir: string): Promise<void> {
		const prefsPath = path.join(userDataDir, "Default", "Preferences");
		await fs.mkdir(path.dirname(prefsPath), { recursive: true }).catch(() => {});

		let prefs: any = {};
		try {
			const content = await fs.readFile(prefsPath, "utf-8");
			prefs = JSON.parse(content);
		} catch {}

		const pinnedTabs = Array.isArray(prefs.pinned_tabs) ? prefs.pinned_tabs : [];
		const existingPinnedUrls = new Set(
			pinnedTabs
				.filter((entry: any) => entry && typeof entry === "object" && typeof entry.url === "string")
				.map((entry: { url: string }) => this.normalizeStartupTabUrl(entry.url))
		);

		for (const url of PROFILE_STARTUP_TAB_URLS) {
			const normalizedUrl = this.normalizeStartupTabUrl(url);
			if (!existingPinnedUrls.has(normalizedUrl)) {
				pinnedTabs.push({ url });
			}
		}

		prefs.pinned_tabs = pinnedTabs;
		if (prefs.protection) delete prefs.protection;

		await fs.writeFile(prefsPath, JSON.stringify(prefs));
	}

	private async configurePasswordManager(userDataDir: string): Promise<void> {
		const prefsPath = path.join(userDataDir, "Default", "Preferences");
		await fs.mkdir(path.dirname(prefsPath), { recursive: true }).catch(() => {});

		let prefs: any = {};
		try {
			const content = await fs.readFile(prefsPath, "utf-8");
			prefs = JSON.parse(content);
		} catch {}

		if (!prefs.profile) prefs.profile = {};
		if (!prefs.autofill) prefs.autofill = {};
		if (!prefs.password_manager) prefs.password_manager = {};

		prefs.credentials_enable_service = true;
		prefs.profile.password_manager_enabled = true;
		prefs.profile.password_generation_enabled = true;
		prefs.autofill.profile_enabled = true;
		prefs.password_manager.autosignin_enabled = true;

		if (prefs.protection) delete prefs.protection;

		await fs.writeFile(prefsPath, JSON.stringify(prefs));
	}

	private async ensureStartupTabsOpen(context: BrowserContext, profile: CloakProfile): Promise<void> {
		for (const targetUrl of PROFILE_STARTUP_TAB_URLS) {
			const isOpen = context.pages().some((page) => this.isStartupTabMatch(page.url(), targetUrl));
			if (isOpen) {
				continue;
			}

			const page = await context.newPage();
			try {
				await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
			} catch (error) {
				await this.logToProfile(profile, `Failed to open startup tab ${targetUrl}: ${(error as Error).message}`);
				if (page.url() === "about:blank") {
					await page.close().catch(() => {});
				}
			}
		}

		const preferredPage = context.pages().find((page) => this.isStartupTabMatch(page.url(), PROFILE_STARTUP_TAB_URLS[0]));
		await preferredPage?.bringToFront().catch(() => {});
	}

	private async cloneProfileUserDataDir(sourceDir: string, profileId: string): Promise<string> {
		const cloneDir = path.join(process.cwd(), ".iscan", `temp-profile-clone-${profileId}-${Date.now()}`);
		await fs.mkdir(path.dirname(cloneDir), { recursive: true }).catch(() => {});
		await fs.cp(sourceDir, cloneDir, {
			recursive: true,
			force: true,
			filter: (entryPath) => shouldCopyProfileEntry(entryPath),
		});
		return cloneDir;
	}

	async launchProfile(target: string, options: CloakLaunchProfileOptions = {}): Promise<Browser | BrowserContext> {
		const profile = this.resolveProfile(target);
		const profileId = profile.id;
		const trackSession = options.trackSession !== false;

		// DEBUG LOG
		try {
			const debugLine = `[${new Date().toISOString()}] Launching profile: ${profile.name} (Extensions: ${this.cloakExtensions.length})\n`;
			fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), debugLine);
		} catch {}

		const chromeVersion = await this.getChromiumVersion();

		let actualUserDataDir = profile.userDataDir ? this.resolveProfilePath(profile.userDataDir) : undefined;
		let cleanupUserDataDirOnClose = false;
		if (options.freshSession && actualUserDataDir) {
			actualUserDataDir = await this.cloneProfileUserDataDir(actualUserDataDir, profileId);
			cleanupUserDataDirOnClose = true;
		}

		if (!actualUserDataDir && profile.searchEngine) {
			actualUserDataDir = path.join(process.cwd(), ".iscan", `temp-profile-${profileId}-${Date.now()}`);
			cleanupUserDataDirOnClose = true;
		}

		if (actualUserDataDir) {
			await fs.mkdir(actualUserDataDir, { recursive: true }).catch(() => {});
			if (profile.searchEngine) {
				const engines: Record<string, any> = {
					"Google": { 
						short_name: "Google", 
						keyword: "google.com", 
						url: "https://www.google.com/search?q={searchTerms}",
						suggestions_url: "https://www.google.com/complete/search?client=chrome&q={searchTerms}",
						favicon_url: "https://www.google.com/favicon.ico",
						prepopulate_id: 1,
						is_default: true,
						is_active: 1,
						safe_for_autoreplace: true,
						id: "1001",
						sync_guid: "google-search-provider-iscan"
					},
					"DuckDuckGo": { 
						short_name: "DuckDuckGo", 
						keyword: "duckduckgo.com", 
						url: "https://duckduckgo.com/?q={searchTerms}",
						suggestions_url: "https://duckduckgo.com/ac/?q={searchTerms}&type=list",
						favicon_url: "https://duckduckgo.com/favicon.ico",
						prepopulate_id: 92,
						is_default: true,
						is_active: 1,
						safe_for_autoreplace: true,
						id: "1002",
						sync_guid: "ddg-search-provider-iscan"
					},
					"Bing": { 
						short_name: "Bing", 
						keyword: "bing.com", 
						url: "https://www.bing.com/search?q={searchTerms}",
						suggestions_url: "https://www.bing.com/osjson.aspx?query={searchTerms}",
						favicon_url: "https://www.bing.com/favicon.ico",
						prepopulate_id: 3,
						is_default: true,
						is_active: 1,
						safe_for_autoreplace: true,
						id: "1003",
						sync_guid: "bing-search-provider-iscan"
					},
					"Yahoo": { 
						short_name: "Yahoo", 
						keyword: "yahoo.com", 
						url: "https://search.yahoo.com/search?p={searchTerms}",
						suggestions_url: "https://search.yahoo.com/sugg/chrome?output=fxjson&command={searchTerms}",
						favicon_url: "https://search.yahoo.com/favicon.ico",
						prepopulate_id: 2,
						is_default: true,
						is_active: 1,
						safe_for_autoreplace: true,
						id: "1004",
						sync_guid: "yahoo-search-provider-iscan"
					},
					"Yandex": { 
						short_name: "Yandex", 
						keyword: "yandex.ru", 
						url: "https://yandex.ru/search/?text={searchTerms}",
						suggestions_url: "https://suggest.yandex.ru/suggest-ffp?part={searchTerms}",
						favicon_url: "https://yandex.ru/favicon.ico",
						prepopulate_id: 10,
						is_default: true,
						is_active: 1,
						safe_for_autoreplace: true,
						id: "1005",
						sync_guid: "yandex-search-provider-iscan"
					},
					"Brave": { 
						short_name: "Brave", 
						keyword: "search.brave.com", 
						url: "https://search.brave.com/search?q={searchTerms}",
						suggestions_url: "https://search.brave.com/api/suggest?q={searchTerms}",
						favicon_url: "https://search.brave.com/favicon.ico",
						prepopulate_id: 11,
						is_default: true,
						is_active: 1,
						safe_for_autoreplace: true,
						id: "1006",
						sync_guid: "brave-search-provider-iscan"
					}
				};

				const engineData = engines[profile.searchEngine];
				if (engineData) {
					const prefsPath = path.join(actualUserDataDir, "Default", "Preferences");
					await fs.mkdir(path.join(actualUserDataDir, "Default"), { recursive: true }).catch(() => {});
					
					let prefs: any = {};
					try {
						const content = await fs.readFile(prefsPath, "utf-8");
						prefs = JSON.parse(content);
					} catch {}

					// Ensure structure and clear protection hashes that might prevent the change
					if (prefs.protection) delete prefs.protection;
					if (prefs.search_provider_overrides && typeof prefs.search_provider_overrides === "string") delete prefs.search_provider_overrides;
					
					if (!prefs.default_search_provider_data) prefs.default_search_provider_data = {};
					
					// Set multiple fields to ensure it sticks
					prefs.default_search_provider_data.template_url_data = engineData;
					prefs.default_search_provider_data.mirrored_template_url_data = engineData;
					prefs.default_search_provider_data.synced_default_search_provider_data = engineData;
					
					// Force overrides
					prefs.search_provider_overrides = [engineData];
					
					// Privacy and Leak Protection
					if (!prefs.webrtc) prefs.webrtc = {};
					prefs.webrtc.ip_handling_policy = "disable_non_proxied_udp";
					prefs.webrtc.rtc_event_log_collection_allowed = false;
					prefs.webrtc.rtc_make_proxied_connections_with_local_ips = false;
					
					if (!prefs.dns_over_https) prefs.dns_over_https = {};
					prefs.dns_over_https.mode = "secure";
					prefs.dns_over_https.templates = "https://dns.google/dns-query";
					
					// Disable geolocation and other potential leaks
					if (!prefs.profile) prefs.profile = {};
					if (!prefs.profile.default_content_setting_values) prefs.profile.default_content_setting_values = {};
					prefs.profile.default_content_setting_values.geolocation = 2; // Block
					prefs.profile.default_content_setting_values.media_stream = 2; // Block
					
					await fs.writeFile(prefsPath, JSON.stringify(prefs));

					// Also try to update Web Data database if it exists
					const webDataPath = path.join(actualUserDataDir, "Default", "Web Data");
					try {
						const { execSync } = await import("child_process");
						
						// 1. Ensure the engine exists in keywords table
						const id = parseInt(engineData.id, 10);
						const now = Math.floor(Date.now() / 1000) * 1000000;
						const sql = `
							INSERT OR REPLACE INTO keywords 
							(id, short_name, keyword, favicon_url, url, suggest_url, prepopulate_id, is_active, safe_for_autoreplace, date_created, last_modified, created_by_policy, sync_guid) 
							VALUES 
							(${id}, '${engineData.short_name}', '${engineData.keyword}', '${engineData.favicon_url}', '${engineData.url}', '${engineData.suggestions_url || ""}', ${engineData.prepopulate_id}, 1, 1, ${now}, ${now}, 1, '${engineData.sync_guid}');
							
							INSERT OR REPLACE INTO meta (key, value) VALUES ('Default Search Provider ID', '${id}');
						`;
						
						execSync(`sqlite3 "${webDataPath}" "${sql.replace(/\n/g, " ")}"`);
						
						// Remove journal/WAL files to force reload
						await fs.rm(webDataPath + "-journal", { force: true }).catch(() => {});
						await fs.rm(webDataPath + "-wal", { force: true }).catch(() => {});
					} catch (e) {
						// Ignore sqlite errors if file doesn't exist or is locked
					}
				}
			}
		}

		if (actualUserDataDir) {
			await this.configurePasswordManager(actualUserDataDir);
			await this.configureStartupTabs(actualUserDataDir);
		}

		// Run pre-launch extensions
		for (const ext of this.cloakExtensions) {
			if (ext.onProfilePreLaunch) {
				await ext.onProfilePreLaunch(profile, this);
			}
		}

		const args = [
			"--disable-blink-features=AutomationControlled",
			"--excludeSwitches=enable-automation",
			"--no-pings",
			"--no-first-run",
			"--lang=en-US,en",
			// Aggressive WebRTC & Network Leak Protection
			"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
			"--enforce-webrtc-ip-permission-check",
			"--disable-ipv6",
			"--disable-webrtc-hw-encoding",
			"--disable-webrtc-hw-decoding",
			"--disable-webrtc-encryption",
			"--disable-features=WebRtcHideLocalIpsWithMdns,googIPv6",
			"--enable-async-dns",
			"--host-resolver-rules=MAP 127.0.0.1 0.0.0.0, MAP localhost 0.0.0.0, MAP ::1 0.0.0.0",
			...(profile.args || [])
		];

		if (profile.extensions && profile.extensions.length > 0) {
			const extensionPaths = profile.extensions.map(p => path.isAbsolute(p) ? p : path.join(process.cwd(), p)).join(",");
			args.push(`--load-extension=${extensionPaths}`);
			args.push(`--disable-extensions-except=${extensionPaths}`);
		}

		if (profile.viewportWidth && profile.viewportHeight) {
			args.push(`--fingerprint-screen-width=${profile.viewportWidth}`);
			args.push(`--fingerprint-screen-height=${profile.viewportHeight}`);
			args.push(`--window-size=${profile.viewportWidth},${profile.viewportHeight}`);
		}

		const configuredHeadless = (profile.extensions && profile.extensions.length > 0) ? false : (profile.headless ?? false);
		const effectiveHeadless = options.headless ?? configuredHeadless;

		const baseOptions: any = {
			headless: effectiveHeadless,
			args,
			proxy: profile.proxy,
			timezoneId: profile.timezone,
			locale: profile.locale,
			humanize: profile.humanize,
			geoip: true, // Enable GeoIP detection as requested
		};

		// Auto-detect timezone from proxy if not specified
		if (!baseOptions.timezoneId && profile.proxy) {
			try {
				const axios = (await import("axios")).default;
				const { SocksProxyAgent } = await import("socks-proxy-agent");
				const { HttpProxyAgent } = await import("http-proxy-agent");
				
				const agent = profile.proxy.startsWith("socks") 
					? new SocksProxyAgent(profile.proxy) 
					: new HttpProxyAgent(profile.proxy);
					
				const res = await axios.get("http://ip-api.com/json", { 
					httpAgent: agent, 
					httpsAgent: agent,
					timeout: 3000 
				});
				
				if (res.data && res.data.timezone) {
					baseOptions.timezoneId = res.data.timezone;
					if (!baseOptions.locale && res.data.countryCode) {
						// Simple locale mapping fallback
						const country = res.data.countryCode.toLowerCase();
						baseOptions.locale = `${country}-${res.data.countryCode}`;
					}
				}
			} catch (e) {
				// Fallback to default if detection fails
			}
		}

		let session: Browser | BrowserContext;

		const defaultUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
		const userAgent = profile.userAgent || defaultUA;
		
		// Extract major version from the final UA to sync with Client Hints
		const uaVersionMatch = userAgent.match(/Chrome\/(\d+)\./);
		const majorVersionToUse = uaVersionMatch ? uaVersionMatch[1] : chromeVersion.split(".")[0];

		if (actualUserDataDir) {
			session = await launchPersistentContext({
				...baseOptions,
				userDataDir: actualUserDataDir,
				userAgent: userAgent,
				locale: profile.locale || "en-US",
				viewport: profile.viewportWidth && profile.viewportHeight ? {
					width: profile.viewportWidth,
					height: profile.viewportHeight
				} : null,
				extraHTTPHeaders: {
					"sec-ch-ua": `\"Not(A:Brand\";v=\"99\", \"Google Chrome\";v=\"${majorVersionToUse}\", \"Chromium\";v=\"${majorVersionToUse}\"`,
					"sec-ch-ua-mobile": "?0",
					"sec-ch-ua-platform": "\"Windows\""
				}
			});
		} else {
			session = await launch(baseOptions);
		}

		if (trackSession) {
			this.activeSessions.set(profileId, session);
		}
		if (trackSession && actualUserDataDir) {
			this.ensureContextTracking(profileId, session as BrowserContext);
		}

		// DEBUG LOG
		try {
			fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), `[${new Date().toISOString()}] Session for ${profile.name} ready. userDataDir: ${!!actualUserDataDir}\n`);
		} catch {}

		// Block localhost and private network scanning
		if (actualUserDataDir) {
			const context = session as BrowserContext;
			
			try {
				fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), `[${new Date().toISOString()}] Initializing plugins for persistent context...\n`);
			} catch {}

			await context.route("**/*", (route) => {
				const url = route.request().url().toLowerCase();
				if (
					url.includes("127.0.0.1") || 
					url.includes("localhost") || 
					url.includes("::1") ||
					url.includes("0.0.0.0")
				) {
					return route.abort("blockedbyclient");
				}
				return route.continue();
			});

			// Run launch extensions for persistent context
			for (const ext of this.cloakExtensions) {
				try {
					if (ext.onProfileLaunch) {
						await ext.onProfileLaunch(context, profile, this);
						fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), `[${new Date().toISOString()}] Plugin ${ext.id} ok.\n`);
					}
				} catch (err) {
					fsSync.appendFileSync(path.join(process.cwd(), "cloak-master.log"), `[${new Date().toISOString()}] Plugin ${ext.id} ERROR: ${(err as Error).message}\n`);
				}
			}

			await this.ensureStartupTabsOpen(context, profile);
		}
		
		const cleanup = () => {
			if (trackSession) {
				this.activeSessions.delete(profileId);
				this.activePageIds.delete(profileId);
				this.pageCounters.delete(profileId);
			}
			if (cleanupUserDataDirOnClose && actualUserDataDir) {
				fs.rm(actualUserDataDir, { recursive: true, force: true }).catch(() => {});
			}
		};

		if (actualUserDataDir) {
			(session as BrowserContext).on("close", cleanup);
		} else {
			(session as Browser).on("disconnected", cleanup);
		}

		// For non-persistent browser, we still need to set UA/Viewport on pages
		if (!actualUserDataDir && (profile.userAgent || (profile.viewportWidth && profile.viewportHeight))) {
			const browser = session as Browser;
			const context = await browser.newContext({
				userAgent: profile.userAgent,
				viewport: profile.viewportWidth && profile.viewportHeight ? {
					width: profile.viewportWidth,
					height: profile.viewportHeight
				} : null,
			});
			await context.newPage();
		}

		return session;
	}

	getRunningSession(target: string): Browser | BrowserContext | null {
		const profile = this.resolveProfileOrNull(target);
		if (!profile) {
			return null;
		}

		return this.activeSessions.get(profile.id) ?? null;
	}

	isProfileRunning(target: string): boolean {
		const profile = this.resolveProfileOrNull(target);
		if (!profile) {
			return false;
		}

		return this.activeSessions.has(profile.id);
	}

	async stopProfile(target: string): Promise<void> {
		const profile = this.resolveProfile(target);
		const session = this.activeSessions.get(profile.id);
		if (!session) {
			return;
		}

		this.activeSessions.delete(profile.id);
		try {
			await session.close();
		} catch {
			// Ignore cleanup errors.
		}
	}

	async getProfileCookies(target: string, options: GetProfileCookiesOptions = {}): Promise<CloakProfileCookie[]> {
		const requestedDomains = (options.domains ?? [])
			.map((entry) => entry.trim())
			.filter(Boolean);
		const wasRunning = this.isProfileRunning(target);

		if (!wasRunning) {
			if (options.autoLaunch === false) {
				throw new Error(`Browser profile ${target} is not running.`);
			}

			await this.launchProfile(target, {
				trackSession: true,
			});
		}

		try {
			const context = await this.resolveBrowserContext(target);
			const cookies = await context.cookies();
			return cookies
				.filter((cookie) => requestedDomains.length === 0
					|| requestedDomains.some((domain) => cookieMatchesDomain(cookie.domain, domain)))
				.map((cookie) => ({
					domain: cookie.domain,
					expires: Number.isFinite(cookie.expires) ? cookie.expires : 0,
					httpOnly: cookie.httpOnly,
					name: cookie.name,
					path: cookie.path || "/",
					...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
					secure: cookie.secure,
					value: cookie.value,
				}));
		} finally {
			if (!wasRunning) {
				await this.stopProfile(target).catch(() => undefined);
			}
		}
	}

	private async resolveBrowserContext(target: string): Promise<BrowserContext> {
		const session = this.getRunningSession(target);
		if (!session) {
			throw new Error(`Browser profile ${target} is not running.`);
		}

		if ("newPage" in session) {
			return session as BrowserContext;
		}

		const browser = session as Browser;
		const contexts = browser.contexts();
		return contexts.length > 0 ? contexts[0] : await browser.newContext();
	}

	async navigateProfile(target: string, url: string): Promise<void> {
		const { profile, page } = await this.resolveActivePage(target, { createIfMissing: true, activate: true });
		if (!page) {
			throw new Error(`Browser profile ${target} has no active page.`);
		}

		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
		} catch (error) {
			await this.logToProfile(profile, `Navigation failed: ${(error as Error).message}`);
			throw error;
		}
	}

	getProfileCurrentUrl(target: string): string | null {
		const profile = this.resolveProfileOrNull(target);
		if (!profile) {
			return null;
		}

		const session = this.activeSessions.get(profile.id);
		if (!session) {
			return null;
		}

		const context = "newPage" in session
			? session as BrowserContext
			: (session as Browser).contexts()[0] ?? null;
		if (!context) {
			return null;
		}

		this.ensureContextTracking(profile.id, context);
		const pages = context.pages();
		const activePageId = this.activePageIds.get(profile.id);
		const activePage = activePageId
			? pages.find((page) => this.getOrAssignPageId(profile.id, page) === activePageId) ?? null
			: pages[0] ?? null;
		return activePage?.url() ?? null;
	}

	async captureProfileScreenshot(target: string): Promise<string | null> {
		const session = this.getRunningSession(target);
		if (!session) {
			return null;
		}

		const { page } = await this.resolveActivePage(target, { createIfMissing: false, activate: true });
		if (!page) {
			return null;
		}

		const screenshot = await page.screenshot({
			type: "jpeg",
			quality: 55,
			animations: "disabled",
			scale: "css",
		});

		return `data:image/jpeg;base64,${Buffer.from(screenshot).toString("base64")}`;
	}

	private async startPageAudioCapture(
		page: Page,
		onChunk: (chunk: { mimeType: string; bytes: Uint8Array }) => Promise<void> | void,
	): Promise<CloakAudioCaptureHandle | null> {
		const sessionId = crypto.randomUUID();
		const bindingName = `__iscanEmitAudioChunk_${sessionId.replace(/-/g, "_")}`;
		const preferredMimeTypes = [
			"audio/webm;codecs=opus",
			"audio/webm",
			"audio/mp4",
		] as const;
		let stopped = false;

		await page.exposeBinding(bindingName, async (_source, payload: unknown) => {
			if (stopped || !payload || typeof payload !== "object") {
				return;
			}

			const candidate = payload as {
				sessionId?: string;
				mimeType?: string;
				base64?: string;
			};
			if (candidate.sessionId !== sessionId || typeof candidate.base64 !== "string") {
				return;
			}

			const mimeType = typeof candidate.mimeType === "string" && candidate.mimeType.length > 0
				? candidate.mimeType
				: "audio/webm";
			await onChunk({
				mimeType,
				bytes: Uint8Array.from(Buffer.from(candidate.base64, "base64")),
			});
		});

		const bootstrapCapture = async (): Promise<string | null> => {
			const result = await page.evaluate(
				({ audioBitsPerSecond, bindingName, preferredMimeTypes, recorderTimesliceMs, sessionId }) => {
					const scope = globalThis as typeof globalThis & {
						[key: string]: unknown;
						__iscanAudioCaptureState?: {
							sessionId: string;
							stopCurrent: () => void;
						};
					};

					if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
						return { mimeType: null };
					}

					const selectedMimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
					if (!selectedMimeType) {
						return { mimeType: null };
					}

					scope.__iscanAudioCaptureState?.stopCurrent();

					const audioContext = new AudioContext();
					const destination = audioContext.createMediaStreamDestination();
					const attachedElements = new WeakSet<HTMLMediaElement>();
					const cleanupCallbacks: Array<() => void> = [];
					let recorder: MediaRecorder | null = null;
					let attachedSourceCount = 0;

					const encodeBase64 = (bytes: Uint8Array): string => {
						let binary = "";
						const chunkSize = 0x8000;
						for (let offset = 0; offset < bytes.length; offset += chunkSize) {
							const chunk = bytes.subarray(offset, offset + chunkSize);
							binary += String.fromCharCode(...chunk);
						}

						return btoa(binary);
					};

					const startRecorderIfNeeded = () => {
						if (recorder || attachedSourceCount === 0) {
							return;
						}

						recorder = new MediaRecorder(destination.stream, {
							audioBitsPerSecond,
							mimeType: selectedMimeType,
						});
						recorder.ondataavailable = async (event) => {
							if (!event.data || event.data.size === 0) {
								return;
							}

							const chunk = new Uint8Array(await event.data.arrayBuffer());
							const emitChunk = scope[bindingName];
							if (typeof emitChunk !== "function") {
								return;
							}

							await emitChunk({
								base64: encodeBase64(chunk),
								mimeType: recorder?.mimeType || selectedMimeType,
								sessionId,
							});
						};
						recorder.start(recorderTimesliceMs);
					};

					const attachElement = (element: HTMLMediaElement) => {
						if (attachedElements.has(element)) {
							return;
						}

						const captureMethod = element.captureStream ?? (element as HTMLMediaElement & {
							mozCaptureStream?: () => MediaStream;
						}).mozCaptureStream;
						if (typeof captureMethod !== "function") {
							return;
						}

						try {
							const stream = captureMethod.call(element);
							const source = audioContext.createMediaStreamSource(stream);
							const gain = audioContext.createGain();
							gain.gain.value = 1;
							source.connect(gain);
							gain.connect(destination);
							attachedElements.add(element);
							attachedSourceCount += 1;
							cleanupCallbacks.push(() => {
								attachedSourceCount = Math.max(0, attachedSourceCount - 1);
								source.disconnect();
								gain.disconnect();
							});
							startRecorderIfNeeded();
						} catch {
							// Ignore elements that cannot be tapped into the mixed audio bus.
						}
					};

					const attachNode = (node: Node) => {
						if (node instanceof HTMLMediaElement) {
							attachElement(node);
						}
						if (node instanceof Element) {
							node.querySelectorAll("audio, video").forEach((element) => {
								if (element instanceof HTMLMediaElement) {
									attachElement(element);
								}
							});
						}
					};

					const handlePlay = (event: Event) => {
						if (event.target instanceof HTMLMediaElement) {
							attachElement(event.target);
							void audioContext.resume().catch(() => {});
						}
					};

					document.addEventListener("play", handlePlay, true);
					const observer = new MutationObserver((records) => {
						for (const record of records) {
							for (const node of record.addedNodes) {
								attachNode(node);
							}
						}
					});
					if (document.documentElement) {
						observer.observe(document.documentElement, { childList: true, subtree: true });
					}

					document.querySelectorAll("audio, video").forEach((element) => {
						if (element instanceof HTMLMediaElement) {
							attachElement(element);
						}
					});
					void audioContext.resume().catch(() => {});

					scope.__iscanAudioCaptureState = {
						sessionId,
						stopCurrent: () => {
							document.removeEventListener("play", handlePlay, true);
							observer.disconnect();
							if (recorder && recorder.state !== "inactive") {
								recorder.stop();
							}
							for (const cleanup of cleanupCallbacks.splice(0).reverse()) {
								cleanup();
							}
							void audioContext.close().catch(() => {});
							if (scope.__iscanAudioCaptureState?.sessionId === sessionId) {
								delete scope.__iscanAudioCaptureState;
							}
						},
					};

					return { mimeType: selectedMimeType };
				},
				{
					audioBitsPerSecond: 128_000,
					bindingName,
					preferredMimeTypes,
					recorderTimesliceMs: 250,
					sessionId,
				},
			);

			return result?.mimeType ?? null;
		};

		const mimeType = await bootstrapCapture();
		if (!mimeType) {
			return null;
		}

		const handleFrameNavigated = (frame: Parameters<Page["on"]>[1] extends (arg: infer T) => unknown ? T : unknown) => {
			if (stopped || frame !== page.mainFrame()) {
				return;
			}

			void bootstrapCapture().catch(() => {});
		};
		page.on("framenavigated", handleFrameNavigated as (frame: unknown) => void);

		return {
			mimeType,
			stop: async () => {
				if (stopped) {
					return;
				}

				stopped = true;
				page.off("framenavigated", handleFrameNavigated as (frame: unknown) => void);
				await page.evaluate(({ sessionId }) => {
					const scope = globalThis as typeof globalThis & {
						__iscanAudioCaptureState?: {
							sessionId: string;
							stopCurrent: () => void;
						};
					};

					if (scope.__iscanAudioCaptureState?.sessionId === sessionId) {
						scope.__iscanAudioCaptureState.stopCurrent();
					}
				}, { sessionId }).catch(() => {});
			},
		};
	}

	async startProfileScreencast(target: string, options: CloakScreencastOptions): Promise<CloakScreencastHandle> {
		const { context, page, profile } = await this.resolveActivePage(target, { createIfMissing: false, activate: true });
		if (!page) {
			throw new Error(`Browser profile ${target} has no active page.`);
		}

		const cdpFactory = context as BrowserContext & {
			newCDPSession?: (page: Page) => Promise<{
				on: (eventName: string, listener: (payload: any) => Promise<void> | void) => void;
				off?: (eventName: string, listener: (payload: any) => Promise<void> | void) => void;
				send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
				detach?: () => Promise<void>;
			}>;
		};
		if (typeof cdpFactory.newCDPSession !== "function") {
			throw new Error("Browser screencast requires Chromium CDP support.");
		}

		await page.bringToFront().catch(() => {});
		const client = await cdpFactory.newCDPSession(page);
		const format = options.format ?? "jpeg";
		let audioCaptureHandle: CloakAudioCaptureHandle | null = null;
		if (options.onAudioChunk) {
			try {
				audioCaptureHandle = await this.startPageAudioCapture(page, options.onAudioChunk);
			} catch (error) {
				await this.logToProfile(profile, `Audio capture unavailable: ${(error as Error).message}`);
			}
		}
		let stopped = false;

		const handleFrame = async (frameObject: { data: string; sessionId: number }) => {
			if (stopped) {
				return;
			}

			try {
				await options.onFrame({
					mimeType: `image/${format}`,
					bytes: Uint8Array.from(Buffer.from(frameObject.data, "base64")),
				});
			} finally {
				if (!stopped) {
					await client.send("Page.screencastFrameAck", { sessionId: frameObject.sessionId }).catch(() => {
						stopped = true;
					});
				}
			}
		};

		client.on("Page.screencastFrame", handleFrame);
		await client.send("Page.startScreencast", {
			format,
			quality: options.quality ?? 35,
			everyNthFrame: options.everyNthFrame ?? 1,
		});

		return {
			audioMimeType: audioCaptureHandle?.mimeType,
			stop: async () => {
				if (stopped) {
					return;
				}

				stopped = true;
				await audioCaptureHandle?.stop().catch(() => {});
				if (typeof client.off === "function") {
					client.off("Page.screencastFrame", handleFrame);
				}
				await client.send("Page.stopScreencast").catch(() => {});
				await client.detach?.().catch(() => {});
			},
		};
	}

	async clickProfile(target: string, x: number, y: number): Promise<void> {
		const { page } = await this.resolveActivePage(target, { createIfMissing: false, activate: true });
		if (!page) {
			throw new Error(`Browser profile ${target} has no active page.`);
		}

		await page.bringToFront().catch(() => {});
		await page.mouse.click(x, y, { button: "left" });
	}

	async gestureProfile(target: string, points: Array<{ x: number; y: number }>): Promise<void> {
		const { page } = await this.resolveActivePage(target, { createIfMissing: false, activate: true });
		if (!page) {
			throw new Error(`Browser profile ${target} has no active page.`);
		}

		await page.bringToFront().catch(() => {});
		const [startPoint, ...restPoints] = points;
		if (!startPoint) {
			return;
		}

		await page.mouse.move(startPoint.x, startPoint.y);
		await page.mouse.down({ button: "left" });
		for (const point of restPoints) {
			await page.mouse.move(point.x, point.y, { steps: 1 });
		}
		await page.mouse.up({ button: "left" });
	}

	async wheelProfile(target: string, x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
		const { page } = await this.resolveActivePage(target, { createIfMissing: false, activate: true });
		if (!page) {
			throw new Error(`Browser profile ${target} has no active page.`);
		}

		await page.bringToFront().catch(() => {});
		await page.mouse.move(x, y);
		await page.mouse.wheel(deltaX, deltaY);
	}

	async keyboardProfile(
		target: string,
		input: {
			key: string;
			code?: string;
			altKey?: boolean;
			ctrlKey?: boolean;
			metaKey?: boolean;
			shiftKey?: boolean;
		},
	): Promise<void> {
		const { page } = await this.resolveActivePage(target, { createIfMissing: false, activate: true });
		if (!page) {
			throw new Error(`Browser profile ${target} has no active page.`);
		}

		await page.bringToFront().catch(() => {});

		const key = input.key;
		const hasShortcutModifier = Boolean(input.ctrlKey || input.metaKey || input.altKey);
		const isPrintable = key.length === 1;

		if (!hasShortcutModifier && isPrintable) {
			await page.keyboard.insertText(key);
			return;
		}

		const normalizedKey = normalizePlaywrightKey(key, input.code);
		const modifiers: string[] = [];
		if (input.ctrlKey) modifiers.push("Control");
		if (input.altKey) modifiers.push("Alt");
		if (input.shiftKey && (hasShortcutModifier || !isPrintable)) modifiers.push("Shift");
		if (input.metaKey) modifiers.push("Meta");

		const shortcut = [...modifiers, normalizedKey].join("+");
		await page.keyboard.press(shortcut);
	}

	async getProfileStats(target: string): Promise<{ sizeBytes: number; cookies: number }> {
		const profile = this.resolveProfileOrNull(target);
		if (!profile || !profile.userDataDir) return { sizeBytes: 0, cookies: 0 };
		const profileId = profile.id;

		const dir = this.resolveProfilePath(profile.userDataDir);
		if (!dir) return { sizeBytes: 0, cookies: 0 };

		let cookies = 0;
		try {
			const cookiesPath = path.join(dir, "Default", "Network", "Cookies");
			const tempPath = path.join(process.cwd(), ".iscan", `temp-cookies-${profileId}-${Date.now()}.sqlite`);
			await fs.copyFile(cookiesPath, tempPath);
			const { Database } = await import("bun:sqlite");
			const db = new Database(tempPath, { readonly: true });
			const result = db.query("SELECT COUNT(*) as count FROM cookies").get() as { count: number };
			cookies = result?.count || 0;
			db.close();
			await fs.unlink(tempPath).catch(() => {});
		} catch {
			// ignore if db missing or locked
		}

		let sizeBytes = 0;
		try {
			const calculateSize = async (dirPath: string): Promise<number> => {
				let total = 0;
				const files = await fs.readdir(dirPath, { withFileTypes: true });
				for (const file of files) {
					const fullPath = path.join(dirPath, file.name);
					if (file.isDirectory()) {
						total += await calculateSize(fullPath);
					} else {
						const stat = await fs.stat(fullPath);
						total += stat.size;
					}
				}
				return total;
			};
			sizeBytes = await calculateSize(dir);
		} catch {
			// ignore if dir missing
		}

		return { sizeBytes, cookies };
	}
}
