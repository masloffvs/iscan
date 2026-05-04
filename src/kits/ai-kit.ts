import fs from "fs/promises";
import path from "path";
import { generateText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

import { Kit, type KitLifecycleContext } from "./kit";

export const AI_KIT_ID = "$ai";

const AI_KIT_INFO = {
	id: AI_KIT_ID,
	name: "$ai",
	category: "ai",
	description: "Activity-scoped AI toolkit backed by a shared repository of saved provider connections.",
	tags: ["ai", "llm", "providers", "sdk"],
} as const;

export const AI_PROVIDER_KINDS = ["openai", "anthropic", "google", "openai-compatible"] as const;

export type AiProviderKind = typeof AI_PROVIDER_KINDS[number];

export type AiConnection = {
	id: string;
	name: string;
	provider: AiProviderKind;
	model: string;
	apiKey?: string;
	apiKeyEnv?: string;
	authToken?: string;
	authTokenEnv?: string;
	baseUrl?: string;
	providerName?: string;
	headers?: Record<string, string>;
	systemPrompt?: string;
	createdAt: string;
	updatedAt: string;
	meta?: Record<string, unknown>;
};

export type AiConnectionUpsertInput = Omit<AiConnection, "id" | "name" | "createdAt" | "updatedAt"> & {
	id?: string;
	name?: string;
	createdAt?: string;
	updatedAt?: string;
};

export type AiGenerateTextRequest = {
	connection?: string;
	model?: string;
	system?: string;
	prompt?: string;
	messages?: ModelMessage[];
	temperature?: number;
	maxOutputTokens?: number;
	stopSequences?: string[];
	tools?: any;
	toolChoice?: any;
	stopWhen?: any;
	providerOptions?: any;
	headers?: Record<string, string>;
	maxRetries?: number;
	timeout?: number | { totalMs?: number; stepMs?: number; chunkMs?: number };
};

export type AiKitOptions = {
	selectedConnectionId?: string | null;
	repositoryPath?: string;
};

function normalizeConnectionId(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/g, "")
		.replace(/-+$/g, "");

	return normalized.length > 0 ? normalized : `ai-${crypto.randomUUID()}`;
}

function resolveSecretValue(rawValue: string | undefined, envName: string | undefined): string | undefined {
	if (envName) {
		const environmentValue = process.env[envName];
		if (environmentValue && environmentValue.trim().length > 0) {
			return environmentValue;
		}
	}

	return rawValue;
}

function cloneHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!headers) {
		return undefined;
	}

	const normalizedEntries: Array<[string, string]> = [];
	for (const [rawKey, rawValue] of Object.entries(headers)) {
		const key = rawKey.trim();
		if (key.length === 0 || typeof rawValue !== "string") {
			continue;
		}

		normalizedEntries.push([key, rawValue]);
	}

	return Object.fromEntries(normalizedEntries);
}

export function formatAiConnectionLabel(connection: AiConnection): string {
	return `${connection.name} (${connection.id})`;
}

export class AiKit extends Kit {
	private readonly repositoryPath: string;
	private connections: AiConnection[] = [];
	private selectedConnectionId: string | null;

	constructor(options: AiKitOptions = {}) {
		super(AI_KIT_INFO);
		this.selectedConnectionId = options.selectedConnectionId ?? null;
		this.repositoryPath = options.repositoryPath ?? path.join(process.cwd(), ".iscan", "ai-connections.json");
	}

	protected override async onStart(_context: KitLifecycleContext): Promise<void> {
		try {
			await fs.mkdir(path.dirname(this.repositoryPath), { recursive: true });
			const raw = await fs.readFile(this.repositoryPath, "utf-8");
			const parsed = JSON.parse(raw);
			this.connections = Array.isArray(parsed) ? parsed as AiConnection[] : [];
		} catch {
			this.connections = [];
		}
	}

	getRepositoryPath(): string {
		return this.repositoryPath;
	}

	listConnections(): AiConnection[] {
		return [...this.connections].sort((left, right) => left.name.localeCompare(right.name));
	}

	getSelectedConnectionId(): string | null {
		return this.selectedConnectionId;
	}

	getSelectedConnection(): AiConnection | null {
		if (!this.selectedConnectionId) {
			return null;
		}

		return this.connections.find(connection => connection.id === this.selectedConnectionId) ?? null;
	}

	resolveConnectionOrNull(target: string): AiConnection | null {
		const normalizedTarget = target.trim();
		if (normalizedTarget.length === 0) {
			return null;
		}

		const byId = this.connections.find(connection => connection.id === normalizedTarget);
		if (byId) {
			return byId;
		}

		const byName = this.connections.filter(connection => connection.name === normalizedTarget);
		if (byName.length === 1) {
			return byName[0] ?? null;
		}

		if (byName.length > 1) {
			throw new Error(`AI connection target is ambiguous: ${normalizedTarget}`);
		}

		return null;
	}

	resolveConnection(target: string): AiConnection {
		const connection = this.resolveConnectionOrNull(target);
		if (connection) {
			return connection;
		}

		throw new Error(`AI connection '${target}' not found in ${this.repositoryPath}.`);
	}

