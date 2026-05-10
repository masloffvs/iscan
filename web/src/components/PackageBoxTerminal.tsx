import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { buildRemotePackageBoxTerminalStreamUrl } from "../api/client";

type PackageBoxTerminalProps = {
  boxId: string | null;
};

type PackageTerminalServerMessage =
  | {
    type: "ready";
    boxId: string;
    cols: number;
    rows: number;
    commandString: string;
  }
  | {
    type: "output";
    stream: "stdout" | "stderr";
    data: string;
  }
  | {
    type: "exit";
    exitCode: number;
  }
  | {
    type: "error";
    error: string;
  };

type TerminalGeometry = {
  cols: number;
  rows: number;
};

const DEFAULT_TERMINAL_GEOMETRY: TerminalGeometry = {
  cols: 120,
  rows: 28,
};

const MODAL_BACKGROUND = "#121212";
const CELL_WIDTH_PX = 9;
const CELL_HEIGHT_PX = 20;
const TERMINAL_VERTICAL_PADDING_PX = 18;
const TERMINAL_BOTTOM_SAFE_ZONE_PX = 22;
const TERMINAL_FULLSCREEN_BOTTOM_SAFE_ZONE_PX = 38;

function clamp(value: number, range: { min: number; max: number }): number {
  if (value < range.min) {
    return range.min;
  }

  if (value > range.max) {
    return range.max;
  }

  return value;
}

function measureTerminalGeometry(
  container: HTMLElement | null,
  options: { bottomSafeZonePx?: number } = {},
): TerminalGeometry {
  if (!container) {
    return DEFAULT_TERMINAL_GEOMETRY;
  }

  const width = Math.max(container.clientWidth - 24, 0);
  const height = Math.max(
    container.clientHeight - TERMINAL_VERTICAL_PADDING_PX - (options.bottomSafeZonePx ?? TERMINAL_BOTTOM_SAFE_ZONE_PX),
    0,
  );
  if (width === 0 || height === 0) {
    return DEFAULT_TERMINAL_GEOMETRY;
  }

  return {
    cols: clamp(Math.floor(width / CELL_WIDTH_PX), { min: 40, max: 240 }),
    rows: clamp(Math.floor(height / CELL_HEIGHT_PX), { min: 12, max: 120 }),
  };
}

function readPackageTerminalServerMessage(raw: string): PackageTerminalServerMessage {
  const parsed = JSON.parse(raw) as Partial<PackageTerminalServerMessage> & {
    data?: unknown;
    error?: unknown;
  };

  if (parsed.type === "ready") {
    return {
      type: "ready",
      boxId: typeof parsed.boxId === "string" ? parsed.boxId : "unknown",
      cols: typeof parsed.cols === "number" ? parsed.cols : DEFAULT_TERMINAL_GEOMETRY.cols,
      rows: typeof parsed.rows === "number" ? parsed.rows : DEFAULT_TERMINAL_GEOMETRY.rows,
      commandString: typeof parsed.commandString === "string" ? parsed.commandString : "",
    };
  }

  if (parsed.type === "output") {
    return {
      type: "output",
      stream: parsed.stream === "stderr" ? "stderr" : "stdout",
      data: typeof parsed.data === "string" ? parsed.data : "",
    };
  }

  if (parsed.type === "exit") {
    return {
      type: "exit",
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : 0,
    };
  }

  if (parsed.type === "error") {
    return {
      type: "error",
      error: typeof parsed.error === "string" ? parsed.error : "Terminal transport failed.",
    };
  }

  throw new Error("Unsupported terminal server message.");
}

