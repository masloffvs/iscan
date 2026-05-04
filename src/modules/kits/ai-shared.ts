import { AiKit, AI_PROVIDER_KINDS, type AiConnection, type AiProviderKind, formatAiConnectionLabel } from "../../kits";
import { createTableEntity, createTextEntity, normalizeOutputEntities, renderOutputEntities, type OutputEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import type { ModuleExecutionContext } from "../module";

const MAX_RENDERED_OUTPUT_CHARS = 6000;
const MAX_RENDERED_OUTPUT_LINES = 80;

export async function ensureAiKit(
	context: Pick<ModuleExecutionContext<unknown, object>, "getAiKit" | "runtime">,
): Promise<AiKit> {
	const existingKit = context.getAiKit();
	if (existingKit) {
		return existingKit;
	}

	return await context.runtime.attachKit(new AiKit(), {
		reason: "module:kits/ai",
	});
}

export function parseOptionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value !== "string") {
		throw new InvalidParamsError(`${fieldName} must be a string.`);
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	throw new InvalidParamsError(`${fieldName} must be a valid number.`);
}

export function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

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

	throw new InvalidParamsError(`${fieldName} must be a boolean.`);
}

export function parseOptionalProvider(value: unknown): AiProviderKind | undefined {
	const provider = parseOptionalString(value, "provider");
	if (!provider) {
		return undefined;
	}

	if ((AI_PROVIDER_KINDS as readonly string[]).includes(provider)) {
		return provider as AiProviderKind;
	}

	throw new InvalidParamsError(`provider must be one of: ${AI_PROVIDER_KINDS.join(", ")}.`);
}

export function parseOptionalStringRecord(
	value: unknown,
	fieldName: string,
): Record<string, string> | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const parsedValue = typeof value === "string" ? parseJson(fieldName, value) : value;
	if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
		throw new InvalidParamsError(`${fieldName} must be a JSON object with string values.`);
	}

	return Object.fromEntries(
		Object.entries(parsedValue)
			.filter(([, entryValue]) => typeof entryValue === "string")
			.map(([key, entryValue]) => [key, entryValue as string]),
	);
}

export function createAiConnectionsReport(kit: AiKit, title = "$ai repository"): OutputEntity[] {
	const connections = kit.listConnections();
	const selectedConnection = kit.getSelectedConnection();
	const summaryLines = [
		title,
		`Repository: ${kit.getRepositoryPath()}`,
		`Connections: ${connections.length}`,
		`Selected: ${selectedConnection ? formatAiConnectionLabel(selectedConnection) : "<none>"}`,
	];

	if (connections.length === 0) {
		summaryLines.push("Create one with $.kits.ai.connect({ name: \"local\", provider: \"openai-compatible\", model: \"llama3.1\" })");
		return [createTextEntity(summaryLines, { tone: "info" })];
	}

	return [
		createTextEntity(summaryLines, { tone: "info" }),
		createTableEntity(
			[
				{ key: "selected", header: "*", width: 3, align: "center" },
				{ key: "id", header: "id", width: 8 },
				{ key: "name", header: "name", maxWidth: 28 },
				{ key: "provider", header: "provider", maxWidth: 20 },
				{ key: "model", header: "model", maxWidth: 28 },
				{ key: "baseUrl", header: "baseUrl", maxWidth: 40 },
			],
			connections.map(connection => ({
				selected: selectedConnection?.id === connection.id ? "*" : "",
				id: connection.id,
				name: connection.name,
				provider: connection.provider,
				model: connection.model,
				baseUrl: connection.baseUrl ?? "",
			})),
			{ title: "Saved AI connections" },
		),
	];
}

export function formatModuleResultAsText(value: unknown, width = 96): string {
	const normalizedEntities = normalizeOutputEntities(value);
	if (normalizedEntities) {
		const renderedLines = renderOutputEntities(normalizedEntities, width)
			.map(line => line.text)
			.slice(0, MAX_RENDERED_OUTPUT_LINES);
		return clipText(renderedLines.join("\n"));
	}

	if (typeof value === "string") {
		return clipText(value);
	}

	if (value === undefined) {
		return "<no output>";
	}

	try {
		return clipText(JSON.stringify(value, null, 2));
	} catch {
		return clipText(String(value));
	}
}

export function resolveChatConnection(kit: AiKit, target: string | undefined): AiConnection {
	if (target) {
		return kit.selectConnection(target) ?? kit.resolveConnection(target);
	}

	const selectedConnection = kit.getSelectedConnection();
	if (selectedConnection) {
		return selectedConnection;
	}

	const connections = kit.listConnections();
	if (connections.length === 1) {
		return kit.selectConnection(connections[0]?.id ?? "") ?? connections[0] as AiConnection;
	}

	if (connections.length === 0) {
		throw new InvalidParamsError("$ai has no saved connections. Create one with $.kits.ai.connect({ name: \"local\", provider: \"openai-compatible\", model: \"llama3.1\" }).");
	}

	throw new InvalidParamsError("$ai has multiple saved connections. Select one with $.kits.ai.connect({ connection: \"<id>\" }).");
}

export function parseJson(fieldName: string, value: string): unknown {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new InvalidParamsError(`${fieldName} must be valid JSON.`, error);
	}
}

function clipText(text: string): string {
	if (text.length <= MAX_RENDERED_OUTPUT_CHARS) {
		return text;
	}

	return `${text.slice(0, MAX_RENDERED_OUTPUT_CHARS)}\n...[truncated]`;
}