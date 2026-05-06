import { logger } from "../../logger";
import { CloakKit } from "../../kits/cloak-kit";
import { BpkgKit } from "../../kits/bpkg-kit";
import { ProxyKit } from "../../kits/proxy-kit";
import { MICROLINK_UA_KIT_ID, MicrolinkUaKit } from "../../kits/microlink-ua-kit";
import type { ModuleRuntime } from "../../modules";
import { buildErrorMessage, createErrorResponse, createJsonResponse, createMethodNotAllowedResponse } from "./http";
import { VmServerSessions } from "./sessions";
import {
  readOptionalPositiveIntegerQueryParam,
  readOptionalPrivilegeLevelQueryParam,
  readVmPackageTerminalClientMessage,
} from "./parsers";
import { startVmPackageTerminalStream } from "./websocket";
import { handleVmServerRequest } from "./routes/index";
import {
  VM_BROWSER_STREAM_BINARY_KIND_AUDIO,
  VM_BROWSER_STREAM_BINARY_KIND_IMAGE,
  type VmServerSocketData,
} from "./types";

export const DEFAULT_VM_SERVER_PORT = 36665;

const VM_SERVER_IDLE_TIMEOUT_SECONDS = 120;

export async function startVmServer(moduleRuntime: ModuleRuntime<any>, port = DEFAULT_VM_SERVER_PORT): Promise<never> {
  const sessions = new VmServerSessions(moduleRuntime);
  let cloakKit: CloakKit | null = moduleRuntime.getCloakKit();
  let bpkgKit: BpkgKit | null = moduleRuntime.getKit<BpkgKit>("bpkg");
  let proxyKit: ProxyKit | null = moduleRuntime.getProxyKit();
  let userAgentKit: MicrolinkUaKit | null = moduleRuntime.getKit<MicrolinkUaKit>(MICROLINK_UA_KIT_ID);

  async function ensureCloakKit(): Promise<CloakKit> {
    cloakKit = cloakKit ?? await moduleRuntime.attachKit(new CloakKit(), { reason: "browser management" });
    return cloakKit;
  }

  async function ensureBpkgKit(): Promise<BpkgKit> {
    bpkgKit = bpkgKit ?? await moduleRuntime.attachKit(new BpkgKit(), { reason: "package box management" });
    return bpkgKit;
  }

  async function ensureProxyKit(): Promise<ProxyKit> {
    proxyKit = proxyKit ?? await moduleRuntime.attachKit(new ProxyKit(), { reason: "browser profile proxy selection" });
    return proxyKit;
  }

  async function ensureUserAgentKit(): Promise<MicrolinkUaKit> {
    userAgentKit = userAgentKit ?? await moduleRuntime.attachKit(new MicrolinkUaKit(), { reason: "user agent management" });
    return userAgentKit;
  }

  const server = Bun.serve<VmServerSocketData>({
    port,
    idleTimeout: VM_SERVER_IDLE_TIMEOUT_SECONDS,
    async fetch(request, server) {
      const startedAt = Date.now();
      const url = new URL(request.url);

      if (url.pathname === "/vm/browsers/stream") {
        if (request.method !== "GET") {
          return createMethodNotAllowedResponse(["GET"]);
        }

        try {
          const target = url.searchParams.get("target")?.trim();
          if (!target) {
            return createJsonResponse(
              { ok: false, error: "Browser stream request requires a non-empty `target`." },
              { status: 400 },
            );
          }

          const quality = readOptionalPositiveIntegerQueryParam(url, "quality", { min: 1, max: 100 });
          const everyNthFrame = readOptionalPositiveIntegerQueryParam(url, "everyNthFrame", { min: 1, max: 10 });

          const upgraded = server.upgrade(request, {
            data: { kind: "browser-stream", target, quality, everyNthFrame },
          });

          if (upgraded) {
            logger.info(
              { method: request.method, path: url.pathname, status: 101, durationMs: Date.now() - startedAt, target, quality, everyNthFrame },
              "VM browser stream upgraded",
            );
            return;
          }

          return createJsonResponse(
            { ok: false, error: "Failed to upgrade browser stream websocket." },
            { status: 400 },
          );
        } catch (error) {
          return createErrorResponse(error);
        }
      }

      if (url.pathname === "/vm/packages/terminal/stream") {
        if (request.method !== "GET") {
          return createMethodNotAllowedResponse(["GET"]);
        }

        try {
          const target = url.searchParams.get("target")?.trim();
          if (!target) {
            return createJsonResponse(
              { ok: false, error: "Package terminal request requires a non-empty `target`." },
              { status: 400 },
            );
          }

          const cols = readOptionalPositiveIntegerQueryParam(url, "cols", { min: 40, max: 240 });
          const privilegeLevel = readOptionalPrivilegeLevelQueryParam(url, "privilegeLevel");
          const rows = readOptionalPositiveIntegerQueryParam(url, "rows", { min: 12, max: 120 });

          const upgraded = server.upgrade(request, {
            data: { kind: "package-terminal", target, cols, privilegeLevel, rows },
          });

          if (upgraded) {
            logger.info(
              { method: request.method, path: url.pathname, status: 101, durationMs: Date.now() - startedAt, target, cols, privilegeLevel, rows },
              "VM package terminal stream upgraded",
            );
            return;
          }

          return createJsonResponse(
            { ok: false, error: "Failed to upgrade package terminal websocket." },
            { status: 400 },
          );
        } catch (error) {
          return createErrorResponse(error);
        }
      }

      let response: Response;
      try {
        response = await handleVmServerRequest(request, url, sessions, ensureCloakKit, ensureBpkgKit, ensureProxyKit, ensureUserAgentKit);
      } catch (error) {
        logger.error({ error }, "VM server request failed");
        response = createErrorResponse(error);
      }

      logger.info(
        { method: request.method, path: url.pathname, status: response.status, durationMs: Date.now() - startedAt },
        "VM server request",
      );

      return response;
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === "browser-stream") {
          logger.info({ target: ws.data.target }, "VM browser stream opened");

          void (async () => {
            let tabsIntervalId: ReturnType<typeof setInterval> | null = null;
            try {
              const kit = await ensureCloakKit();
              let lastTabsSignature: string | null = null;

              const sendTabsSnapshot = async () => {
                if (ws.data.kind !== "browser-stream") {
                  return;
                }

                const tabs = await kit.listProfileTabs(ws.data.target);
                const nextSignature = JSON.stringify(tabs);
                if (nextSignature === lastTabsSignature) {
                  return;
                }

                lastTabsSignature = nextSignature;
                ws.send(JSON.stringify({ type: "tabs", tabs }));
              };

              const screencast = await kit.startProfileScreencast(ws.data.target, {
                format: "jpeg",
                quality: ws.data.quality,
                everyNthFrame: ws.data.everyNthFrame,
                onFrame(frame) {
                  const payload = new Uint8Array(frame.bytes.length + 1);
                  payload[0] = VM_BROWSER_STREAM_BINARY_KIND_IMAGE;
                  payload.set(frame.bytes, 1);
                  ws.send(payload);
                },
                onAudioChunk(chunk) {
                  const payload = new Uint8Array(chunk.bytes.length + 1);
                  payload[0] = VM_BROWSER_STREAM_BINARY_KIND_AUDIO;
                  payload.set(chunk.bytes, 1);
                  ws.send(payload);
                },
              });

              tabsIntervalId = setInterval(() => {
                void sendTabsSnapshot().catch(() => {});
              }, 900);

              if (ws.data.isClosed) {
                if (tabsIntervalId) {
                  clearInterval(tabsIntervalId);
                }
                await screencast.stop();
                return;
              }

              ws.data.stopStream = async () => {
                if (tabsIntervalId) {
                  clearInterval(tabsIntervalId);
                  tabsIntervalId = null;
                }
                await screencast.stop();
              };

              ws.send(JSON.stringify({
                type: "ready",
                transport: "screencast",
                audioMimeType: screencast.audioMimeType,
                mimeType: "image/jpeg",
                quality: ws.data.quality ?? 35,
                everyNthFrame: ws.data.everyNthFrame ?? 1,
              }));

              await sendTabsSnapshot();
            } catch (error) {
              const message = buildErrorMessage(error);
              try {
                ws.send(JSON.stringify({ type: "error", error: message }));
              } catch {
                // Ignore send failures on closed sockets.
              }
              ws.close(1011, "Browser stream failed");
            }
          })();

          return;
        }

        logger.info(
          { target: ws.data.target, cols: ws.data.cols, privilegeLevel: ws.data.privilegeLevel, rows: ws.data.rows },
          "VM package terminal opened",
        );

        void startVmPackageTerminalStream(ws, ensureBpkgKit).catch((error) => {
          const message = buildErrorMessage(error);
          try {
            ws.send(JSON.stringify({ type: "error", error: message }));
          } catch {
            // Ignore send failures on closed sockets.
          }
          ws.close(1011, "Package terminal failed");
        });
      },
      message(ws, message) {
        if (ws.data.kind !== "package-terminal") {
          return;
        }

        try {
          const payload = readVmPackageTerminalClientMessage(message);
          if (payload.type === "input") {
            void ws.data.writeTerminal?.(payload.data);
            return;
          }

          ws.data.cols = payload.cols ?? ws.data.cols;
          ws.data.rows = payload.rows ?? ws.data.rows;
        } catch (error) {
          try {
            ws.send(JSON.stringify({ type: "error", error: buildErrorMessage(error) }));
          } catch {
            // Ignore send failures on closed sockets.
          }
        }
      },
      close(ws) {
        ws.data.isClosed = true;
        if (ws.data.kind === "browser-stream") {
          const stopStream = ws.data.stopStream;
          ws.data.stopStream = undefined;
          logger.info({ target: ws.data.target }, "VM browser stream closed");
          void stopStream?.();
          return;
        }

        const closeTerminal = ws.data.closeTerminal;
        ws.data.closeTerminal = undefined;
        ws.data.writeTerminal = undefined;
        logger.info({ target: ws.data.target }, "VM package terminal closed");
        void closeTerminal?.();
      },
    },
  });

  logger.info({ port: server.port, idleTimeoutSeconds: VM_SERVER_IDLE_TIMEOUT_SECONDS }, "VM server started");

  return await new Promise<never>(() => {});
}
