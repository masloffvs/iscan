import { $axios } from "../axios";
import { Kit, type KitInfo, type KitLifecycleContext } from "./kit";

export const OLLAMA_KIT_ID = "ollama";

const OLLAMA_KIT_INFO: KitInfo = {
	id: OLLAMA_KIT_ID,
	name: "OllamaKit",
	category: "ai",
	description: "Reusable Ollama client for local LLM inference.",
	tags: ["ollama", "ai", "llm", "http"],
};

export type OllamaKitOptions = {
	baseUrl: string;
	defaultModel?: string;
};

export type OllamaModel = {
	name: string;
	modified_at: string;
	size: number;
	digest: string;
	details: {
		format: string;
		family: string;
		families: string[] | null;
		parameter_size: string;
		quantization_level: string;
	};
};

export type OllamaGenerateRequest = {
	model?: string;
	prompt: string;
	system?: string;
	template?: string;
	context?: number[];
	stream?: boolean;
	raw?: boolean;
	format?: "json" | string;
	options?: Record<string, unknown>;
};

export type OllamaGenerateResponse = {
	model: string;
	created_at: string;
	response: string;
	done: boolean;
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
};

export type OllamaChatMessage = {
	role: "system" | "user" | "assistant";
	content: string;
	images?: string[];
};

export type OllamaChatRequest = {
	model?: string;
	messages: OllamaChatMessage[];
	stream?: boolean;
	format?: "json" | string;
	options?: Record<string, unknown>;
};

export type OllamaChatResponse = {
	model: string;
	created_at: string;
	message: OllamaChatMessage;
	done: boolean;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
};

export class OllamaKit extends Kit {
	private readonly baseUrl: string;
	private readonly defaultModel: string | undefined;
	private models: OllamaModel[] = [];

	constructor(options: OllamaKitOptions) {
		super(OLLAMA_KIT_INFO);
		this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
		this.defaultModel = options.defaultModel;
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	getDefaultModel(): string | undefined {
		return this.defaultModel;
	}

	async listModels(): Promise<OllamaModel[]> {
		const response = await $axios.get<{ models: OllamaModel[] }>(`${this.baseUrl}/api/tags`);
		this.models = response.data.models;
		return this.models;
	}

	async generate(request: OllamaGenerateRequest): Promise<OllamaGenerateResponse> {
		const response = await $axios.post<OllamaGenerateResponse>(`${this.baseUrl}/api/generate`, {
			...request,
			model: request.model ?? this.defaultModel,
			stream: request.stream ?? false,
		});
		return response.data;
	}

	async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
		const response = await $axios.post<OllamaChatResponse>(`${this.baseUrl}/api/chat`, {
			...request,
			model: request.model ?? this.defaultModel,
			stream: request.stream ?? false,
		});
		return response.data;
	}

	override async onStart(_context: KitLifecycleContext): Promise<void> {
		try {
			await this.listModels();
		} catch (error) {
			// Don't fail start if Ollama is not reachable immediately, but log it
			console.warn(`OllamaKit: Failed to reach Ollama at ${this.baseUrl}:`, error instanceof Error ? error.message : String(error));
		}
	}
}
