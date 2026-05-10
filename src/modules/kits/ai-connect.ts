import { AI_PROVIDER_KINDS, formatAiConnectionLabel, type AiConnection, type AiConnectionUpsertInput, type AiProviderKind } from "../../kits";
import { createTextEntity } from "../../primitives";
import { defineExecutor, defineModule } from "../module";
import { InvalidParamsError } from "../errors";
import {
	createAiConnectionsReport,
	ensureAiKit,
	parseOptionalBoolean,
	parseOptionalProvider,
	parseOptionalString,
	parseOptionalStringRecord,
} from "./ai-shared";

export type AiConnectParams = {
	connection?: string;
	id?: string;
	name?: string;
	provider?: AiProviderKind;
	model?: string;
	apiKey?: string;
	apiKeyEnv?: string;
	authToken?: string;
	authTokenEnv?: string;
	baseUrl?: string;
	providerName?: string;
	headersJson?: string;
	system?: string;
	persist?: boolean;
};

const AI_CONNECT_CONSOLE_PARAMS = [
	{ name: "connection", detail: "Existing connection id or unique name to select", example: "local-ollama", valueType: "string" },
	{ name: "id", detail: "Stable repository id. Defaults to a slug from name", example: "openai-prod", valueType: "string" },
	{ name: "name", detail: "Human label for the saved connection", example: "Prod OpenAI", valueType: "string" },
	{ name: "provider", detail: "Provider kind", values: AI_PROVIDER_KINDS, example: "openai-compatible", valueType: "string" },
	{ name: "model", detail: "Default model name for this connection", example: "llama3.1", valueType: "string" },
	{ name: "apiKey", detail: "Inline API key. Stored in the repository file", example: "sk-...", valueType: "string" },
	{ name: "apiKeyEnv", detail: "Environment variable to read the API key from", example: "OPENAI_API_KEY", valueType: "string" },
	{ name: "authToken", detail: "Optional auth token for providers that use it", example: "token", valueType: "string" },
	{ name: "authTokenEnv", detail: "Environment variable to read authToken from", example: "ANTHROPIC_AUTH_TOKEN", valueType: "string" },
	{ name: "baseUrl", detail: "Custom provider base URL", example: "http://127.0.0.1:11434/v1", valueType: "string" },
	{ name: "providerName", detail: "Optional provider label for openai-compatible and google factories", example: "ollama", valueType: "string" },
	{ name: "headersJson", detail: "Optional JSON object with additional HTTP headers", example: '{"X-Test":"1"}', valueType: "json" },
	{ name: "system", detail: "Default system prompt stored on the connection", example: "Be concise.", valueType: "string" },
	{ name: "persist", detail: "When false, keep the connection only in memory for the current Activity", example: "false", valueType: "boolean" },
] as const;

function hasConnectionPayload(params: AiConnectParams): boolean {
	return [
		params.provider,
		params.model,
		params.apiKey,
		params.apiKeyEnv,
		params.authToken,
		params.authTokenEnv,
		params.baseUrl,
		params.providerName,
		params.headersJson,
		params.system,
		params.name,
	].some(value => value !== undefined);
}

function resolveSeedConnection(
	connections: readonly AiConnection[],
	target: string | undefined,
	id: string | undefined,
	name: string | undefined,
): AiConnection | null {
	const candidates = [target, id, name].filter((value): value is string => Boolean(value));
	for (const candidate of candidates) {
		const byId = connections.find(connection => connection.id === candidate);
		if (byId) {
			return byId;
		}

		const byName = connections.filter(connection => connection.name === candidate);
		if (byName.length === 1) {
			return byName[0] ?? null;
		}
	}

	return null;
}

