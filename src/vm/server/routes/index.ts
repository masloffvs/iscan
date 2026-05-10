import type { CloakKit } from "../../../kits/cloak-kit";
import type { AiKit } from "../../../kits/ai-kit";
import type { BpkgKit } from "../../../kits/bpkg-kit";
import type { ProxyKit } from "../../../kits/proxy-kit";
import type { SettingsKit } from "../../../kits";
import type { UaKit } from "../../../kits/ua-kit";
import type { ModulePaletteCommand } from "../../../modules/module";
import { createJsonResponse, createMethodNotAllowedResponse } from "../http";
import type { VmServerSessions } from "../sessions";
import { handleFilesRoutes } from "./files";
import { handleBrowserRoutes } from "./browsers";
import { handleCommandRoutes } from "./commands";
import { handleHttpClientRoutes } from "./http-client";
import { handlePackageRoutes } from "./packages";
import { handleVmCoreRoutes } from "./vm-core";
import { handleVmFsRoutes } from "./vm-fs";
import { handleAiAgentRoutes } from "./ai-agent";
import { handleAuditRoutes } from "./audit";
import { handleSettingsRoutes } from "./settings";
import { handleZoomEyeRoutes } from "./zoomeye";

export async function handleVmServerRequest(
  request: Request,
  url: URL,
  sessions: VmServerSessions,
  ensureAiKit: () => Promise<AiKit>,
  ensureCloakKit: () => Promise<CloakKit>,
  ensureBpkgKit: () => Promise<BpkgKit>,
  ensureProxyKit: () => Promise<ProxyKit>,
  ensureUserAgentKit: () => Promise<UaKit>,
  ensureSettingsKit: () => Promise<SettingsKit>,
  listPaletteCommands: () => Promise<ModulePaletteCommand[]>,
  runPaletteCommand: (id: string, params?: unknown) => Promise<unknown>,
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

  const commandResponse = await handleCommandRoutes(request, url, listPaletteCommands, runPaletteCommand);
  if (commandResponse) {
    return commandResponse;
  }

  const httpClientResponse = await handleHttpClientRoutes(request, url);
  if (httpClientResponse) {
    return httpClientResponse;
  }

  const aiAgentResponse = await handleAiAgentRoutes(request, url, ensureAiKit);
  if (aiAgentResponse) {
    return aiAgentResponse;
  }

  const auditResponse = await handleAuditRoutes(request, url, ensureCloakKit);
  if (auditResponse) {
    return auditResponse;
  }

  const settingsResponse = await handleSettingsRoutes(request, url, ensureSettingsKit);
  if (settingsResponse) {
    return settingsResponse;
  }

  const zoomEyeResponse = await handleZoomEyeRoutes(request, url, ensureCloakKit);
  if (zoomEyeResponse) {
    return zoomEyeResponse;
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