function TerminalControlButton({
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-white/[0.05] text-[#a0a0a8] transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export default function PackageBoxTerminal({ boxId }: PackageBoxTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const geometryRef = useRef<TerminalGeometry>(DEFAULT_TERMINAL_GEOMETRY);
  const isFullscreenRef = useRef<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [sessionRevision, setSessionRevision] = useState<number>(0);
  const [status, setStatus] = useState<string>(boxId ? "Connecting to box shell..." : "Select a box to open a shell.");
  const [connectionState, setConnectionState] = useState<"connecting" | "ready" | "closed" | "error">("connecting");

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      terminal.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isFullscreen]);

  useEffect(() => {
    const host = hostRef.current;
    const terminal = terminalRef.current;
    if (!host || !terminal) {
      return;
    }

    const nextGeometry = measureTerminalGeometry(host, {
      bottomSafeZonePx: isFullscreen ? TERMINAL_FULLSCREEN_BOTTOM_SAFE_ZONE_PX : TERMINAL_BOTTOM_SAFE_ZONE_PX,
    });
    geometryRef.current = nextGeometry;
    terminal.resize(nextGeometry.cols, nextGeometry.rows);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: "resize",
        cols: nextGeometry.cols,
        rows: nextGeometry.rows,
      }));
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!boxId || !hostRef.current) {
      setStatus("Select a box to open a shell.");
      setConnectionState("closed");
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      cols: DEFAULT_TERMINAL_GEOMETRY.cols,
      rows: DEFAULT_TERMINAL_GEOMETRY.rows,
      convertEol: false,
      cursorBlink: true,
      fontFamily: "IBM Plex Mono, SFMono-Regular, monospace",
      fontSize: 12,
      fontWeight: "400",
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: MODAL_BACKGROUND,
        foreground: "#e4e4e7",
        cursor: "#fafafa",
        cursorAccent: MODAL_BACKGROUND,
        selectionBackground: "rgba(255, 255, 255, 0.16)",
      },
    });
    terminalRef.current = terminal;
    hostRef.current.innerHTML = "";
    terminal.open(hostRef.current);
    terminal.focus();

    let disposed = false;

    const resizeTerminal = () => {
      const nextGeometry = measureTerminalGeometry(hostRef.current, {
        bottomSafeZonePx: isFullscreenRef.current ? TERMINAL_FULLSCREEN_BOTTOM_SAFE_ZONE_PX : TERMINAL_BOTTOM_SAFE_ZONE_PX,
      });
      const previousGeometry = geometryRef.current;
      if (nextGeometry.cols === previousGeometry.cols && nextGeometry.rows === previousGeometry.rows) {
        return;
      }

      geometryRef.current = nextGeometry;
      terminal.resize(nextGeometry.cols, nextGeometry.rows);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: "resize",
          cols: nextGeometry.cols,
          rows: nextGeometry.rows,
        }));
      }
    };

    geometryRef.current = measureTerminalGeometry(hostRef.current, {
      bottomSafeZonePx: isFullscreenRef.current ? TERMINAL_FULLSCREEN_BOTTOM_SAFE_ZONE_PX : TERMINAL_BOTTOM_SAFE_ZONE_PX,
    });
    terminal.resize(geometryRef.current.cols, geometryRef.current.rows);

    const socket = new WebSocket(buildRemotePackageBoxTerminalStreamUrl(boxId, geometryRef.current));
    socketRef.current = socket;
    setConnectionState("connecting");
    setStatus("Connecting to box shell...");

    socket.addEventListener("open", () => {
      if (disposed) {
        return;
      }

      setStatus("Transport connected. Waiting for shell...");
    });

    socket.addEventListener("message", (event) => {
      if (disposed || typeof event.data !== "string") {
        return;
      }

      try {
        const message = readPackageTerminalServerMessage(event.data);
        if (message.type === "ready") {
          geometryRef.current = { cols: message.cols, rows: message.rows };
          terminal.resize(message.cols, message.rows);
          terminal.focus();
          setConnectionState("ready");
          setStatus(`Attached to ${message.boxId}.`);
          return;
        }

        if (message.type === "output") {
          if (message.data.length > 0) {
            terminal.write(message.data);
          }
          return;
        }

        if (message.type === "exit") {
          terminal.write(`\r\n\x1b[90m[process exited ${message.exitCode}]\x1b[0m\r\n`);
          setConnectionState("closed");
          setStatus(`Shell exited with code ${message.exitCode}.`);
          return;
        }

        terminal.write(`\r\n\x1b[31m[error] ${message.error}\x1b[0m\r\n`);
        setConnectionState("error");
        setStatus(message.error);
      } catch (error) {
        terminal.write(`\r\n\x1b[31m[decode error] ${String(error)}\x1b[0m\r\n`);
        setConnectionState("error");
        setStatus("Failed to decode terminal payload.");
      }
    });

    socket.addEventListener("error", () => {
      if (disposed) {
        return;
      }

      setConnectionState("error");
      setStatus("Terminal transport error.");
    });

    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (disposed) {
        return;
      }

      setConnectionState((current) => current === "error" ? "error" : current === "closed" ? "closed" : "closed");
      setStatus((current) => current.startsWith("Shell exited") ? current : "Disconnected. Reconnect to open a new shell.");
    });

    const dataDisposable = terminal.onData((data) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify({
        type: "input",
        data,
      }));
    });

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
        resizeTerminal();
      });

    if (resizeObserver && hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      dataDisposable.dispose();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      terminal.dispose();
      terminalRef.current = null;
    };
  }, [boxId, sessionRevision]);

  const containerClassName = isFullscreen
    ? "fixed inset-0 z-[130] flex flex-col bg-[#121212] p-4"
    : "space-y-2";
  const panelClassName = isFullscreen ? "flex min-h-0 grow flex-col" : "";
  const hostClassName = isFullscreen
    ? "package-box-terminal package-box-terminal-fullscreen mt-3 min-h-0 grow w-full"
    : "package-box-terminal mt-2 h-[34vh] min-h-[220px] max-h-[320px] w-full";

  return (
    <div className={containerClassName}>
      <div className={panelClassName}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#68686e]">Terminal</p>
            <p className="mt-1 text-[11px] text-[#d6d6db]">{status}</p>
          </div>

          <div className="flex items-center gap-1.5">
            <TerminalControlButton
              ariaLabel="Clear terminal"
              disabled={!terminalRef.current}
              onClick={() => {
                terminalRef.current?.clear();
                terminalRef.current?.focus();
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="m6 6 1 14h10l1-14" />
              </svg>
            </TerminalControlButton>
            <TerminalControlButton
              ariaLabel="Reconnect terminal"
              disabled={!boxId || connectionState === "connecting"}
              onClick={() => {
                setSessionRevision((current) => current + 1);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
                <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
              </svg>
            </TerminalControlButton>
            <TerminalControlButton
              ariaLabel={isFullscreen ? "Exit terminal fullscreen" : "Open terminal fullscreen"}
              onClick={() => {
                setIsFullscreen((current) => !current);
              }}
            >
              {isFullscreen ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M15 3h6v6" />
                  <path d="m21 3-7 7" />
                  <path d="M9 21H3v-6" />
                  <path d="m3 21 7-7" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M9 3H3v6" />
                  <path d="m3 3 7 7" />
                  <path d="M15 21h6v-6" />
                  <path d="m21 21-7-7" />
                </svg>
              )}
            </TerminalControlButton>
          </div>
        </div>

        <div className={hostClassName} onClick={() => terminalRef.current?.focus()} ref={hostRef} />
      </div>
    </div>
  );
}