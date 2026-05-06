import {
	AIRCRACK_KIT_ID,
	AircrackKit,
	type AircrackDumpStartOptions,
	type AircrackMonitorSequencePlan,
} from "../kits";
import { InvalidParamsError } from "./errors";
import { defineExecutor, defineModule, type ModuleExecutionContext } from "./module";

type EnsureAircrackKitContext = Pick<ModuleExecutionContext<unknown, object>, "getKit" | "runtime">;

export type AircrackDslParams = Record<string, unknown>;

type NormalizedAircrackDslParams = {
	config: Record<string, unknown>;
	values: unknown[];
};

type AircrackDslTerminalAction =
	| "dump-list"
	| "dump-snapshot"
	| "dump-start"
	| "dump-stop"
	| "monitor-check"
	| "monitor-check-kill"
	| "monitor-list"
	| "monitor-sequence"
	| "monitor-start"
	| "monitor-status"
	| "monitor-stop"
	| "region-get"
	| "region-set"
	| "rfkill-list";

type MonitorSequenceStep = "checkKill" | "setRegion" | "start" | "stop";

const MONITOR_SEQUENCE_STEP_SET = new Set<MonitorSequenceStep>(["checkKill", "start", "stop", "setRegion"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureAircrackKit(
	context: EnsureAircrackKitContext,
	reason = "module:pkg/aircrack",
): Promise<AircrackKit> {
	const existingKit = context.getKit<AircrackKit>(AIRCRACK_KIT_ID);
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new AircrackKit(), { reason });
}

function parseRequiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const normalizedValue = value.trim();
	if (normalizedValue.length === 0) {
		throw new InvalidParamsError(`${fieldName} must be a non-empty string.`);
	}

	return normalizedValue;
}

function parseOptionalCountryCode(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const normalizedValue = parseRequiredString(value, fieldName).toUpperCase();
	if (!/^[A-Z0-9]{2}$/u.test(normalizedValue)) {
		throw new InvalidParamsError(`${fieldName} must be a 2-character regulatory code.`);
	}

	return normalizedValue;
}

