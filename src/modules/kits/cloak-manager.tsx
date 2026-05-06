import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { createTableEntity, createTextEntity, type OutputEntity, type PrimitiveTableColumn, type PrimitiveTableRow } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule, type InteractiveApplicationProps } from "../module";
import { CloakKit, type CloakProfile } from "../../kits/cloak-kit";
import { ProxyKit } from "../../kits/proxy-kit";
import {
	CLOAK_SEARCH_ENGINE_PRESET_VALUES as PRESET_SEARCH_ENGINES,
	CLOAK_VIEWPORT_PRESET_VALUES as PRESET_VIEWPORTS,
} from "../../kits/cloak-profile-editor";
import { ensureCloakManagerDependencies } from "./cloak-manager.shared";
import { formatProxyProfileUrl } from "./proxy-shared";

type CloakManagerProps = InteractiveApplicationProps & {
	kit: CloakKit;
	proxyKit: ProxyKit | null;
};

type ViewState = "list" | "create" | "details";

type CloakManagerAction = "list";

type CloakManagerParams = {
	action?: string;
	includeStats?: boolean | string;
};

const PRESET_TIMEZONES = ["", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"];
const PRESET_LOCALES = ["", "en-US", "en-GB", "fr-FR", "de-DE", "es-ES", "it-IT", "ja-JP", "ko-KR", "zh-CN", "ru-RU"];

function parseOptionalString(value: unknown, paramName: string): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`Param '${paramName}' must be a string.`);
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalBoolean(value: unknown, paramName: string): boolean | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") {
			return true;
		}

		if (normalized === "false") {
			return false;
		}
	}

	throw new InvalidParamsError(`Param '${paramName}' must be a boolean.`);
}

function isInteractiveApplicationUnavailableError(error: unknown): boolean {
	return error instanceof Error && error.name === "InteractiveApplicationUnavailableError";
}

