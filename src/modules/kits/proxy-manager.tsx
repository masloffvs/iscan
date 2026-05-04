import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { type OutputEntity } from "../../primitives";
import { defineExecutor, defineModule, type InteractiveApplicationProps } from "../module";
import { InvalidParamsError } from "../errors";
import { ProxyKit, type ProxyProfile, type ProxyType, type ProxyTestResult } from "../../kits/proxy-kit";
import { createProxyProfilesReport, ensureProxyKit, parseOptionalString, PROXY_TYPE_VALUES } from "./proxy-shared";

type ProxyManagerProps = InteractiveApplicationProps & {
	kit: ProxyKit;
};

type ViewState = "list" | "create" | "details";
type ProxyManagerAction = "list";

type ProxyManagerParams = {
	action?: string;
};

const PROXY_TYPES: ProxyType[] = [...PROXY_TYPE_VALUES];

function isInteractiveApplicationUnavailableError(error: unknown): boolean {
	return error instanceof Error && error.name === "InteractiveApplicationUnavailableError";
}


function buildProxyManagerFallbackOutput(kit: ProxyKit): OutputEntity[] {
	return createProxyProfilesReport(kit, {
		title: "Proxy Manager",
		summaryLines: [
			`Proxy profiles • ${kit.getProxies().length} total`,
				"Interactive manager unavailable in notebook mode. Use $.kits.proxy.import(), $.kits.proxy.replace(), $.kits.proxy.list(), $.kits.proxy.test(), $.kits.proxy.save(), and $.kits.proxy.delete() for explicit operations.",
		],
		tableTitle: "Proxy profiles",
	});
}

function readProxyManagerAction(params: ProxyManagerParams): ProxyManagerAction | null {
	const action = parseOptionalString(params.action, "action");
	if (!action) {
		return null;
	}

	if (action === "list") {
		return action;
	}

	throw new InvalidParamsError(`Unsupported proxy manager action: ${action}`);
}

function runProxyManagerAction(
	params: ProxyManagerParams,
	kit: ProxyKit,
): OutputEntity[] | null {
	const action = readProxyManagerAction(params);
	if (!action) {
		return null;
	}

	if (action === "list") {
		return buildProxyManagerFallbackOutput(kit);
	}

	return null;
}