function parseBooleanFlag(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function collectOrderedFlagNames(config: Record<string, unknown>): string[] {
	return Object.entries(config)
		.filter(([, value]) => value === true)
		.map(([key]) => key);
}

function normalizeAircrackDslParams(params: unknown): NormalizedAircrackDslParams {
	if (params === undefined) {
		return {
			config: {},
			values: [],
		};
	}

	const config: Record<string, unknown> = {};
	const values: unknown[] = [];
	const ingestValue = (value: unknown) => {
		if (isRecord(value)) {
			Object.assign(config, value);
			return;
		}

		if (value !== undefined) {
			values.push(value);
		}
	};

	if (Array.isArray(params)) {
		for (const value of params) {
			ingestValue(value);
		}

		return { config, values };
	}

	if (isRecord(params)) {
		const args = Array.isArray(params.args) ? params.args : [];
		for (const value of args) {
			ingestValue(value);
		}

		if (Object.prototype.hasOwnProperty.call(params, "value")) {
			ingestValue(params.value);
		}

		for (const [key, value] of Object.entries(params)) {
			if (key === "args" || key === "value") {
				continue;
			}

			config[key] = value;
		}

		return { config, values };
	}

	return {
		config,
		values: [params],
	};
}

function readConfiguredString(config: Record<string, unknown>, fieldNames: readonly string[], fieldName: string): string | undefined {
	for (const candidateField of fieldNames) {
		if (candidateField in config && config[candidateField] !== undefined) {
			return parseRequiredString(config[candidateField], fieldName);
		}
	}

	return undefined;
}

function readPositionalString(config: Record<string, unknown>, values: unknown[], fieldNames: readonly string[], fieldName: string): string {
	const configuredValue = readConfiguredString(config, fieldNames, fieldName);
	if (configuredValue !== undefined) {
		return configuredValue;
	}

	if (values.length === 0) {
		throw new InvalidParamsError(`${fieldName} is required.`);
	}

	return parseRequiredString(values[0], fieldName);
}

function consumeInterfaceArgument(config: Record<string, unknown>, values: unknown[]): { interfaceName: string; remainingValues: unknown[] } {
	const configuredValue = readConfiguredString(config, ["interface", "interfaceName", "name", "device"], "interface");
	if (configuredValue !== undefined) {
		return {
			interfaceName: configuredValue,
			remainingValues: [...values],
		};
	}

	if (values.length === 0) {
		throw new InvalidParamsError("interface is required.");
	}

	return {
		interfaceName: parseRequiredString(values[0], "interface"),
		remainingValues: values.slice(1),
	};
}

function tryConsumeSingleChannel(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(Math.trunc(value));
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const normalizedValue = value.trim();
	if (!/^[0-9,\s]+$/u.test(normalizedValue)) {
		return undefined;
	}

	const channels = normalizedValue.split(/[\s,]+/u).filter(Boolean);
	if (channels.length !== 1) {
		throw new InvalidParamsError("monitor.start supports at most one channel value.");
	}

	return channels[0];
}

function looksLikeCountryCode(value: unknown): boolean {
	return typeof value === "string" && /^[A-Za-z0-9]{2}$/u.test(value.trim());
}

function buildMonitorPlan(config: Record<string, unknown>, values: unknown[]): AircrackMonitorSequencePlan {
	const { interfaceName, remainingValues: rawRemainingValues } = consumeInterfaceArgument(config, values);
	const orderedSteps = collectOrderedFlagNames(config)
		.filter((flagName): flagName is MonitorSequenceStep => MONITOR_SEQUENCE_STEP_SET.has(flagName as MonitorSequenceStep));
	const regionFromConfig = parseOptionalCountryCode(
		config.region ?? config.country ?? config.countryCode ?? config.code,
		"region",
	);
	let channel = config.channel ?? config.channels;
	let region = regionFromConfig;
	const remainingValues = [...rawRemainingValues];

	if (channel === undefined && orderedSteps.includes("start") && remainingValues.length > 0) {
		const candidateChannel = tryConsumeSingleChannel(remainingValues[0]);
		if (candidateChannel !== undefined && !(orderedSteps.includes("setRegion") && remainingValues.length === 1 && looksLikeCountryCode(remainingValues[0]))) {
			channel = candidateChannel;
			remainingValues.shift();
		}
	}

	if (!region && orderedSteps.includes("setRegion") && remainingValues.length > 0) {
		region = parseOptionalCountryCode(remainingValues[0], "region");
	}

	return {
		interface: interfaceName,
		channel,
		region,
		steps: orderedSteps,
	};
}

function buildDumpStartOptions(config: Record<string, unknown>, values: unknown[]): AircrackDumpStartOptions {
	const { interfaceName, remainingValues } = consumeInterfaceArgument(config, values);
	const write = typeof config.write === "string"
		? config.write
		: typeof config.output === "string"
			? config.output
			: typeof remainingValues[0] === "string"
				? remainingValues[0]
				: undefined;

	return {
		interface: interfaceName,
		channel: config.channel ?? config.channels,
		write,
		sessionId: typeof config.sessionId === "string" ? config.sessionId : undefined,
		writeIntervalSeconds: typeof config.writeIntervalSeconds === "number"
			? config.writeIntervalSeconds
			: typeof config.interval === "number"
				? config.interval
				: undefined,
		bssid: typeof config.bssid === "string" ? config.bssid : undefined,
		essid: typeof config.essid === "string" ? config.essid : undefined,
	};
}

function readDumpTarget(config: Record<string, unknown>, values: unknown[], fieldName: string): string {
	for (const candidateField of ["sessionId", "session", "target", "file", "captureFile", "write"] as const) {
		if (candidateField in config && config[candidateField] !== undefined) {
			return parseRequiredString(config[candidateField], fieldName);
		}
	}

	if (values.length === 0) {
		throw new InvalidParamsError(`${fieldName} is required.`);
	}

	return parseRequiredString(values[0], fieldName);
}

function pickAircrackTerminalAction(config: Record<string, unknown>): AircrackDslTerminalAction {
	const hasMonitor = parseBooleanFlag(config, "monitor");
	const hasDump = parseBooleanFlag(config, "dump");
	const hasSetRegion = parseBooleanFlag(config, "setRegion");
	const monitorSequenceSteps = collectOrderedFlagNames(config).filter((flagName) => MONITOR_SEQUENCE_STEP_SET.has(flagName as MonitorSequenceStep));

	if (hasDump && parseBooleanFlag(config, "list")) {
		return "dump-list";
	}

	if (hasDump && parseBooleanFlag(config, "start")) {
		return "dump-start";
	}

	if (hasDump && parseBooleanFlag(config, "snapshot")) {
		return "dump-snapshot";
	}

	if (hasDump && parseBooleanFlag(config, "stop")) {
		return "dump-stop";
	}

	if (parseBooleanFlag(config, "rfkill") && parseBooleanFlag(config, "list")) {
		return "rfkill-list";
	}

	if ((parseBooleanFlag(config, "region") || parseBooleanFlag(config, "regulatory"))
		&& (parseBooleanFlag(config, "get") || parseBooleanFlag(config, "show") || parseBooleanFlag(config, "status"))) {
		return "region-get";
	}

	if (hasMonitor && parseBooleanFlag(config, "list")) {
		return "monitor-list";
	}

	if (hasMonitor && parseBooleanFlag(config, "status")) {
		return "monitor-status";
	}

	if (hasMonitor && parseBooleanFlag(config, "check") && !parseBooleanFlag(config, "checkKill")) {
		return "monitor-check";
	}

	if (hasMonitor && monitorSequenceSteps.length > 1) {
		return "monitor-sequence";
	}

	if (hasMonitor && parseBooleanFlag(config, "checkKill")) {
		return "monitor-check-kill";
	}

	if (hasMonitor && parseBooleanFlag(config, "start")) {
		return "monitor-start";
	}

	if (hasMonitor && parseBooleanFlag(config, "stop")) {
		return "monitor-stop";
	}

	if (hasMonitor && hasSetRegion) {
		return "monitor-sequence";
	}

	if (hasSetRegion) {
		return "region-set";
	}

	throw new InvalidParamsError(
		"Incomplete $.pkg.aircrack chain. Finish with .monitor.list(), .monitor(...).status(), .monitor.check(), .monitor.checkKill(), .monitor(...).start(), .monitor(...).stop(), .rfkill.list(), .region.get(), .setRegion(...), .dump.list(), .dump.start(...), .dump.snapshot(...), or .dump.stop(...).",
	);
}

export const aircrackDslModule = defineModule<AircrackDslParams, unknown>({
	id: "pkg/aircrack",
	category: "pkg",
	description: "Host-side wireless monitor and airodump-ng DSL root for $.pkg.aircrack monitor/dump flows.",
	consoleParams: [
		{ name: "monitor", detail: "Activate the wireless monitor namespace.", jsDescriptorName: "monitor", valueType: "boolean" },
		{ name: "list", detail: "List wireless interfaces or dump sessions depending on the namespace.", jsDescriptorName: "list", valueType: "boolean" },
		{ name: "status", detail: "Inspect one wireless interface by name.", jsDescriptorName: "status", valueType: "boolean" },
		{ name: "check", detail: "Inspect interfering processes reported by airmon-ng.", jsDescriptorName: "check", valueType: "boolean" },
		{ name: "checkKill", detail: "Kill interfering processes with airmon-ng check kill.", jsDescriptorName: "checkKill", valueType: "boolean" },
		{ name: "start", detail: "Start monitor mode or a file-backed dump session depending on the namespace.", jsDescriptorName: "start", valueType: "boolean" },
		{ name: "stop", detail: "Stop monitor mode or stop a dump session depending on the namespace.", jsDescriptorName: "stop", valueType: "boolean" },
		{ name: "setRegion", detail: "Set the global wireless regulatory domain through iw reg set.", jsDescriptorName: "setRegion", valueType: "boolean" },
		{ name: "region", detail: "Activate the regulatory domain namespace.", jsDescriptorName: "region", valueType: "boolean" },
		{ name: "get", detail: "Read the current regulatory domain state.", jsDescriptorName: "get", valueType: "boolean" },
		{ name: "rfkill", detail: "Activate the rfkill namespace.", jsDescriptorName: "rfkill", valueType: "boolean" },
		{ name: "dump", detail: "Activate the airodump-ng capture namespace.", jsDescriptorName: "dump", valueType: "boolean" },
		{ name: "snapshot", detail: "Parse the latest capture CSV for a session id, capture prefix, or csv file path.", jsDescriptorName: "snapshot", valueType: "boolean" },
		{ name: "interface", detail: "Wireless interface name for monitor or dump actions.", example: "wlan0", valueType: "string" },
		{ name: "channel", detail: "Single monitor channel or dump channel list.", example: "6", valueType: "json" },
		{ name: "countryCode", detail: "2-character regulatory domain code.", example: "DE", valueType: "string" },
		{ name: "write", detail: "Capture output prefix for airodump-ng dump sessions.", example: "./logs/site-survey", valueType: "string" },
		{ name: "sessionId", detail: "Dump session id for dump.stop() or dump.snapshot().", example: "survey-1", valueType: "string" },
	],
	executor: defineExecutor(async (context) => {
		const kit = await ensureAircrackKit(context, "module:pkg/aircrack");
		const { config, values } = normalizeAircrackDslParams(context.params);
		const action = pickAircrackTerminalAction(config);

		if (action === "monitor-list") {
			return await kit.listWirelessInterfaces();
		}

		if (action === "monitor-status") {
			const interfaceName = readPositionalString(config, values, ["interface", "interfaceName", "name", "device"], "interface");
			return await kit.getWirelessInterface(interfaceName);
		}

		if (action === "monitor-check") {
			return await kit.checkProcesses();
		}

		if (action === "monitor-check-kill") {
			return await kit.checkProcesses({ kill: true });
		}

		if (action === "monitor-start") {
			const plan = buildMonitorPlan(config, values);
			return await kit.startMonitor(plan.interface, { channel: plan.channel });
		}

		if (action === "monitor-stop") {
			const interfaceName = readPositionalString(config, values, ["interface", "interfaceName", "name", "device"], "interface");
			return await kit.stopMonitor(interfaceName);
		}

		if (action === "monitor-sequence") {
			return await kit.runMonitorSequence(buildMonitorPlan(config, values));
		}

		if (action === "region-get") {
			return await kit.getRegulatoryDomain();
		}

		if (action === "region-set") {
			const region = parseOptionalCountryCode(
				config.region ?? config.country ?? config.countryCode ?? config.code ?? values[0],
				"region",
			);
			if (!region) {
				throw new InvalidParamsError("region is required.");
			}

			return await kit.setRegulatoryDomain(region);
		}

		if (action === "rfkill-list") {
			return await kit.listRfkill();
		}

		if (action === "dump-list") {
			return kit.listDumpSessions();
		}

		if (action === "dump-start") {
			return await kit.startDumpSession(buildDumpStartOptions(config, values));
		}

		if (action === "dump-snapshot") {
			return await kit.snapshotDumpSession(readDumpTarget(config, values, "dump target"));
		}

		return await kit.stopDumpSession(readDumpTarget(config, values, "sessionId"));
	}),
});