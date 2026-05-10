import type { SettingsKit } from "../../../kits";
import {
  createJsonResponse,
  createMethodNotAllowedResponse,
  ensureRecordBody,
  readJsonBody,
  VmServerHttpError,
} from "../http";

type EnsureSettingsKit = () => Promise<SettingsKit>;

function readSettingId(body: Record<string, unknown>): string {
  const rawId = body.id;
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    throw new VmServerHttpError(400, "Request body field `id` must be a non-empty string.");
  }

  return rawId.trim();
}

export async function handleSettingsRoutes(
  request: Request,
  url: URL,
  ensureSettingsKit: EnsureSettingsKit,
): Promise<Response | null> {
  if (url.pathname === "/vm/settings") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const settingsKit = await ensureSettingsKit();
    return createJsonResponse({
      ok: true,
      result: await settingsKit.listCatalog(),
    });
  }

  if (url.pathname === "/vm/settings/set") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    const settingsKit = await ensureSettingsKit();
    const id = readSettingId(body);
    const value = await settingsKit.set(id, body.value);
    return createJsonResponse({
      ok: true,
      result: { value },
    });
  }

  if (url.pathname === "/vm/settings/reset") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = ensureRecordBody(await readJsonBody(request));
    const settingsKit = await ensureSettingsKit();
    const id = readSettingId(body);
    const deleted = await settingsKit.reset(id);
    return createJsonResponse({
      ok: true,
      result: {
        id,
        deleted,
        value: await settingsKit.readResolved(id),
      },
    });
  }

  return null;
}