function formatBytes(bytes: number): string {
	if (bytes === 0) {
		return "0 B";
	}

	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function buildCloakProfilesOutput(
	kit: CloakKit,
	options: { includeStats: boolean },
): Promise<OutputEntity[]> {
	const profiles = kit.getProfiles();
	const runningCount = profiles.filter((profile) => kit.isProfileRunning(profile.id)).length;
	const statsByProfileId = options.includeStats
		? Object.fromEntries(await Promise.all(profiles.map(async (profile) => [profile.id, await kit.getProfileStats(profile.id)] as const)))
		: {};
	const summaryLines = [
		`Cloak profiles • ${profiles.length} total • ${runningCount} running`,
		options.includeStats ? "Includes storage size and cookie counts" : "Use includeStats=true for storage and cookie metadata",
	];

	if (profiles.length === 0) {
		return [createTextEntity([...summaryLines, "", "No Cloak profiles found."], { tone: "info", title: "Cloak Manager" })];
	}

	const columns: PrimitiveTableColumn[] = [
		{ key: "name", header: "name" },
		{ key: "status", header: "status" },
		{ key: "profileId", header: "id" },
		{ key: "proxy", header: "proxy" },
		{ key: "profileDir", header: "profile dir" },
		{ key: "headless", header: "headless", align: "center" },
		{ key: "humanize", header: "humanize", align: "center" },
	];

	if (options.includeStats) {
		columns.push(
			{ key: "cookies", header: "cookies", align: "right" },
			{ key: "size", header: "size", align: "right" },
		);
	}

	const rows: PrimitiveTableRow[] = profiles.map((profile) => {
		const stats = statsByProfileId[profile.id] as { sizeBytes: number; cookies: number } | undefined;
		const row: PrimitiveTableRow = {
			name: profile.name,
			status: kit.isProfileRunning(profile.id) ? "running" : "stopped",
			profileId: profile.id,
			proxy: profile.proxy ?? "",
			profileDir: profile.userDataDir ?? "in-memory",
			headless: profile.headless ? "yes" : "no",
			humanize: profile.humanize ? "yes" : "no",
		};

		if (options.includeStats) {
			row.cookies = stats?.cookies ?? 0;
			row.size = formatBytes(stats?.sizeBytes ?? 0);
		}

		return row;
	});

	return [
		createTextEntity(summaryLines, { tone: "muted", title: "Cloak Manager" }),
		createTableEntity(columns, rows, { title: "Profiles" }),
	];
}

function readCloakManagerAction(params: CloakManagerParams): CloakManagerAction | null {
	const action = parseOptionalString(params.action, "action");
	if (!action) {
		return null;
	}

	if (action === "list") {
		return action;
	}

	throw new InvalidParamsError(`Unsupported Cloak manager action: ${action}`);
}

async function runCloakManagerAction(
	params: CloakManagerParams,
	kit: CloakKit,
): Promise<OutputEntity[] | null> {
	const action = readCloakManagerAction(params);
	if (!action) {
		return null;
	}

	if (action === "list") {
		return await buildCloakProfilesOutput(kit, {
			includeStats: parseOptionalBoolean(params.includeStats, "includeStats") ?? false,
		});
	}

	return null;
}

function CloakManager({ width, height, onExit, kit, proxyKit }: CloakManagerProps) {
	const [profiles, setProfiles] = useState<CloakProfile[]>([]);
	const [view, setView] = useState<ViewState>("list");
	const [cursor, setCursor] = useState(0);
	const [draftName, setDraftName] = useState("");
	const [draftProxy, setDraftProxy] = useState("");
	const [draftTimezone, setDraftTimezone] = useState("");
	const [draftLocale, setDraftLocale] = useState("");
	const [draftUserAgent, setDraftUserAgent] = useState("");
	const [draftViewport, setDraftViewport] = useState("");
	const [draftSearchEngine, setDraftSearchEngine] = useState("");
	const [draftHumanize, setDraftHumanize] = useState(false);
	const [draftHeadless, setDraftHeadless] = useState(false);
	const [draftUserDataDir, setDraftUserDataDir] = useState("");
	const [draftArgs, setDraftArgs] = useState("");
	
	const fields = ["name", "proxy", "timezone", "locale", "userAgent", "viewport", "searchEngine", "userDataDir", "args", "humanize", "headless"] as const;
	type InputMode = typeof fields[number];
	const [inputMode, setInputMode] = useState<InputMode>("name");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [stats, setStats] = useState<Record<string, { sizeBytes: number; cookies: number }>>({});
	const [userAgents, setUserAgents] = useState<string[]>([""]);
	const [availableProxies, setAvailableProxies] = useState<string[]>([""]);

	useEffect(() => {
		kit.fetchUserAgents().then(agents => {
			setUserAgents(["", ...agents]);
		});
		if (proxyKit) {
			const proxies = proxyKit.getProxies().map(p => {
				return formatProxyProfileUrl(p);
			});
			setAvailableProxies(["", ...proxies]);
		}
	}, [kit, proxyKit]);

	useEffect(() => {
		const currentProfiles = kit.getProfiles();
		setProfiles(currentProfiles);
		if (view === "list") {
			Promise.all(currentProfiles.map(async p => {
				const stat = await kit.getProfileStats(p.id);
				return [p.id, stat] as const;
			})).then(results => {
				setStats(Object.fromEntries(results));
			});
		}
	}, [kit, view]); // Reload profiles when view changes back to list

	const startEdit = (p: CloakProfile) => {
		setEditingId(p.id);
		setDraftName(p.name);
		setDraftProxy(p.proxy || "");
		setDraftTimezone(p.timezone || "");
		setDraftLocale(p.locale || "");
		setDraftUserAgent(p.userAgent || "");
		setDraftViewport(p.viewportWidth && p.viewportHeight ? `${p.viewportWidth}x${p.viewportHeight}` : "");
		setDraftSearchEngine(p.searchEngine || "");
		setDraftUserDataDir(p.userDataDir || "");
		setDraftArgs(p.args?.join(" ") || "");
		setDraftHumanize(p.humanize || false);
		setDraftHeadless(p.headless || false);
		setView("create");
		setInputMode("name");
	};

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			if (view === "create" || view === "details") {
				setView("list");
				setDraftName("");
				setDraftProxy("");
				setDraftTimezone("");
				setDraftLocale("");
				setDraftUserAgent("");
				setDraftViewport("");
				setDraftSearchEngine("");
				setDraftUserDataDir("");
				setDraftArgs("");
				setDraftHumanize(false);
				setDraftHeadless(false);
				setEditingId(null);
				setInputMode("name");
				return;
			}
			onExit(0);
			return;
		}

		if (view === "list") {
			if (key.upArrow) {
				setCursor(c => Math.max(0, c - 1));
			} else if (key.downArrow) {
				setCursor(c => Math.min(profiles.length, c + 1));
			} else if (key.return) {
				if (cursor === profiles.length) {
					// "Create new profile" selected
					setView("create");
					setEditingId(null);
					setDraftName("");
					setDraftProxy("");
					setDraftTimezone("");
					setDraftLocale("");
					setDraftUserAgent("");
					setDraftViewport("");
					setDraftSearchEngine("");
					setDraftUserDataDir("");
					setDraftArgs("");
					setDraftHumanize(false);
					setDraftHeadless(false);
					setInputMode("name");
				} else if (profiles[cursor]) {
					// Open details/launch
					setView("details");
				}
			} else if (input === "e" || input === "E") {
				if (cursor < profiles.length && profiles[cursor]) {
					startEdit(profiles[cursor]);
				}
			} else if (input === "l" || input === "L") {
				if (cursor < profiles.length && profiles[cursor]) {
					kit.launchProfile(profiles[cursor].id).catch(err => {
						console.error(err);
					});
				}
			} else if (key.delete || key.backspace) {
				if (cursor < profiles.length) {
					const p = profiles[cursor];
					if (p) {
						kit.deleteProfile(p.id).then(() => {
							setProfiles(kit.getProfiles());
							setCursor(c => Math.max(0, Math.min(profiles.length - 2, c)));
						});
					}
				}
			}
		} else if (view === "create") {
			if (key.tab) {
				const currentIndex = fields.indexOf(inputMode);
				const nextIndex = (currentIndex + 1) % fields.length;
				setInputMode(fields[nextIndex] as InputMode);
			} else if (key.upArrow) {
				const currentIndex = fields.indexOf(inputMode);
				const prevIndex = (currentIndex - 1 + fields.length) % fields.length;
				setInputMode(fields[prevIndex] as InputMode);
			} else if (key.downArrow) {
				const currentIndex = fields.indexOf(inputMode);
				const nextIndex = (currentIndex + 1) % fields.length;
				setInputMode(fields[nextIndex] as InputMode);
			} else if (key.leftArrow) {
				if (inputMode === "timezone") {
					const idx = PRESET_TIMEZONES.indexOf(draftTimezone);
					if (idx > 0) setDraftTimezone(PRESET_TIMEZONES[idx - 1]!);
					else if (idx === -1) setDraftTimezone(PRESET_TIMEZONES[PRESET_TIMEZONES.length - 1]!);
				} else if (inputMode === "locale") {
					const idx = PRESET_LOCALES.indexOf(draftLocale);
					if (idx > 0) setDraftLocale(PRESET_LOCALES[idx - 1]!);
					else if (idx === -1) setDraftLocale(PRESET_LOCALES[PRESET_LOCALES.length - 1]!);
				} else if (inputMode === "userAgent") {
					const idx = userAgents.indexOf(draftUserAgent);
					if (idx > 0) setDraftUserAgent(userAgents[idx - 1]!);
					else if (idx === -1) setDraftUserAgent(userAgents[userAgents.length - 1]!);
				} else if (inputMode === "proxy") {
					const idx = availableProxies.indexOf(draftProxy);
					if (idx > 0) setDraftProxy(availableProxies[idx - 1]!);
					else setDraftProxy(availableProxies[availableProxies.length - 1]!);
				} else if (inputMode === "viewport") {
					const idx = PRESET_VIEWPORTS.indexOf(draftViewport);
					if (idx > 0) setDraftViewport(PRESET_VIEWPORTS[idx - 1]!);
					else if (idx === -1) setDraftViewport(PRESET_VIEWPORTS[PRESET_VIEWPORTS.length - 1]!);
				} else if (inputMode === "searchEngine") {
					const idx = PRESET_SEARCH_ENGINES.indexOf(draftSearchEngine);
					if (idx > 0) setDraftSearchEngine(PRESET_SEARCH_ENGINES[idx - 1]!);
					else if (idx === -1) setDraftSearchEngine(PRESET_SEARCH_ENGINES[PRESET_SEARCH_ENGINES.length - 1]!);
				} else if (inputMode === "userDataDir") {
					setDraftUserDataDir(draftUserDataDir ? "" : `profile-${crypto.randomUUID().slice(0, 8)}`);
				}
			} else if (key.rightArrow) {
				if (inputMode === "timezone") {
					const idx = PRESET_TIMEZONES.indexOf(draftTimezone);
					if (idx !== -1 && idx < PRESET_TIMEZONES.length - 1) setDraftTimezone(PRESET_TIMEZONES[idx + 1]!);
					else if (idx === -1 || idx === PRESET_TIMEZONES.length - 1) setDraftTimezone(PRESET_TIMEZONES[0]!);
				} else if (inputMode === "locale") {
					const idx = PRESET_LOCALES.indexOf(draftLocale);
					if (idx !== -1 && idx < PRESET_LOCALES.length - 1) setDraftLocale(PRESET_LOCALES[idx + 1]!);
					else if (idx === -1 || idx === PRESET_LOCALES.length - 1) setDraftLocale(PRESET_LOCALES[0]!);
				} else if (inputMode === "userAgent") {
					const idx = userAgents.indexOf(draftUserAgent);
					if (idx !== -1 && idx < userAgents.length - 1) setDraftUserAgent(userAgents[idx + 1]!);
					else if (idx === -1 || idx === userAgents.length - 1) setDraftUserAgent(userAgents[0]!);
				} else if (inputMode === "proxy") {
					const idx = availableProxies.indexOf(draftProxy);
					if (idx !== -1 && idx < availableProxies.length - 1) setDraftProxy(availableProxies[idx + 1]!);
					else setDraftProxy(availableProxies[0]!);
				} else if (inputMode === "viewport") {
					const idx = PRESET_VIEWPORTS.indexOf(draftViewport);
					if (idx !== -1 && idx < PRESET_VIEWPORTS.length - 1) setDraftViewport(PRESET_VIEWPORTS[idx + 1]!);
					else if (idx === -1 || idx === PRESET_VIEWPORTS.length - 1) setDraftViewport(PRESET_VIEWPORTS[0]!);
				} else if (inputMode === "searchEngine") {
					const idx = PRESET_SEARCH_ENGINES.indexOf(draftSearchEngine);
					if (idx !== -1 && idx < PRESET_SEARCH_ENGINES.length - 1) setDraftSearchEngine(PRESET_SEARCH_ENGINES[idx + 1]!);
					else if (idx === -1 || idx === PRESET_SEARCH_ENGINES.length - 1) setDraftSearchEngine(PRESET_SEARCH_ENGINES[0]!);
				} else if (inputMode === "userDataDir") {
					setDraftUserDataDir(draftUserDataDir ? "" : `profile-${crypto.randomUUID().slice(0, 8)}`);
				}
			} else if (key.return) {
				if (inputMode === "humanize") {
					setDraftHumanize(!draftHumanize);
				} else if (inputMode === "headless") {
					setDraftHeadless(!draftHeadless);
				} else if (draftName.trim() !== "") {
					let viewportWidth = undefined;
					let viewportHeight = undefined;
					if (draftViewport) {
						const [w, h] = draftViewport.split("x");
						if (w && h) {
							viewportWidth = parseInt(w, 10);
							viewportHeight = parseInt(h, 10);
						}
					}
					const newProfile: CloakProfile = {
						id: editingId || crypto.randomUUID(),
						name: draftName.trim(),
						proxy: draftProxy.trim() || undefined,
						timezone: draftTimezone.trim() || undefined,
						locale: draftLocale.trim() || undefined,
						userAgent: draftUserAgent.trim() || undefined,
						viewportWidth,
						viewportHeight,
						searchEngine: draftSearchEngine.trim() || undefined,
						userDataDir: draftUserDataDir.trim() || undefined,
						args: draftArgs.trim() ? draftArgs.split(" ") : undefined,
						humanize: draftHumanize,
						headless: draftHeadless,
					};
					kit.saveProfile(newProfile).then(() => {
						setProfiles(kit.getProfiles());
						setView("list");
					});
				}
			} else if (key.delete || key.backspace) {
				if (inputMode === "name") setDraftName(s => s.slice(0, -1));
				if (inputMode === "proxy") setDraftProxy(s => s.slice(0, -1));
				if (inputMode === "timezone") setDraftTimezone(s => s.slice(0, -1));
				if (inputMode === "locale") setDraftLocale(s => s.slice(0, -1));
				if (inputMode === "userAgent") setDraftUserAgent(s => s.slice(0, -1));
				if (inputMode === "viewport") setDraftViewport(s => s.slice(0, -1));
				if (inputMode === "searchEngine") setDraftSearchEngine(s => s.slice(0, -1));
				if (inputMode === "userDataDir") setDraftUserDataDir(s => s.slice(0, -1));
				if (inputMode === "args") setDraftArgs(s => s.slice(0, -1));
			} else if (input.length > 0) {
				if (inputMode === "name") setDraftName(s => s + input);
				if (inputMode === "proxy") setDraftProxy(s => s + input);
				if (inputMode === "timezone") setDraftTimezone(s => s + input);
				if (inputMode === "locale") setDraftLocale(s => s + input);
				if (inputMode === "userAgent") setDraftUserAgent(s => s + input);
				if (inputMode === "viewport") setDraftViewport(s => s + input);
				if (inputMode === "searchEngine") setDraftSearchEngine(s => s + input);
				if (inputMode === "userDataDir") setDraftUserDataDir(s => s + input);
				if (inputMode === "args") setDraftArgs(s => s + input);
				if (input === " " && inputMode === "humanize") setDraftHumanize(!draftHumanize);
				if (input === " " && inputMode === "headless") setDraftHeadless(!draftHeadless);
			}
		} else if (view === "details") {
			const p = profiles[cursor];
			if (!p) {
				setView("list");
				return;
			}

			if (input === "e" || input === "E") {
				startEdit(p);
			} else if (input === "l" || input === "L") {
				kit.launchProfile(p.id).catch(err => {
					// error handling inside UI could be added
					console.error(err);
				});
				setView("list");
			}
		}
	});

	const formatSize = (bytes: number) => {
		if (bytes === 0) return "-";
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
		return (bytes / (1024 * 1024)).toFixed(1) + " MB";
	};

	const renderInput = (mode: InputMode, label: string, value: string, placeholder = "") => {
		const isActive = inputMode === mode;
		const isDropdown = mode === "timezone" || mode === "locale" || mode === "userAgent" || mode === "userDataDir" || mode === "viewport" || mode === "searchEngine" || mode === "proxy";
		
		let displayContent = value || <Text dimColor>{placeholder}</Text>;
		if (isActive) {
			if (isDropdown) {
				displayContent = <Text color="#34d399">{"< "}{value || placeholder}{" >"}</Text>;
			} else {
				displayContent = <Text color="#34d399">{value}█</Text>;
			}
		}

		if (mode === "userAgent" && typeof displayContent === "string" && displayContent.length > 50 && !isActive) {
			displayContent = displayContent.slice(0, 47) + "...";
		}

		return (
			<Box>
				<Text wrap="truncate">{label}: {displayContent}</Text>
			</Box>
		);
	};

	const renderCheckbox = (mode: InputMode, label: string, value: boolean) => {
		const isActive = inputMode === mode;
		return (
			<Box>
				<Text>{label}: {isActive ? <Text color="#34d399">[{value ? "x" : " "}]</Text> : `[${value ? "x" : " "}]`}</Text>
			</Box>
		);
	};

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Text color="#60a5fa" bold>CloakBrowser Profile Manager</Text>
			
			{view === "list" && (
				<Box flexDirection="column" marginTop={1}>
					<Box flexDirection="row" paddingX={1}>
						<Box width={3}><Text bold></Text></Box>
						<Box width={20}><Text bold>NAME</Text></Box>
						<Box width={10}><Text bold>STATUS</Text></Box>
						<Box width={12}><Text bold>SIZE</Text></Box>
						<Box width={10}><Text bold>COOKIES</Text></Box>
						<Box width={20}><Text bold>PROXY</Text></Box>
					</Box>
					{profiles.length === 0 ? (
						<Box paddingX={1}><Text color="#9ca3af">No profiles found.</Text></Box>
					) : (
						profiles.map((p, i) => (
							<Box key={p.id} flexDirection="row" paddingX={1}>
								<Box width={3}>
									<Text color={i === cursor ? "#34d399" : "#e5e7eb"}>
										{i === cursor ? "> " : "  "}
									</Text>
								</Box>
								<Box width={20}>
									<Text color={i === cursor ? "#34d399" : "#e5e7eb"} wrap="truncate">
										{p.name}
									</Text>
								</Box>
								<Box width={10}>
									<Text color={kit.isProfileRunning(p.id) ? "#60a5fa" : "#9ca3af"}>
										{kit.isProfileRunning(p.id) ? "Running" : "Stopped"}
									</Text>
								</Box>
								<Box width={12}>
									<Text color="#d1d5db">{stats[p.id] ? formatSize(stats[p.id]!.sizeBytes) : "..."}</Text>
								</Box>
								<Box width={10}>
									<Text color="#d1d5db">{stats[p.id] ? stats[p.id]!.cookies : "..."}</Text>
								</Box>
								<Box width={20}>
									<Text color="#9ca3af" wrap="truncate">{p.proxy || "None"}</Text>
								</Box>
							</Box>
						))
					)}
					<Box paddingX={1} marginTop={1}>
						<Text color={cursor === profiles.length ? "#34d399" : "#e5e7eb"}>
							{cursor === profiles.length ? "> " : "  "}
							+ Create new profile
						</Text>
					</Box>
					
					<Box marginTop={1}>
						<Text dimColor>Arrows to navigate • Enter to select • L to launch • E to edit • Del/Backspace to delete • Esc to exit</Text>
					</Box>
				</Box>
			)}

			{view === "create" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>{editingId ? "Edit Profile" : "Create New Profile"}</Text>
					<Box marginTop={1} flexDirection="column">
						{renderInput("name", "Name", draftName, "Required")}
						{renderInput("proxy", "Proxy", draftProxy, "Optional (http://...)")}
						{renderInput("timezone", "Timezone", draftTimezone, "Optional (America/New_York)")}
						{renderInput("locale", "Locale", draftLocale, "Optional (en-US)")}
						{renderInput("userAgent", "User Agent", draftUserAgent, "Optional")}
						{renderInput("viewport", "Viewport", draftViewport, "Optional (1920x1080)")}
						{renderInput("searchEngine", "Search Engine", draftSearchEngine, "Optional (Google)")}
						{renderInput("userDataDir", "Profile Dir", draftUserDataDir, "Optional (Persistent Profile)")}
						{renderInput("args", "Extra Args", draftArgs, "Optional (Space separated flags e.g. --fingerprint=123)")}
						{renderCheckbox("humanize", "Humanize", draftHumanize)}
						{renderCheckbox("headless", "Headless", draftHeadless)}
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Up/Down or Tab to navigate • Enter to save (when on Name) or toggle • Esc to cancel</Text>
					</Box>
				</Box>
			)}

			{view === "details" && profiles[cursor] && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Profile Details</Text>
					<Box marginTop={1} flexDirection="column">
						<Text>Name: {profiles[cursor]!.name}</Text>
						<Text>Proxy: {profiles[cursor]!.proxy || "None"}</Text>
						<Text>Timezone: {profiles[cursor]!.timezone || "Auto"}</Text>
						<Text>Locale: {profiles[cursor]!.locale || "Auto"}</Text>
						<Text>User Agent: {profiles[cursor]!.userAgent || "Auto"}</Text>
						<Text>Viewport: {profiles[cursor]!.viewportWidth && profiles[cursor]!.viewportHeight ? `${profiles[cursor]!.viewportWidth}x${profiles[cursor]!.viewportHeight}` : "Auto"}</Text>
						<Text>Search Engine: {profiles[cursor]!.searchEngine || "Default"}</Text>
						<Text>Profile Dir: {profiles[cursor]!.userDataDir || "In-Memory"}</Text>
						<Text>Extra Args: {profiles[cursor]!.args?.join(" ") || "None"}</Text>
						<Text>Humanize: {profiles[cursor]!.humanize ? "Yes" : "No"}</Text>
						<Text>Headless: {profiles[cursor]!.headless ? "Yes" : "No"}</Text>
						<Text>Status: {kit.isProfileRunning(profiles[cursor]!.id) ? "Running" : "Stopped"}</Text>
					</Box>
					<Box marginTop={1}>
						<Text bold color="#34d399">Press 'L' to Launch Browser</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>E to Edit • Esc to go back</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}