function buildUpsertPayload(params: AiConnectParams, seed: AiConnection | null): AiConnectionUpsertInput {
	const provider = parseOptionalProvider(params.provider) ?? seed?.provider;
	const model = parseOptionalString(params.model, "model") ?? seed?.model;
	if (!provider) {
		throw new InvalidParamsError(`kits/ai/connect requires provider=<${AI_PROVIDER_KINDS.join("|")}> when creating a new connection.`);
	}

	if (!model) {
		throw new InvalidParamsError("kits/ai/connect requires model=<model> when creating a new connection.");
	}

	return {
		id: parseOptionalString(params.id, "id") ?? seed?.id ?? parseOptionalString(params.name, "name") ?? undefined,
		name: parseOptionalString(params.name, "name") ?? seed?.name ?? parseOptionalString(params.connection, "connection") ?? `${provider}:${model}`,
		provider,
		model,
		apiKey: parseOptionalString(params.apiKey, "apiKey") ?? seed?.apiKey,
		apiKeyEnv: parseOptionalString(params.apiKeyEnv, "apiKeyEnv") ?? seed?.apiKeyEnv,
		authToken: parseOptionalString(params.authToken, "authToken") ?? seed?.authToken,
		authTokenEnv: parseOptionalString(params.authTokenEnv, "authTokenEnv") ?? seed?.authTokenEnv,
		baseUrl: parseOptionalString(params.baseUrl, "baseUrl") ?? seed?.baseUrl,
		providerName: parseOptionalString(params.providerName, "providerName") ?? seed?.providerName,
		headers: parseOptionalStringRecord(params.headersJson, "headersJson") ?? seed?.headers,
		systemPrompt: parseOptionalString(params.system, "system") ?? seed?.systemPrompt,
		meta: seed?.meta,
	};
}

export const aiConnectModule = defineModule<AiConnectParams>({
	id: "kits/ai/connect",
	category: "kits",
	description: "Create, update, or select a $ai connection for the current Activity",
	consoleParams: AI_CONNECT_CONSOLE_PARAMS,
	executor: defineExecutor<AiConnectParams>(async (context) => {
		const kit = await ensureAiKit(context);
		const connectionTarget = parseOptionalString(context.params.connection, "connection");
		const id = parseOptionalString(context.params.id, "id");
		const name = parseOptionalString(context.params.name, "name");
		const persist = parseOptionalBoolean(context.params.persist, "persist");
		const seedConnection = resolveSeedConnection(kit.listConnections(), connectionTarget, id, name);

		if (hasConnectionPayload(context.params)) {
			const connection = await kit.saveConnection(buildUpsertPayload(context.params, seedConnection), { persist });
			kit.selectConnection(connection.id);
			return [
				createTextEntity(
					[
						`$ai attached to ${formatAiConnectionLabel(connection)}`,
						`Provider: ${connection.provider}`,
						`Model: ${connection.model}`,
						`Base URL: ${connection.baseUrl ?? "<default>"}`,
						`Storage: ${persist === false ? "in-memory" : "repository"}`,
					],
					{ tone: "info" },
				),
				...createAiConnectionsReport(kit),
			];
		}

		if (connectionTarget || id || name) {
			const connection = kit.selectConnection(connectionTarget ?? id ?? name ?? "");
			if (!connection) {
				throw new InvalidParamsError("Failed to resolve the requested AI connection.");
			}

			return [
				createTextEntity(
					[
						`$ai attached to ${formatAiConnectionLabel(connection)}`,
						`Provider: ${connection.provider}`,
						`Model: ${connection.model}`,
					],
					{ tone: "info" },
				),
				...createAiConnectionsReport(kit),
			];
		}

		const connections = kit.listConnections();
		if (connections.length === 1) {
			const connection = kit.selectConnection(connections[0]?.id ?? "");
			if (!connection) {
				throw new InvalidParamsError("Failed to select the only saved AI connection.");
			}

			return [
				createTextEntity([`$ai attached to ${formatAiConnectionLabel(connection)}`], { tone: "info" }),
				...createAiConnectionsReport(kit),
			];
		}

		return createAiConnectionsReport(kit);
	}),
}).useDefault("connection");