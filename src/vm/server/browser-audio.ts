import type { ServerWebSocket } from "bun";
import { logger } from "../../logger";
import type { VmServerSocketData } from "./types";

const DEFAULT_BROWSER_AUDIO_BITRATE = process.env.ISCAN_CLOAK_AUDIO_BITRATE?.trim() || "96k";
const DEFAULT_BROWSER_AUDIO_MIME_TYPE = "audio/mpeg";
const DEFAULT_BROWSER_AUDIO_PACTL_PATH = process.env.ISCAN_CLOAK_PACTL_PATH?.trim() || "pactl";
const DEFAULT_BROWSER_AUDIO_SINK = process.env.ISCAN_CLOAK_PULSE_SINK?.trim() || "ChromeAudio";
const DEFAULT_BROWSER_AUDIO_SINK_DESCRIPTION = process.env.ISCAN_CLOAK_PULSE_SINK_DESCRIPTION?.trim() || DEFAULT_BROWSER_AUDIO_SINK;

type VmBrowserAudioReadyMessage = {
  type: "ready";
  transport: "ffmpeg";
  mimeType: string;
  monitorSource: string;
};

type VmBrowserAudioErrorMessage = {
  type: "error";
  error: string;
};

function getBrowserAudioMonitorSource(): string {
  const explicitMonitorSource = process.env.ISCAN_CLOAK_PULSE_MONITOR?.trim();
  if (explicitMonitorSource) {
    return explicitMonitorSource;
  }

  return `${DEFAULT_BROWSER_AUDIO_SINK}.monitor`;
}

function getBrowserAudioCommand(): string[] {
  return [
    process.env.ISCAN_CLOAK_AUDIO_FFMPEG_PATH?.trim() || "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "nobuffer",
    "-flush_packets",
    "1",
    "-thread_queue_size",
    "512",
    "-f",
    "pulse",
    "-i",
    getBrowserAudioMonitorSource(),
    "-vn",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    DEFAULT_BROWSER_AUDIO_BITRATE,
    "-f",
    "mp3",
    "pipe:1",
  ];
}

function getBrowserAudioEnvironment(): NodeJS.ProcessEnv {
  const configuredPulseServer = process.env.ISCAN_CLOAK_PULSE_SERVER?.trim();
  const configuredPipewireLatency = process.env.ISCAN_CLOAK_PIPEWIRE_LATENCY?.trim();

  return {
    ...process.env,
    ...(configuredPulseServer ? { PULSE_SERVER: configuredPulseServer } : {}),
    ...(configuredPipewireLatency ? { PIPEWIRE_LATENCY: configuredPipewireLatency } : {}),
  };
}

function decodeSyncOutput(payload: Uint8Array | null | undefined): string {
  if (!payload || payload.byteLength === 0) {
    return "";
  }

  return new TextDecoder().decode(payload).trim();
}

