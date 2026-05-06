import { createJsonResponse, createMethodNotAllowedResponse, readJsonBody } from "../http";
import {
  normalizeVmCode,
  readRequiredQueryPath,
  readVmFileRequestBody,
  readVmFsDeleteRequestBody,
  readVmFsWriteRequestBody,
} from "../parsers";
import type { VmServerSessions } from "../sessions";

export async function handleVmFsRoutes(
  request: Request,
  url: URL,
  sessions: VmServerSessions,
): Promise<Response | null> {
  const fsListMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/list$/u);
  if (fsListMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsListMatch[1] ?? ""));
    const result = await sessions.listFsDirectory(vmCode, readRequiredQueryPath(url));
    return createJsonResponse({ ok: true, result });
  }

  const fsReadMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/read$/u);
  if (fsReadMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsReadMatch[1] ?? ""));
    const result = await sessions.readFsFile(vmCode, readRequiredQueryPath(url));
    return createJsonResponse({ ok: true, result });
  }

  const fsWriteMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/write$/u);
  if (fsWriteMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsWriteMatch[1] ?? ""));
    const body = readVmFsWriteRequestBody(await readJsonBody(request));
    const result = await sessions.writeFsFile(vmCode, body.path, {
      content: body.content,
      contentBase64: body.contentBase64,
    });
    return createJsonResponse({ ok: true, result });
  }

  const fsMkdirMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/mkdir$/u);
  if (fsMkdirMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsMkdirMatch[1] ?? ""));
    const body = readVmFileRequestBody(await readJsonBody(request));
    const result = await sessions.mkdirFsDirectory(vmCode, body.path);
    return createJsonResponse({ ok: true, result });
  }

  const fsDeleteMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/delete$/u);
  if (fsDeleteMatch) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsDeleteMatch[1] ?? ""));
    const body = readVmFsDeleteRequestBody(await readJsonBody(request));
    const result = await sessions.deleteFsEntry(vmCode, body.path, { recursive: body.recursive });
    return createJsonResponse({ ok: true, result });
  }

  const fsDownloadMatch = url.pathname.match(/^\/vm\/([^/]+)\/fs\/download$/u);
  if (fsDownloadMatch) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const vmCode = normalizeVmCode(decodeURIComponent(fsDownloadMatch[1] ?? ""));
    const result = await sessions.downloadFsFile(vmCode, readRequiredQueryPath(url));

    return new Response(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${result.name}"`,
      },
    });
  }

  return null;
}
