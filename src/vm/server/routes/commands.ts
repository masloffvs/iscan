import type { ModulePaletteCommand } from "../../../modules/module";
import { createJsonResponse, createMethodNotAllowedResponse, ensureRecordBody, readJsonBody, VmServerHttpError } from "../http";

type RunPaletteCommand = (id: string, params?: unknown) => Promise<unknown>;
type ListPaletteCommands = () => Promise<ModulePaletteCommand[]>;

function normalizeCommandResult(value: unknown): unknown {
	if (value === undefined) {
		return null;
	}

	if (
		value === null
		|| typeof value === "string"
		|| typeof value === "number"
		|| typeof value === "boolean"
	) {
		return value;
	}

	try {
		return JSON.parse(JSON.stringify(value)) as unknown;
	} catch {
		return {
			summary: value instanceof Error ? value.message : String(value),
		};
	}
}

export async function handleCommandRoutes(
	request: Request,
	url: URL,
	listPaletteCommands: ListPaletteCommands,
	runPaletteCommand: RunPaletteCommand,
): Promise<Response | null> {
	if (url.pathname === "/vm/commands") {
		if (request.method !== "GET") {
			return createMethodNotAllowedResponse(["GET"]);
		}

		return createJsonResponse({
			ok: true,
			result: {
				commands: await listPaletteCommands(),
			},
		});
	}

	if (url.pathname === "/vm/commands/run") {
		if (request.method !== "POST") {
			return createMethodNotAllowedResponse(["POST"]);
		}

		const body = ensureRecordBody(await readJsonBody(request));
		const rawId = body.id;
		if (typeof rawId !== "string" || rawId.trim().length === 0) {
			throw new VmServerHttpError(400, "Request body field `id` must be a non-empty string.");
		}

		const id = rawId.trim();
		const startedAt = Date.now();
		const result = await runPaletteCommand(id, body.params);
		return createJsonResponse({
			ok: true,
			result: {
				commandId: id,
				durationMs: Date.now() - startedAt,
				result: normalizeCommandResult(result),
			},
		});
	}

	return null;
}