function runBrowserAudioCommandSync(command: readonly string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: [...command],
    env: getBrowserAudioEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function ensureBrowserAudioSinkSync(): void {
  const listResult = runBrowserAudioCommandSync([DEFAULT_BROWSER_AUDIO_PACTL_PATH, "list", "short", "sinks"]);
  if (listResult.exitCode !== 0) {
    throw new Error(decodeSyncOutput(listResult.stderr) || "Failed to query PulseAudio sinks.");
  }

  const sinkExists = decodeSyncOutput(listResult.stdout)
    .split(/\r?\n/u)
    .map((line) => line.split(/\t+/u)[1]?.trim() ?? "")
    .some((sinkName) => sinkName === DEFAULT_BROWSER_AUDIO_SINK);
  if (sinkExists) {
    return;
  }

  const loadResult = runBrowserAudioCommandSync([
    DEFAULT_BROWSER_AUDIO_PACTL_PATH,
    "load-module",
    "module-null-sink",
    `sink_name=${DEFAULT_BROWSER_AUDIO_SINK}`,
    `sink_properties=device.description=${DEFAULT_BROWSER_AUDIO_SINK_DESCRIPTION}`,
  ]);
  if (loadResult.exitCode !== 0) {
    throw new Error(decodeSyncOutput(loadResult.stderr) || "Failed to create shared browser audio sink.");
  }

  logger.info(
    {
      moduleId: decodeSyncOutput(loadResult.stdout),
      sink: DEFAULT_BROWSER_AUDIO_SINK,
    },
    "VM browser audio sink created",
  );
}

export class VmBrowserAudioStreamManager {
  private readonly clients = new Set<ServerWebSocket<VmServerSocketData>>();
  private captureProcess: ReturnType<typeof Bun.spawn> | null = null;
  private captureStartPromise: Promise<void> | null = null;
  private preparePromise: Promise<void> | null = null;
  private stoppedProcess: ReturnType<typeof Bun.spawn> | null = null;

  async prepare(): Promise<void> {
    if (this.preparePromise) {
      await this.preparePromise;
      return;
    }

    this.preparePromise = Promise.resolve().then(() => {
      ensureBrowserAudioSinkSync();
    });

    try {
      await this.preparePromise;
    } finally {
      this.preparePromise = null;
    }
  }

  async subscribe(ws: ServerWebSocket<VmServerSocketData>): Promise<void> {
    if (ws.data.kind !== "browser-audio-stream") {
      return;
    }

    this.clients.add(ws);

    try {
      await this.ensureCaptureProcess();
      if (ws.data.isClosed || !this.clients.has(ws)) {
        return;
      }

      ws.send(JSON.stringify(this.buildReadyMessage()));
    } catch (error) {
      this.clients.delete(ws);
      throw error;
    }
  }

  unsubscribe(ws: ServerWebSocket<VmServerSocketData>): void {
    if (ws.data.kind !== "browser-audio-stream") {
      return;
    }

    this.clients.delete(ws);
    if (this.clients.size === 0) {
      this.stopCaptureProcess();
    }
  }

  private buildReadyMessage(): VmBrowserAudioReadyMessage {
    return {
      type: "ready",
      transport: "ffmpeg",
      mimeType: DEFAULT_BROWSER_AUDIO_MIME_TYPE,
      monitorSource: getBrowserAudioMonitorSource(),
    };
  }

  private async ensureCaptureProcess(): Promise<void> {
    await this.prepare();

    if (this.captureProcess) {
      return;
    }

    if (this.captureStartPromise) {
      await this.captureStartPromise;
      return;
    }

    this.captureStartPromise = this.startCaptureProcess();
    try {
      await this.captureStartPromise;
    } finally {
      this.captureStartPromise = null;
    }
  }

  private async startCaptureProcess(): Promise<void> {
    const command = getBrowserAudioCommand();
    const child = Bun.spawn({
      cmd: command,
      env: getBrowserAudioEnvironment(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.captureProcess = child;

    const stderrTask = this.readErrorOutput(child.stderr);
    void this.forwardAudioOutput(child.stdout).catch((error) => {
      logger.warn({ error }, "VM browser audio stdout forwarding failed");
    });
    void this.watchCaptureProcess(child, stderrTask);

    logger.info(
      {
        clientCount: this.clients.size,
        command,
        monitorSource: getBrowserAudioMonitorSource(),
      },
      "VM browser audio capture started",
    );
  }

  private stopCaptureProcess(): void {
    const child = this.captureProcess;
    this.captureProcess = null;
    if (!child) {
      return;
    }

    this.stoppedProcess = child;
    child.kill();
  }

  private async watchCaptureProcess(
    child: ReturnType<typeof Bun.spawn>,
    stderrTask: Promise<string>,
  ): Promise<void> {
    const exitCode = await child.exited;
    const stderrOutput = (await stderrTask.catch(() => "")).trim();
    const wasIntentional = this.stoppedProcess === child;
    if (wasIntentional) {
      this.stoppedProcess = null;
      logger.info({ exitCode, monitorSource: getBrowserAudioMonitorSource() }, "VM browser audio capture stopped");
      return;
    }

    if (this.captureProcess === child) {
      this.captureProcess = null;
    }

    if (this.clients.size === 0) {
      return;
    }

    const errorMessage = stderrOutput.length > 0
      ? stderrOutput
      : `ffmpeg exited with code ${exitCode}`;

    logger.warn(
      {
        exitCode,
        errorMessage,
        monitorSource: getBrowserAudioMonitorSource(),
      },
      "VM browser audio capture exited unexpectedly",
    );

    this.broadcastJson({ type: "error", error: errorMessage });

    for (const client of Array.from(this.clients)) {
      try {
        client.close(1011, "Browser audio stream failed");
      } catch {
        // Ignore close races on already closed sockets.
      }
    }
  }

  private async forwardAudioOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<void> {
    if (!stream) {
      return;
    }

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value || value.byteLength === 0) {
          continue;
        }

        const payload = new Uint8Array(value);
        for (const client of this.clients) {
          if (client.data.kind !== "browser-audio-stream" || client.data.isClosed) {
            continue;
          }

          try {
            client.send(payload);
          } catch {
            // Ignore send failures on closed sockets.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async readErrorOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
    if (!stream) {
      return "";
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        output += decoder.decode(value, { stream: true });
      }

      output += decoder.decode();
      return output;
    } finally {
      reader.releaseLock();
    }
  }

  private broadcastJson(message: VmBrowserAudioErrorMessage): void {
    for (const client of this.clients) {
      if (client.data.kind !== "browser-audio-stream" || client.data.isClosed) {
        continue;
      }

      try {
        client.send(JSON.stringify(message));
      } catch {
        // Ignore send failures on closed sockets.
      }
    }
  }
}