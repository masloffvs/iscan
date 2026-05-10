import { createTextEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule } from "../module";
import { createAiConnectionsReport, ensureAiKit, parseOptionalString } from "./ai-shared";

export type AiSelectParams = {
	connection?: string;
};

export const aiSelectModule = defineModule<AiSelectParams>({
	id: "kits/ai/select",
	category: "kits",
	description: "Select an available $ai connection for the current Activity",
	consoleParams: [
		{
			name: "connection",
			detail: "Connection id or unique name. Defaults to the only available connection when exactly one exists.",
			example: "local-ollama",
			valueType: "string",
		},
	],
	executor: defineExecutor<AiSelectParams>(async (context) => {
		const kit = await ensureAiKit(context);
		const target = parseOptionalString(context.params.connection, "connection");
		let connection;

		if (target) {
			connection = kit.selectConnection(target);
		} else {
			const connections = kit.listConnections();
			if (connections.length === 0) {
				throw new InvalidParamsError("$ai has no available connections. Create one with $.kits.ai.create({ provider: \"openai-compatible\", model: \"llama3.1\" }).");
			}

			if (connections.length > 1) {
				throw new InvalidParamsError("kits/ai/select requires connection=<id|name> when multiple AI connections exist.");
			}

			connection = kit.selectConnection(connections[0]?.id ?? "");
		}

		if (!connection) {
			throw new InvalidParamsError("Failed to resolve the requested AI connection.");
		}

		return [
			createTextEntity([`$ai selected ${connection.name}`], { tone: "info" }),
			...createAiConnectionsReport(kit),
		];
	}),
}).useDefault("connection");