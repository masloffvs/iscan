import { AI_PROVIDER_KINDS, formatAiConnectionLabel, type AiConnectionUpsertInput, type AiProviderKind } from "../../kits";
import { createTextEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule } from "../module";
import {
	createAiConnectionsReport,
	ensureAiKit,
	parseOptionalBoolean,
	parseOptionalProvider,
	parseOptionalString,
	parseOptionalStringRecord,
} from "./ai-shared";

export type AiCreateParams = {
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

const AI_CREATE_CONSOLE_PARAMS = [
	{ name: "id", detail: "Stable connection id. Defaults to a slug from name", example: "openai-prod", valueType: "string" },
	{ name: "name", detail: "Human label for the new connection", example: "Prod OpenAI", valueType: "string" },
	{ name: "provider", detail: "Provider kind", values: AI_PROVIDER_KINDS, example: "openai-compatible", required: true, valueType: "string" },
	{ name: "model", detail: "Default model name for this connection", example: "llama3.1", required: true, valueType: "string" },
	{ name: "apiKey", detail: "Inline API key for this connection", example: "sk-...", valueType: "string" },
	{ name: "apiKeyEnv", detail: "Environment variable to read the API key from", example: "OPENAI_API_KEY", valueType: "string" },
	{ name: "authToken", detail: "Optional auth token for providers that use it", example: "token", valueType: "string" },
	{ name: "authTokenEnv", detail: "Environment variable to read authToken from", example: "ANTHROPIC_AUTH_TOKEN", valueType: "string" },
	{ name: "baseUrl", detail: "Custom provider base URL", example: "http://127.0.0.1:11434/v1", valueType: "string" },
	{ name: "providerName", detail: "Optional provider label for openai-compatible and google factories", example: "ollama", valueType: "string" },
	{ name: "headersJson", detail: "Optional JSON object with additional HTTP headers", example: '{"X-Test":"1"}', valueType: "json" },
	{ name: "system", detail: "Default system prompt stored on the connection", example: "Be concise.", valueType: "string" },
	{ name: "persist", detail: "When false, keep the connection only in memory for the current Activity", example: "false", valueType: "boolean" },
] as const;

function buildCreatePayload(params: AiCreateParams): AiConnectionUpsertInput {
	const provider = parseOptionalProvider(params.provider);
	const model = parseOptionalString(params.model, "model");
	if (!provider) {
		throw new InvalidParamsError(`kits/ai/create requires provider=<${AI_PROVIDER_KINDS.join("|")}>.`);
	}

	if (!model) {
		throw new InvalidParamsError("kits/ai/create requires model=<model>.");
	}

	const id = parseOptionalString(params.id, "id");
	const name = parseOptionalString(params.name, "name") ?? id ?? `${provider}:${model}`;

	return {
		id,
		name,
		provider,
		model,
		apiKey: parseOptionalString(params.apiKey, "apiKey"),
		apiKeyEnv: parseOptionalString(params.apiKeyEnv, "apiKeyEnv"),
		authToken: parseOptionalString(params.authToken, "authToken"),
		authTokenEnv: parseOptionalString(params.authTokenEnv, "authTokenEnv"),
		baseUrl: parseOptionalString(params.baseUrl, "baseUrl"),
		providerName: parseOptionalString(params.providerName, "providerName"),
		headers: parseOptionalStringRecord(params.headersJson, "headersJson"),
		systemPrompt: parseOptionalString(params.system, "system"),
	};
	}

export const aiCreateModule = defineModule<AiCreateParams>({
	id: "kits/ai/create",
	category: "kits",
	description: "Create a new $ai connection and optionally keep it only in memory for the current Activity",
	consoleParams: AI_CREATE_CONSOLE_PARAMS,
	executor: defineExecutor<AiCreateParams>(async (context) => {
		const kit = await ensureAiKit(context);
		const persist = parseOptionalBoolean(context.params.persist, "persist");
		const connection = await kit.createConnection(buildCreatePayload(context.params), { persist });
		return [
			createTextEntity(
				[
					`$ai created ${formatAiConnectionLabel(connection)}`,
					`Provider: ${connection.provider}`,
					`Model: ${connection.model}`,
					`Storage: ${persist === false ? "in-memory" : "repository"}`,
				],
				{ tone: "info" },
			),
			...createAiConnectionsReport(kit),
		];
	}),
});