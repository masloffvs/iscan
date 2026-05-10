import { formatAiConnectionLabel } from "../../kits";
import { createTextEntity } from "../../primitives";
import { InvalidParamsError } from "../errors";
import { defineExecutor, defineModule } from "../module";
import { createAiConnectionsReport, ensureAiKit, parseOptionalString } from "./ai-shared";

export type AiDeleteParams = {
	connection?: string;
};

function resolveDeleteTargetName(connection: { id: string; name: string }): string {
	return connection.name || connection.id;
}

export const aiDeleteModule = defineModule<AiDeleteParams>({
	id: "kits/ai/delete",
	category: "kits",
	description: "Delete an available $ai connection by id or unique name",
	consoleParams: [
		{
			name: "connection",
			detail: "Connection id or unique name. Defaults to the only available connection when exactly one exists.",
			example: "local-ollama",
			valueType: "string",
		},
	],
	executor: defineExecutor<AiDeleteParams>(async (context) => {
		const kit = await ensureAiKit(context);
		const target = parseOptionalString(context.params.connection, "connection");
		const resolved = target
			? kit.resolveConnection(target)
			: (() => {
				const connections = kit.listConnections();
				if (connections.length === 0) {
					throw new InvalidParamsError("$ai has no available connections to delete.");
				}

				if (connections.length > 1) {
					throw new InvalidParamsError("kits/ai/delete requires connection=<id|name> when multiple AI connections exist.");
				}

				return connections[0];
			})();

		const deleted = await kit.deleteConnection(resolved?.id ?? target ?? "");
		if (!deleted) {
			throw new InvalidParamsError(`Failed to delete AI connection '${target ?? resolveDeleteTargetName(resolved)}'.`);
		}

		return [
			createTextEntity([`$ai deleted ${formatAiConnectionLabel(resolved)}`], { tone: "info" }),
			...createAiConnectionsReport(kit),
		];
	}),
}).useDefault("connection");