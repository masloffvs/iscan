import type {
	ModuleConsoleParam,
	ModuleConsoleParamValueType,
	NotebookTypeOverlayDefinition,
} from "../modules/module";

export type BpkgPackageDependencySpec = {
	pacman?: readonly string[];
	paru?: readonly string[];
};

export type BpkgBindingParameterDefinition = {
	type: ModuleConsoleParamValueType;
	description?: string;
	example?: string;
	required?: boolean;
};

export type BpkgBindingCommandSnapshot = {
	boxId: string;
	command: string[];
	commandString: string;
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type BpkgBindingDefinition = {
	acceptedExitCodes?: readonly number[];
	description: string;
	defaultParameterName?: string;
	notebookTypeOverlay?: NotebookTypeOverlayDefinition;
	parameters?: Record<string, BpkgBindingParameterDefinition>;
	prepare?: BpkgBindingPrepare;
	responseParser?: BpkgBindingResponseParser;
};

export type BpkgPrivilegeLevel = "sandbox-ro" | "sandbox-rw" | "host-privileged";

export type BpkgTranspiledCommand = {
	argv?: readonly string[];
	command?: string;
	createdAt: number;
	cwd?: string;
	env?: Record<string, string>;
	privilegeLevel?: BpkgPrivilegeLevel;
};

export type BpkgBindingTransformerContext = {
	bindingId: string;
	packageId: string;
	packageName: string;
};

export type BpkgBindingRuntimeBridge = {
	getKit<T = unknown>(id: string): T | null;
	ensureKit<T = unknown>(
		id: string,
		createKit: () => T | Promise<T>,
		context?: { reason?: string },
	): Promise<T>;
};

export type BpkgBindingPrepareContext = BpkgBindingTransformerContext & {
	boxId: string;
	params: Record<string, unknown>;
	runtime: BpkgBindingRuntimeBridge;
	boxFileExists(filePath: string): Promise<boolean>;
	readBoxFile(filePath: string): Promise<string>;
	writeBoxFile(filePath: string, content: string | Uint8Array): Promise<void>;
};

export type BpkgBindingPrepareResult = void | Partial<Record<string, unknown>>;

export type BpkgBindingPrepare = (
	context: BpkgBindingPrepareContext,
) => BpkgBindingPrepareResult | Promise<BpkgBindingPrepareResult>;

export type BpkgBindingTransformer = (
	params: Record<string, unknown>,
	context: BpkgBindingTransformerContext,
) => BpkgTranspiledCommand | Promise<BpkgTranspiledCommand>;

export type BpkgBindingResponseParserContext = BpkgBindingTransformerContext & {
	boxId: string;
	params: Record<string, unknown>;
	transpiled: BpkgTranspiledCommand;
	readFile(filePath: string): Promise<string>;
};

export type BpkgBindingResponseParser = (
	result: BpkgBindingCommandSnapshot,
	context: BpkgBindingResponseParserContext,
) => unknown | Promise<unknown>;

export type BpkgPackageBindingsDefinition = {
	package: string;
	description: string;
	id: string;
	dependency: BpkgPackageDependencySpec;
	bindings: Record<string, BpkgBindingDefinition>;
	transformers: Record<string, BpkgBindingTransformer>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoolean(value: unknown, label: string): boolean {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "string") {
		switch (value.trim().toLowerCase()) {
			case "1":
			case "true":
			case "yes":
			case "on":
				return true;
			case "0":
			case "false":
			case "no":
			case "off":
				return false;
		}
	}

	throw new Error(`${label} must be a boolean.`);
}

function parseNumber(value: unknown, label: string): number {
	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numericValue)) {
		throw new Error(`${label} must be a number.`);
	}

	return numericValue;
}

