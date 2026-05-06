import type { ServerWebSocket } from "bun";
import type { BpkgKit } from "../../kits/bpkg-kit";
import { buildErrorMessage } from "./http";
import type { VmServerSocketData } from "./types";

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
