import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  activateRemoteBrowserTab,
  buildRemoteBrowserStreamUrl,
  captureRemoteCloakBrowserScreenshot,
  clickRemoteCloakBrowser,
  closeRemoteBrowserTab,
  gestureRemoteCloakBrowser,
  getRemoteBrowserTabs,
  insertRemoteBrowserText,
  keyboardRemoteCloakBrowser,
  readRemoteBrowserSelection,
  wheelRemoteCloakBrowser,
  type RemoteBrowserProfileEntry,
  type RemoteBrowserTabEntry,
} from "../api/client";

const LIVE_PREVIEW_CONFIG = {
  tuning: {
    refreshIntervalMs: 1200,
    pollingRecovery: {
      backoffFactor: 2,
      maxBackoffMs: 9600,
      noisyFailureThreshold: 3,
    },
    dragDistanceThreshold: 10,
    pointerPath: {
      jitterThreshold: 6,
      maxSegmentLength: 18,
    },
    streamQuality: {
      pendingFrameDegradeThreshold: 3,
      slowFrameDegradeThreshold: 4,
      slowFrameLagMs: 140,
      degradeCooldownMs: 1800,
      upgradeStableMs: 9000,
      upgradeCooldownMs: 6000,
    },
  },
  streamAttempts: [
    { quality: 45, everyNthFrame: 1, label: "stream-hq" },
    { quality: 30, everyNthFrame: 2, label: "stream-balanced" },
    { quality: 18, everyNthFrame: 3, label: "stream-lite" },
  ],
} as const;

const STREAM_BINARY_KIND_IMAGE = 1;

type PreviewTransportMode = "idle" | "poll" | "stream";

type BrowserPreviewStreamMessage =
  | { type: "ready"; transport: "screencast"; mimeType?: string; quality?: number; everyNthFrame?: number }
  | { type: "tabs"; tabs: RemoteBrowserTabEntry[] }
  | { type: "error"; error: string };

type BrowserPreviewStreamClientMessage =
  | { type: "refresh-tabs" }
  | { type: "pointer-down" | "pointer-move" | "pointer-up"; x: number; y: number };

type PreviewPoint = {
  x: number;
  y: number;
};

type BrowserLivePreviewControllerOptions = {
  profile: RemoteBrowserProfileEntry;
  suppressLiveStatusUpdates: boolean;
};

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

