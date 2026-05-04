import { InvalidParamsError } from "./errors";

function isNumericValue(raw: string): boolean {
	return /^-?(?:\d+|\d*\.\d+)$/.test(raw);
}

export function readFlagValue(argv: readonly string[], flagName: string): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument) {
			continue;
		}

		if (argument === flagName) {
			return argv[index + 1];
		}

		const prefix = `${flagName}=`;
		if (argument.startsWith(prefix)) {
			return argument.slice(prefix.length);
		}
	}

	return undefined;
}

export function readFlagValues(argv: readonly string[], flagName: string): string[] {
	const values: string[] = [];

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument) {
			continue;
		}

		if (argument === flagName) {
			const nextValue = argv[index + 1];
			if (nextValue !== undefined) {
				values.push(nextValue);
			}
			continue;
		}

		const prefix = `${flagName}=`;
		if (argument.startsWith(prefix)) {
			values.push(argument.slice(prefix.length));
		}
	}

	return values;
}

export function parseLooseValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return "";
	}

	if (trimmed === "true") {
		return true;
	}

	if (trimmed === "false") {
		return false;
	}

	if (trimmed === "null") {
		return null;
	}

	if (isNumericValue(trimmed)) {
		return Number(trimmed);
	}

	if (
		trimmed.startsWith("{") ||
		trimmed.startsWith("[") ||
		trimmed.startsWith('"') ||
		trimmed.startsWith("'")
	) {
		try {
			return JSON.parse(trimmed.replace(/^'|'$/g, '"'));
		} catch (error) {
			throw new InvalidParamsError(`Invalid params payload: ${trimmed}`, error);
		}
	}

	return trimmed;
}

function parseKeyValueArgument(raw: string): [string, unknown] {
	const separatorIndex = raw.indexOf("=");
	if (separatorIndex < 0) {
		return [raw.trim(), true];
	}

	const key = raw.slice(0, separatorIndex).trim();
	const value = raw.slice(separatorIndex + 1);
	if (key.length === 0) {
		throw new InvalidParamsError(`Invalid param argument: ${raw}`);
	}

	return [key, parseLooseValue(value)];
}

function parseKeyValueArguments(values: readonly string[]): Record<string, unknown> {
	const parsed: Record<string, unknown> = {};

	for (const value of values) {
		const [key, parsedValue] = parseKeyValueArgument(value);
		parsed[key] = parsedValue;
	}

	return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInlineParams(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"') || trimmed.startsWith("'")) {
		return parseLooseValue(trimmed);
	}

	if (trimmed.includes("=")) {
		return parseKeyValueArguments(trimmed.split(/\s+/).filter(Boolean));
	}

	return parseLooseValue(trimmed);
}

export function parseModuleParams(argv: readonly string[]): unknown {
	const rawParams = readFlagValue(argv, "--params");
	const rawParamValues = readFlagValues(argv, "--param");

	const explicitParams = rawParams === undefined ? undefined : parseLooseValue(rawParams);
	if (rawParamValues.length === 0) {
		return explicitParams;
	}

	const inlineParams = parseKeyValueArguments(rawParamValues);
	if (explicitParams === undefined) {
		return inlineParams;
	}

	if (!isRecord(explicitParams)) {
		throw new InvalidParamsError("--param can only be combined with object-like --params values.");
	}

	return {
		...explicitParams,
		...inlineParams,
	};
}