export const cloakManagerModule = defineModule<CloakManagerParams>({
	id: "kits/cloak/manager",
	description: "Manage and launch stealth Chromium profiles via CloakBrowser; notebook cells fall back to profile listing",
	category: "kits",
	consoleParams: [
		{
			name: "action",
			detail: "Optional non-interactive action. If omitted, opens the interactive manager when available.",
			example: "action=list",
			valueType: "string",
			values: ["list"],
		},
		{
			name: "includeStats",
			detail: "Include cookie counts and profile storage size in list output.",
			example: "includeStats=true",
			valueType: "boolean",
		},
	],
	executor: defineExecutor<CloakManagerParams>(async (context) => {
		const action = readCloakManagerAction(context.params);
		if (action === "list") {
			const { kit } = await ensureCloakManagerDependencies(
				context.runtime,
				"Listing Cloak profiles",
				{ includeProxyKit: false },
			);
			return await runCloakManagerAction(context.params, kit);
		}

		const { kit, proxyKit } = await ensureCloakManagerDependencies(
			context.runtime,
			"Starting CloakManager",
		);

		try {
			const exitCode = await context.runInteractiveApplication(CloakManager, { kit, proxyKit });
			return { exitCode };
		} catch (error) {
			if (!isInteractiveApplicationUnavailableError(error)) {
				throw error;
			}

			return await buildCloakProfilesOutput(kit, { includeStats: false });
		}
	}),
});
