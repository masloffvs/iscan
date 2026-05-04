import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import {
  activateRemoteBrowserTab,
  buildRemoteBrowserStreamUrl,
  captureRemoteCloakBrowserScreenshot,
  clickRemoteCloakBrowser,
  gestureRemoteCloakBrowser,
  getRemoteBrowserTabs,
  keyboardRemoteCloakBrowser,
  wheelRemoteCloakBrowser,
  type RemoteBrowserProfileEntry,
  type RemoteBrowserTabEntry,
} from "../api/client";

type BrowserPreviewModalProps = {
  profile: RemoteBrowserProfileEntry;
  onClose: () => void;
};

const PREVIEW_REFRESH_INTERVAL_MS = 1200;
const DRAG_DISTANCE_THRESHOLD = 10;
const STREAM_ATTEMPTS = [
  { quality: 45, everyNthFrame: 1, label: "stream-hq" },
  { quality: 30, everyNthFrame: 2, label: "stream-balanced" },
  { quality: 18, everyNthFrame: 3, label: "stream-lite" },
] as const;

const STREAM_BINARY_KIND_IMAGE = 1;
const STREAM_BINARY_KIND_AUDIO = 2;

type PreviewTransportMode = "idle" | "poll" | "stream";

type BrowserPreviewStreamMessage =
  | { type: "ready"; transport: "screencast"; mimeType?: string; audioMimeType?: string; quality?: number; everyNthFrame?: number }
  | { type: "tabs"; tabs: RemoteBrowserTabEntry[] }
  | { type: "error"; error: string };

type PreviewPoint = {
  x: number;
  y: number;
};

function summarizeTab(tab: RemoteBrowserTabEntry): string {
  const text = tab.title?.trim() || tab.url.trim() || tab.id;
  return text.length > 0 ? text : tab.id;
}

async function decodeStreamBinaryMessage(data: Blob | ArrayBuffer): Promise<{ kind: number; payload: Uint8Array } | null> {
  const bytes = data instanceof Blob
    ? new Uint8Array(await data.arrayBuffer())
    : new Uint8Array(data);
  if (bytes.length === 0) {
    return null;
  }

  return {
    kind: bytes[0] ?? 0,
    payload: bytes.subarray(1),
  };
}

