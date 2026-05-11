import { logger } from "../../logger";
import { AiKit } from "../../kits/ai-kit";
import { CloakKit } from "../../kits/cloak-kit";
import { BpkgKit } from "../../kits/bpkg-kit";
import { ProxyKit } from "../../kits/proxy-kit";
import { $settings, SETTINGS_KIT_ID, type SettingsKit } from "../../kits";
import { UA_KIT_ID, UaKit } from "../../kits/ua-kit";
import type { ModuleRuntime } from "../../modules";
import { buildErrorMessage, createErrorResponse, createJsonResponse, createMethodNotAllowedResponse } from "./http";
import { VmServerSessions } from "./sessions";
import {
  normalizeVmCode,
  readVmBrowserStreamClientMessage,
  readOptionalPositiveIntegerQueryParam,
  readOptionalPrivilegeLevelQueryParam,
  readVmExecutionStreamClientMessage,
  readVmInspectorStreamClientMessage,
  readVmPackageTerminalClientMessage,
} from "./parsers";
import { startVmInspectorStream, startVmPackageTerminalStream } from "./websocket";
import { handleVmServerRequest } from "./routes/index";
import {
  VM_BROWSER_STREAM_BINARY_KIND_IMAGE,
  type VmServerSocketData,
} from "./types";
import { VmBrowserAudioStreamManager } from "./browser-audio";

export const DEFAULT_VM_SERVER_PORT = 36665;

const VM_SERVER_IDLE_TIMEOUT_SECONDS = 120;
const VM_BROWSER_STREAM_STALL_TIMEOUT_MS = 3000;

