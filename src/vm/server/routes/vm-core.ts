import { createJsonResponse, createMethodNotAllowedResponse, readJsonBody, VmServerHttpError } from "../http";
import {
  normalizeVmCode,
  readVmEvalRequestBody,
  readVmCompletionRequestBody,
  readVmInitRequestBody,
  readVmSaveFileRequestBody,
} from "../parsers";
import { serializeVmResult } from "../utils";
import type { VmServerSessions } from "../sessions";

export async function handleVmCoreRoutes(
  request: Request,
  url: URL,
  sessions: VmServerSessions,
): Promise<Response | null> {
  if (url.pathname === "/vm/init") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmInitRequestBody(await readJsonBody(request));
    const initialized = body.code
      ? await sessions.initializeExistingSession(body.code)
      : await sessions.createNewSession();

    return createJsonResponse(
      {
        ok: true,
        code: initialized.session.code,
        created: initialized.created,
        snapshotPath: initialized.session.vm.getSnapshotPath(),
      },
      {
        status: initialized.created ? 201 : 200,
      },
    );
  }

  const evalMatch = url.pathname.match(/^\/vm\/([^/]+)\/eval$/u);
  if (evalMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(evalMatch[1] ?? ""));
    const body = readVmEvalRequestBody(await readJsonBody(request));
    const result = await sessions.evaluate(vmCode, body.code, body.language);

    return createJsonResponse({
      ok: true,
      result: serializeVmResult(result),
    });
  }

  const completionsMatch = url.pathname.match(/^\/vm\/([^/]+)\/completions$/u);
  if (completionsMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(completionsMatch[1] ?? ""));
    const body = readVmCompletionRequestBody(await readJsonBody(request));
    const items = await sessions.getNotebookCompletions(vmCode, body.fragment, body.language);

    return createJsonResponse({
      ok: true,
      result: { items },
    });
  }

  const saveMatch = url.pathname.match(/^\/vm\/([^/]+)\/file$/u);
  if (saveMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(saveMatch[1] ?? ""));
    const session = await sessions.initializeExistingSession(vmCode);
    if (!session.session.relativePath) {
      throw new VmServerHttpError(400, `VM code ${vmCode} is not bound to an ISB file.`);
    }

    const body = readVmSaveFileRequestBody(
      await readJsonBody(request),
      session.session.relativePath,
    );
    const savedSession = await sessions.saveFileSession(vmCode, body.notebook);

    return createJsonResponse({
      ok: true,
      code: savedSession.code,
      created: false,
      relativePath: savedSession.relativePath,
      snapshotPath: savedSession.vm.getSnapshotPath(),
      result: {
        notebook: savedSession.notebook,
      },
    });
  }

  const restartMatch = url.pathname.match(/^\/vm\/([^/]+)\/restart$/u);
  if (restartMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(restartMatch[1] ?? ""));
    const restarted = await sessions.restartFileSession(vmCode);

    return createJsonResponse({
      ok: true,
      code: restarted.code,
      created: false,
      relativePath: restarted.relativePath,
      snapshotPath: restarted.vm.getSnapshotPath(),
      result: {
        notebook: restarted.notebook,
      },
    });
  }

  const reloadMatch = url.pathname.match(/^\/vm\/([^/]+)\/reload$/u);
  if (reloadMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(reloadMatch[1] ?? ""));
    const reloaded = await sessions.reloadFileSession(vmCode);

    return createJsonResponse({
      ok: true,
      code: reloaded.code,
      created: false,
      relativePath: reloaded.relativePath,
      snapshotPath: reloaded.vm.getSnapshotPath(),
      result: {
        notebook: reloaded.notebook,
      },
    });
  }

  return null;
}