function parseString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string.`);
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}

	return normalized;
}

function parseStringArray(value: unknown, label: string): string[] {
	if (Array.isArray(value)) {
		return value.map((entry, index) => parseString(entry, `${label}[${index}]`));
	}

	if (typeof value === "string") {
		const entries = value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (entries.length === 0) {
			throw new Error(`${label} must contain at least one value.`);
		}

		return entries;
	}

	throw new Error(`${label} must be a string or string array.`);
}

function parseJson(value: unknown, label: string): unknown {
	if (typeof value !== "string") {
		return value;
	}

	try {
		return JSON.parse(value);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${label} must be valid JSON: ${detail}`);
	}
}

export function defineBindings<TDefinition extends BpkgPackageBindingsDefinition>(
	definition: TDefinition,
): TDefinition {
	const bindingIds = Object.keys(definition.bindings);
	if (bindingIds.length === 0) {
		throw new Error(`bpkg package '${definition.id}' must declare at least one binding.`);
	}

	for (const bindingId of bindingIds) {
		if (!definition.transformers[bindingId]) {
			throw new Error(`bpkg package '${definition.id}' is missing a transformer for binding '${bindingId}'.`);
		}
	}

	return definition;
}

export function getBpkgBindingDefinition(
	packageDefinition: BpkgPackageBindingsDefinition,
	bindingId: string,
): BpkgBindingDefinition {
	const bindingDefinition = packageDefinition.bindings[bindingId];
	if (!bindingDefinition) {
		throw new Error(`bpkg package '${packageDefinition.id}' does not define binding '${bindingId}'.`);
	}

	return bindingDefinition;
}

export function createBpkgBindingConsoleParams(
	packageDefinition: BpkgPackageBindingsDefinition,
	bindingId: string,
): readonly ModuleConsoleParam[] {
	const bindingDefinition = getBpkgBindingDefinition(packageDefinition, bindingId);
	return Object.entries(bindingDefinition.parameters ?? {}).map(([name, parameter]) => ({
		name,
		detail: parameter.description,
		example: parameter.example,
		required: parameter.required,
		valueType: parameter.type,
	}));
}

export function normalizeBpkgBindingParams(
	packageDefinition: BpkgPackageBindingsDefinition,
	bindingId: string,
	input: unknown,
): Record<string, unknown> {
	const bindingDefinition = getBpkgBindingDefinition(packageDefinition, bindingId);
	const parameterDefinitions = bindingDefinition.parameters ?? {};
	const rawRecord = (() => {
		if (input === undefined || input === null) {
			return {};
		}

		if (isRecord(input)) {
			return { ...input };
		}

		if (bindingDefinition.defaultParameterName) {
			return {
				[bindingDefinition.defaultParameterName]: input,
			};
		}

		throw new Error(
			`bpkg binding '${packageDefinition.id}/${bindingId}' expects named parameters.`,
		);
	})();

	const normalizedRecord: Record<string, unknown> = {};
	for (const [name, parameterDefinition] of Object.entries(parameterDefinitions)) {
		const rawValue = rawRecord[name];
		if (rawValue === undefined || rawValue === null || rawValue === "") {
			if (parameterDefinition.required) {
				throw new Error(`bpkg binding '${packageDefinition.id}/${bindingId}' requires parameter '${name}'.`);
			}
			continue;
		}

		const label = `${packageDefinition.id}/${bindingId}.${name}`;
		normalizedRecord[name] = (() => {
			switch (parameterDefinition.type) {
				case "string":
					return parseString(rawValue, label);
				case "number":
					return parseNumber(rawValue, label);
				case "boolean":
					return parseBoolean(rawValue, label);
				case "json":
					return parseJson(rawValue, label);
				case "string[]":
					return parseStringArray(rawValue, label);
				default:
					return rawValue;
			}
		})();
	}

	for (const [name, value] of Object.entries(rawRecord)) {
		if (!(name in normalizedRecord) && !(name in parameterDefinitions)) {
			normalizedRecord[name] = value;
		}
	}

	return normalizedRecord;
}