export function useBrowserLivePreviewController({
  profile,
  suppressLiveStatusUpdates,
}: BrowserLivePreviewControllerOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const pointerPathRef = useRef<PreviewPoint[]>([]);
  const isPointerDownRef = useRef<boolean>(false);
  const refreshTimerRef = useRef<number | null>(null);
  const streamSocketRef = useRef<WebSocket | null>(null);
  const streamObjectUrlRef = useRef<string | null>(null);
  const preferredStreamAttemptIndexRef = useRef<number>(0);
  const pendingAdaptiveStreamAttemptIndexRef = useRef<number | null>(null);
  const pendingAdaptiveStreamReasonRef = useRef<string | null>(null);
  const streamFramePendingRef = useRef<boolean>(false);
  const streamPendingFrameCountRef = useRef<number>(0);
  const streamSlowFrameCountRef = useRef<number>(0);
  const streamFrameStartedAtRef = useRef<number | null>(null);
  const streamStableSinceRef = useRef<number | null>(null);
  const streamQualityCooldownUntilRef = useRef<number>(0);
  const activeTabIdRef = useRef<string | null>(null);
  const suppressNextActiveChangeRestartRef = useRef<boolean>(false);
  const transportModeRef = useRef<PreviewTransportMode>("idle");
  const isStreamingPointerRef = useRef<boolean>(false);
  const pendingPointerMoveRef = useRef<PreviewPoint | null>(null);
  const pointerMoveFrameRef = useRef<number | null>(null);
  const typeBufferRef = useRef<string>("");
  const typeFlushTimerRef = useRef<number | null>(null);
  const streamMimeTypeRef = useRef<string>("image/jpeg");
  const screenshotRevisionRef = useRef<number>(0);
  const screenshotRequestPromiseRef = useRef<Promise<string | null> | null>(null);
  const tabsRequestPromiseRef = useRef<Promise<RemoteBrowserTabEntry[]> | null>(null);
  const pollingTickPromiseRef = useRef<Promise<void> | null>(null);
  const hasScreenshotRef = useRef<boolean>(false);
  const [streamRevision, setStreamRevision] = useState<number>(0);
  const [tabs, setTabs] = useState<RemoteBrowserTabEntry[]>([]);
  const [hasScreenshot, setHasScreenshot] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isClicking, setIsClicking] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Live preview updates automatically. Click, drag, scroll, or type into the preview.");

  function setStatusMessage(nextStatus: string, options: { force?: boolean } = {}): void {
    if (suppressLiveStatusUpdates && !options.force) {
      return;
    }

    setStatus(nextStatus);
  }

  function canRequestTabsOverStream(): boolean {
    const socket = streamSocketRef.current;
    return transportModeRef.current === "stream"
      && socket?.readyState === WebSocket.OPEN;
  }

  function sendBrowserStreamMessage(message: BrowserPreviewStreamClientMessage): boolean {
    const socket = streamSocketRef.current;
    if (!canRequestTabsOverStream() || !socket) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  function requestTabsOverStream(): boolean {
    return sendBrowserStreamMessage({ type: "refresh-tabs" });
  }

  async function flushTypedTextBuffer(): Promise<void> {
    if (typeFlushTimerRef.current !== null) {
      window.clearTimeout(typeFlushTimerRef.current);
      typeFlushTimerRef.current = null;
    }

    const text = typeBufferRef.current;
    typeBufferRef.current = "";
    if (!text) {
      return;
    }

    await insertRemoteBrowserText(profile.id, text);
  }

  function queueTypedText(text: string): void {
    typeBufferRef.current += text;
    if (typeFlushTimerRef.current !== null) {
      window.clearTimeout(typeFlushTimerRef.current);
    }

    typeFlushTimerRef.current = window.setTimeout(() => {
      typeFlushTimerRef.current = null;
      void flushTypedTextBuffer().catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
      });
    }, 34);
  }

  async function writeTextToClipboard(text: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("Clipboard write is not available in this browser.");
    }

    await navigator.clipboard.writeText(text);
  }

  async function readTextFromClipboard(): Promise<string> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      throw new Error("Clipboard read is not available in this browser.");
    }

    return await navigator.clipboard.readText();
  }

  function updateScreenshotVisibility(nextVisible: boolean): void {
    if (hasScreenshotRef.current === nextVisible) {
      return;
    }

    hasScreenshotRef.current = nextVisible;
    setHasScreenshot(nextVisible);
  }

  function resetStreamPressureTracking(options: { resetPreferredAttempt?: boolean } = {}): void {
    pendingAdaptiveStreamAttemptIndexRef.current = null;
    pendingAdaptiveStreamReasonRef.current = null;
    streamFramePendingRef.current = false;
    streamPendingFrameCountRef.current = 0;
    streamSlowFrameCountRef.current = 0;
    streamFrameStartedAtRef.current = null;
    streamStableSinceRef.current = null;
    streamQualityCooldownUntilRef.current = 0;

    if (options.resetPreferredAttempt) {
      preferredStreamAttemptIndexRef.current = 0;
    }
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

  function requestAdaptiveStreamDowngrade(currentAttemptIndex: number, reason: string): void {
    const nextAttemptIndex = currentAttemptIndex + 1;
    const nextAttempt = LIVE_PREVIEW_CONFIG.streamAttempts[nextAttemptIndex];
    if (!nextAttempt) {
      return;
    }

    const now = performance.now();
    if (streamQualityCooldownUntilRef.current > now) {
      return;
    }

    if (preferredStreamAttemptIndexRef.current >= nextAttemptIndex) {
      return;
    }

    preferredStreamAttemptIndexRef.current = nextAttemptIndex;
    pendingAdaptiveStreamAttemptIndexRef.current = nextAttemptIndex;
    pendingAdaptiveStreamReasonRef.current = reason;
    streamQualityCooldownUntilRef.current = now + LIVE_PREVIEW_CONFIG.tuning.streamQuality.degradeCooldownMs;
    closeStreamSocket();
  }

  function requestAdaptiveStreamUpgrade(currentAttemptIndex: number, reason: string): void {
    const nextAttemptIndex = currentAttemptIndex - 1;
    const nextAttempt = LIVE_PREVIEW_CONFIG.streamAttempts[nextAttemptIndex];
    if (!nextAttempt) {
      return;
    }

    const now = performance.now();
    if (streamQualityCooldownUntilRef.current > now) {
      return;
    }

    if (preferredStreamAttemptIndexRef.current <= nextAttemptIndex) {
      return;
    }

    preferredStreamAttemptIndexRef.current = nextAttemptIndex;
    pendingAdaptiveStreamAttemptIndexRef.current = nextAttemptIndex;
    pendingAdaptiveStreamReasonRef.current = reason;
    streamQualityCooldownUntilRef.current = now + LIVE_PREVIEW_CONFIG.tuning.streamQuality.upgradeCooldownMs;
    closeStreamSocket();
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

    if (path.length === 2) {
      const endPoint = path[1]!;
      context.lineTo(endPoint.x, endPoint.y);
    } else {
      for (let index = 1; index < path.length - 1; index += 1) {
        const point = path[index]!;
        const nextPoint = path[index + 1]!;
        const midpointX = (point.x + nextPoint.x) / 2;
        const midpointY = (point.y + nextPoint.y) / 2;
        context.quadraticCurveTo(point.x, point.y, midpointX, midpointY);
      }

      const lastPoint = path[path.length - 1]!;
      context.lineTo(lastPoint.x, lastPoint.y);
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

  function replaceScreenshot(
    nextUrl: string | null,
    options: { objectUrl?: boolean; streamAttemptIndex?: number } = {},
  ): void {
    const hadScreenshot = hasScreenshotRef.current;
    screenshotRevisionRef.current += 1;
    const screenshotRevision = screenshotRevisionRef.current;
    const streamAttemptIndex = typeof options.streamAttemptIndex === "number"
      ? options.streamAttemptIndex
      : null;
    const isStreamFrame = options.objectUrl && streamAttemptIndex !== null;

    if (isStreamFrame) {
      if (streamFramePendingRef.current) {
        streamStableSinceRef.current = performance.now();
        streamPendingFrameCountRef.current += 1;
        if (streamPendingFrameCountRef.current >= LIVE_PREVIEW_CONFIG.tuning.streamQuality.pendingFrameDegradeThreshold) {
          requestAdaptiveStreamDowngrade(
            streamAttemptIndex,
            `Screencast ${LIVE_PREVIEW_CONFIG.streamAttempts[streamAttemptIndex]!.label} is outrunning canvas rendering. Lowering quality.`,
          );
        }
      }

      streamFramePendingRef.current = true;
      streamFrameStartedAtRef.current = performance.now();
    }

    if (streamObjectUrlRef.current) {
      URL.revokeObjectURL(streamObjectUrlRef.current);
      streamObjectUrlRef.current = null;
    }

    if (options.objectUrl && nextUrl) {
      streamObjectUrlRef.current = nextUrl;
    }

    if (!nextUrl) {
      streamFramePendingRef.current = false;
      streamFrameStartedAtRef.current = null;
      streamStableSinceRef.current = null;
      imageRef.current = null;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
      updateScreenshotVisibility(false);
      return;
    }

    const image = new Image();
    image.onload = () => {
      if (screenshotRevisionRef.current !== screenshotRevision) {
        return;
      }

      if (isStreamFrame) {
        const now = performance.now();
        streamFramePendingRef.current = false;
        const renderLagMs = streamFrameStartedAtRef.current === null
          ? 0
          : now - streamFrameStartedAtRef.current;
        streamFrameStartedAtRef.current = null;
        streamPendingFrameCountRef.current = 0;
        if (renderLagMs >= LIVE_PREVIEW_CONFIG.tuning.streamQuality.slowFrameLagMs) {
          streamSlowFrameCountRef.current += 1;
          streamStableSinceRef.current = now;
          if (streamSlowFrameCountRef.current >= LIVE_PREVIEW_CONFIG.tuning.streamQuality.slowFrameDegradeThreshold) {
            requestAdaptiveStreamDowngrade(
              streamAttemptIndex,
              `Screencast ${LIVE_PREVIEW_CONFIG.streamAttempts[streamAttemptIndex]!.label} is decoding too slowly on this client. Lowering quality.`,
            );
          }
        } else {
          streamSlowFrameCountRef.current = 0;
          if (streamStableSinceRef.current === null) {
            streamStableSinceRef.current = now;
          }

          if (
            streamAttemptIndex > 0
            && now - streamStableSinceRef.current >= LIVE_PREVIEW_CONFIG.tuning.streamQuality.upgradeStableMs
          ) {
            requestAdaptiveStreamUpgrade(
              streamAttemptIndex,
              `Screencast ${LIVE_PREVIEW_CONFIG.streamAttempts[streamAttemptIndex]!.label} has stayed stable. Restoring ${LIVE_PREVIEW_CONFIG.streamAttempts[streamAttemptIndex - 1]!.label}.`,
            );
          }
        }
      }

      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        return;
      }

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      imageRef.current = image;
      redrawCanvas();
      updateScreenshotVisibility(true);
    };
    image.onerror = () => {
      if (screenshotRevisionRef.current !== screenshotRevision) {
        return;
      }

      if (isStreamFrame) {
        streamFramePendingRef.current = false;
        streamFrameStartedAtRef.current = null;
        streamStableSinceRef.current = null;
      }

      if (!hadScreenshot) {
        updateScreenshotVisibility(false);
      }
    };
    image.src = nextUrl;
  }

  function restartStream(): void {
    setStreamRevision((current) => current + 1);
  }

  function normalizePointerSegment(startPoint: PreviewPoint, endPoint: PreviewPoint): PreviewPoint[] {
    const deltaX = endPoint.x - startPoint.x;
    const deltaY = endPoint.y - startPoint.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance) || distance < LIVE_PREVIEW_CONFIG.tuning.pointerPath.jitterThreshold) {
      return [];
    }

    const segmentCount = Math.max(1, Math.ceil(distance / LIVE_PREVIEW_CONFIG.tuning.pointerPath.maxSegmentLength));
    const normalizedPoints: PreviewPoint[] = [];
    for (let index = 1; index <= segmentCount; index += 1) {
      const progress = index / segmentCount;
      const point = {
        x: Math.round(startPoint.x + deltaX * progress),
        y: Math.round(startPoint.y + deltaY * progress),
      };
      const previousPoint = normalizedPoints[normalizedPoints.length - 1] ?? startPoint;
      if (previousPoint.x === point.x && previousPoint.y === point.y) {
        continue;
      }

      normalizedPoints.push(point);
    }

    return normalizedPoints;
  }

  function appendPointerPoint(point: PreviewPoint): PreviewPoint[] {
    const currentPath = pointerPathRef.current;
    const lastPoint = currentPath[currentPath.length - 1];
    if (!lastPoint) {
      pointerPathRef.current = [point];
      return pointerPathRef.current;
    }

    const normalizedPoints = normalizePointerSegment(lastPoint, point);
    if (normalizedPoints.length === 0) {
      return currentPath;
    }

    pointerPathRef.current = [...currentPath, ...normalizedPoints];
    return pointerPathRef.current;
  }

  function flushPendingPointerMove(): void {
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }

    const point = pendingPointerMoveRef.current;
    pendingPointerMoveRef.current = null;
    if (!point || !isStreamingPointerRef.current) {
      return;
    }

    sendBrowserStreamMessage({ type: "pointer-move", x: point.x, y: point.y });
  }

  function queuePointerMove(point: PreviewPoint): void {
    pendingPointerMoveRef.current = point;
    if (pointerMoveFrameRef.current !== null) {
      return;
    }

    pointerMoveFrameRef.current = window.requestAnimationFrame(() => {
      pointerMoveFrameRef.current = null;
      flushPendingPointerMove();
    });
  }

  function applyTabs(nextTabs: RemoteBrowserTabEntry[], options: { restartStreamOnActiveChange?: boolean } = {}): void {
    const nextActiveTabId = nextTabs.find((tab) => tab.active)?.id ?? null;
    const previousActiveTabId = activeTabIdRef.current;
    activeTabIdRef.current = nextActiveTabId;
    setTabs(nextTabs);

    if (previousActiveTabId !== nextActiveTabId && suppressNextActiveChangeRestartRef.current) {
      suppressNextActiveChangeRestartRef.current = false;
      return;
    }

    if (
      options.restartStreamOnActiveChange
      && transportModeRef.current === "stream"
      && previousActiveTabId
      && nextActiveTabId
      && nextActiveTabId !== previousActiveTabId
    ) {
      setStatusMessage("Active tab changed. Reconnecting stream...");
      restartStream();
    }
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

  async function refreshTabs(options: { forceApi?: boolean } = {}): Promise<void> {
    if (!profile.isRunning) {
      applyTabs([]);
      return;
    }

    if (!options.forceApi && requestTabsOverStream()) {
      return;
    }

    const nextTabs = await requestTabsSnapshot();
    applyTabs(nextTabs);
  }

  function requestScreenshotSnapshot(): Promise<string | null> {
    if (screenshotRequestPromiseRef.current) {
      return screenshotRequestPromiseRef.current;
    }

    const request = captureRemoteCloakBrowserScreenshot(profile.id)
      .finally(() => {
        if (screenshotRequestPromiseRef.current === request) {
          screenshotRequestPromiseRef.current = null;
        }
      });
    screenshotRequestPromiseRef.current = request;
    return request;
  }

  function requestTabsSnapshot(): Promise<RemoteBrowserTabEntry[]> {
    if (tabsRequestPromiseRef.current) {
      return tabsRequestPromiseRef.current;
    }

    const request = getRemoteBrowserTabs(profile.id)
      .finally(() => {
        if (tabsRequestPromiseRef.current === request) {
          tabsRequestPromiseRef.current = null;
        }
      });
    tabsRequestPromiseRef.current = request;
    return request;
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
      const nextScreenshotUrl = await requestScreenshotSnapshot();
      if (nextScreenshotUrl || !hasScreenshotRef.current) {
        replaceScreenshot(nextScreenshotUrl);
      }
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
    const tabStrip = tabStripRef.current;
    if (!tabStrip) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (tabStrip.scrollWidth <= tabStrip.clientWidth) {
        return;
      }

      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      tabStrip.scrollBy({ left: delta, behavior: "auto" });
    };

    tabStrip.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      tabStrip.removeEventListener("wheel", handleNativeWheel);
    };
  }, [tabs.length]);

  useEffect(() => {
    const previewViewport = previewViewportRef.current;
    if (!previewViewport) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      const canvas = canvasRef.current;
      if (canvas && event.target instanceof Node && canvas.contains(event.target)) {
        return;
      }

      event.stopPropagation();
      if (profile.isRunning) {
        event.preventDefault();
      }
    };

    previewViewport.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      previewViewport.removeEventListener("wheel", handleNativeWheel);
    };
  }, [profile.id, profile.isRunning]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const handleNativeCanvasWheel = (event: WheelEvent) => {
      if (!profile.isRunning || isLoading || !hasScreenshotRef.current || isPointerDownRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const clientX = event.clientX;
      const clientY = event.clientY;
      const deltaX = event.deltaX;
      const deltaY = event.deltaY;
      canvas.focus();

      void (async () => {
        await flushTypedTextBuffer().catch(() => {});
        const point = toCanvasPoint(clientX, clientY);
        if (!point) {
          return;
        }

        setStatusMessage(`Scroll forwarded at ${point.x} x ${point.y}.`);
        try {
          await wheelRemoteCloakBrowser(profile.id, point.x, point.y, deltaX, deltaY);
          scheduleRefresh(120);
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
        }
      })();
    };

    canvas.addEventListener("wheel", handleNativeCanvasWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleNativeCanvasWheel);
    };
  }, [isLoading, profile.id, profile.isRunning]);

  useEffect(() => {
    return () => {
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }

      pendingPointerMoveRef.current = null;
      if (typeFlushTimerRef.current !== null) {
        window.clearTimeout(typeFlushTimerRef.current);
        typeFlushTimerRef.current = null;
      }

      closeStreamSocket();
      if (streamObjectUrlRef.current) {
        URL.revokeObjectURL(streamObjectUrlRef.current);
        streamObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let fallbackIntervalId: number | null = null;
    let fallbackIntervalMs: number = LIVE_PREVIEW_CONFIG.tuning.refreshIntervalMs;
    let fallbackFailureCount = 0;

    if (!profile.isRunning) {
      transportModeRef.current = "idle";
      resetStreamPressureTracking({ resetPreferredAttempt: true });
      closeStreamSocket();
      replaceScreenshot(null);
      applyTabs([]);
      setStatusMessage("Launch the browser to use interactive preview.");
      return;
    }

    const tick = async (options: { includeTabs?: boolean } = {}) => {
      const includeTabs = options.includeTabs ?? true;
      const [screenshotResult, tabsResult] = await Promise.allSettled([
        requestScreenshotSnapshot(),
        includeTabs
          ? requestTabsSnapshot()
          : Promise.resolve<RemoteBrowserTabEntry[] | null>(null),
      ]);
      if (disposed) {
        return;
      }

      let hadTransportFailure = false;
      if (screenshotResult.status === "fulfilled") {
        if (screenshotResult.value || !hasScreenshotRef.current) {
          replaceScreenshot(screenshotResult.value);
        }
      } else {
        hadTransportFailure = true;
      }

      if (tabsResult.status === "fulfilled" && tabsResult.value) {
        applyTabs(tabsResult.value);
      } else if (includeTabs) {
        hadTransportFailure = true;
      }

      if (transportModeRef.current === "poll" && fallbackIntervalId !== null) {
        if (hadTransportFailure) {
          fallbackFailureCount += 1;
          const nextIntervalMs = Math.min(
            LIVE_PREVIEW_CONFIG.tuning.pollingRecovery.maxBackoffMs,
            LIVE_PREVIEW_CONFIG.tuning.refreshIntervalMs
              * LIVE_PREVIEW_CONFIG.tuning.pollingRecovery.backoffFactor ** Math.min(fallbackFailureCount, 3),
          );
          if (nextIntervalMs !== fallbackIntervalMs) {
            fallbackIntervalMs = nextIntervalMs;
            window.clearInterval(fallbackIntervalId);
            fallbackIntervalId = window.setInterval(() => {
              queuePollingTick({ includeTabs: true });
            }, fallbackIntervalMs);
          }

          if (fallbackFailureCount >= LIVE_PREVIEW_CONFIG.tuning.pollingRecovery.noisyFailureThreshold) {
            setStatusMessage("Preview transport is unstable. Retrying snapshots more slowly.", { force: true });
          }
        } else if (fallbackFailureCount !== 0 || fallbackIntervalMs !== LIVE_PREVIEW_CONFIG.tuning.refreshIntervalMs) {
          fallbackFailureCount = 0;
          fallbackIntervalMs = LIVE_PREVIEW_CONFIG.tuning.refreshIntervalMs;
          window.clearInterval(fallbackIntervalId);
          fallbackIntervalId = window.setInterval(() => {
            queuePollingTick({ includeTabs: true });
          }, fallbackIntervalMs);
        }
      }

      setIsLoading(false);
    };

    const queuePollingTick = (options: { includeTabs?: boolean } = {}) => {
      if (pollingTickPromiseRef.current) {
        return;
      }

      const task = tick(options)
        .catch(() => {})
        .finally(() => {
          if (pollingTickPromiseRef.current === task) {
            pollingTickPromiseRef.current = null;
          }
        });
      pollingTickPromiseRef.current = task;
    };

    const startPollingFallback = (nextStatus?: string) => {
      if (disposed || fallbackIntervalId !== null) {
        return;
      }

      transportModeRef.current = "poll";
      if (nextStatus) {
        setStatusMessage(nextStatus);
      }

      fallbackFailureCount = 0;
      fallbackIntervalMs = LIVE_PREVIEW_CONFIG.tuning.refreshIntervalMs;
      queuePollingTick({ includeTabs: true });
      fallbackIntervalId = window.setInterval(() => {
        queuePollingTick({ includeTabs: true });
      }, fallbackIntervalMs);
    };

    const openStreamAttempt = (attemptIndex: number) => {
      if (disposed) {
        return;
      }

      const attempt = LIVE_PREVIEW_CONFIG.streamAttempts[attemptIndex];
      if (!attempt) {
        startPollingFallback("Screencast unavailable. Falling back to snapshots.");
        return;
      }

      preferredStreamAttemptIndexRef.current = attemptIndex;
      streamPendingFrameCountRef.current = 0;
      streamSlowFrameCountRef.current = 0;
      streamFramePendingRef.current = false;
      streamFrameStartedAtRef.current = null;
      streamStableSinceRef.current = performance.now();
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

            if (binaryMessage.kind !== STREAM_BINARY_KIND_IMAGE) {
              return;
            }

            streamReceivedFrame = true;
            transportModeRef.current = "stream";
            const blob = new Blob([new Uint8Array(binaryMessage.payload)], { type: streamMimeTypeRef.current });
            replaceScreenshot(URL.createObjectURL(blob), { objectUrl: true, streamAttemptIndex: attemptIndex });
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
            setStatusMessage(`Live preview streaming via screencast (${attempt.label}).`);
            return;
          }

          if (message.type === "tabs") {
            applyTabs(message.tabs, { restartStreamOnActiveChange: true });
            return;
          }

          setStatusMessage(`Screencast failed: ${message.error}`, { force: true });
        })();
      };

      streamSocket.onerror = () => {
        if (!disposed) {
          setStatusMessage(`Screencast ${attempt.label} failed. Trying a lighter stream...`, { force: true });
        }
      };

      streamSocket.onclose = () => {
        if (streamSocketRef.current === streamSocket) {
          streamSocketRef.current = null;
        }

        if (disposed) {
          return;
        }

        const adaptiveAttemptIndex = pendingAdaptiveStreamAttemptIndexRef.current;
        const adaptiveReason = pendingAdaptiveStreamReasonRef.current;
        if (adaptiveAttemptIndex !== null && adaptiveAttemptIndex !== attemptIndex) {
          pendingAdaptiveStreamAttemptIndexRef.current = null;
          pendingAdaptiveStreamReasonRef.current = null;
          streamPendingFrameCountRef.current = 0;
          streamSlowFrameCountRef.current = 0;
          streamFramePendingRef.current = false;
          streamFrameStartedAtRef.current = null;
          streamStableSinceRef.current = performance.now();
          if (adaptiveReason) {
            setStatusMessage(adaptiveReason, { force: true });
          }
          setIsLoading(true);
          openStreamAttempt(adaptiveAttemptIndex);
          return;
        }

        if (streamReceivedFrame) {
          if (attemptIndex + 1 < LIVE_PREVIEW_CONFIG.streamAttempts.length) {
            preferredStreamAttemptIndexRef.current = attemptIndex + 1;
            setStatusMessage(`Screencast disconnected. Retrying with ${LIVE_PREVIEW_CONFIG.streamAttempts[attemptIndex + 1]!.label}...`, { force: true });
            openStreamAttempt(attemptIndex + 1);
            return;
          }

          startPollingFallback("Screencast disconnected. Falling back to snapshots.");
          return;
        }

        if (attemptIndex + 1 < LIVE_PREVIEW_CONFIG.streamAttempts.length) {
          openStreamAttempt(attemptIndex + 1);
          return;
        }

        startPollingFallback("Screencast unavailable. Falling back to snapshots.");
      };
    };

    if (!hasScreenshotRef.current) {
      setIsLoading(true);
    }
    openStreamAttempt(preferredStreamAttemptIndexRef.current);

    return () => {
      disposed = true;
      closeStreamSocket();
      streamFramePendingRef.current = false;
      streamFrameStartedAtRef.current = null;
      streamStableSinceRef.current = null;
      if (fallbackIntervalId !== null) {
        window.clearInterval(fallbackIntervalId);
      }
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      pollingTickPromiseRef.current = null;
    };
  }, [profile.id, profile.isRunning, streamRevision]);

  useEffect(() => {
    if (hasScreenshot) {
      canvasRef.current?.focus();
    }
  }, [hasScreenshot]);

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
    if (!profile.isRunning || tabId === activeTabIdRef.current) {
      return;
    }

    setStatusMessage(`Switching to ${tabId}...`);
    try {
      await activateRemoteBrowserTab(profile.id, tabId);
      if (transportModeRef.current === "stream") {
        suppressNextActiveChangeRestartRef.current = true;
        restartStream();
      } else {
        await refreshTabs({ forceApi: true });
        await refreshScreenshot();
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
    }
  }

  async function closeTabs(tabIds: readonly string[]): Promise<void> {
    if (!profile.isRunning || tabIds.length === 0) {
      return;
    }

    const activeTabId = activeTabIdRef.current;
    const closesActiveTab = activeTabId ? tabIds.includes(activeTabId) : false;

    try {
      for (const tabId of tabIds) {
        await closeRemoteBrowserTab(profile.id, tabId);
      }

      if (transportModeRef.current === "stream") {
        if (closesActiveTab) {
          suppressNextActiveChangeRestartRef.current = true;
          restartStream();
          return;
        }

        requestTabsOverStream();
        return;
      }

      await refreshTabs({ forceApi: true });
      if (closesActiveTab) {
        await refreshScreenshot();
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
    }
  }

  async function handleCanvasPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): Promise<void> {
    if (!profile.isRunning || isClicking || isLoading || !hasScreenshotRef.current) {
      return;
    }

    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      setStatus("Preview is still initializing. Try again in a moment.");
      return;
    }

    isPointerDownRef.current = true;
    isStreamingPointerRef.current = sendBrowserStreamMessage({ type: "pointer-down", x: point.x, y: point.y });
    pendingPointerMoveRef.current = null;
    pointerPathRef.current = [point];
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    redrawCanvas(pointerPathRef.current);
    setStatusMessage(`Gesture start ${point.x} x ${point.y}.`);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!isPointerDownRef.current) {
      return;
    }

    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    const nextPath = appendPointerPoint(point);
    const nextPoint = nextPath[nextPath.length - 1];
    if (!nextPoint) {
      return;
    }

    if (isStreamingPointerRef.current) {
      queuePointerMove(nextPoint);
    }
    redrawCanvas(nextPath);
    setStatus(`Gesture path: ${nextPath.length} points.`);
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
      pendingPointerMoveRef.current = null;
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }
      isStreamingPointerRef.current = false;
      return;
    }

    if (isStreamingPointerRef.current) {
      flushPendingPointerMove();
      const finalPoint = currentPath[currentPath.length - 1] ?? currentPath[0]!;
      isStreamingPointerRef.current = false;
      sendBrowserStreamMessage({ type: "pointer-up", x: finalPoint.x, y: finalPoint.y });
      return;
    }

    const pathDistance = getPathDistance(currentPath);
    setIsClicking(true);
    try {
      if (currentPath.length > 1 && pathDistance >= LIVE_PREVIEW_CONFIG.tuning.dragDistanceThreshold) {
        setStatusMessage(`Gesture forwarded with ${currentPath.length} points.`);
        await gestureRemoteCloakBrowser(profile.id, currentPath);
      } else {
        const point = currentPath[0]!;
        setStatusMessage(`Click forwarded to ${point.x} x ${point.y}.`);
        await clickRemoteCloakBrowser(profile.id, point.x, point.y);
      }

      scheduleRefresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
    } finally {
      setIsClicking(false);
    }
  }

  async function handleCanvasPointerUp(event: ReactPointerEvent<HTMLCanvasElement>): Promise<void> {
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

  async function handleCanvasPointerCancel(event: ReactPointerEvent<HTMLCanvasElement>): Promise<void> {
    if (!isPointerDownRef.current) {
      return;
    }

    await finishPointerInteraction(event.pointerId, event.currentTarget);
  }

  async function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>): Promise<void> {
    if (!profile.isRunning || isLoading || isPointerDownRef.current) {
      return;
    }

    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
      return;
    }

    const isShortcutModifier = event.ctrlKey || event.metaKey;
    const normalizedKey = event.key.toLowerCase();
    const isPrintableWithoutShortcut = !event.altKey && !isShortcutModifier && event.key.length === 1;

    if (isShortcutModifier && (normalizedKey === "c" || normalizedKey === "x" || normalizedKey === "v")) {
      event.preventDefault();
      event.stopPropagation();

      try {
        await flushTypedTextBuffer();

        if (normalizedKey === "v") {
          const clipboardText = await readTextFromClipboard();
          if (clipboardText.length > 0) {
            await insertRemoteBrowserText(profile.id, clipboardText);
            scheduleRefresh(100);
          }
          return;
        }

        const selection = await readRemoteBrowserSelection(profile.id);
        if (selection.text.length > 0) {
          await writeTextToClipboard(selection.text);
        }

        if (normalizedKey === "x") {
          await keyboardRemoteCloakBrowser(profile.id, {
            key: event.key,
            code: event.code,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          });
          scheduleRefresh(100);
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
      }
      return;
    }

    if (isPrintableWithoutShortcut) {
      event.preventDefault();
      event.stopPropagation();
      queueTypedText(event.key);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setStatusMessage(`Key forwarded: ${event.key}.`);
    try {
      await flushTypedTextBuffer();
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
      setStatusMessage(error instanceof Error ? error.message : String(error), { force: true });
    }
  }

  return {
    canvasRef,
    previewViewportRef,
    tabStripRef,
    tabs,
    hasScreenshot,
    isLoading,
    isFullscreen,
    status,
    refreshTabs,
    refreshScreenshot,
    toggleFullscreen,
    handleTabSelect,
    closeTabs,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleCanvasPointerCancel,
    handleCanvasKeyDown,
  };
}