function ProxyManager({ width, height, onExit, kit }: ProxyManagerProps) {
	const [proxies, setProxies] = useState<ProxyProfile[]>([]);
	const [view, setView] = useState<ViewState>("list");
	const [cursor, setCursor] = useState(0);
	const [testResults, setTestResults] = useState<Record<string, ProxyTestResult>>({});
	const [testingIds, setTestingIds] = useState<Set<string>>(new Set());

	const [draftName, setDraftName] = useState("");
	const [draftHost, setDraftHost] = useState("");
	const [draftPort, setDraftPort] = useState("");
	const [draftUsername, setDraftUsername] = useState("");
	const [draftPassword, setDraftPassword] = useState("");
	const [draftType, setDraftType] = useState<ProxyType>("HTTP");
	const [editingId, setEditingId] = useState<string | null>(null);

	const fields = ["name", "host", "port", "username", "password", "type"] as const;
	type InputMode = typeof fields[number];
	const [inputMode, setInputMode] = useState<InputMode>("name");

	useEffect(() => {
		setProxies(kit.getProxies());
	}, [kit, view]);

	const startEdit = (p: ProxyProfile) => {
		setEditingId(p.id);
		setDraftName(p.name);
		setDraftHost(p.host);
		setDraftPort(p.port.toString());
		setDraftUsername(p.username || "");
		setDraftPassword(p.password || "");
		setDraftType(p.type);
		setView("create");
		setInputMode("name");
	};

	const testProxy = async (id: string) => {
		setTestingIds(prev => new Set(prev).add(id));
		try {
			const result = await kit.testProxy(id);
			setTestResults(prev => ({ ...prev, [id]: result }));
		} finally {
			setTestingIds(prev => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		}
	};

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			if (view === "create" || view === "details") {
				setView("list");
				setEditingId(null);
				return;
			}
			onExit(0);
			return;
		}

		if (view === "list") {
			if (key.upArrow) setCursor(c => Math.max(0, c - 1));
			else if (key.downArrow) setCursor(c => Math.min(proxies.length, c + 1));
			else if (key.return) {
				if (cursor === proxies.length) {
					setView("create");
					setEditingId(null);
					setDraftName("");
					setDraftHost("");
					setDraftPort("");
					setDraftUsername("");
					setDraftPassword("");
					setDraftType("HTTP");
					setInputMode("name");
				} else if (proxies[cursor]) {
					setView("details");
				}
			} else if (input === "e" || input === "E") {
				if (cursor < proxies.length && proxies[cursor]) startEdit(proxies[cursor]);
			} else if (input === "t" || input === "T") {
				if (cursor < proxies.length && proxies[cursor]) testProxy(proxies[cursor].id);
			} else if (key.delete || key.backspace) {
				if (cursor < proxies.length && proxies[cursor]) {
					kit.deleteProxy(proxies[cursor].id).then(() => setProxies(kit.getProxies()));
				}
			}
		} else if (view === "create") {
			if (key.tab) {
				const idx = fields.indexOf(inputMode);
				setInputMode(fields[(idx + 1) % fields.length] as InputMode);
			} else if (key.upArrow) {
				const idx = fields.indexOf(inputMode);
				setInputMode(fields[(idx - 1 + fields.length) % fields.length] as InputMode);
			} else if (key.downArrow) {
				const idx = fields.indexOf(inputMode);
				setInputMode(fields[(idx + 1) % fields.length] as InputMode);
			} else if (key.leftArrow || key.rightArrow) {
				if (inputMode === "type") {
					const idx = PROXY_TYPES.indexOf(draftType);
					const delta = key.leftArrow ? -1 : 1;
					setDraftType(PROXY_TYPES[(idx + delta + PROXY_TYPES.length) % PROXY_TYPES.length]!);
				}
			} else if (key.return) {
				if (draftName.trim() && draftHost.trim() && draftPort.trim()) {
					const p: ProxyProfile = {
						id: editingId || crypto.randomUUID(),
						name: draftName.trim(),
						host: draftHost.trim(),
						port: parseInt(draftPort.trim(), 10),
						username: draftUsername.trim() || undefined,
						password: draftPassword.trim() || undefined,
						type: draftType
					};
					kit.saveProxy(p).then(() => setView("list"));
				}
			} else if (key.delete || key.backspace) {
				if (inputMode === "name") setDraftName(s => s.slice(0, -1));
				if (inputMode === "host") setDraftHost(s => s.slice(0, -1));
				if (inputMode === "port") setDraftPort(s => s.slice(0, -1));
				if (inputMode === "username") setDraftUsername(s => s.slice(0, -1));
				if (inputMode === "password") setDraftPassword(s => s.slice(0, -1));
			} else if (input.length > 0) {
				if (inputMode === "name") setDraftName(s => s + input);
				if (inputMode === "host") setDraftHost(s => s + input);
				if (inputMode === "port") setDraftPort(s => s + input);
				if (inputMode === "username") setDraftUsername(s => s + input);
				if (inputMode === "password") setDraftPassword(s => s + input);
			}
		} else if (view === "details") {
			const p = proxies[cursor];
			if (!p) { setView("list"); return; }
			if (input === "e" || input === "E") startEdit(p);
			if (input === "t" || input === "T") testProxy(p.id);
		}
	});

	const renderInput = (mode: InputMode, label: string, value: string, placeholder = "") => {
		const isActive = inputMode === mode;
		const isDropdown = mode === "type";
		let content = value || <Text dimColor>{placeholder}</Text>;
		if (isActive) content = isDropdown ? <Text color="#34d399">{"< "}{value}{" >"}</Text> : <Text color="#34d399">{value}█</Text>;
		return <Box><Text>{label}: {content}</Text></Box>;
	};

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Text color="#7dd3fc" bold>Proxy Service Kit Manager</Text>
			
			{view === "list" && (
				<Box flexDirection="column" marginTop={1}>
					<Box flexDirection="row" paddingX={1}>
						<Box width={3}><Text bold></Text></Box>
						<Box width={20}><Text bold>NAME</Text></Box>
						<Box width={25}><Text bold>ADDRESS</Text></Box>
						<Box width={10}><Text bold>TYPE</Text></Box>
						<Box width={15}><Text bold>LATENCY</Text></Box>
						<Box width={15}><Text bold>IP</Text></Box>
					</Box>
					{proxies.length === 0 ? (
						<Box paddingX={1}><Text color="#9ca3af">No proxies configured.</Text></Box>
					) : (
						proxies.map((p, i) => (
							<Box key={p.id} flexDirection="row" paddingX={1}>
								<Box width={3}><Text color={i === cursor ? "#34d399" : "#e5e7eb"}>{i === cursor ? "> " : "  "}</Text></Box>
								<Box width={20}><Text color={i === cursor ? "#34d399" : "#e5e7eb"}>{p.name}</Text></Box>
								<Box width={25}><Text color="#d1d5db">{p.host}:{p.port}</Text></Box>
								<Box width={10}><Text color="#9ca3af">{p.type}</Text></Box>
								<Box width={15}>
									{testingIds.has(p.id) ? <Text color="#7dd3fc">Testing...</Text> : 
									 <Text color={testResults[p.id]?.error ? "#f87171" : "#34d399"}>{testResults[p.id]?.latencyMs ? `${testResults[p.id]!.latencyMs}ms` : "-"}</Text>}
								</Box>
								<Box width={15}><Text color="#9ca3af">{testResults[p.id]?.ip || "-"}</Text></Box>
							</Box>
						))
					)}
					<Box paddingX={1} marginTop={1}>
						<Text color={cursor === proxies.length ? "#34d399" : "#e5e7eb"}>
							{cursor === proxies.length ? "> " : "  "}
							+ Add new proxy
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Arrows to navigate • Enter to select • E to edit • T to test • Del to delete • Esc to exit</Text>
					</Box>
				</Box>
			)}

			{view === "create" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>{editingId ? "Edit Proxy" : "Add New Proxy"}</Text>
					<Box marginTop={1} flexDirection="column">
						{renderInput("name", "Name", draftName, "Required")}
						{renderInput("host", "Host", draftHost, "Required")}
						{renderInput("port", "Port", draftPort, "Required")}
						{renderInput("username", "User", draftUsername, "Optional")}
						{renderInput("password", "Pass", draftPassword, "Optional")}
						{renderInput("type", "Type", draftType)}
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Up/Down or Tab to navigate • Enter to save • Esc to cancel</Text>
					</Box>
				</Box>
			)}

			{view === "details" && proxies[cursor] && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Proxy Details</Text>
					<Box marginTop={1} flexDirection="column">
						<Text>Name: {proxies[cursor]!.name}</Text>
						<Text>Address: {proxies[cursor]!.host}:{proxies[cursor]!.port}</Text>
						<Text>Type: {proxies[cursor]!.type}</Text>
						<Text>Auth: {proxies[cursor]!.username ? `${proxies[cursor]!.username}:***` : "None"}</Text>
						{testResults[proxies[cursor]!.id] && (
							<Box flexDirection="column" marginTop={1}>
								<Text bold color="#7dd3fc">Last Test:</Text>
								<Text>IP: {testResults[proxies[cursor]!.id]!.ip}</Text>
								<Text>Latency: {testResults[proxies[cursor]!.id]!.latencyMs}ms</Text>
								{testResults[proxies[cursor]!.id]!.error && <Text color="#f87171">Error: {testResults[proxies[cursor]!.id]!.error}</Text>}
							</Box>
						)}
					</Box>
					<Box marginTop={1}>
						<Text bold color="#34d399">Press 'T' to Test • 'E' to Edit • Esc to go back</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}

export const proxyManagerModule = defineModule<ProxyManagerParams>({
	id: "kits/proxy/manager",
	description: "Interactive proxy manager; use $.kits.proxy.list() and $.kits.proxy.test() for notebook-safe operations",
	category: "kits",
	consoleParams: [
		{
			name: "action",
			detail: "Compatibility non-interactive action. Prefer $.kits.proxy.list() for explicit notebook-safe listing.",
			example: "action=list",
			valueType: "string",
			values: ["list"],
		},
	],
	executor: defineExecutor<ProxyManagerParams>(async (context) => {
		const action = readProxyManagerAction(context.params);
		const kit = await ensureProxyKit(
			context,
			action === "list" ? "Listing Proxy profiles" : "Starting ProxyManager",
		);

		if (action === "list") {
			return runProxyManagerAction(context.params, kit);
		}

		try {
			const exitCode = await context.runInteractiveApplication(ProxyManager, { kit });
			return { exitCode };
		} catch (error) {
			if (!isInteractiveApplicationUnavailableError(error)) {
				throw error;
			}

			return buildProxyManagerFallbackOutput(kit);
		}
	}),
});
