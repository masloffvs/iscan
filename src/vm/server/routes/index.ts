import type { CloakKit } from "../../../kits/cloak-kit";
import type { BpkgKit } from "../../../kits/bpkg-kit";
import type { ProxyKit } from "../../../kits/proxy-kit";
import type { MicrolinkUaKit } from "../../../kits/microlink-ua-kit";
import { createJsonResponse, createMethodNotAllowedResponse } from "../http";
import type { VmServerSessions } from "../sessions";
import { handleFilesRoutes } from "./files";
import { handleBrowserRoutes } from "./browsers";
import { handlePackageRoutes } from "./packages";
import { handleVmCoreRoutes } from "./vm-core";
import { handleVmFsRoutes } from "./vm-fs";

export async function handleVmServerRequest(
  request: Request,
  url: URL,
  sessions: VmServerSessions,
  ensureCloakKit: () => Promise<CloakKit>,
  ensureBpkgKit: () => Promise<BpkgKit>,
  ensureProxyKit: () => Promise<ProxyKit>,
  ensureUserAgentKit: () => Promise<MicrolinkUaKit>,
): Promise<Response> {
  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse(["GET"]);
    }

    return createJsonResponse({ ok: true, result: { status: "ready" } });
  }

  const filesResponse = await handleFilesRoutes(request, url, sessions);
  if (filesResponse) {
    return filesResponse;
  }

  const browsersResponse = await handleBrowserRoutes(request, url, ensureCloakKit, ensureProxyKit, ensureUserAgentKit);
  if (browsersResponse) {
    return browsersResponse;
  }

  const packagesResponse = await handlePackageRoutes(request, url, ensureBpkgKit);
  if (packagesResponse) {
    return packagesResponse;
  }

  const fsCoreResponse = await handleVmFsRoutes(request, url, sessions);
  if (fsCoreResponse) {
    return fsCoreResponse;
  }

  const vmCoreResponse = await handleVmCoreRoutes(request, url, sessions);
  if (vmCoreResponse) {
    return vmCoreResponse;
  }

  return createJsonResponse(
    { ok: false, error: "Not found." },
    { status: 404 },
  );
}
