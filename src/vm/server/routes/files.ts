import { listIsbFiles } from "../../isb";
import { createJsonResponse, createMethodNotAllowedResponse, readJsonBody } from "../http";
import {
  readVmFileRequestBody,
  readVmMoveFileRequestBody,
} from "../parsers";
import type { VmServerSessions } from "../sessions";

export async function handleFilesRoutes(
  request: Request,
  url: URL,
  sessions: VmServerSessions,
): Promise<Response | null> {
  if (url.pathname === "/vm/files") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    return createJsonResponse({
      ok: true,
      result: {
        files: await listIsbFiles(),
      },
    });
  }

  if (url.pathname === "/vm/files/create") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmFileRequestBody(await readJsonBody(request));
    const created = await sessions.createFileSession(body.path);

    return createJsonResponse(
      {
        ok: true,
        code: created.session.code,
        created: true,
        relativePath: created.session.relativePath,
        snapshotPath: created.session.vm.getSnapshotPath(),
        result: {
          notebook: created.session.notebook,
        },
      },
      {
        status: 201,
      },
    );
  }

  if (url.pathname === "/vm/files/open") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmFileRequestBody(await readJsonBody(request));
    const opened = await sessions.openFileSession(body.path);

    return createJsonResponse({
      ok: true,
      code: opened.session.code,
      created: false,
      relativePath: opened.session.relativePath,
      snapshotPath: opened.session.vm.getSnapshotPath(),
      result: {
        notebook: opened.session.notebook,
      },
    });
  }

  if (url.pathname === "/vm/files/delete") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmFileRequestBody(await readJsonBody(request));
    const deleted = await sessions.deleteFile(body.path);

    return createJsonResponse({
      ok: true,
      result: deleted,
    });
  }

  if (url.pathname === "/vm/files/move") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmMoveFileRequestBody(await readJsonBody(request));
    const moved = await sessions.moveFile(body.path, body.targetPath);

    return createJsonResponse({
      ok: true,
      result: moved,
    });
  }

  return null;
}
