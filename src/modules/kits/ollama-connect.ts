import { OllamaKit } from "../../kits/ollama-kit";
import { createTableEntity, createTextEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule, type ModuleConsoleParam } from "../module";

export type OllamaConnectParams = {
	url?: string;
	model?: string;
};

const OLLAMA_CONNECT_CONSOLE_PARAMS: readonly ModuleConsoleParam[] = [
	{
		name: "url",
		detail: "Base URL of the Ollama server.",
		valueType: "string",
		example: "url=http://127.0.0.1:11434",
	},
	{
		name: "model",
		detail: "Default model name to reuse after connecting.",
		valueType: "string",
		example: "model=llama3.1",
	},
];

const executor = defineExecutor<OllamaConnectParams>(async ({ params, runtime }) => {
	const url = params.url ?? "http://127.0.0.1:11434";
	const kit = new OllamaKit({
		baseUrl: url,
		defaultModel: params.model,
	});

	const connectedKit = await runtime.attachKit(kit, {
		reason: "module:kits/ollama-connect",
	});

	const models = await connectedKit.listModels();

	const entities = [
		createTextEntity([
			`OllamaKit connected`,
			`URL: ${connectedKit.getBaseUrl()}`,
			`Default Model: ${connectedKit.getDefaultModel() ?? "<not set>"}`,
		], { tone: "info" }),
	];

	if (models.length > 0) {
		entities.push(createTableEntity(
			[
				{ key: "name", header: "Model Name" },
				{ key: "parameter_size", header: "Params" },
				{ key: "quantization_level", header: "Quant" },
			],
			models.map(m => ({
				name: m.name,
				parameter_size: m.details.parameter_size,
				quantization_level: m.details.quantization_level,
			})),
			{ title: "Available Models" }
		));
	}

	return entities;
});

export const ollamaConnectModule = defineModule({
	id: "kits/ollama-connect",
	aliases: ["kit/ollama-connect", "ollama"],
	category: "kits",
	description: "Connect to a local or remote Ollama instance",
	consoleParams: OLLAMA_CONNECT_CONSOLE_PARAMS,
	executor,
}).useDefault("url");
