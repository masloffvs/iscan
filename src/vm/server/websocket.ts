import type { ServerWebSocket } from "bun";
import type { BpkgKit } from "../../kits/bpkg-kit";
import { buildErrorMessage } from "./http";
import type { VmServerSessions } from "./sessions";
import type { VmServerSocketData } from "./types";

const ACTIVE_INSPECTOR_STREAM_MS = 1000;
const IDLE_INSPECTOR_STREAM_MS = 2500;
const ERROR_INSPECTOR_STREAM_MS = 4000;

export async function forwardTerminalOutput(
  ws: ServerWebSocket<VmServerSocketData>,
  stream: ReadableStream<Uint8Array> | null | undefined,
  kind: "stdout" | "stderr",
): Promise<void> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk || ws.data.isClosed) {
        continue;
      }

      ws.send(JSON.stringify({
        type: "output",
        stream: kind,
        data: chunk,
      }));
    }

    const remainder = decoder.decode();
    if (remainder && !ws.data.isClosed) {
      ws.send(JSON.stringify({
        type: "output",
        stream: kind,
        data: remainder,
      }));
    }
  } finally {
    reader.releaseLock();
  }
}

export async function startVmPackageTerminalStream(
  ws: ServerWebSocket<VmServerSocketData>,
  ensureBpkgKit: () => Promise<BpkgKit>,
): Promise<void> {
  if (ws.data.kind !== "package-terminal") {
    return;
  }

  const kit = await ensureBpkgKit();
  const session = await kit.openBoxTerminal(ws.data.target, {
    cols: ws.data.cols,
    privilegeLevel: ws.data.privilegeLevel,
    rows: ws.data.rows,
  });

  if (ws.data.isClosed) {
    await session.close();
    return;
  }

  ws.data.writeTerminal = async (data: string) => {
    await session.write(data);
  };
  ws.data.closeTerminal = async () => {
    await session.close();
  };

  ws.send(JSON.stringify({
    type: "ready",
    boxId: session.box.id,
    cols: session.cols,
    rows: session.rows,
    commandString: session.commandString,
  }));

  const stdoutTask = forwardTerminalOutput(ws, session.child.stdout, "stdout");
  const stderrTask = forwardTerminalOutput(ws, session.child.stderr, "stderr");
  const exitCode = await session.child.exited;

  await Promise.allSettled([stdoutTask, stderrTask]);

  if (!ws.data.isClosed) {
    try {
      ws.send(JSON.stringify({
        type: "exit",
        exitCode,
      }));
    } catch {
      // Ignore send failures after disconnect.
    }

    ws.close(1000, "Box terminal exited");
  }
}

export async function startVmInspectorStream(
  ws: ServerWebSocket<VmServerSocketData>,
  sessions: VmServerSessions,
): Promise<void> {
  if (ws.data.kind !== "inspector-stream") {
    return;
  }

  let timerId: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const scheduleNext = (delayMs: number) => {
    if (ws.data.kind !== "inspector-stream" || ws.data.isClosed) {
      return;
    }

    clearTimer();
    timerId = setTimeout(() => {
      void sendState();
    }, delayMs);
  };

  const sendState = async () => {
    if (ws.data.kind !== "inspector-stream" || ws.data.isClosed) {
      return;
    }

    clearTimer();

    try {
      const state = await sessions.readInspectorStreamState(ws.data.code);
      if (ws.data.kind !== "inspector-stream" || ws.data.isClosed) {
        return;
      }

      ws.send(JSON.stringify({
        type: "state",
        snapshot: state.snapshot,
        rootGroups: state.rootGroups,
      }));

      scheduleNext(
        state.snapshot.activeEvaluation || state.snapshot.execution.activeTaskId || state.snapshot.execution.queueLength > 0
          ? ACTIVE_INSPECTOR_STREAM_MS
          : IDLE_INSPECTOR_STREAM_MS,
      );
    } catch (error) {
      if (ws.data.kind !== "inspector-stream" || ws.data.isClosed) {
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

      scheduleNext(ERROR_INSPECTOR_STREAM_MS);
    }
  };

  ws.data.stopStream = () => {
    clearTimer();
  };

  ws.send(JSON.stringify({ type: "ready" }));
  await sendState();
}