export async function startVmServer(moduleRuntime: ModuleRuntime<any>, port = DEFAULT_VM_SERVER_PORT): Promise<never> {
  process.env.ISCAN_CLOAK_PULSE_SINK = process.env.ISCAN_CLOAK_PULSE_SINK?.trim() || "ChromeAudio";

  const sessions = new VmServerSessions(moduleRuntime);
  let aiKit: AiKit | null = moduleRuntime.getAiKit();
  let cloakKit: CloakKit | null = moduleRuntime.getCloakKit();
  let bpkgKit: BpkgKit | null = moduleRuntime.getKit<BpkgKit>("bpkg");
  let proxyKit: ProxyKit | null = moduleRuntime.getProxyKit();
  let userAgentKit: UaKit | null = moduleRuntime.getKit<UaKit>(UA_KIT_ID);
  let settingsKit: SettingsKit | null = moduleRuntime.getKit<SettingsKit>(SETTINGS_KIT_ID);
  const browserAudioStreamManager = new VmBrowserAudioStreamManager();
  void browserAudioStreamManager.prepare().catch((error) => {
    logger.warn({ error }, "VM browser audio sink preparation failed during startup");
  });

  async function ensureAiKit(): Promise<AiKit> {
    aiKit = aiKit ?? await moduleRuntime.attachKit(new AiKit(), { reason: "web ai agent" });
    return aiKit;
  }

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

  async function ensureUserAgentKit(): Promise<UaKit> {
    userAgentKit = userAgentKit ?? await moduleRuntime.attachKit(new UaKit(), { reason: "browser user agent management" });
    return userAgentKit;
  }

  async function ensureSettingsKit(): Promise<SettingsKit> {
    settingsKit = settingsKit ?? await moduleRuntime.attachKit($settings, { reason: "workspace settings api" });
    return settingsKit;
  }

  async function listPaletteCommands() {
    return moduleRuntime.listPaletteCommands();
  }

  async function runPaletteCommand(id: string, params?: unknown) {
    return await moduleRuntime.runModuleForWeb(id, params);
  }

  const server = Bun.serve<VmServerSocketData>({
    hostname: "0.0.0.0",
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

      if (url.pathname === "/vm/browsers/audio/stream") {
        if (request.method !== "GET") {
          return createMethodNotAllowedResponse(["GET"]);
        }

        const upgraded = server.upgrade(request, {
          data: { kind: "browser-audio-stream" },
        });

        if (upgraded) {
          logger.info(
            { method: request.method, path: url.pathname, status: 101, durationMs: Date.now() - startedAt },
            "VM browser audio stream upgraded",
          );
          return;
        }

        return createJsonResponse(
          { ok: false, error: "Failed to upgrade browser audio websocket." },
          { status: 400 },
        );
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

      if (url.pathname === "/vm/execution/stream") {
        if (request.method !== "GET") {
          return createMethodNotAllowedResponse(["GET"]);
        }

        const upgraded = server.upgrade(request, {
          data: { kind: "execution-stream" },
        });

        if (upgraded) {
          logger.info(
            { method: request.method, path: url.pathname, status: 101, durationMs: Date.now() - startedAt },
            "VM execution stream upgraded",
          );
          return;
        }

        return createJsonResponse(
          { ok: false, error: "Failed to upgrade execution websocket." },
          { status: 400 },
        );
      }

      const inspectorStreamMatch = url.pathname.match(/^\/vm\/([^/]+)\/inspector\/stream$/u);
      if (inspectorStreamMatch) {
        if (request.method !== "GET") {
          return createMethodNotAllowedResponse(["GET"]);
        }

        try {
          const code = normalizeVmCode(decodeURIComponent(inspectorStreamMatch[1] ?? ""));
          const upgraded = server.upgrade(request, {
            data: { kind: "inspector-stream", code },
          });

          if (upgraded) {
            logger.info(
              { method: request.method, path: url.pathname, status: 101, durationMs: Date.now() - startedAt, code },
              "VM inspector stream upgraded",
            );
            return;
          }

          return createJsonResponse(
            { ok: false, error: "Failed to upgrade inspector websocket." },
            { status: 400 },
          );
        } catch (error) {
          return createErrorResponse(error);
        }
      }

      let response: Response;
      try {
        response = await handleVmServerRequest(request, url, sessions, ensureAiKit, ensureCloakKit, ensureBpkgKit, ensureProxyKit, ensureUserAgentKit, ensureSettingsKit, listPaletteCommands, runPaletteCommand);
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
        if (ws.data.kind === "browser-audio-stream") {
          logger.info("VM browser audio stream opened");

          void browserAudioStreamManager.subscribe(ws).catch((error) => {
            const message = buildErrorMessage(error);
            try {
              ws.send(JSON.stringify({ type: "error", error: message }));
            } catch {
              // Ignore send failures on closed sockets.
            }
            ws.close(1011, "Browser audio stream failed");
          });

          return;
        }

        if (ws.data.kind === "browser-stream") {
          logger.info({ target: ws.data.target }, "VM browser stream opened");

          void (async () => {
            let tabsIntervalId: ReturnType<typeof setInterval> | null = null;
            let frameWatchdogId: ReturnType<typeof setTimeout> | null = null;
            let tabsRefreshPromise: Promise<void> | null = null;
            try {
              const kit = await ensureCloakKit();
              let lastTabsSignature: string | null = null;

              const clearFrameWatchdog = () => {
                if (frameWatchdogId) {
                  clearTimeout(frameWatchdogId);
                  frameWatchdogId = null;
                }
              };

              const armFrameWatchdog = () => {
                clearFrameWatchdog();
                frameWatchdogId = setTimeout(() => {
                  if (ws.data.kind !== "browser-stream" || ws.data.isClosed) {
                    return;
                  }

                  logger.warn({ target: ws.data.target }, "VM browser stream stalled waiting for screencast frames");
                  try {
                    ws.send(JSON.stringify({ type: "error", error: "Screencast stalled while waiting for frames." }));
                  } catch {
                    // Ignore send failures on closed sockets.
                  }

                  ws.close(1011, "Browser stream stalled");
                }, VM_BROWSER_STREAM_STALL_TIMEOUT_MS);
              };

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

              const queueTabsSnapshot = () => {
                if (tabsRefreshPromise) {
                  return;
                }

                tabsRefreshPromise = sendTabsSnapshot()
                  .catch(() => {})
                  .finally(() => {
                    tabsRefreshPromise = null;
                  });
              };

              const screencast = await kit.startProfileScreencast(ws.data.target, {
                format: "jpeg",
                quality: ws.data.quality,
                everyNthFrame: ws.data.everyNthFrame,
                onFrame(frame) {
                  armFrameWatchdog();
                  const payload = new Uint8Array(frame.bytes.length + 1);
                  payload[0] = VM_BROWSER_STREAM_BINARY_KIND_IMAGE;
                  payload.set(frame.bytes, 1);
                  ws.send(payload);
                },
              });
              armFrameWatchdog();

              tabsIntervalId = setInterval(() => {
                queueTabsSnapshot();
              }, 900);

              if (ws.data.isClosed) {
                clearFrameWatchdog();
                if (tabsIntervalId) {
                  clearInterval(tabsIntervalId);
                }
                await screencast.stop();
                return;
              }

              ws.data.stopStream = async () => {
                clearFrameWatchdog();
                if (tabsIntervalId) {
                  clearInterval(tabsIntervalId);
                  tabsIntervalId = null;
                }
                await screencast.stop();
              };
              ws.data.requestTabsSnapshot = async () => {
                await sendTabsSnapshot();
              };
              ws.data.inputQueue = Promise.resolve();

              ws.send(JSON.stringify({
                type: "ready",
                transport: "screencast",
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

        if (ws.data.kind === "execution-stream") {
          logger.info("VM execution stream opened");
          ws.send(JSON.stringify({ type: "ready" }));
          return;
        }

        if (ws.data.kind === "inspector-stream") {
          logger.info({ code: ws.data.code }, "VM inspector stream opened");

          void startVmInspectorStream(ws, sessions).catch((error) => {
            const message = buildErrorMessage(error);
            try {
              ws.send(JSON.stringify({ type: "error", error: message }));
            } catch {
              // Ignore send failures on closed sockets.
            }
            ws.close(1011, "Inspector stream failed");
          });
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
        if (ws.data.kind === "browser-stream") {
          ws.data.inputQueue = (ws.data.inputQueue ?? Promise.resolve()).then(async () => {
            try {
              const payload = readVmBrowserStreamClientMessage(message);
              if (payload.type === "refresh-tabs") {
                await ws.data.requestTabsSnapshot?.();
                return;
              }

              const kit = await ensureCloakKit();
              if (payload.type === "pointer-down") {
                ws.data.pendingPointerMove = undefined;
                await kit.pointerDownProfile(ws.data.target, payload.x, payload.y);
                return;
              }

              if (payload.type === "pointer-move") {
                ws.data.pendingPointerMove = { x: payload.x, y: payload.y };
                const nextMove = ws.data.pendingPointerMove;
                if (!nextMove) {
                  return;
                }

                ws.data.pendingPointerMove = undefined;
                await kit.pointerMoveProfile(ws.data.target, nextMove.x, nextMove.y);
                return;
              }

              if (payload.type === "pointer-up") {
                ws.data.pendingPointerMove = undefined;
                await kit.pointerUpProfile(ws.data.target, payload.x, payload.y);
              }
            } catch {
              // Ignore invalid browser stream client messages.
            }
          });
          return;
        }

        if (ws.data.kind === "inspector-stream") {
          void (async () => {
            try {
              const payload = readVmInspectorStreamClientMessage(message);
              if (payload.type === "inspect-node") {
                try {
                  const details = await sessions.inspectSessionNode(ws.data.code, payload.handle);
                  if (ws.data.isClosed) {
                    return;
                  }

                  ws.send(JSON.stringify({
                    type: "node",
                    handle: payload.handle,
                    details,
                  }));
                } catch (error) {
                  if (ws.data.isClosed) {
                    return;
                  }

                  try {
                    ws.send(JSON.stringify({
                      type: "node-error",
                      handle: payload.handle,
                      error: buildErrorMessage(error),
                    }));
                  } catch {
                    // Ignore send failures on closed sockets.
                  }
                }
                return;
              }

              const ack = sessions.cancelExecutionTask(payload.taskId);
              if (ws.data.isClosed) {
                return;
              }

              ws.send(JSON.stringify(ack));

              const state = await sessions.readInspectorStreamState(ws.data.code);
              if (ws.data.isClosed) {
                return;
              }

              ws.send(JSON.stringify({
                type: "state",
                snapshot: state.snapshot,
                rootGroups: state.rootGroups,
              }));
            } catch (error) {
              if (ws.data.isClosed) {
                return;
              }

              try {
                ws.send(JSON.stringify({
                  type: "error",
                  error: buildErrorMessage(error),
                }));
              } catch {
                // Ignore send failures on closed sockets.
              }
            }
          })();
          return;
        }

        if (ws.data.kind === "execution-stream") {
          void (async () => {
            try {
              const payload = readVmExecutionStreamClientMessage(message);
              if (payload.type === "cancel") {
                const taskId = payload.taskId ?? ws.data.executionTaskId;
                if (!taskId) {
                  ws.send(JSON.stringify({
                    type: "cancel-ack",
                    taskId: "unknown",
                    accepted: false,
                    status: "unknown",
                    message: "Execution stream has no active task to cancel.",
                  }));
                  return;
                }

                const ack = sessions.cancelExecutionTask(taskId);
                if (!ack.accepted || ack.status === "unknown" || ack.status === "completed" || ack.status === "failed" || ack.status === "cancelled") {
                  ws.send(JSON.stringify(ack));
                }
                return;
              }

              if (ws.data.executionTaskId) {
                ws.send(JSON.stringify({
                  type: "error",
                  taskId: ws.data.executionTaskId,
                  error: "Execution stream already has an active task.",
                }));
                return;
              }

              const task = await sessions.startExecutionTask(
                payload.code,
                payload.input,
                payload.language,
                {
                  cellId: payload.cellId,
                  previousCellId: payload.previousCellId,
                },
                (event) => {
                  if (ws.data.isClosed) {
                    return;
                  }

                  try {
                    ws.send(JSON.stringify(event));
                  } catch {
                    // Ignore send failures on closed sockets.
                  }

                  if (event.type === "complete") {
                    const unsubscribeExecutionTask = ws.data.unsubscribeExecutionTask;
                    ws.data.executionTaskId = undefined;
                    ws.data.unsubscribeExecutionTask = undefined;
                    unsubscribeExecutionTask?.();
                  }
                },
              );
              ws.data.executionTaskId = task.taskId;
              ws.data.unsubscribeExecutionTask = task.unsubscribe;
            } catch (error) {
              try {
                ws.send(JSON.stringify({ type: "error", taskId: ws.data.executionTaskId ?? "unknown", error: buildErrorMessage(error) }));
              } catch {
                // Ignore send failures on closed sockets.
              }
            }
          })();
          return;
        }

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
        if (ws.data.kind === "browser-audio-stream") {
          browserAudioStreamManager.unsubscribe(ws);
          logger.info("VM browser audio stream closed");
          return;
        }

        if (ws.data.kind === "browser-stream") {
          const stopStream = ws.data.stopStream;
          ws.data.stopStream = undefined;
          ws.data.requestTabsSnapshot = undefined;
          logger.info({ target: ws.data.target }, "VM browser stream closed");
          void stopStream?.();
          return;
        }

        if (ws.data.kind === "inspector-stream") {
          const stopStream = ws.data.stopStream;
          ws.data.stopStream = undefined;
          logger.info({ code: ws.data.code }, "VM inspector stream closed");
          stopStream?.();
          return;
        }

        if (ws.data.kind === "execution-stream") {
          const unsubscribeExecutionTask = ws.data.unsubscribeExecutionTask;
          ws.data.executionTaskId = undefined;
          ws.data.unsubscribeExecutionTask = undefined;
          logger.info("VM execution stream closed");
          unsubscribeExecutionTask?.();
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