	async saveConnection(input: AiConnectionUpsertInput): Promise<AiConnection> {
		const now = new Date().toISOString();
		const inputName = input.name?.trim();
		const existingConnection = input.id
			? this.connections.find(connection => connection.id === input.id)
			: inputName
				? this.connections.find(connection => connection.name === inputName)
				: undefined;
		const nextId = existingConnection?.id ?? normalizeConnectionId(input.id || inputName || `${input.provider}-${input.model}`);
		const nextName = inputName && inputName.length > 0 ? inputName : nextId;

		const nextConnection: AiConnection = {
			id: nextId,
			name: nextName,
			provider: input.provider,
			model: input.model.trim(),
			apiKey: input.apiKey?.trim() || undefined,
			apiKeyEnv: input.apiKeyEnv?.trim() || undefined,
			authToken: input.authToken?.trim() || undefined,
			authTokenEnv: input.authTokenEnv?.trim() || undefined,
			baseUrl: input.baseUrl?.trim() || undefined,
			providerName: input.providerName?.trim() || undefined,
			headers: cloneHeaders(input.headers),
			systemPrompt: input.systemPrompt?.trim() || undefined,
			createdAt: existingConnection?.createdAt ?? input.createdAt ?? now,
			updatedAt: input.updatedAt ?? now,
			meta: input.meta,
		};

		this.connections = existingConnection
			? this.connections.map(connection => connection.id === existingConnection.id ? nextConnection : connection)
			: [...this.connections, nextConnection];
		await this.persistRepository();
		this.selectedConnectionId = nextConnection.id;
		return nextConnection;
	}

	async deleteConnection(target: string): Promise<boolean> {
		const connection = this.resolveConnectionOrNull(target);
		if (!connection) {
			return false;
		}

		this.connections = this.connections.filter(candidate => candidate.id !== connection.id);
		if (this.selectedConnectionId === connection.id) {
			this.selectedConnectionId = null;
		}
		await this.persistRepository();
		return true;
	}

	selectConnection(target: string | null): AiConnection | null {
		if (target === null) {
			this.selectedConnectionId = null;
			return null;
		}

		const connection = this.resolveConnection(target);
		this.selectedConnectionId = connection.id;
		return connection;
	}

	async generateText(request: AiGenerateTextRequest) {
		const connection = this.resolveConnectionForRequest(request.connection);
		const model = this.createLanguageModel(connection, request.model);
		const mergedHeaders = {
			...(connection.headers ?? {}),
			...(request.headers ?? {}),
		};
		const callSettings = {
			model,
			system: request.system ?? connection.systemPrompt,
			temperature: request.temperature,
			maxOutputTokens: request.maxOutputTokens,
			stopSequences: request.stopSequences,
			tools: request.tools,
			toolChoice: request.toolChoice,
			stopWhen: request.stopWhen,
			providerOptions: request.providerOptions,
			headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
			maxRetries: request.maxRetries,
			timeout: request.timeout,
		};

		if (request.messages) {
			return await generateText({
				...callSettings,
				messages: request.messages,
			});
		}

		if (request.prompt !== undefined) {
			return await generateText({
				...callSettings,
				prompt: request.prompt,
			});
		}

		throw new Error("$ai generateText requires either prompt or messages.");
	}

	private resolveConnectionForRequest(target: string | undefined): AiConnection {
		if (target) {
			const connection = this.selectConnection(target);
			if (connection) {
				return connection;
			}
		}

		const selectedConnection = this.getSelectedConnection();
		if (selectedConnection) {
			return selectedConnection;
		}

		if (this.connections.length === 1) {
			const onlyConnection = this.connections[0];
			this.selectedConnectionId = onlyConnection?.id ?? null;
			if (onlyConnection) {
				return onlyConnection;
			}
		}

		if (this.connections.length === 0) {
			throw new Error(`$ai has no saved connections. Use $.kits.ai.connect({ name: "local", provider: "openai-compatible", model: "llama3.1" }) to create one.`);
		}

		throw new Error(`$ai requires a selected connection. Use $.kits.ai.list() or $.kits.ai.connect({ connection: "<id>" }).`);
	}

	private createLanguageModel(connection: AiConnection, overrideModel: string | undefined) {
		const modelId = overrideModel?.trim() || connection.model;
		const apiKey = resolveSecretValue(connection.apiKey, connection.apiKeyEnv);
		const authToken = resolveSecretValue(connection.authToken, connection.authTokenEnv);
		const headers = cloneHeaders(connection.headers);

		switch (connection.provider) {
			case "openai": {
				const openai = createOpenAI({
					apiKey,
					baseURL: connection.baseUrl,
					headers,
				});
				return openai(modelId);
			}

			case "openai-compatible": {
				if (!connection.baseUrl) {
					throw new Error(`AI connection '${connection.id}' requires baseUrl for openai-compatible providers.`);
				}

				const openaiCompatible = createOpenAI({
					apiKey,
					baseURL: connection.baseUrl,
					name: connection.providerName || connection.name || "openai-compatible",
					headers,
				});
				return openaiCompatible(modelId);
			}

			case "anthropic": {
				const anthropic = createAnthropic({
					apiKey,
					authToken,
					baseURL: connection.baseUrl,
					headers,
				});
				return anthropic(modelId);
			}

			case "google": {
				const google = createGoogleGenerativeAI({
					apiKey,
					baseURL: connection.baseUrl,
					headers,
					name: connection.providerName,
				});
				return google(modelId);
			}
		}
	}

	private async persistRepository(): Promise<void> {
		await fs.mkdir(path.dirname(this.repositoryPath), { recursive: true });
		await fs.writeFile(this.repositoryPath, JSON.stringify(this.connections, null, 2));
	}
}

export type { ModelMessage };