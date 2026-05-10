import { useEffect, useRef, useState } from "react";
import { buildRemoteBrowserAudioStreamUrl } from "../api/client";

const DEFAULT_GLOBAL_BROWSER_AUDIO_MIME_TYPE = "audio/mpeg";

const GLOBAL_BROWSER_AUDIO_CONFIG = {
  reconnectDelayMs: 900,
  buffering: {
    appendBatchMaxBytes: 48_000,
    appendBatchMaxChunks: 12,
    maxQueuedBytes: 192_000,
    minRetainedBackBufferSec: 2.5,
    pruneIntervalMs: 900,
  },
  tuning: {
    minStartLatencySec: 0.35,
    targetLatencySec: 0.4,
    catchupLatencySec: 0.6,
    maxLatencySec: 1.2,
    catchupPlaybackRate: 1.03,
  },
} as const;

type BrowserAudioStreamMessage =
  | { type: "ready"; transport: "ffmpeg"; mimeType: string; monitorSource: string }
  | { type: "error"; error: string };

async function readAudioPayload(data: Blob | ArrayBuffer): Promise<Uint8Array> {
  return data instanceof Blob
    ? new Uint8Array(await data.arrayBuffer())
    : new Uint8Array(data);
}

export default function GlobalBrowserAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const audioMediaSourceRef = useRef<MediaSource | null>(null);
  const audioSourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioChunkQueueRef = useRef<Uint8Array[]>([]);
  const audioQueuedBytesRef = useRef<number>(0);
  const audioMimeTypeRef = useRef<string | null>(null);
  const lastAudioSyncAtRef = useRef<number>(0);
  const lastAudioPruneAtRef = useRef<number>(0);
  const audioPlaybackDisabledRef = useRef<boolean>(false);
  const [connectionRevision, setConnectionRevision] = useState(0);

  function clearReconnectTimer(): void {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function closeSocket(): void {
    const socket = socketRef.current;
    socketRef.current = null;
    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimerRef.current !== null) {
      return;
    }

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setConnectionRevision((current) => current + 1);
    }, GLOBAL_BROWSER_AUDIO_CONFIG.reconnectDelayMs);
  }

  function getBufferedAudioLatency(audio: HTMLAudioElement): number | null {
    if (audio.buffered.length === 0) {
      return null;
    }

    const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
    const latencySec = bufferedEnd - audio.currentTime;
    if (!Number.isFinite(bufferedEnd) || !Number.isFinite(latencySec)) {
      return null;
    }

    return latencySec;
  }

  function syncAudioPlayback(force = false): void {
    const audio = audioRef.current;
    if (!audio || audioPlaybackDisabledRef.current) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastAudioSyncAtRef.current < 120) {
      return;
    }

    lastAudioSyncAtRef.current = now;
    const latencySec = getBufferedAudioLatency(audio);
    if (latencySec === null) {
      return;
    }

    if (latencySec > GLOBAL_BROWSER_AUDIO_CONFIG.tuning.maxLatencySec) {
      const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
      const nextTime = Math.max(0, bufferedEnd - GLOBAL_BROWSER_AUDIO_CONFIG.tuning.targetLatencySec);
      if (Math.abs(nextTime - audio.currentTime) > 0.05) {
        audio.currentTime = nextTime;
      }
      if (audio.playbackRate !== 1) {
        audio.playbackRate = 1;
      }
      return;
    }

    if (latencySec > GLOBAL_BROWSER_AUDIO_CONFIG.tuning.catchupLatencySec) {
      if (audio.playbackRate !== GLOBAL_BROWSER_AUDIO_CONFIG.tuning.catchupPlaybackRate) {
        audio.playbackRate = GLOBAL_BROWSER_AUDIO_CONFIG.tuning.catchupPlaybackRate;
      }
      return;
    }

    if (audio.playbackRate !== 1) {
      audio.playbackRate = 1;
    }
  }

  function combineAudioChunks(chunks: readonly Uint8Array[]): ArrayBuffer {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined.buffer;
  }

  function maybePruneAudioBuffer(force = false): boolean {
    const audio = audioRef.current;
    const sourceBuffer = audioSourceBufferRef.current;
    if (!audio || !sourceBuffer || sourceBuffer.updating || audio.buffered.length === 0) {
      return false;
    }

    const now = Date.now();
    if (!force && now - lastAudioPruneAtRef.current < GLOBAL_BROWSER_AUDIO_CONFIG.buffering.pruneIntervalMs) {
      return false;
    }

    const bufferedStart = audio.buffered.start(0);
    const pruneBefore = audio.currentTime - GLOBAL_BROWSER_AUDIO_CONFIG.buffering.minRetainedBackBufferSec;
    if (!Number.isFinite(bufferedStart) || !Number.isFinite(pruneBefore) || pruneBefore <= bufferedStart + 0.25) {
      return false;
    }

    try {
      sourceBuffer.remove(0, pruneBefore);
      lastAudioPruneAtRef.current = now;
      return true;
    } catch {
      return false;
    }
  }

  async function resumeAudioPlayback(): Promise<void> {
    const audio = audioRef.current;
    if (!audio || audioPlaybackDisabledRef.current) {
      return;
    }

    const latencySec = getBufferedAudioLatency(audio);
    if (
      audio.paused
      && latencySec !== null
      && latencySec < GLOBAL_BROWSER_AUDIO_CONFIG.tuning.minStartLatencySec
    ) {
      return;
    }

    await audio.play().catch(() => {
      // Browser autoplay policies may defer playback until the next user gesture.
    });
    syncAudioPlayback(true);
  }

  function flushAudioQueue(): void {
    const sourceBuffer = audioSourceBufferRef.current;
    if (!sourceBuffer) {
      return;
    }

    if (maybePruneAudioBuffer()) {
      return;
    }

    if (sourceBuffer.updating || audioChunkQueueRef.current.length === 0) {
      syncAudioPlayback();
      return;
    }

    const chunksToAppend: Uint8Array[] = [];
    let totalBytes = 0;
    while (
      audioChunkQueueRef.current.length > 0
      && chunksToAppend.length < GLOBAL_BROWSER_AUDIO_CONFIG.buffering.appendBatchMaxChunks
    ) {
      const nextChunk = audioChunkQueueRef.current[0];
      if (!nextChunk) {
        break;
      }

      if (
        chunksToAppend.length > 0
        && totalBytes + nextChunk.byteLength > GLOBAL_BROWSER_AUDIO_CONFIG.buffering.appendBatchMaxBytes
      ) {
        break;
      }

      audioChunkQueueRef.current.shift();
      audioQueuedBytesRef.current = Math.max(0, audioQueuedBytesRef.current - nextChunk.byteLength);
      chunksToAppend.push(nextChunk);
      totalBytes += nextChunk.byteLength;
    }

    if (chunksToAppend.length === 0) {
      return;
    }

    try {
      sourceBuffer.appendBuffer(combineAudioChunks(chunksToAppend));
    } catch {
      audioChunkQueueRef.current = [];
      audioQueuedBytesRef.current = 0;
    }
  }

  function handleAudioSourceBufferUpdate(): void {
    if (maybePruneAudioBuffer(true)) {
      return;
    }

    syncAudioPlayback();
    flushAudioQueue();
    void resumeAudioPlayback();
  }

  function resetAudioPlayback(options: { keepDisabled?: boolean } = {}): void {
    audioChunkQueueRef.current = [];
    audioQueuedBytesRef.current = 0;
    audioMimeTypeRef.current = null;
    lastAudioSyncAtRef.current = 0;
    lastAudioPruneAtRef.current = 0;
    if (!options.keepDisabled) {
      audioPlaybackDisabledRef.current = false;
    }

    const sourceBuffer = audioSourceBufferRef.current;
    audioSourceBufferRef.current = null;
    if (sourceBuffer) {
      sourceBuffer.removeEventListener("updateend", handleAudioSourceBufferUpdate);
    }

    const mediaSource = audioMediaSourceRef.current;
    audioMediaSourceRef.current = null;
    if (mediaSource && mediaSource.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch {
        // Ignore shutdown races while tearing down the transport.
      }
    }

    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = 1;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }

  function initializeAudioPlayback(mimeType: string): void {
    if (audioPlaybackDisabledRef.current) {
      return;
    }

    if (audioMimeTypeRef.current === mimeType && audioSourceBufferRef.current) {
      return;
    }

    resetAudioPlayback();
    if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mimeType)) {
      audioPlaybackDisabledRef.current = true;
      console.warn("Global browser audio MIME is not supported by MediaSource:", mimeType);
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audioMimeTypeRef.current = mimeType;
    const mediaSource = new MediaSource();
    audioMediaSourceRef.current = mediaSource;
    const objectUrl = URL.createObjectURL(mediaSource);
    audioObjectUrlRef.current = objectUrl;
    audio.src = objectUrl;
    mediaSource.addEventListener("sourceopen", () => {
      if (audioMediaSourceRef.current !== mediaSource) {
        return;
      }

      try {
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = "sequence";
        sourceBuffer.addEventListener("updateend", handleAudioSourceBufferUpdate);
        audioSourceBufferRef.current = sourceBuffer;
        audio.preload = "auto";
        flushAudioQueue();
        void resumeAudioPlayback();
      } catch (error) {
        audioPlaybackDisabledRef.current = true;
        console.warn("Global browser audio source buffer initialization failed:", error);
        resetAudioPlayback({ keepDisabled: true });
      }
    }, { once: true });
    void resumeAudioPlayback();
  }

  function queueAudioChunk(chunk: Uint8Array): void {
    if (audioPlaybackDisabledRef.current) {
      return;
    }

    audioChunkQueueRef.current.push(chunk);
    audioQueuedBytesRef.current += chunk.byteLength;
    while (
      audioQueuedBytesRef.current > GLOBAL_BROWSER_AUDIO_CONFIG.buffering.maxQueuedBytes
      && audioChunkQueueRef.current.length > 1
    ) {
      const droppedChunk = audioChunkQueueRef.current.shift();
      if (!droppedChunk) {
        break;
      }

      audioQueuedBytesRef.current = Math.max(0, audioQueuedBytesRef.current - droppedChunk.byteLength);
    }

    flushAudioQueue();
  }

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      closeSocket();
      resetAudioPlayback();
    };
  }, []);

  useEffect(() => {
    const handleResumeRequest = () => {
      void resumeAudioPlayback();
    };

    window.addEventListener("pointerdown", handleResumeRequest, { passive: true });
    window.addEventListener("keydown", handleResumeRequest);
    return () => {
      window.removeEventListener("pointerdown", handleResumeRequest);
      window.removeEventListener("keydown", handleResumeRequest);
    };
  }, []);

  useEffect(() => {
    clearReconnectTimer();

    let disposed = false;
    initializeAudioPlayback(DEFAULT_GLOBAL_BROWSER_AUDIO_MIME_TYPE);

    const socket = new WebSocket(buildRemoteBrowserAudioStreamUrl());
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.onmessage = (event) => {
      void (async () => {
        if (disposed) {
          return;
        }

        if (typeof event.data !== "string") {
          queueAudioChunk(await readAudioPayload(event.data));
          return;
        }

        let message: BrowserAudioStreamMessage;
        try {
          message = JSON.parse(event.data) as BrowserAudioStreamMessage;
        } catch {
          return;
        }

        if (message.type === "ready") {
          initializeAudioPlayback(message.mimeType);
          return;
        }

        console.warn("Global browser audio stream error:", message.error);
      })();
    };

    socket.onerror = () => {
      if (!disposed) {
        scheduleReconnect();
      }
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (disposed) {
        return;
      }

      resetAudioPlayback();
      scheduleReconnect();
    };

    return () => {
      disposed = true;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      resetAudioPlayback();
    };
  }, [connectionRevision]);

  return <audio ref={audioRef} autoPlay playsInline aria-hidden="true" className="pointer-events-none absolute h-0 w-0 opacity-0" />;
}