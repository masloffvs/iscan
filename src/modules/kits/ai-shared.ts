import { AiKit, AI_PROVIDER_KINDS, type AiConnection, type AiGenerateTextRequest, type AiProviderKind, type ModelMessage, formatAiConnectionLabel } from "../../kits";
import { createTableEntity, createTextEntity, normalizeOutputEntities, renderOutputEntities, type OutputEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import type { ModuleExecutionContext } from "../module";

const MAX_RENDERED_OUTPUT_CHARS = 6000;
const MAX_RENDERED_OUTPUT_LINES = 80;

export type AiChatRole = "system" | "user" | "assistant";

export type AiChatHistoryMessage = {
	role: AiChatRole;
	text: string;
};

export type AiChatReply = {
	text: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
	finishReason?: string | null;
};

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
		`Repository path: ${kit.getRepositoryPath()}`,
		`Connections: ${connections.length}`,
		`Selected: ${selectedConnection ? formatAiConnectionLabel(selectedConnection) : "<none>"}`,
	];

	if (connections.length === 0) {
		summaryLines.push("Create one with $.kits.ai.create({ provider: \"openai-compatible\", model: \"llama3.1\" }) or $.kits.ai.connect({ name: \"local\", provider: \"openai-compatible\", model: \"llama3.1\" })");
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
			{ title: "Available AI connections" },
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
		throw new InvalidParamsError("$ai has no available connections. Create one with $.kits.ai.create({ provider: \"openai-compatible\", model: \"llama3.1\" }) or $.kits.ai.connect({ name: \"local\", provider: \"openai-compatible\", model: \"llama3.1\" }).");
	}

	throw new InvalidParamsError("$ai has multiple available connections. Select one with $.kits.ai.select({ connection: \"<id>\" }) or $.kits.ai.connect({ connection: \"<id>\" }).");
}

function toModelMessages(messages: readonly AiChatHistoryMessage[]): ModelMessage[] {
	return messages
		.filter(message => message.role !== "system")
		.map(message => ({
			role: message.role,
			content: message.text,
		}));
}

export function buildAiSystemPrompt(
	systemPrompt: string | undefined,
	options: { enableTools?: boolean } = {},
): string {
	const defaultPrompt = options.enableTools === false
		? [
			"You are $ai inside iscan.",
			"You are helping the operator through a multi-turn chat interface.",
			"Stay concise, precise, and action-oriented.",
		].join(" ")
		: [
			"You are $ai inside iscan.",
			"You can inspect modules and run them with tools when needed.",
			"Prefer list_modules and describe_module before run_module when the correct module or params are unclear.",
			"When you use run_module, summarize the result for the operator instead of dumping raw JSON unless they ask for it.",
		].join(" ");

	return systemPrompt ? `${defaultPrompt}\n\n${systemPrompt}` : defaultPrompt;
}

export async function requestAiTextReply(options: {
	kit: AiKit;
	connection: string;
	model?: string;
	system: string | undefined;
	history: readonly AiChatHistoryMessage[];
	temperature: number | undefined;
	maxOutputTokens: number | undefined;
	tools?: AiGenerateTextRequest["tools"];
	stopWhen?: AiGenerateTextRequest["stopWhen"];
}): Promise<AiChatReply> {
	const result = await options.kit.generateText({
		connection: options.connection,
		model: options.model,
		system: options.system,
		messages: toModelMessages(options.history),
		temperature: options.temperature,
		maxOutputTokens: options.maxOutputTokens,
		tools: options.tools,
		stopWhen: options.stopWhen,
	});

	return {
		text: result.text?.trim() || "<empty response>",
		usage: result.usage,
		finishReason: result.finishReason ? String(result.finishReason) : null,
	};
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