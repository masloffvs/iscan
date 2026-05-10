import type { BpkgKit } from "../../../kits/bpkg-kit";
import { createJsonResponse, createMethodNotAllowedResponse, readJsonBody } from "../http";
import {
  readVmPackageActionRequestBody,
  readVmPackageCreateRequestBody,
  readVmPackageInstallRequestBody,
  readVmPackagePrivilegeRequestBody,
} from "../parsers";

export async function handlePackageRoutes(
  request: Request,
  url: URL,
  ensureBpkgKit: () => Promise<BpkgKit>,
): Promise<Response | null> {
  if (url.pathname === "/vm/packages") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    const kit = await ensureBpkgKit();
    const snapshot = kit.inspect();

    return createJsonResponse({
      ok: true,
      result: {
        boxes: snapshot.boxes,
        defaultBoxId: snapshot.defaultBoxId,
        hostInfo: snapshot.hostInfo,
        supportedPackages: kit.listSupportedPackages(),
      },
    });
  }

  if (url.pathname === "/vm/packages/create") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageCreateRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const box = await kit.createBox(body);

    return createJsonResponse({ ok: true, result: { box } });
  }

  if (url.pathname === "/vm/packages/select") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageActionRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const box = await kit.selectDefaultBox(body.target);

    return createJsonResponse({ ok: true, result: { target: body.target, box } });
  }

  if (url.pathname === "/vm/packages/delete") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageActionRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const deleted = await kit.deleteBox(body.target);

    return createJsonResponse({
      ok: true,
      result: {
        target: deleted.target,
        defaultBoxId: deleted.defaultBoxId,
      },
    });
  }

  if (url.pathname === "/vm/packages/install") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackageInstallRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const installed = await kit.installSupportedPackages(body.packages, body.target);

    return createJsonResponse({
      ok: true,
      result: {
        target: installed.box.id,
        box: installed.box,
        packageIds: installed.packageIds,
        pacmanPackages: installed.pacmanPackages,
        paruPackages: installed.paruPackages,
      },
    });
  }

  if (url.pathname === "/vm/packages/privilege") {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse(["POST"]);
    }

    const body = readVmPackagePrivilegeRequestBody(await readJsonBody(request));
    const kit = await ensureBpkgKit();
    const { target, ...policy } = body;
    const box = await kit.setBoxPrivilege(target, policy);

    return createJsonResponse({ ok: true, result: { target: box.id, box } });
  }

  return null;
}
