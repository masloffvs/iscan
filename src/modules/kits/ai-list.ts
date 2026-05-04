import { defineExecutor, defineModule } from "../module";
import { createTextEntity } from "../../primitives";
import { ensureAiKit, createAiConnectionsReport, parseOptionalString } from "./ai-shared";

export type AiListParams = {
	connection?: string;
};

export const aiListModule = defineModule<AiListParams>({
	id: "kits/ai/list",
	category: "kits",
	description: "List saved $ai connections and optionally select one for the current Activity",
	consoleParams: [
		{
			name: "connection",
			detail: "Optional connection id or unique name to select before listing",
			example: "local-ollama",
			valueType: "string",
		},
	],
	executor: defineExecutor<AiListParams>(async (context) => {
		const kit = await ensureAiKit(context);
		const connectionTarget = parseOptionalString(context.params.connection, "connection");

		if (connectionTarget) {
			const connection = kit.selectConnection(connectionTarget);
			return [
				createTextEntity([`$ai selected ${connection?.name ?? connectionTarget}`], { tone: "info" }),
				...createAiConnectionsReport(kit),
			];
		}

		return createAiConnectionsReport(kit);
	}),
}).useDefault("connection");