export default function BrowserPreviewModal({ profile, onClose }: BrowserPreviewModalProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const pointerPathRef = useRef<PreviewPoint[]>([]);
  const isPointerDownRef = useRef<boolean>(false);
  const refreshTimerRef = useRef<number | null>(null);
  const streamSocketRef = useRef<WebSocket | null>(null);
  const streamObjectUrlRef = useRef<string | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const audioMediaSourceRef = useRef<MediaSource | null>(null);
  const audioSourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioChunkQueueRef = useRef<Uint8Array[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  const transportModeRef = useRef<PreviewTransportMode>("idle");
  const audioPlaybackDisabledRef = useRef<boolean>(false);
  const audioMimeTypeRef = useRef<string | null>(null);
  const streamMimeTypeRef = useRef<string>("image/jpeg");
  const [streamRevision, setStreamRevision] = useState<number>(0);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [tabs, setTabs] = useState<RemoteBrowserTabEntry[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isClicking, setIsClicking] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Live preview updates automatically. Click, drag, scroll, or type into the preview.");

  function replaceScreenshot(nextUrl: string | null, options: { objectUrl?: boolean } = {}): void {
    if (streamObjectUrlRef.current) {
      URL.revokeObjectURL(streamObjectUrlRef.current);
      streamObjectUrlRef.current = null;
    }

    if (options.objectUrl && nextUrl) {
      streamObjectUrlRef.current = nextUrl;
    }

    setScreenshotUrl(nextUrl);
  }

  function closeStreamSocket(): void {
    const socket = streamSocketRef.current;
    streamSocketRef.current = null;
    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  function flushAudioQueue(): void {
    const sourceBuffer = audioSourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating || audioChunkQueueRef.current.length === 0) {
      return;
    }

    const nextChunk = audioChunkQueueRef.current.shift();
    if (!nextChunk) {
      return;
    }

    try {
      sourceBuffer.appendBuffer(nextChunk);
    } catch {
      audioChunkQueueRef.current = [];
    }
  }

  function resetAudioPlayback(options: { keepDisabled?: boolean } = {}): void {
    audioChunkQueueRef.current = [];
    if (!options.keepDisabled) {
      audioPlaybackDisabledRef.current = false;
    }
    audioMimeTypeRef.current = null;

    const sourceBuffer = audioSourceBufferRef.current;
    audioSourceBufferRef.current = null;
    if (sourceBuffer) {
      sourceBuffer.removeEventListener("updateend", flushAudioQueue);
    }

    const mediaSource = audioMediaSourceRef.current;
    audioMediaSourceRef.current = null;
    if (mediaSource && mediaSource.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch {
        // Ignore shutdown errors during transport resets.
      }
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }

  async function resumeAudioPlayback(): Promise<void> {
    const audio = audioRef.current;
    if (!audio || audioPlaybackDisabledRef.current) {
      return;
    }

    await audio.play().catch(() => {
      // Browser autoplay policies may defer playback until the next user gesture.
    });
  }

  function queueAudioChunk(chunk: Uint8Array): void {
    if (audioPlaybackDisabledRef.current) {
      return;
    }

    audioChunkQueueRef.current.push(chunk);
    flushAudioQueue();
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
      setStatus((current) => `${current} Audio transport is available, but this browser cannot play ${mimeType}.`);
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
        sourceBuffer.addEventListener("updateend", flushAudioQueue);
        audioSourceBufferRef.current = sourceBuffer;
        flushAudioQueue();
        void resumeAudioPlayback();
      } catch {
        audioPlaybackDisabledRef.current = true;
        resetAudioPlayback({ keepDisabled: true });
      }
    }, { once: true });
    void resumeAudioPlayback();
  }

  function restartStream(): void {
    setStreamRevision((current) => current + 1);
  }

  function applyTabs(nextTabs: RemoteBrowserTabEntry[], options: { restartStreamOnActiveChange?: boolean } = {}): void {
    const nextActiveTabId = nextTabs.find((tab) => tab.active)?.id ?? null;
    const previousActiveTabId = activeTabIdRef.current;
    activeTabIdRef.current = nextActiveTabId;
    setTabs(nextTabs);
    setActiveTabId(nextActiveTabId);

    if (
      options.restartStreamOnActiveChange
      && transportModeRef.current === "stream"
      && previousActiveTabId
      && nextActiveTabId
      && nextActiveTabId !== previousActiveTabId
    ) {
      setStatus("Active tab changed. Reconnecting stream...");
      restartStream();
    }
  }

  function redrawCanvas(path: PreviewPoint[] = pointerPathRef.current): void {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
    if (path.length < 2) {
      return;
    }

    context.save();
    context.strokeStyle = "rgba(255, 102, 102, 0.92)";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(path[0]!.x, path[0]!.y);
    for (const point of path.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.stroke();

    const lastPoint = path[path.length - 1];
    if (lastPoint) {
      context.fillStyle = "rgba(255, 255, 255, 0.95)";
      context.beginPath();
      context.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function toCanvasPoint(clientX: number, clientY: number): PreviewPoint | null {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const rawX = (clientX - rect.left) * scaleX;
    const rawY = (clientY - rect.top) * scaleY;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(rawX)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(rawY)));

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return { x, y };
  }

  function getPathDistance(points: PreviewPoint[]): number {
    let distance = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previousPoint = points[index - 1]!;
      const point = points[index]!;
      distance += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    }
    return distance;
  }

  async function refreshTabs(): Promise<void> {
    if (!profile.isRunning) {
      applyTabs([]);
      return;
    }

    const nextTabs = await getRemoteBrowserTabs(profile.id);
    applyTabs(nextTabs);
  }

  function scheduleRefresh(delayMs = 160): void {
    if (transportModeRef.current === "stream") {
      return;
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshScreenshot();
      void refreshTabs();
    }, delayMs);
  }

  async function refreshScreenshot(): Promise<void> {
    if (!profile.isRunning) {
      replaceScreenshot(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextScreenshotUrl = await captureRemoteCloakBrowserScreenshot(profile.id);
      replaceScreenshot(nextScreenshotUrl);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === previewViewportRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      closeStreamSocket();
      resetAudioPlayback();
      if (streamObjectUrlRef.current) {
        URL.revokeObjectURL(streamObjectUrlRef.current);
        streamObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let fallbackIntervalId: number | null = null;

    if (!profile.isRunning) {
      transportModeRef.current = "idle";
      closeStreamSocket();
      resetAudioPlayback();
      replaceScreenshot(null);
      applyTabs([]);
      setStatus("Launch the browser to use interactive preview.");
      return;
    }

    const tick = async () => {
      const [screenshotResult, tabsResult] = await Promise.allSettled([
        captureRemoteCloakBrowserScreenshot(profile.id),
        getRemoteBrowserTabs(profile.id),
      ]);
      if (disposed) {
        return;
      }

      if (screenshotResult.status === "fulfilled") {
        replaceScreenshot(screenshotResult.value);
      }

      if (tabsResult.status === "fulfilled") {
        applyTabs(tabsResult.value);
      }

      setIsLoading(false);
    };

    const startPollingFallback = (nextStatus?: string) => {
      if (disposed || fallbackIntervalId !== null) {
        return;
      }

      transportModeRef.current = "poll";
      resetAudioPlayback();
      if (nextStatus) {
        setStatus(nextStatus);
      }

      void tick();
      fallbackIntervalId = window.setInterval(() => {
        void tick();
      }, PREVIEW_REFRESH_INTERVAL_MS);
    };

    const openStreamAttempt = (attemptIndex: number) => {
      if (disposed) {
        return;
      }

      const attempt = STREAM_ATTEMPTS[attemptIndex];
      if (!attempt) {
        startPollingFallback("Screencast unavailable. Falling back to snapshots.");
        return;
      }

      resetAudioPlayback();
      const streamSocket = new WebSocket(buildRemoteBrowserStreamUrl(profile.id, attempt));
      streamSocket.binaryType = "arraybuffer";
      streamSocketRef.current = streamSocket;
      let streamReceivedFrame = false;

      streamSocket.onmessage = (event) => {
        void (async () => {
        if (disposed) {
          return;
        }

        if (typeof event.data !== "string") {
          const binaryMessage = await decodeStreamBinaryMessage(event.data);
          if (!binaryMessage) {
            return;
          }

          if (binaryMessage.kind === STREAM_BINARY_KIND_AUDIO) {
            queueAudioChunk(binaryMessage.payload);
            return;
          }

          if (binaryMessage.kind !== STREAM_BINARY_KIND_IMAGE) {
            return;
          }

          streamReceivedFrame = true;
          transportModeRef.current = "stream";
          const blob = new Blob([binaryMessage.payload], { type: streamMimeTypeRef.current });
          replaceScreenshot(URL.createObjectURL(blob), { objectUrl: true });
          setIsLoading(false);
          return;
        }

        let message: BrowserPreviewStreamMessage;
        try {
          message = JSON.parse(event.data) as BrowserPreviewStreamMessage;
        } catch {
          return;
        }

        if (message.type === "ready") {
          streamMimeTypeRef.current = message.mimeType ?? "image/jpeg";
          if (message.audioMimeType) {
            initializeAudioPlayback(message.audioMimeType);
          }
          setStatus(message.audioMimeType
            ? `Live preview streaming with audio via screencast (${attempt.label}).`
            : `Live preview streaming via screencast (${attempt.label}).`);
          return;
        }

        if (message.type === "tabs") {
          applyTabs(message.tabs, { restartStreamOnActiveChange: true });
          return;
        }

        setStatus(`Screencast failed: ${message.error}`);
        })();
      };

      streamSocket.onerror = () => {
        if (!disposed) {
          setStatus(`Screencast ${attempt.label} failed. Trying a lighter stream...`);
        }
      };

      streamSocket.onclose = () => {
        if (streamSocketRef.current === streamSocket) {
          streamSocketRef.current = null;
        }

        if (disposed) {
          return;
        }

        if (streamReceivedFrame) {
          if (attemptIndex + 1 < STREAM_ATTEMPTS.length) {
            setStatus(`Screencast disconnected. Retrying with ${STREAM_ATTEMPTS[attemptIndex + 1]!.label}...`);
            openStreamAttempt(attemptIndex + 1);
            return;
          }

          startPollingFallback("Screencast disconnected. Falling back to snapshots.");
          return;
        }

        if (attemptIndex + 1 < STREAM_ATTEMPTS.length) {
          openStreamAttempt(attemptIndex + 1);
          return;
        }

        startPollingFallback("Screencast unavailable. Falling back to snapshots.");
      };
    };

    setIsLoading(true);
    void tick();
    openStreamAttempt(0);

    return () => {
      disposed = true;
      closeStreamSocket();
      resetAudioPlayback();
      if (fallbackIntervalId !== null) {
        window.clearInterval(fallbackIntervalId);
      }
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [profile.id, profile.isRunning, streamRevision]);

  useEffect(() => {
    if (screenshotUrl) {
      canvasRef.current?.focus();
    }
  }, [screenshotUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !screenshotUrl) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      imageRef.current = image;
      redrawCanvas();
    };
    image.src = screenshotUrl;
  }, [screenshotUrl]);

  async function toggleFullscreen(): Promise<void> {
    const element = previewViewportRef.current;
    if (!element) {
      return;
    }

    if (document.fullscreenElement === element) {
      await document.exitFullscreen().catch(() => {});
      return;
    }

    await element.requestFullscreen().catch(() => {});
  }

  async function handleTabSelect(tabId: string): Promise<void> {
    if (!profile.isRunning || tabId === activeTabId) {
      return;
    }

    setStatus(`Switching to ${tabId}...`);
    try {
      await activateRemoteBrowserTab(profile.id, tabId);
      await refreshTabs();
      if (transportModeRef.current === "stream") {
        restartStream();
      } else {
        await refreshScreenshot();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>): Promise<void> {
    if (!profile.isRunning || isClicking || isLoading || !screenshotUrl) {
      return;
    }

    void resumeAudioPlayback();
    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      setStatus("Preview is still initializing. Try again in a moment.");
      return;
    }

    isPointerDownRef.current = true;
    pointerPathRef.current = [point];
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    redrawCanvas(pointerPathRef.current);
    setStatus(`Gesture start ${point.x} x ${point.y}.`);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!isPointerDownRef.current) {
      return;
    }

    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    const currentPath = pointerPathRef.current;
    const lastPoint = currentPath[currentPath.length - 1];
    if (lastPoint && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 3) {
      return;
    }

    pointerPathRef.current = [...currentPath, point];
    redrawCanvas(pointerPathRef.current);
    setStatus(`Gesture path: ${pointerPathRef.current.length} points.`);
  }

  async function finishPointerInteraction(pointerId?: number, sourceElement?: HTMLCanvasElement | null): Promise<void> {
    const currentPath = [...pointerPathRef.current];
    pointerPathRef.current = [];
    isPointerDownRef.current = false;
    if (pointerId !== undefined && sourceElement?.hasPointerCapture(pointerId)) {
      sourceElement.releasePointerCapture(pointerId);
    }
    redrawCanvas([]);

    if (!profile.isRunning || currentPath.length === 0) {
      return;
    }

    const pathDistance = getPathDistance(currentPath);
    setIsClicking(true);
    try {
      if (currentPath.length > 1 && pathDistance >= DRAG_DISTANCE_THRESHOLD) {
        setStatus(`Gesture forwarded with ${currentPath.length} points.`);
        await gestureRemoteCloakBrowser(profile.id, currentPath);
      } else {
        const point = currentPath[0]!;
        setStatus(`Click forwarded to ${point.x} x ${point.y}.`);
        await clickRemoteCloakBrowser(profile.id, point.x, point.y);
      }

      scheduleRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClicking(false);
    }
  }

  async function handleCanvasPointerUp(event: React.PointerEvent<HTMLCanvasElement>): Promise<void> {
    if (!isPointerDownRef.current) {
      return;
    }

    const point = toCanvasPoint(event.clientX, event.clientY);
    if (point) {
      const currentPath = pointerPathRef.current;
      const lastPoint = currentPath[currentPath.length - 1];
      if (!lastPoint || lastPoint.x !== point.x || lastPoint.y !== point.y) {
        pointerPathRef.current = [...currentPath, point];
      }
    }

    await finishPointerInteraction(event.pointerId, event.currentTarget);
  }

  async function handleCanvasPointerCancel(event: React.PointerEvent<HTMLCanvasElement>): Promise<void> {
    if (!isPointerDownRef.current) {
      return;
    }

    await finishPointerInteraction(event.pointerId, event.currentTarget);
  }

  async function handleCanvasWheel(event: React.WheelEvent<HTMLCanvasElement>): Promise<void> {
    if (!profile.isRunning || isLoading || !screenshotUrl || isPointerDownRef.current) {
      return;
    }

    void resumeAudioPlayback();
    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus();
    setStatus(`Scroll forwarded at ${point.x} x ${point.y}.`);
    try {
      await wheelRemoteCloakBrowser(profile.id, point.x, point.y, event.deltaX, event.deltaY);
      scheduleRefresh(120);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCanvasKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>): Promise<void> {
    if (!profile.isRunning || isLoading || isPointerDownRef.current) {
      return;
    }

    void resumeAudioPlayback();
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setStatus(`Key forwarded: ${event.key}.`);
    try {
      await keyboardRemoteCloakBrowser(profile.id, {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      scheduleRefresh(100);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeTitle = activeTab ? summarizeTab(activeTab) : (profile.currentUrl ?? profile.name);

  return (
    <Modal title={`${profile.name} Live Preview`} onClose={onClose}>
      <div className="flex h-full flex-col gap-2">
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-white">{activeTitle}</p>
            <p className="truncate text-[10px] text-[#71717a]">{status}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { void refreshTabs(); }}
              disabled={!profile.isRunning}
              className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              Tabs
            </button>
            <button
              type="button"
              onClick={() => { void refreshScreenshot(); void refreshTabs(); }}
              disabled={!profile.isRunning || isLoading}
              className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              {isLoading ? "Updating..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => { void toggleFullscreen(); }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] text-white transition hover:bg-white/[0.12]"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
              )}
            </button>
          </div>
        </div>

        <div className={[
          "overflow-hidden rounded-[20px] border border-white/6 bg-[#101114]",
          isFullscreen ? "h-screen w-screen rounded-none border-0 bg-[#050505]" : "",
        ].join(" ")}>
          {tabs.length > 0 ? (
            <div
              className="overflow-x-auto overflow-y-hidden border-b border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onWheel={(event) => {
                const element = event.currentTarget;
                if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) {
                  return;
                }

                event.preventDefault();
                element.scrollBy({ left: event.deltaY, behavior: "auto" });
              }}
            >
              <div className="flex min-w-max snap-x snap-mandatory items-end gap-px scroll-pl-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => { void handleTabSelect(tab.id); }}
                    className={[
                      "relative top-px min-w-0 max-w-[180px] shrink-0 snap-start rounded-t-[10px] border border-b-0 px-3 py-1.5 text-left text-[10px] transition",
                      tab.active
                        ? "border-white/10 bg-[#17181c] text-white shadow-[0_-1px_0_rgba(255,255,255,0.04)]"
                        : "border-transparent bg-[#141519] text-[#9da1ae] hover:border-white/6 hover:bg-[#1a1b20] hover:text-white",
                    ].join(" ")}
                  >
                    <span className="block truncate font-medium leading-none">{summarizeTab(tab)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div
            ref={previewViewportRef}
            className={[
              "overflow-auto bg-black p-0",
              isFullscreen ? "flex h-screen w-screen items-center justify-center overflow-auto bg-[#050505] p-0" : "",
            ].join(" ")}
          >
            {profile.isRunning ? (
              screenshotUrl ? (
                <canvas
                  ref={canvasRef}
                  tabIndex={0}
                  onPointerDown={(event) => { void handleCanvasPointerDown(event); }}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={(event) => { void handleCanvasPointerUp(event); }}
                  onPointerCancel={(event) => { void handleCanvasPointerCancel(event); }}
                  onWheel={(event) => { void handleCanvasWheel(event); }}
                  onKeyDown={(event) => { void handleCanvasKeyDown(event); }}
                  className={[
                    "block cursor-crosshair touch-none outline-none",
                    isFullscreen
                      ? "mx-auto h-auto max-h-screen w-auto max-w-full"
                      : "w-full",
                  ].join(" ")}
                />
              ) : (
                <div className="flex h-[420px] items-center justify-center text-[11px] text-[#6d6d78]">
                  {isLoading ? "Capturing screenshot..." : "No screenshot available."}
                </div>
              )
            ) : (
              <div className="flex h-[420px] items-center justify-center text-[11px] text-[#6d6d78]">
                Launch the browser to enable live preview and click forwarding.
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}