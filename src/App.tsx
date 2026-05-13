import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useSpring,
  useDragControls,
  MotionConfig,
} from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Edit3,
  Check,
  Undo2,
  Redo2,
  Link2,
  GripVertical,
} from "lucide-react";
import type { ElementType, PageData, PageElement } from "./scrapbookShare";
import {
  loadDraftFromStorage,
  parsePagesFromHash,
  saveDraftToStorage,
  fetchSharedBundleById,
  ensureSharedPagesById,
  saveSharedPagesById,
  uploadImageFileForShare,
  SHARE_STORAGE_LIMIT_BYTES,
  resolveShareableUrl,
  canPublishShareLinks,
  finalizeSharedEditingById,
} from "./scrapbookShare";
import {
  BookStageScaleContext,
  BOOK_STAGE_HEIGHT,
  BOOK_STAGE_WIDTH,
  useBookStageScale,
} from "./bookStage";
import { EditorPanelBody, type EditorAccordionId } from "./EditorPanelBody";
import {
  DEMO_SHARE_ID,
  demoImageVariant,
  demoResponsiveImageAttrs,
  enableDemoDiagnosticsFromUrl,
  isDemoRouteActive,
  isDemoShareId,
  logDemoDiagnostics,
  promoteDemoElement,
  releaseCanvasResource,
  unpromoteDemoElement,
} from "./demoFixes";

// ─── z-index layering constants ───────────────────────────────────────────────
const Z_STEP = 1;
const Z_JUMP = 10;
const Z_MIN = 1;
const Z_MAX = 200;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const defaultPages: PageData[] = [
  {
    id: "cover",
    background: "bg-rose-200",
    pattern: "pattern-polka",
    elements: [
      {
        id: "t1",
        type: "text",
        x: 40,
        y: 200,
        rotation: -5,
        content: "My Cute Scrapbook",
        fontSize: 48,
        color: "#e11d48",
        fontFamily: "var(--font-handwriting)",
        textEffect: "none",
      },
      {
        id: "s1",
        type: "sticker",
        x: 160,
        y: 300,
        rotation: 10,
        content: "🌸",
        fontSize: 64,
      },
    ],
  },
  {
    id: "inside-cover",
    background: "bg-orange-50",
    pattern: "pattern-grid",
    elements: [],
  },
  {
    id: "page-1",
    background: "bg-orange-50",
    pattern: "pattern-grid",
    elements: [
      {
        id: "t2",
        type: "text",
        x: 60,
        y: 100,
        rotation: 2,
        content: "Our Adventures",
        fontSize: 36,
        color: "#d97706",
        fontFamily: "var(--font-handwriting)",
        textEffect: "none",
      },
      {
        id: "i1",
        type: "image",
        x: 80,
        y: 170,
        rotation: -3,
        content:
          "/assets/ChatGPT%20Image%20Mar%2024,%202026,%2004_41_37%20PM.png",
        width: 210,
        height: 290,
      },
    ],
  },
  {
    id: "page-2",
    background: "bg-blue-50",
    pattern: "pattern-lines",
    elements: [
      {
        id: "s2",
        type: "sticker",
        x: 100,
        y: 150,
        rotation: -15,
        content: "✨",
        fontSize: 48,
      },
    ],
  },
  {
    id: "page-3",
    background: "bg-blue-50",
    pattern: "pattern-lines",
    elements: [],
  },
  {
    id: "back-cover",
    background: "bg-rose-200",
    pattern: "pattern-polka",
    elements: [
      {
        id: "t3",
        type: "text",
        x: 120,
        y: 250,
        rotation: 0,
        content: "Төгсөв",
        fontSize: 32,
        color: "#e11d48",
        fontFamily: "var(--font-handwriting)",
        textEffect: "none",
      },
    ],
  },
];

const POLAROID_STICKER_TOKEN = "__POLAROID__";

function getInitialPagesAndShare(): {
  pages: PageData[];
  openedFromShareLink: boolean;
} {
  if (typeof window === "undefined") {
    return { pages: defaultPages, openedFromShareLink: false };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("share")) {
    return { pages: defaultPages, openedFromShareLink: true };
  }
  const fromHash = parsePagesFromHash(window.location.hash);
  if (fromHash) {
    return { pages: fromHash, openedFromShareLink: true };
  }
  const draft = loadDraftFromStorage();
  if (draft) {
    return { pages: draft, openedFromShareLink: false };
  }
  return { pages: defaultPages, openedFromShareLink: false };
}

/** Matches Tailwind `md` (768px): narrow panel on phones (~50% of previous 20rem width). */
function editorPanelWidthPx(viewportWidth: number): number {
  if (viewportWidth < 768) {
    return Math.min(160, Math.max(120, Math.floor(viewportWidth * 0.5) - 8));
  }
  return Math.min(320, viewportWidth - 16);
}

function defaultEditorLeftPx(): number {
  if (typeof window === "undefined") return 400;
  const vw = window.innerWidth;
  const pw = editorPanelWidthPx(vw);
  return Math.max(8, vw - pw - 12);
}

function parseYouTubeVideoId(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  // Pasted ID only (no https://) — common when copying from the address bar on mobile
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  let href = raw;
  if (!/^https?:\/\//i.test(href)) {
    href = `https://${href.replace(/^\/+/, "")}`;
  }

  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    const isYtHost =
      host === "youtu.be" ||
      host.endsWith(".youtu.be") ||
      host.includes("youtube.com") ||
      host.includes("youtube-nocookie.com");
    if (!isYtHost) return null;

    if (host.includes("youtu.be")) {
      const seg = u.pathname.split("/").filter(Boolean)[0]?.trim();
      return seg || null;
    }

    const v = u.searchParams.get("v");
    if (v) return v;

    const parts = u.pathname.split("/").filter(Boolean);
    const embedIdx = parts.indexOf("embed");
    if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];
    const liveIdx = parts.indexOf("live");
    if (liveIdx >= 0 && parts[liveIdx + 1]) return parts[liveIdx + 1];
    const vPathIdx = parts.indexOf("v");
    if (vPathIdx >= 0 && parts[vPathIdx + 1]) return parts[vPathIdx + 1];

    return null;
  } catch {
    return null;
  }
}

function toFriendlyUploadError(
  rawError: string,
  kind: "image" | "video",
): string {
  const t = (rawError || "").toLowerCase();

  if (t.includes("1 minute")) {
    return "Энэ видео 1 минутаас урт байна. Богино видео сонгоно уу.";
  }
  if (
    t.includes("storage limit") ||
    t.includes("15mb") ||
    t.includes("too large")
  ) {
    return "Файл хэт том эсвэл энэ линкийн багтаамж дүүрсэн байна. Жижиг хэмжээтэй зураг/видео сонгоно уу.";
  }
  if (t.includes("only image/video")) {
    return kind === "image"
      ? "Энэ төрлийн зураг дэмжигдэхгүй байна. JPG, PNG, WebP эсвэл GIF файл сонгоно уу."
      : "Энэ төрлийн видео дэмжигдэхгүй байна. MP4, WebM эсвэл MOV файл сонгоно уу.";
  }
  if (t.includes("edit window expired")) {
    return "Энэ линкний засварлах хугацаа дууссан тул шинэ файл нэмэх боломжгүй.";
  }
  if (t.includes("share not found") || t.includes("not found")) {
    return "Линк олдсонгүй. Линк зөв эсэхийг шалгаад дахин оролдоно уу.";
  }
  if (t.includes("file is required")) {
    return "Файл сонгогдоогүй байна. Дахин сонгоод оролдоно уу.";
  }
  if (t.includes("r2 not configured") || t.includes("service unavailable")) {
    return "Одоогоор файл байршуулах боломжгүй байна. Түр хүлээгээд дахин оролдоно уу.";
  }

  return kind === "image"
    ? "Энэ зургийг оруулах боломжгүй байна. Өөр зураг сонгоод дахин оролдоно уу."
    : "Энэ видеог оруулах боломжгүй байна. Өөр видео сонгоод дахин оролдоно уу.";
}

function toFriendlyFinalizeError(rawError: string): string {
  const t = (rawError || "").toLowerCase();
  if (t.includes("not found")) {
    return "Линк олдсонгүй. Хуудсаа сэргээж дахин оролдоно уу.";
  }
  return "Засварыг дуусгах үед алдаа гарлаа. Дахин оролдоно уу.";
}

const STUDIO_UNLOCK_KEY = "scrapbook-studio-unlock";

// ─── Demo-route helpers ────────────────────────────────────────────────────────
// All helpers below are ONLY activated when the URL contains the demo share ID.
// They must never affect the main app or other share links.

/**
 * FIX-J (demo): Activate in-browser diagnostics by appending &diag to the demo URL.
 * Logs JS heap every 5 s to console; shows a fixed overlay with layer count.
 * Guard: only runs on the demo share ID.
 */
function activateDemoDiagnosticsIfRequested(): void {
  if (typeof window === "undefined") return;
  enableDemoDiagnosticsFromUrl();
  if (!window.__DEMO_DIAG) return;
  logDemoDiagnostics("demo diagnostics enabled");
  window.setInterval(() => logDemoDiagnostics("interval"), 5000);
}

/**
 * FIX-C (demo): Strip will-change from all elements that are not actively
 * animating. Called once after the demo page mounts. Prevents iOS WebKit from
 * pre-allocating GPU layers for every element on the page.
 * Guard: only runs on the demo share ID.
 */
function stripIdleWillChange(): void {
  if (typeof document === "undefined") return;
  if (!isDemoRouteActive()) return;
  // Give React one frame to finish painting before we audit.
  requestAnimationFrame(() => {
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const wc = el.style.willChange || getComputedStyle(el).willChange;
      // Keep will-change only on elements that are mid-animation (is-flipping).
      if (wc && wc !== "auto" && !el.classList.contains("demo-promote")) {
        el.style.willChange = "auto";
      }
    });
  });
}

/**
 * FIX-A/B (demo): Cap the Unsplash image width for the demo to a
 * device-appropriate value. On iOS we use 900px (≈ iPhone 15 Pro @3x logical
 * width of 393px × 2 = 786px, rounded up). On desktop we use 1200px.
 * This is tighter than the existing 1100/1400 split and avoids loading
 * 2200px-wide bitmaps that exhaust iOS VRAM.
 */
function getDemoImageMaxWidth(): number {
  if (typeof window === "undefined") return 1200;
  // Use devicePixelRatio-aware cap: logical width × DPR, max 1200 on mobile.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const logicalW = window.innerWidth || 390;
  // Each page is ~half the viewport width in the book spread.
  const pageLogicalW = Math.ceil(logicalW / 2);
  const dpAware = Math.ceil(pageLogicalW * dpr);
  return isIosWebkitDevice()
    ? Math.min(dpAware, 1100)
    : Math.min(dpAware, 1400);
}
const DEMO_EDIT_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
const LOADING_SCENE_EXIT_MS = 700;
const LOADING_PROGRESS_SETTLE_MS = 220;
const BOOTSTRAP_NETWORK_TIMEOUT_MS = 7000;
const BOOTSTRAP_MAX_WAIT_MS = 9000;
/** Share links need more time on slow mobile networks; must exceed worst-case fetch retries. */
const SHARE_FETCH_TIMEOUT_MS = 15000;
const SHARE_FETCH_ATTEMPTS = 6;
const SHARE_BOOTSTRAP_FAILSAFE_MS =
  SHARE_FETCH_ATTEMPTS * SHARE_FETCH_TIMEOUT_MS + 12000;
const MAX_UPLOAD_IMAGE_SIDE_PX = 2200;
const MAX_BACKGROUND_UPLOAD_IMAGE_SIDE_PX = 2560;
const DEMO_CDN_IMAGE_MAX_WIDTH_PX = 820;
const DEMO_CDN_IOS_IMAGE_MAX_WIDTH_PX = 640;
const DEMO_LIGHT_MUSIC_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3";
const DEMO_LIGHT_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const DEMO_LIGHT_IMAGE_URLS = [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e",
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828",
  "https://images.unsplash.com/photo-1519681393784-d120267933ba",
  "https://images.unsplash.com/photo-1527631746610-bca00a040d60",
  "https://images.unsplash.com/photo-1491553895911-0055eca6402d",
  "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429",
] as const;
const DEMO_LIGHT_BACKGROUND_URLS = [
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470",
  "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
] as const;

function isSandboxDemoShareId(id: string | null | undefined): boolean {
  return isDemoShareId(id);
}

function getDemoEditUntilIso(id: string): string {
  const fallback = Date.now() + DEMO_EDIT_WINDOW_MS;
  if (typeof window === "undefined") return new Date(fallback).toISOString();
  const key = `scrapbook-demo-opened-at:${id}`;
  const existing = Number(window.localStorage.getItem(key) || 0);
  const openedAt =
    Number.isFinite(existing) && existing > 0 ? existing : Date.now();
  if (!existing) {
    window.localStorage.setItem(key, String(openedAt));
  }
  return new Date(openedAt + DEMO_EDIT_WINDOW_MS).toISOString();
}

function demoCdnWidth(maxWidth: number): number {
  const deviceCap = isIosWebkitDevice()
    ? DEMO_CDN_IOS_IMAGE_MAX_WIDTH_PX
    : DEMO_CDN_IMAGE_MAX_WIDTH_PX;
  return Math.min(maxWidth, deviceCap);
}

function buildDemoCdnImageUrl(url: string, maxWidth: number): string {
  return demoImageVariant(url, demoCdnWidth(maxWidth), 72);
}

function demoCdnImageAt(index: number, maxWidth: number): string {
  const url = DEMO_LIGHT_IMAGE_URLS[index % DEMO_LIGHT_IMAGE_URLS.length];
  return buildDemoCdnImageUrl(url, maxWidth);
}

function demoCdnBackgroundAt(index: number, maxWidth: number): string {
  const url =
    DEMO_LIGHT_BACKGROUND_URLS[index % DEMO_LIGHT_BACKGROUND_URLS.length];
  return buildDemoCdnImageUrl(url, maxWidth);
}

function upgradeDemoPagesForHd(
  pages: PageData[],
  maxWidth: number = 1400,
): PageData[] {
  return pages.map((page, pageIndex) => ({
    ...page,
    backgroundImage: demoCdnBackgroundAt(pageIndex, maxWidth),
    elements: page.elements.map((element, elementIndex) => {
      if (element.type === "video") {
        return {
          ...element,
          content: DEMO_LIGHT_VIDEO_URL,
          width: Math.min(element.width || 300, 240),
          height: Math.min(element.height || 160, 136),
        };
      }

      const assetIndex = pageIndex * 5 + elementIndex;
      if (element.type === "image") {
        return {
          ...element,
          content:
            element.content === "__POLAROID__"
              ? element.content
              : demoCdnImageAt(assetIndex, maxWidth),
          frameImage: element.frameImage
            ? demoCdnImageAt(assetIndex + 2, maxWidth)
            : element.frameImage,
        };
      }

      if (element.type === "sticker" && /^https?:\/\//i.test(element.content)) {
        return {
          ...element,
          content: demoCdnImageAt(assetIndex, maxWidth),
        };
      }

      return {
        ...element,
        frameImage: element.frameImage
          ? demoCdnImageAt(assetIndex + 2, maxWidth)
          : element.frameImage,
      };
    }),
  }));
}

function isIosWebkitDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cssImageUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

async function fetchSharedBundleWithAttempts(
  id: string,
  attempts: number,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof fetchSharedBundleById>>> {
  let last: Awaited<ReturnType<typeof fetchSharedBundleById>> = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const bundle = await withTimeout(fetchSharedBundleById(id), timeoutMs);
      if (bundle) return bundle;
      last = bundle;
    } catch {
      // retry below
    }
    if (i < attempts - 1) {
      await sleep(400 * (i + 1));
    }
  }
  return last;
}

async function fetchBundleWithRetry(
  id: string,
  attempts: number = 3,
): Promise<Awaited<ReturnType<typeof fetchSharedBundleById>>> {
  return fetchSharedBundleWithAttempts(
    id,
    attempts,
    BOOTSTRAP_NETWORK_TIMEOUT_MS,
  );
}

// FIX-E: Release canvas memory after toBlob completes.
// On iOS WebKit, canvas backing stores are not freed until the canvas element
// is GC'd. Setting width/height to 0 immediately releases the GPU texture.
function releaseCanvas(canvas: HTMLCanvasElement): void {
  releaseCanvasResource(canvas);
}

async function optimizeImageForUpload(
  file: File,
  options: {
    maxSide?: number;
    minRecompressBytes?: number;
    webpQuality?: number;
  } = {},
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  const maxUploadSide = options.maxSide ?? MAX_UPLOAD_IMAGE_SIDE_PX;
  const minRecompressBytes = options.minRecompressBytes ?? 4_000_000;
  const webpQuality = options.webpQuality ?? 0.9;

  const loadImage = (f: File) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(f);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to decode image."));
      };
      img.src = url;
    });

  const img = await loadImage(file);
  const srcW = img.naturalWidth || 1;
  const srcH = img.naturalHeight || 1;
  const maxSide = Math.max(srcW, srcH);
  const shouldResize = maxSide > maxUploadSide;
  const scale = shouldResize ? maxUploadSide / maxSide : 1;
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  // Skip recompression for already-small files to avoid quality loss.
  if (!shouldResize && file.size < minRecompressBytes) return file;

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    releaseCanvas(canvas);
    return file;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", webpQuality),
  );
  // FIX-E: Always release the canvas backing store immediately after toBlob.
  releaseCanvas(canvas);

  if (!blob || blob.size >= file.size) return file;
  const safeName = (file.name || "image").replace(/\.[^.]+$/, "");
  return new File([blob], `${safeName}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

function shouldRenderLeaf(
  index: number,
  currentLeaf: number,
  totalLeaves: number,
): boolean {
  if (totalLeaves <= 8) return true;
  if (index === 0 || index === totalLeaves - 1) return true;
  return (
    Math.abs(index - currentLeaf) <= 2 ||
    Math.abs(index - (currentLeaf - 1)) <= 2
  );
}

function LoadingScene({
  isExiting,
  progress,
}: {
  isExiting: boolean;
  progress: number;
}) {
  return (
    <div className={`wizard-loader ${isExiting ? "wizard-loader--exit" : ""}`}>
      <div className="scene">
        <div className="objects">
          <div className="square" />
          <div className="circle" />
          <div className="triangle" />
        </div>
        <div className="wizard">
          <div className="body" />
          <div className="right-arm">
            <div className="right-hand" />
          </div>
          <div className="left-arm">
            <div className="left-hand" />
          </div>
          <div className="head">
            <div className="beard" />
            <div className="face">
              <div className="adds" />
            </div>
            <div className="hat">
              <div className="hat-of-the-hat" />
              <div className="four-point-star --first" />
              <div className="four-point-star --second" />
              <div className="four-point-star --third" />
            </div>
          </div>
        </div>
      </div>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="noise" />
    </div>
  );
}

export default function App() {
  const [isInitialBootstrapDone, setIsInitialBootstrapDone] = useState(false);
  const [isWindowLoaded, setIsWindowLoaded] = useState(
    typeof document !== "undefined" && document.readyState !== "loading",
  );
  const [isLoadingSceneVisible, setIsLoadingSceneVisible] = useState(true);
  const [isLoadingSceneExiting, setIsLoadingSceneExiting] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(6);
  const init = getInitialPagesAndShare();
  const studioRootShareId = (
    import.meta.env.VITE_STUDIO_ROOT_SHARE_ID || "studio-root"
  ).trim();
  const studioPassword = (import.meta.env.VITE_STUDIO_PASSWORD || "").trim();
  const [studioPasswordInput, setStudioPasswordInput] = useState("");
  const [studioAuthError, setStudioAuthError] = useState<string | null>(null);
  const [studioUnlocked, setStudioUnlocked] = useState(() => {
    if (typeof window === "undefined") return true;
    const isShareLink = new URLSearchParams(window.location.search).has(
      "share",
    );
    if (isShareLink) return true;
    if (!studioPassword) return true;
    return window.sessionStorage.getItem(STUDIO_UNLOCK_KEY) === "1";
  });
  const [pages, setPages] = useState<PageData[]>(init.pages);
  const [sharedViewMode, setSharedViewMode] = useState(
    init.openedFromShareLink,
  );
  const [currentShareId, setCurrentShareId] = useState<string | null>(null);
  const [history, setHistory] = useState<PageData[][]>([init.pages]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const initialPagesRef = useRef(init.pages);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [shareLinkLoadError, setShareLinkLoadError] = useState<
    null | "timeout" | "failed"
  >(null);
  const [shareBootstrapRetry, setShareBootstrapRetry] = useState(0);
  const retryShareBootstrap = useCallback(() => {
    setShareLinkLoadError(null);
    setIsInitialBootstrapDone(false);
    setIsLoadingSceneVisible(true);
    setIsLoadingSceneExiting(false);
    setLoadingProgress(6);
    setShareBootstrapRetry((n) => n + 1);
  }, []);
  const [shareStorageUsedBytes, setShareStorageUsedBytes] = useState(0);
  const [shareStorageLimitBytes, setShareStorageLimitBytes] = useState(
    SHARE_STORAGE_LIMIT_BYTES,
  );
  /** Server `?share=` only: ISO time after which “Make my own copy” is hidden. */
  const [shareEditUntilIso, setShareEditUntilIso] = useState<string | null>(
    null,
  );
  const [shareDeadlineTick, setShareDeadlineTick] = useState(0);

  const [currentLeaf, setCurrentLeaf] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [showFinalizePrompt, setShowFinalizePrompt] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [appBackgroundColor, setAppBackgroundColor] = useState("#4A5568");
  const [appBackgroundImageUrl, setAppBackgroundImageUrl] = useState("");
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState("");
  const [hasAudioGesture, setHasAudioGesture] = useState(false);
  const [isYtApiReady, setIsYtApiReady] = useState(false);
  const [ytReadyTick, setYtReadyTick] = useState(0);
  const [audibleVideoIds, setAudibleVideoIds] = useState<string[]>([]);
  const [videoMutedById, setVideoMutedById] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const bendIntensity = 1.35;

  const [editorPlacement, setEditorPlacement] = useState(() => ({
    left: defaultEditorLeftPx(),
    top: 12,
  }));
  const [openAccordion, setOpenAccordion] = useState<EditorAccordionId | null>(
    null,
  );
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const editorPlacementRef = useRef(editorPlacement);
  const prevSelectedElementId = useRef<string | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const hasAudioGestureRef = useRef(false);
  const autosaveAbortRef = useRef<AbortController | null>(null);
  const autosaveSeqRef = useRef(0);
  const wasEditingRef = useRef(isEditing);
  const preferLiteEffects = isIosWebkitDevice();
  const isDemoShare = sharedViewMode && isSandboxDemoShareId(currentShareId);
  const isDemoRoute = isDemoShare || isDemoRouteActive();
  const [demoHdIntent, setDemoHdIntent] = useState(false);
  const [demoArmedVideoIds, setDemoArmedVideoIds] = useState<
    Record<string, boolean>
  >({});
  const armDemoVideo = useCallback((id: string) => {
    setDemoArmedVideoIds((prev) =>
      prev[id] ? prev : { ...prev, [id]: true },
    );
  }, []);

  useEffect(() => {
    editorPlacementRef.current = editorPlacement;
  }, [editorPlacement]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("is-ios", preferLiteEffects);
    document.body.classList.toggle("demo-route", isDemoRoute);
    return () => {
      document.body.classList.remove("is-ios");
      document.body.classList.remove("demo-route");
    };
  }, [isDemoRoute, preferLiteEffects]);

  useEffect(() => {
    if (!isDemoRoute || demoHdIntent) return;
    const onIntent = () => {
      setDemoHdIntent(true);
      logDemoDiagnostics("first user intent: hd media enabled");
    };
    window.addEventListener("pointerdown", onIntent, { once: true });
    window.addEventListener("keydown", onIntent, { once: true });
    window.addEventListener("touchstart", onIntent, {
      once: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", onIntent);
      window.removeEventListener("keydown", onIntent);
      window.removeEventListener("touchstart", onIntent);
    };
  }, [demoHdIntent, isDemoRoute]);

  useEffect(() => {
    if (!isDemoRoute) {
      wasEditingRef.current = isEditing;
      return;
    }
    if (wasEditingRef.current && !isEditing) {
      document
        .querySelectorAll<HTMLCanvasElement>("canvas")
        .forEach(releaseCanvasResource);
      logDemoDiagnostics("editor close");
    }
    wasEditingRef.current = isEditing;
  }, [isDemoRoute, isEditing]);

  useEffect(() => {
    if (!isDemoRoute) return;
    return () => {
      document
        .querySelectorAll<HTMLCanvasElement>("canvas")
        .forEach(releaseCanvasResource);
    };
  }, [isDemoRoute]);

  useEffect(() => {
    if (isWindowLoaded) return;
    const onLoaded = () => setIsWindowLoaded(true);
    window.addEventListener("DOMContentLoaded", onLoaded, { once: true });
    window.addEventListener("load", onLoaded, { once: true });
    return () => {
      window.removeEventListener("DOMContentLoaded", onLoaded);
      window.removeEventListener("load", onLoaded);
    };
  }, [isWindowLoaded]);

  useEffect(() => {
    if (!isLoadingSceneVisible) return;
    const isLoaderReady = isInitialBootstrapDone && isWindowLoaded;
    if (isLoaderReady) {
      setLoadingProgress(100);
      return;
    }
    const t = window.setInterval(() => {
      setLoadingProgress((p) => {
        const next = p + Math.max(0.35, (94 - p) * 0.08);
        return Math.min(94, next);
      });
    }, 120);
    return () => window.clearInterval(t);
  }, [isLoadingSceneVisible, isInitialBootstrapDone, isWindowLoaded]);

  useEffect(() => {
    const isLoaderReady = isInitialBootstrapDone && isWindowLoaded;
    if (!isLoaderReady || !isLoadingSceneVisible || isLoadingSceneExiting)
      return;
    setLoadingProgress(100);
    const startExit = window.setTimeout(() => {
      setIsLoadingSceneExiting(true);
    }, LOADING_PROGRESS_SETTLE_MS);
    const hide = window.setTimeout(
      () => setIsLoadingSceneVisible(false),
      LOADING_PROGRESS_SETTLE_MS + LOADING_SCENE_EXIT_MS,
    );
    return () => {
      window.clearTimeout(startExit);
      window.clearTimeout(hide);
    };
  }, [
    isInitialBootstrapDone,
    isWindowLoaded,
    isLoadingSceneVisible,
    isLoadingSceneExiting,
  ]);

  // FIX-C/J (demo): After the loading scene exits, activate demo diagnostics
  // and strip idle will-change from all elements. Both helpers are no-ops on
  // non-demo routes (guarded by DEMO_SHARE_ID check inside each function).
  useEffect(() => {
    if (!isInitialBootstrapDone) return;
    // Delay slightly so React has finished painting the book pages.
    const id = window.setTimeout(
      () => {
        activateDemoDiagnosticsIfRequested();
        stripIdleWillChange();
      },
      LOADING_PROGRESS_SETTLE_MS + LOADING_SCENE_EXIT_MS + 100,
    );
    return () => window.clearTimeout(id);
  }, [isInitialBootstrapDone]);

  useEffect(() => {
    hasAudioGestureRef.current = hasAudioGesture;
  }, [hasAudioGesture]);

  const tryStartBackgroundMusic = useCallback(() => {
    const p = ytPlayerRef.current;
    if (!p) return;
    p.unMute?.();
    p.playVideo?.();
  }, []);

  useEffect(() => {
    const onFirstInteract = () => {
      setHasAudioGesture(true);
      tryStartBackgroundMusic();
    };
    window.addEventListener("pointerdown", onFirstInteract, { once: true });
    window.addEventListener("click", onFirstInteract, { once: true });
    window.addEventListener("keydown", onFirstInteract, { once: true });
    window.addEventListener("touchstart", onFirstInteract, {
      once: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", onFirstInteract);
      window.removeEventListener("click", onFirstInteract);
      window.removeEventListener("keydown", onFirstInteract);
      window.removeEventListener("touchstart", onFirstInteract);
    };
  }, [tryStartBackgroundMusic]);

  useEffect(() => {
    if (window.YT?.Player) {
      setIsYtApiReady(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    const onReady = () => setIsYtApiReady(true);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      onReady();
    };
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  }, []);

  const ytVideoId = parseYouTubeVideoId(backgroundMusicUrl);

  useEffect(() => {
    if (!isYtApiReady) return;
    if (!ytHostRef.current) return;
    if (!ytVideoId) {
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
      return;
    }

    if (ytPlayerRef.current) {
      ytPlayerRef.current.loadVideoById?.(ytVideoId);
      return;
    }

    ytPlayerRef.current = new window.YT.Player(ytHostRef.current, {
      width: "1",
      height: "1",
      videoId: ytVideoId,
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        loop: 1,
        playlist: ytVideoId,
        enablejsapi: 1,
        ...(typeof window !== "undefined"
          ? { origin: window.location.origin }
          : {}),
      },
      events: {
        onReady: (ev: any) => {
          ev.target.setVolume(50);
          setYtReadyTick((n) => n + 1);
          if (hasAudioGestureRef.current) tryStartBackgroundMusic();
        },
      },
    });
  }, [isYtApiReady, ytVideoId, tryStartBackgroundMusic]);

  useEffect(() => {
    const p = ytPlayerRef.current;
    if (!p) return;
    const target = audibleVideoIds.length > 0 ? 20 : 50;
    p.setVolume?.(target);
  }, [audibleVideoIds, ytReadyTick]);

  useEffect(() => {
    if (!hasAudioGesture || !ytVideoId) return;
    tryStartBackgroundMusic();
  }, [hasAudioGesture, ytReadyTick, ytVideoId, tryStartBackgroundMusic]);

  useEffect(() => {
    const onResize = () => {
      setEditorPlacement((p) => {
        const w = editorPanelWidthPx(window.innerWidth);
        const h = editorPanelRef.current?.getBoundingClientRect().height ?? 480;
        return {
          left: Math.min(
            Math.max(8, p.left),
            Math.max(8, window.innerWidth - w - 8),
          ),
          top: Math.min(
            Math.max(8, p.top),
            Math.max(8, window.innerHeight - h - 8),
          ),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const hasTouch =
      window.matchMedia("(pointer: coarse)").matches ||
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0;
    if (!hasTouch) return;

    const shouldAllowNativeScroll = (target: EventTarget | null) => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== document.body) {
        if (el.dataset.allowNativeScroll === "true") return true;
        el = el.parentElement;
      }
      return false;
    };

    const onTouchMove = (e: TouchEvent) => {
      // 2-finger pinch is handled by the stage's own listener → don't block it here.
      if (e.touches.length > 1) return;
      // When user has zoomed in via in-app zoom, allow 1-finger pan.
      if (userZoomRef.current > 1.01) return;
      if (!shouldAllowNativeScroll(e.target)) {
        e.preventDefault();
      }
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const startEditorDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const orig = editorPlacementRef.current;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const rect = editorPanelRef.current?.getBoundingClientRect();
      const pw = rect?.width ?? 320;
      const ph = rect?.height ?? 400;
      setEditorPlacement({
        left: Math.min(window.innerWidth - pw - 8, Math.max(8, orig.left + dx)),
        top: Math.min(window.innerHeight - ph - 8, Math.max(8, orig.top + dy)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  useEffect(() => {
    if (
      selectedElementId &&
      selectedElementId !== prevSelectedElementId.current
    ) {
      setOpenAccordion("selection");
    }
    prevSelectedElementId.current = selectedElementId;
  }, [selectedElementId]);

  const stageViewportRef = useRef<HTMLDivElement>(null);
  const [stageScale, setStageScale] = useState(1);

  // In-app pinch zoom + pan (replaces browser zoom to prevent iOS crash)
  const [userZoom, setUserZoom] = useState(1);
  const userZoomRef = useRef(1);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);
  const lastTapTimeRef = useRef(0);

  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const panStartTouchRef = useRef<{ x: number; y: number } | null>(null);
  const panStartOffsetRef = useRef({ x: 0, y: 0 });

  const clampZoom = (z: number) =>
    Math.min(preferLiteEffects ? 2.35 : 3.5, Math.max(1, z));

  const clampPan = (x: number, y: number, z: number) => {
    const el = stageViewportRef.current;
    if (!el || z <= 1.01) return { x: 0, y: 0 };
    const scaledW = BOOK_STAGE_WIDTH * stageScale * z;
    const scaledH = BOOK_STAGE_HEIGHT * stageScale * z;
    const overflowX = Math.max(0, scaledW - el.clientWidth);
    const overflowY = Math.max(0, scaledH - el.clientHeight);
    const maxX = overflowX / 2 + 24;
    const maxY = overflowY / 2 + 24;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  useEffect(() => {
    userZoomRef.current = userZoom;
    if (userZoom <= 1.01) {
      setPanOffset({ x: 0, y: 0 });
      panOffsetRef.current = { x: 0, y: 0 };
    } else {
      const clamped = clampPan(
        panOffsetRef.current.x,
        panOffsetRef.current.y,
        userZoom,
      );
      if (
        clamped.x !== panOffsetRef.current.x ||
        clamped.y !== panOffsetRef.current.y
      ) {
        setPanOffset(clamped);
        panOffsetRef.current = clamped;
      }
    }
  }, [userZoom]);

  useEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;

    const getTouchDist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDistRef.current = getTouchDist(e.touches);
        pinchStartZoomRef.current = userZoomRef.current;
        panStartTouchRef.current = null;
      }
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapTimeRef.current < 300) {
          // double-tap → reset zoom and pan
          setUserZoom(1);
          userZoomRef.current = 1;
          setPanOffset({ x: 0, y: 0 });
          panOffsetRef.current = { x: 0, y: 0 };
        }
        lastTapTimeRef.current = now;
        panStartTouchRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        panStartOffsetRef.current = { ...panOffsetRef.current };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches);
        const ratio = newDist / pinchStartDistRef.current;
        const next = clampZoom(pinchStartZoomRef.current * ratio);
        setUserZoom(next);
        userZoomRef.current = next;
        return;
      }
      // 1-finger pan when zoomed in
      if (
        e.touches.length === 1 &&
        userZoomRef.current > 1.01 &&
        panStartTouchRef.current !== null
      ) {
        e.preventDefault();
        const dx = e.touches[0].clientX - panStartTouchRef.current.x;
        const dy = e.touches[0].clientY - panStartTouchRef.current.y;
        const clamped = clampPan(
          panStartOffsetRef.current.x + dx,
          panStartOffsetRef.current.y + dy,
          userZoomRef.current,
        );
        setPanOffset(clamped);
        panOffsetRef.current = clamped;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartDistRef.current = null;
      }
      if (e.touches.length === 0) {
        panStartTouchRef.current = null;
      } else if (e.touches.length === 1) {
        // Finger count dropped from 2 → 1, restart pan tracking
        panStartTouchRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        panStartOffsetRef.current = { ...panOffsetRef.current };
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  /** Uniform scale so the fixed 800×600 stage matches preview/edit on every screen size. */
  useLayoutEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      const fill = preferLiteEffects ? 0.995 : 1.01;
      const s = Math.min(w / BOOK_STAGE_WIDTH, h / BOOK_STAGE_HEIGHT) * fill;
      setStageScale(Math.max(0.08, Math.min(s, 4)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [isEditing, preferLiteEffects, sharedViewMode]);

  const totalLeaves = Math.ceil(pages.length / 2);

  const updatePagesWithHistory = (newPages: PageData[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newPages);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setPages(newPages);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setPages(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setPages(history[historyIndex + 1]);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [history, historyIndex]);

  useEffect(() => {
    if (sharedViewMode && currentShareId) {
      const deadlineMs = shareEditUntilIso
        ? Date.parse(shareEditUntilIso)
        : NaN;
      const expired =
        shareEditUntilIso !== null &&
        Number.isFinite(deadlineMs) &&
        Date.now() > deadlineMs;
      if (!expired) return;
    }
    if (sharedViewMode) setIsEditing(false);
  }, [sharedViewMode, currentShareId, shareEditUntilIso]);

  useEffect(() => {
    if (currentShareId) return;
    if (sharedViewMode) return;
    const id = window.setTimeout(() => saveDraftToStorage(pages), 500);
    return () => window.clearTimeout(id);
  }, [pages, currentShareId, sharedViewMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("share");
    let cancelled = false;
    if (!sid) {
      setShareLinkLoadError(null);
    }
    const applyShareBundleRef = { current: true };
    const failsafeMs = sid
      ? SHARE_BOOTSTRAP_FAILSAFE_MS
      : BOOTSTRAP_MAX_WAIT_MS;
    const bootstrapFailSafe = window.setTimeout(() => {
      if (!cancelled) {
        if (sid) {
          applyShareBundleRef.current = false;
          setShareLinkLoadError("timeout");
          setShareHint(null);
        }
        setIsInitialBootstrapDone(true);
      }
    }, failsafeMs);
    (async () => {
      try {
        if (sid) {
          setShareHint(
            isSandboxDemoShareId(sid)
              ? "Loading demo scrapbook..."
              : "Линкийн өгөгдлийг ачаалж байна...",
          );
          const bundle = await fetchSharedBundleWithAttempts(
            sid,
            SHARE_FETCH_ATTEMPTS,
            SHARE_FETCH_TIMEOUT_MS,
          );
          if (cancelled || !applyShareBundleRef.current) return;
          if (bundle) {
            const isDemo = isSandboxDemoShareId(sid);
            // FIX-A (demo): Use DPR-aware width cap instead of hardcoded 1100/1400.
            // getDemoImageMaxWidth() computes: min(pageLogicalWidth × DPR, 1100 on iOS / 1400 on desktop).
            // This prevents loading 2200px Unsplash bitmaps on a 390px-wide iPhone screen.
            const demoAssetMaxWidth = isDemo
              ? getDemoImageMaxWidth()
              : isIosWebkitDevice()
                ? 1100
                : 1400;
            const displayPages = isDemo
              ? upgradeDemoPagesForHd(bundle.pages, demoAssetMaxWidth)
              : bundle.pages;
            const displayAppBackground =
              (isDemo
                ? demoCdnBackgroundAt(99, demoAssetMaxWidth)
                : bundle.appBackgroundImage) || "";
            const displayMusicUrl = isDemo
              ? DEMO_LIGHT_MUSIC_URL
              : bundle.musicUrl || "";
            setShareLinkLoadError(null);
            setCurrentShareId(sid);
            setPages(displayPages);
            setBackgroundMusicUrl(displayMusicUrl);
            setAppBackgroundImageUrl(displayAppBackground);
            setShareEditUntilIso(
              isDemo ? getDemoEditUntilIso(sid) : bundle.editUntil,
            );
            setShareStorageUsedBytes(bundle.mediaBytes);
            setSharedViewMode(true);
            setHistory([displayPages]);
            setHistoryIndex(0);
            setShareHint(null);
            if (isDemo) {
              window.setTimeout(() => logDemoDiagnostics("demo load"), 0);
            }
          } else {
            setShareLinkLoadError("failed");
            setShareHint(null);
          }
          return;
        }
        if (!canPublishShareLinks()) return;
        if (!studioRootShareId) return;
        // Avoid accidental reset: fetch current server data first, ensure only when missing.
        let bundle = await fetchBundleWithRetry(studioRootShareId, 2);
        if (!bundle) {
          const ensured = await withTimeout(
            ensureSharedPagesById(studioRootShareId, initialPagesRef.current),
            BOOTSTRAP_NETWORK_TIMEOUT_MS,
          );
          if (cancelled || !ensured.ok) return;
          bundle = await fetchBundleWithRetry(studioRootShareId, 3);
        }
        if (cancelled) return;
        if (bundle) {
          setCurrentShareId(studioRootShareId);
          setPages(bundle.pages);
          setBackgroundMusicUrl(bundle.musicUrl || "");
          setAppBackgroundImageUrl(bundle.appBackgroundImage || "");
          setShareEditUntilIso(bundle.editUntil);
          setShareStorageUsedBytes(bundle.mediaBytes);
          setSharedViewMode(false);
          setHistory([bundle.pages]);
          setHistoryIndex(0);
        }
      } finally {
        window.clearTimeout(bootstrapFailSafe);
        if (!cancelled) {
          setIsInitialBootstrapDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapFailSafe);
    };
  }, [studioRootShareId, shareBootstrapRetry]);

  useEffect(() => {
    if (!shareEditUntilIso || !sharedViewMode) return;
    const id = window.setInterval(
      () => setShareDeadlineTick((n) => n + 1),
      30_000,
    );
    return () => window.clearInterval(id);
  }, [shareEditUntilIso, sharedViewMode]);

  const shareEditDeadlineMs = shareEditUntilIso
    ? Date.parse(shareEditUntilIso)
    : NaN;
  const isShareEditExpired =
    shareEditUntilIso !== null &&
    Number.isFinite(shareEditDeadlineMs) &&
    Date.now() > shareEditDeadlineMs;
  const canEditSharedLink = sharedViewMode && !isShareEditExpired;
  const canSaveToServer =
    Boolean(currentShareId) &&
    !isDemoShare &&
    (!sharedViewMode || canEditSharedLink);
  void shareDeadlineTick;

  const showPublishLinkUi =
    !isDemoShare && !sharedViewMode && canPublishShareLinks();
  const isPureViewOnly = sharedViewMode && !canEditSharedLink;
  const shouldLockStudio =
    !sharedViewMode && studioPassword.length > 0 && !studioUnlocked;

  const copyShareLink = async () => {
    if (!showPublishLinkUi) return;
    const resolved = await resolveShareableUrl(
      pages,
      backgroundMusicUrl,
      appBackgroundImageUrl,
    );
    if (resolved.kind === "hash" || resolved.kind === "server") {
      try {
        await navigator.clipboard.writeText(resolved.url);
        setShareHint("Линк хууллаа — мессеж эсвэл и-мэйлээр явуулаарай.");
        window.setTimeout(() => setShareHint(null), 5000);
      } catch {
        window.prompt("Энэ линкийг хуулна уу:", resolved.url);
      }
      return;
    }
    window.alert(
      "Хуваалцах линк үүсгэж чадсангүй. Хэт олон том зурагтай бол цөөн эсвэл жижиг зураг ашиглаад, интернетээ шалгаад дахин оролдоно уу. Энэ алдаа үргэлжилбэл линк үүсгэх үйлчилгээ идэвхжээгүй байж магадгүй.",
    );
  };

  const finalizeEditingNow = async () => {
    if (!currentShareId) return;
    if (isDemoShare) {
      setIsEditing(false);
      setShowFinalizePrompt(false);
      setShareHint(
        "Demo mode: your changes are not saved to this public link.",
      );
      window.setTimeout(() => setShareHint(null), 2400);
      return;
    }
    setIsFinalizing(true);
    const r = await finalizeSharedEditingById(currentShareId);
    setIsFinalizing(false);
    if (r.ok === false) {
      window.alert(toFriendlyFinalizeError(r.error));
      return;
    }
    setShareEditUntilIso(r.editUntil);
    setIsEditing(false);
    setShowFinalizePrompt(false);
    setShareHint("Засварыг дуусгалаа. Одоо энэ линк зөвхөн харах горимтой.");
    window.setTimeout(() => setShareHint(null), 2200);
  };

  const saveMusicLinkNow = async () => {
    if (!currentShareId) return;
    if (sharedViewMode && !canEditSharedLink) return;
    if (isDemoShare) {
      setShareHint(
        "Demo mode: music changes stay only in this browser session.",
      );
      window.setTimeout(() => setShareHint(null), 1800);
      return;
    }
    autosaveAbortRef.current?.abort();
    const controller = new AbortController();
    autosaveAbortRef.current = controller;
    const r = await saveSharedPagesById(
      currentShareId,
      pages,
      backgroundMusicUrl,
      appBackgroundImageUrl,
      { signal: controller.signal },
    );
    if (r.ok === false && r.error === "aborted") return;
    if (!r.ok) {
      setShareHint("Хөгжмийн линк хадгалж чадсангүй. Дахин оролдоно уу.");
      return;
    }
    setShareHint("Хөгжмийн линк хадгалагдлаа.");
    if (typeof r.bytesUsed === "number") {
      setShareStorageUsedBytes(r.bytesUsed);
    }
    if (typeof r.bytesLimit === "number") {
      setShareStorageLimitBytes(r.bytesLimit);
    }
    window.setTimeout(() => setShareHint(null), 1400);
  };

  const unlockStudio = () => {
    if (!studioPassword) {
      setStudioUnlocked(true);
      return;
    }
    if (studioPasswordInput === studioPassword) {
      setStudioUnlocked(true);
      setStudioAuthError(null);
      setStudioPasswordInput("");
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(STUDIO_UNLOCK_KEY, "1");
      }
      return;
    }
    setStudioAuthError("Нууц үг буруу байна.");
  };

  useEffect(() => {
    if (!canSaveToServer || !currentShareId) return;
    const seq = ++autosaveSeqRef.current;
    const id = window.setTimeout(async () => {
      autosaveAbortRef.current?.abort();
      const controller = new AbortController();
      autosaveAbortRef.current = controller;
      const r = await saveSharedPagesById(
        currentShareId,
        pages,
        backgroundMusicUrl,
        appBackgroundImageUrl,
        { signal: controller.signal },
      );
      if (seq !== autosaveSeqRef.current) return;
      if (r.ok === false && r.error === "aborted") return;
      if (!r.ok) {
        setShareHint(
          "Энэ линк дээрх өөрчлөлтийг хадгалж чадсангүй. Хуудсаа сэргээгээд дахин оролдоно уу.",
        );
        return;
      }
      if (typeof r.bytesUsed === "number") {
        setShareStorageUsedBytes(r.bytesUsed);
      }
      if (typeof r.bytesLimit === "number") {
        setShareStorageLimitBytes(r.bytesLimit);
      }
      setShareHint("Өөрчлөлт хадгалагдлаа.");
      window.setTimeout(() => setShareHint(null), 1200);
    }, 700);
    return () => {
      window.clearTimeout(id);
    };
  }, [
    appBackgroundImageUrl,
    backgroundMusicUrl,
    canSaveToServer,
    currentShareId,
    pages,
    sharedViewMode,
  ]);

  useEffect(
    () => () => {
      autosaveAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (canSaveToServer) return;
    autosaveAbortRef.current?.abort();
  }, [canSaveToServer, currentShareId]);

  const turnNext = () => {
    if (currentLeaf < totalLeaves) {
      setCurrentLeaf((c) => c + 1);
      setSelectedElementId(null);
    }
  };

  const turnPrev = () => {
    if (currentLeaf > 0) {
      setCurrentLeaf((c) => c - 1);
      setSelectedElementId(null);
    }
  };

  const updateElement = (
    pageId: string,
    updatedElement: PageElement,
    saveHistory: boolean = true,
  ) => {
    const newPages = pages.map((p) => {
      if (p.id === pageId) {
        return {
          ...p,
          elements: p.elements.map((e) =>
            e.id === updatedElement.id ? updatedElement : e,
          ),
        };
      }
      return p;
    });

    if (saveHistory) {
      updatePagesWithHistory(newPages);
    } else {
      setPages(newPages);
    }
  };

  const addElement = (
    pageId: string,
    type: ElementType,
    content: string,
    opts?: { width?: number; height?: number },
  ) => {
    const isPolaroidSticker =
      type === "sticker" && content === POLAROID_STICKER_TOKEN;
    const newElement: PageElement = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      x: 100,
      y: 100,
      rotation: Math.random() * 20 - 10,
      content,
      fontSize: type === "text" ? 32 : type === "sticker" ? 48 : undefined,
      width:
        opts?.width ??
        (isPolaroidSticker ? 210 : type === "text" ? 260 : undefined),
      height:
        opts?.height ??
        (isPolaroidSticker ? 260 : type === "text" ? 120 : undefined),
      color: "#333333",
      fontFamily: type === "text" ? "var(--font-handwriting)" : undefined,
      textEffect: type === "text" ? "none" : undefined,
      fontWeight: type === "text" ? "normal" : undefined,
      fontStyle: type === "text" ? "normal" : undefined,
      textDecoration: type === "text" ? "none" : undefined,
      textBackgroundColor: type === "text" ? "transparent" : undefined,
    };
    updatePagesWithHistory(
      pages.map((p) => {
        if (p.id === pageId) {
          return { ...p, elements: [...p.elements, newElement] };
        }
        return p;
      }),
    );
    setSelectedElementId(newElement.id);
  };

  const storageLeftMb = Math.max(
    0,
    (shareStorageLimitBytes - shareStorageUsedBytes) / (1024 * 1024),
  );

  const probeVideoDurationSec = (file: File) =>
    new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const d = video.duration;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) ? d : 0);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Видеоны мэдээллийг уншиж чадсангүй."));
      };
      video.src = url;
    });

  const probeImageSize = (file: File) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: img.naturalWidth || 1,
          height: img.naturalHeight || 1,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Зургийн хэмжээг уншиж чадсангүй."));
      };
      img.src = url;
    });

  const probeVideoSize = (file: File) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: video.videoWidth || 1,
          height: video.videoHeight || 1,
        });
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Видеоны хэмжээг уншиж чадсангүй."));
      };
      video.src = url;
    });

  const deleteElement = (pageId: string, elementId: string) => {
    updatePagesWithHistory(
      pages.map((p) => {
        if (p.id === pageId) {
          return {
            ...p,
            elements: p.elements.filter((e) => e.id !== elementId),
          };
        }
        return p;
      }),
    );
    setSelectedElementId(null);
  };

  const removePage = (pageId: string) => {
    if (pages.length <= 2) {
      window.alert(
        isDemoShare
          ? "The book needs at least 2 pages."
          : "Номонд хамгийн багадаа 2 хуудас үлдэх ёстой.",
      );
      return;
    }
    if (
      !window.confirm(
        isDemoShare
          ? "Delete this page? You can restore it with Undo."
          : "Энэ хуудсыг устгах уу? Дараа нь Буцаах товчоор сэргээж болно.",
      )
    ) {
      return;
    }
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    const newPages = pages.filter((p) => p.id !== pageId);
    const newTotalLeaves = Math.ceil(newPages.length / 2);
    setCurrentLeaf((cl) => Math.min(cl, newTotalLeaves));
    setSelectedElementId(null);
    if (selectedPageId === pageId) {
      const nextIdx = Math.min(idx, newPages.length - 1);
      setSelectedPageId(newPages[Math.max(0, nextIdx)]?.id ?? null);
    }
    updatePagesWithHistory(newPages);
  };

  const updatePageBackground = (pageId: string, bg: string) => {
    updatePagesWithHistory(
      pages.map((p) => (p.id === pageId ? { ...p, background: bg } : p)),
    );
  };

  const updatePageBackgroundImage = (pageId: string, imageUrl: string) => {
    const nextImage = imageUrl.trim();
    updatePagesWithHistory(
      pages.map((p) => {
        if (p.id !== pageId) return p;
        if (nextImage) return { ...p, backgroundImage: nextImage };
        const { backgroundImage, ...rest } = p;
        void backgroundImage;
        return rest;
      }),
    );
  };

  const uploadBackgroundImageFile = async (
    file: File,
  ): Promise<string | null> => {
    if (!file.type.startsWith("image/")) {
      window.alert("Please choose an image file.");
      return null;
    }
    if (!currentShareId) {
      window.alert(
        "Create or open a share link first. Then the image can be uploaded and saved.",
      );
      return null;
    }
    setShareHint(
      isDemoShare
        ? "Demo mode: previewing background locally..."
        : "Background image is uploading...",
    );
    let preparedFile = file;
    try {
      preparedFile = await optimizeImageForUpload(file, {
        maxSide: isDemoShare
          ? getDemoImageMaxWidth()
          : MAX_BACKGROUND_UPLOAD_IMAGE_SIDE_PX,
        minRecompressBytes: 5_000_000,
        webpQuality: 0.92,
      });
    } catch {
      preparedFile = file;
    }
    if (isDemoShare) {
      setShareHint("Demo background preview added. It will not save publicly.");
      window.setTimeout(
        () => logDemoDiagnostics("after adding background image"),
        0,
      );
      window.setTimeout(() => setShareHint(null), 1800);
      return URL.createObjectURL(preparedFile);
    }
    const uploaded = await uploadImageFileForShare(
      currentShareId,
      preparedFile,
      { uploadKind: "background" },
    );
    if (uploaded.ok === false) {
      setShareHint(null);
      window.alert(toFriendlyUploadError(uploaded.error, "image"));
      return null;
    }
    if (typeof uploaded.bytesUsed === "number") {
      setShareStorageUsedBytes(uploaded.bytesUsed);
    }
    if (typeof uploaded.bytesLimit === "number") {
      setShareStorageLimitBytes(uploaded.bytesLimit);
    }
    setShareHint("Background image updated.");
    window.setTimeout(() => setShareHint(null), 1400);
    return uploaded.url;
  };

  const handlePageBackgroundImageUpload = (
    pageId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      const url = await uploadBackgroundImageFile(file);
      if (url) updatePageBackgroundImage(pageId, url);
    })();
    e.target.value = "";
  };

  const handleAppBackgroundImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      const url = await uploadBackgroundImageFile(file);
      if (url) setAppBackgroundImageUrl(url);
    })();
    e.target.value = "";
  };

  const updatePagePattern = (pageId: string, pattern: string) => {
    updatePagesWithHistory(
      pages.map((p) => (p.id === pageId ? { ...p, pattern } : p)),
    );
  };

  const dropImageIntoPolaroid = (
    pageId: string,
    imageEl: PageElement,
    frameId: string,
  ) => {
    const imageW = imageEl.width || 192;
    const imageH = imageEl.height || 192;
    updatePagesWithHistory(
      pages.map((p) => {
        if (p.id !== pageId) return p;
        const hasFrame = p.elements.some(
          (e) =>
            e.id === frameId &&
            e.type === "sticker" &&
            e.content === POLAROID_STICKER_TOKEN,
        );
        if (!hasFrame) return p;
        return {
          ...p,
          elements: p.elements
            .map((e) =>
              e.id === frameId
                ? {
                    ...e,
                    frameImage: imageEl.content,
                    x: imageEl.x - 12,
                    y: imageEl.y - 12,
                    width: imageW + 24,
                    height: imageH + 44,
                  }
                : e,
            )
            .filter((e) => e.id !== imageEl.id),
        };
      }),
    );
    setSelectedElementId(frameId);
  };

  const setVideoAudible = (id: string, audible: boolean) => {
    setAudibleVideoIds((prev) => {
      const has = prev.includes(id);
      if (audible && !has) return [...prev, id];
      if (!audible && has) return prev.filter((x) => x !== id);
      return prev;
    });
  };

  const isVideoMuted = (id: string) => videoMutedById[id] ?? true;
  const setVideoMuted = (id: string, muted: boolean) => {
    setVideoMutedById((prev) => ({ ...prev, [id]: muted }));
  };

  // On every page turn, force videos back to muted state.
  useEffect(() => {
    setVideoMutedById({});
  }, [currentLeaf]);

  const handleImageUpload = (
    pageId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (currentShareId) {
      setShareHint(
        isDemoShare
          ? "Demo mode: adding image locally..."
          : "Зургийг оновчлоод байршуулж байна...",
      );
      void (async () => {
        let preparedFile = file;
        try {
          preparedFile = await optimizeImageForUpload(
            file,
            isDemoShare ? { maxSide: getDemoImageMaxWidth() } : {},
          );
        } catch {
          preparedFile = file;
        }
        let mediaSize: { width: number; height: number } | null = null;
        try {
          mediaSize = await probeImageSize(preparedFile);
        } catch {
          mediaSize = null;
        }
        if (isDemoShare) {
          const targetWidth = 220;
          const ratio =
            mediaSize && mediaSize.height > 0
              ? mediaSize.width / mediaSize.height
              : 1;
          const targetHeight = Math.max(60, Math.round(targetWidth / ratio));
          addElement(pageId, "image", URL.createObjectURL(preparedFile), {
            width: targetWidth,
            height: targetHeight,
          });
          window.setTimeout(() => logDemoDiagnostics("after adding image"), 0);
          setShareHint("Demo image added. It will not save publicly.");
          window.setTimeout(() => setShareHint(null), 1800);
          return;
        }
        const uploaded = await uploadImageFileForShare(
          currentShareId,
          preparedFile,
        );
        if (uploaded.ok === false) {
          setShareHint(null);
          window.alert(toFriendlyUploadError(uploaded.error, "image"));
          return;
        }
        if (typeof uploaded.bytesUsed === "number") {
          setShareStorageUsedBytes(uploaded.bytesUsed);
        }
        if (typeof uploaded.bytesLimit === "number") {
          setShareStorageLimitBytes(uploaded.bytesLimit);
        }
        const targetWidth = 220;
        const ratio =
          mediaSize && mediaSize.height > 0
            ? mediaSize.width / mediaSize.height
            : 1;
        const targetHeight = Math.max(60, Math.round(targetWidth / ratio));
        addElement(pageId, "image", uploaded.url, {
          width: targetWidth,
          height: targetHeight,
        });
        setShareHint("Зураг байршууллаа.");
        window.setTimeout(() => setShareHint(null), 1400);
      })();
      e.target.value = "";
      return;
    }

    // Keep JSON light: force cloud upload workflow (no base64 fallback).
    window.alert(
      "Эхлээд хуваалцах линк үүсгэх/нээх хэрэгтэй. Дараа нь тэнд зургаа байршуулна уу. Ингэснээр зураг cloud дээр хадгалагдана.",
    );
    e.target.value = "";
  };

  const handleVideoUpload = async (
    pageId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!currentShareId) {
      window.alert(
        "Эхлээд хуваалцах линк үүсгэх/нээх хэрэгтэй. Дараа нь тэнд видео байршуулна уу.",
      );
      e.target.value = "";
      return;
    }
    if (!file.type.startsWith("video/")) {
      window.alert("Видео файл сонгоно уу.");
      e.target.value = "";
      return;
    }
    let mediaSize: { width: number; height: number } | null = null;
    try {
      const [sec, size] = await Promise.all([
        probeVideoDurationSec(file),
        probeVideoSize(file).catch(() => null),
      ]);
      if (sec > 60) {
        window.alert("Нэг видео хамгийн ихдээ 1 минут байна.");
        e.target.value = "";
        return;
      }
      mediaSize = size;
    } catch {
      window.alert("Видеоны уртыг шалгаж чадсангүй.");
      e.target.value = "";
      return;
    }

    setShareHint(
      isDemoShare
        ? "Demo mode: adding video locally..."
        : "Видео байршуулж байна...",
    );
    if (isDemoShare) {
      const targetWidth = 320;
      const ratio =
        mediaSize && mediaSize.height > 0
          ? mediaSize.width / mediaSize.height
          : 16 / 9;
      const targetHeight = Math.max(80, Math.round(targetWidth / ratio));
      addElement(pageId, "video", URL.createObjectURL(file), {
        width: targetWidth,
        height: targetHeight,
      });
      window.setTimeout(() => logDemoDiagnostics("after adding video"), 0);
      setShareHint("Demo video added. It will not save publicly.");
      window.setTimeout(() => setShareHint(null), 1800);
      e.target.value = "";
      return;
    }
    const uploaded = await uploadImageFileForShare(currentShareId, file);
    if (uploaded.ok === false) {
      setShareHint(null);
      window.alert(toFriendlyUploadError(uploaded.error, "video"));
      e.target.value = "";
      return;
    }
    if (typeof uploaded.bytesUsed === "number") {
      setShareStorageUsedBytes(uploaded.bytesUsed);
    }
    if (typeof uploaded.bytesLimit === "number") {
      setShareStorageLimitBytes(uploaded.bytesLimit);
    }
    const targetWidth = 320;
    const ratio =
      mediaSize && mediaSize.height > 0
        ? mediaSize.width / mediaSize.height
        : 16 / 9;
    const targetHeight = Math.max(80, Math.round(targetWidth / ratio));
    addElement(pageId, "video", uploaded.url, {
      width: targetWidth,
      height: targetHeight,
    });
    setShareHint("Видео байршууллаа.");
    window.setTimeout(() => setShareHint(null), 1400);
    e.target.value = "";
  };

  // Determine which pages are currently visible based on currentLeaf
  // currentLeaf 0: left = null, right = 0
  // currentLeaf 1: left = 1, right = 2
  // currentLeaf 2: left = 3, right = 4
  const visibleLeftPageId =
    currentLeaf === 0 ? null : pages[currentLeaf * 2 - 1]?.id;
  const visibleRightPageId =
    currentLeaf === totalLeaves ? null : pages[currentLeaf * 2]?.id;

  // Set selected page to right page by default if available, else left
  React.useEffect(() => {
    if (isEditing) {
      if (visibleRightPageId) setSelectedPageId(visibleRightPageId);
      else if (visibleLeftPageId) setSelectedPageId(visibleLeftPageId);
    } else {
      setSelectedPageId(null);
      setSelectedElementId(null);
    }
  }, [currentLeaf, isEditing, visibleRightPageId, visibleLeftPageId]);

  const leaves = [];
  for (let i = 0; i < totalLeaves; i++) {
    leaves.push({
      front: pages[i * 2],
      back: pages[i * 2 + 1],
    });
  }
  const transformStageDragPoint = useCallback(
    (point: { x: number; y: number }) => {
      const scale = stageScale * userZoom;
      if (scale <= 0) return point;
      return {
        x: point.x / scale,
        y: point.y / scale,
      };
    },
    [stageScale, userZoom],
  );

  if (shouldLockStudio) {
    return (
      <>
        <div
          className="h-dvh font-sans flex items-center justify-center px-4"
          style={{ backgroundColor: "#1f2937" }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h1 className="text-lg font-semibold text-stone-900">
              Нууц үг оруулна уу
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Үндсэн scrapbook редакторт нэвтрэхийн тулд нууц үгээ оруулна уу.
            </p>
            <input
              type="password"
              value={studioPasswordInput}
              onChange={(e) => setStudioPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") unlockStudio();
              }}
              placeholder="Password"
              className="mt-4 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            {studioAuthError && (
              <p className="mt-2 text-xs text-rose-600">{studioAuthError}</p>
            )}
            <button
              type="button"
              onClick={unlockStudio}
              className="mt-4 w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
            >
              Нэвтрэх
            </button>
          </div>
        </div>
        {isLoadingSceneVisible && (
          <LoadingScene
            isExiting={isLoadingSceneExiting}
            progress={loadingProgress}
          />
        )}
      </>
    );
  }

  const appBackgroundImage = appBackgroundImageUrl.trim();
  const appShellStyle: React.CSSProperties = appBackgroundImage
    ? {
        backgroundColor: appBackgroundColor,
        ...(isDemoShare ? {} : { backgroundImage: cssImageUrl(appBackgroundImage) }),
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      }
    : { backgroundColor: appBackgroundColor };

  return (
    <>
      {shareLinkLoadError && (
        <div
          className="fixed left-0 right-0 top-0 z-120 flex items-center justify-center gap-3 border-b border-amber-700/40 bg-amber-950/95 px-3 py-2 text-center text-sm text-amber-50 shadow-md"
          role="alert"
        >
          <span className="min-w-0 flex-1">
            {shareLinkLoadError === "timeout"
              ? "Холболт удаан байна. Дахин оролдоно уу."
              : "Хадгалагдсан номыг ачаалж чадсангүй. Интернэтээ шалгана уу."}
          </span>
          <button
            type="button"
            onClick={retryShareBootstrap}
            className="shrink-0 rounded-lg bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
          >
            Дахин ачаалах
          </button>
        </div>
      )}
      <div
        className={`h-dvh font-sans flex touch-auto flex-col overflow-hidden ${isDemoShare ? "demo-route relative" : ""}`}
        style={appShellStyle}
      >
        {isDemoShare && appBackgroundImage && (
          <DemoResponsiveImage
            src={appBackgroundImage}
            alt=""
            isDemoShare={isDemoShare}
            hdReady={demoHdIntent}
            sizes="100vw"
            maxWidth={1400}
            pictureClassName="pointer-events-none absolute inset-0 z-0 block"
            className="h-full w-full object-cover"
            draggable={false}
          />
        )}
        {/* Sidebar is overlaid (not flex-shrink) so book size stays the same in edit vs preview */}
        <div className="flex-1 relative z-10 min-h-0">
          {sharedViewMode && !isPureViewOnly && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 mx-2 max-w-lg text-center text-xs sm:text-sm text-white bg-white/15 rounded-xl py-2 px-3 sm:px-4 border border-white/25 shadow-lg">
              {!canEditSharedLink ? (
                <p className="mb-2 text-white/95">
                  {isShareEditExpired
                    ? "Энэ линкийн засварлах хугацаа дууссан"
                    : "Энэ хуваалцсан линк зөвхөн харах горимтой"}
                  {isShareEditExpired && Number.isFinite(shareEditDeadlineMs)
                    ? ` (${new Date(shareEditDeadlineMs).toLocaleString()})`
                    : ""}
                  . Скрапбүүк яг хадгалсан хэвээр үлдэнэ.
                </p>
              ) : (
                <p className="mb-2 text-white/95">
                  {isDemoShare ? (
                    <>
                      Demo sandbox: each visitor can try editing until{" "}
                      {shareEditUntilIso &&
                      Number.isFinite(shareEditDeadlineMs) ? (
                        <span className="font-semibold whitespace-nowrap">
                          {new Date(shareEditDeadlineMs).toLocaleString()}
                        </span>
                      ) : (
                        "five days after first opening"
                      )}
                      . Changes are private and never save to this public link.
                    </>
                  ) : (
                    <>
                      Засвар хийх боломжит хугацаа
                      {shareEditUntilIso &&
                      Number.isFinite(shareEditDeadlineMs) ? (
                        <>
                          {" "}
                          <span className="font-semibold whitespace-nowrap">
                            {new Date(shareEditDeadlineMs).toLocaleString()}
                          </span>{" "}
                          хүртэл.
                        </>
                      ) : (
                        "."
                      )}{" "}
                      Өөрчлөлтүүд энэ линк дээр автоматаар хадгалагдана.
                    </>
                  )}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {showPublishLinkUi && (
                  <button
                    type="button"
                    onClick={() => void copyShareLink()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-stone-800 text-xs font-medium hover:bg-stone-100"
                  >
                    <Link2 size={14} />
                    Линк хуулах
                  </button>
                )}
                {canEditSharedLink && !isDemoShare && (
                  <button
                    type="button"
                    onClick={() => setShowFinalizePrompt(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-medium hover:bg-rose-700"
                  >
                    Засвар дуусгах
                  </button>
                )}
              </div>
            </div>
          )}

          <main className="absolute inset-0 flex flex-col min-h-0 min-w-0 overflow-hidden p-0">
            {/* Row: nav + book fills height minus bottom bar space */}
            <div className="relative flex flex-1 min-h-0 w-full items-center justify-center">
              <button
                type="button"
                onClick={turnPrev}
                disabled={currentLeaf === 0}
                className={`absolute left-2 top-1/2 -translate-y-1/2 sm:left-3 shrink-0 w-10 h-10 sm:w-12 sm:h-12 text-white rounded-full flex items-center justify-center disabled:opacity-0 disabled:pointer-events-none transition-all z-20 ${
                  preferLiteEffects || isDemoShare
                    ? "demo-frosted bg-white/35 hover:bg-white/45"
                    : "bg-white/20 backdrop-blur-sm hover:bg-white/30"
                }`}
                aria-label={isDemoShare ? "Previous page" : "Өмнөх хуудас"}
              >
                <ChevronLeft size={26} />
              </button>

              <BookStageScaleContext.Provider value={stageScale}>
                <div
                  ref={stageViewportRef}
                  className="flex min-h-0 min-w-0 flex-1 h-full max-h-full items-center justify-center overflow-hidden"
                >
                  <div
                    className="relative shrink-0"
                    style={{
                      width: BOOK_STAGE_WIDTH * stageScale,
                      height: BOOK_STAGE_HEIGHT * stageScale,
                      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${userZoom})`,
                      transformOrigin: "center center",
                      transition:
                        userZoom === 1 ? "transform 0.25s ease" : "none",
                    }}
                  >
                    <div
                      className="book-perspective absolute left-0 top-0 preserve-3d"
                      style={{
                        width: BOOK_STAGE_WIDTH,
                        height: BOOK_STAGE_HEIGHT,
                        transform: `scale(${stageScale})`,
                        transformOrigin: "top left",
                      }}
                      onClick={() => {
                        if (!isEditing) setSelectedElementId(null);
                      }}
                    >
                      {isEditing ? (
                        <MotionConfig
                          transformPagePoint={transformStageDragPoint}
                        >
                          <EditingSpread
                            pages={pages}
                            visibleLeftPageId={visibleLeftPageId}
                            visibleRightPageId={visibleRightPageId}
                            selectedElementId={selectedElementId}
                            setSelectedElementId={setSelectedElementId}
                            updateElement={updateElement}
                            onVideoAudibleChange={setVideoAudible}
                            onDropImageIntoPolaroid={dropImageIntoPolaroid}
                            isVideoMuted={isVideoMuted}
                            setVideoMuted={setVideoMuted}
                            selectedPageId={selectedPageId}
                            setSelectedPageId={setSelectedPageId}
                            isDemoShare={isDemoShare}
                            demoHdIntent={demoHdIntent}
                            demoArmedVideoIds={demoArmedVideoIds}
                            armDemoVideo={armDemoVideo}
                          />
                        </MotionConfig>
                      ) : (
                        leaves.map((leaf, i) => {
                          if (!shouldRenderLeaf(i, currentLeaf, totalLeaves)) {
                            return null;
                          }
                          return (
                            <FlipPage
                              key={i}
                              leaf={leaf}
                              i={i}
                              currentLeaf={currentLeaf}
                              totalLeaves={totalLeaves}
                              isEditing={false}
                              selectedElementId={selectedElementId}
                              setSelectedElementId={setSelectedElementId}
                              updateElement={updateElement}
                              onVideoAudibleChange={setVideoAudible}
                              onDropImageIntoPolaroid={dropImageIntoPolaroid}
                              isVideoMuted={isVideoMuted}
                              setVideoMuted={setVideoMuted}
                              selectedPageId={selectedPageId}
                              setSelectedPageId={setSelectedPageId}
                              bendIntensity={bendIntensity}
                              liteMode={preferLiteEffects}
                              isDemoShare={isDemoShare}
                              demoHdIntent={demoHdIntent}
                              demoArmedVideoIds={demoArmedVideoIds}
                              armDemoVideo={armDemoVideo}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </BookStageScaleContext.Provider>

              <button
                type="button"
                onClick={turnNext}
                disabled={currentLeaf === totalLeaves}
                className={`absolute right-2 top-1/2 -translate-y-1/2 sm:right-3 shrink-0 w-10 h-10 sm:w-12 sm:h-12 text-white rounded-full flex items-center justify-center disabled:opacity-0 disabled:pointer-events-none transition-all z-20 ${
                  preferLiteEffects || isDemoShare
                    ? "demo-frosted bg-white/35 hover:bg-white/45"
                    : "bg-white/20 backdrop-blur-sm hover:bg-white/30"
                }`}
                aria-label={isDemoShare ? "Next page" : "Дараагийн хуудас"}
              >
                <ChevronRight size={26} />
              </button>
            </div>
          </main>

          {/* Bottom Floating Controls */}
          {!isPureViewOnly && (
            <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 max-w-[95vw]">
              {sharedViewMode && (
                <p className="text-xs text-white/90 bg-black/40 px-3 py-1.5 rounded-full border border-white/20">
                  {isDemoShare
                    ? "Demo mode: edits are private and not saved"
                    : `Үлдсэн зай: ${storageLeftMb.toFixed(2)} MB`}
                </p>
              )}
              {shareHint && (
                <p className="text-xs text-white/90 bg-black/40 px-3 py-1.5 rounded-full border border-white/20">
                  {shareHint}
                </p>
              )}
              <div
                className={`px-6 py-3 rounded-full flex items-center gap-4 border border-white/20 ${
                  preferLiteEffects || isDemoShare
                    ? "demo-frosted bg-white/20 shadow-lg"
                    : "bg-white/10 backdrop-blur-md shadow-xl"
                }`}
              >
                {!sharedViewMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsEditing(!isEditing)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isEditing ? "bg-stone-800 text-white" : "bg-white text-stone-800 hover:bg-stone-100"}`}
                      title={
                        isDemoShare
                          ? isEditing
                            ? "Preview"
                            : "Edit"
                          : isEditing
                            ? "Урьдчилж харах"
                            : "Засах"
                      }
                    >
                      {isEditing ? <Check size={18} /> : <Edit3 size={18} />}
                    </button>

                    {isEditing && (
                      <>
                        <div className="w-px h-6 bg-white/30 mx-1" />
                        <button
                          type="button"
                          onClick={undo}
                          disabled={historyIndex === 0}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={isDemoShare ? "Undo" : "Буцаах"}
                        >
                          <Undo2 size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={redo}
                          disabled={historyIndex === history.length - 1}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={isDemoShare ? "Redo" : "Дахин хийх"}
                        >
                          <Redo2 size={18} />
                        </button>
                      </>
                    )}

                    {showPublishLinkUi && (
                      <>
                        <div className="w-px h-6 bg-white/30 mx-1" />
                        <button
                          type="button"
                          onClick={() => void copyShareLink()}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors"
                          title="Энэ скрапбүүкийг явуулах линк хуулах"
                        >
                          <Link2 size={18} />
                        </button>
                      </>
                    )}

                    <div className="w-px h-6 bg-white/30 mx-1" />
                    <button
                      type="button"
                      onClick={() => {
                        const newPages = [...pages];
                        const backCover = newPages.pop();
                        const pageNum = newPages.length;
                        newPages.push({
                          id: `page-${pageNum}`,
                          background: "bg-stone-50",
                          pattern: "",
                          elements: [],
                        });
                        newPages.push({
                          id: `page-${pageNum + 1}`,
                          background: "bg-stone-50",
                          pattern: "",
                          elements: [],
                        });
                        if (backCover) newPages.push(backCover);
                        updatePagesWithHistory(newPages);
                      }}
                      className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors"
                      title="Хуудас нэмэх"
                    >
                      <Plus size={20} />
                    </button>
                  </>
                )}
                {sharedViewMode && canEditSharedLink && (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsEditing(!isEditing)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isEditing ? "bg-stone-800 text-white" : "bg-white text-stone-800 hover:bg-stone-100"}`}
                      title={
                        isDemoShare
                          ? isEditing
                            ? "Preview"
                            : "Edit"
                          : isEditing
                            ? "Урьдчилж харах"
                            : "Засах"
                      }
                    >
                      {isEditing ? <Check size={18} /> : <Edit3 size={18} />}
                    </button>
                    {isEditing && (
                      <>
                        <div className="w-px h-6 bg-white/30 mx-1" />
                        <button
                          type="button"
                          onClick={undo}
                          disabled={historyIndex === 0}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={isDemoShare ? "Undo" : "Буцаах"}
                        >
                          <Undo2 size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={redo}
                          disabled={historyIndex === history.length - 1}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={isDemoShare ? "Redo" : "Дахин хийх"}
                        >
                          <Redo2 size={18} />
                        </button>
                      </>
                    )}
                  </>
                )}
                {sharedViewMode && showPublishLinkUi && (
                  <button
                    type="button"
                    onClick={() => void copyShareLink()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-stone-800 text-sm font-medium hover:bg-stone-100"
                  >
                    <Link2 size={16} />
                    Линк хуулах
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Editor panel: draggable + accordion */}
          {isEditing && (!sharedViewMode || canEditSharedLink) && (
            <div
              ref={editorPanelRef}
              className="fixed z-30 flex max-h-[min(calc(100dvh-16px),900px)] w-[min(10rem,calc(50vw-12px))] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl md:w-[min(20rem,calc(100vw-16px))]"
              style={{ left: editorPlacement.left, top: editorPlacement.top }}
            >
              <div
                className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1.5 border-b border-stone-200 bg-stone-100 px-2 py-1.5 active:cursor-grabbing md:gap-2 md:px-3 md:py-2"
                onPointerDown={startEditorDrag}
              >
                <GripVertical className="size-4 text-stone-400 md:size-[18px]" />
                <span className="text-xs font-semibold text-stone-700 md:text-sm">
                  {isDemoShare ? "Edit demo" : "Засвар"}
                </span>
              </div>
              <div
                className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-2 md:p-4"
                data-allow-native-scroll="true"
              >
                <EditorPanelBody
                  selectedPageId={selectedPageId}
                  isDemoMode={isDemoShare}
                  selectedElementId={selectedElementId}
                  pages={pages}
                  openAccordion={openAccordion}
                  setOpenAccordion={setOpenAccordion}
                  appBackgroundColor={appBackgroundColor}
                  setAppBackgroundColor={setAppBackgroundColor}
                  appBackgroundImageUrl={appBackgroundImageUrl}
                  setAppBackgroundImageUrl={setAppBackgroundImageUrl}
                  backgroundMusicUrl={backgroundMusicUrl}
                  setBackgroundMusicUrl={setBackgroundMusicUrl}
                  saveMusicLink={saveMusicLinkNow}
                  addElement={addElement}
                  handleImageUpload={handleImageUpload}
                  handleVideoUpload={handleVideoUpload}
                  handlePageBackgroundImageUpload={
                    handlePageBackgroundImageUpload
                  }
                  handleAppBackgroundImageUpload={
                    handleAppBackgroundImageUpload
                  }
                  updatePageBackground={updatePageBackground}
                  updatePageBackgroundImage={updatePageBackgroundImage}
                  updatePagePattern={updatePagePattern}
                  updateElement={updateElement}
                  updatePagesWithHistory={updatePagesWithHistory}
                  deleteElement={deleteElement}
                  removePage={removePage}
                  addPagesPair={() => {
                    const newPages = [...pages];
                    const backCover = newPages.pop();
                    const pageNum = newPages.length;
                    newPages.push({
                      id: `page-${pageNum}`,
                      background: "bg-stone-50",
                      pattern: "",
                      elements: [],
                    });
                    newPages.push({
                      id: `page-${pageNum + 1}`,
                      background: "bg-stone-50",
                      pattern: "",
                      elements: [],
                    });
                    if (backCover) newPages.push(backCover);
                    updatePagesWithHistory(newPages);
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <div
          className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
          aria-hidden
        >
          <div ref={ytHostRef} />
        </div>
        {showFinalizePrompt && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
              <p className="text-base font-semibold text-stone-900 mb-2">
                Анхааруулга
              </p>
              <p className="text-sm leading-6 text-stone-700">
                Үүнийг буцаах боломжгүй, дахин засвар оруулах боломжгүй болно.
                Та дууссандаа итгэлтэй байна уу?
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowFinalizePrompt(false)}
                  disabled={isFinalizing}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  Үгүй
                </button>
                <button
                  type="button"
                  onClick={() => void finalizeEditingNow()}
                  disabled={isFinalizing}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {isFinalizing ? "Түр хүлээнэ үү..." : "Тийм"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {isLoadingSceneVisible && (
        <LoadingScene
          isExiting={isLoadingSceneExiting}
          progress={loadingProgress}
        />
      )}
    </>
  );
}

/** Flat 2D spread while editing — avoids broken pointer hit-testing from 3D transforms (bends / translateZ). */
function EditingSpread({
  pages,
  visibleLeftPageId,
  visibleRightPageId,
  selectedElementId,
  setSelectedElementId,
  updateElement,
  onVideoAudibleChange,
  onDropImageIntoPolaroid,
  isVideoMuted,
  setVideoMuted,
  selectedPageId,
  setSelectedPageId,
  isDemoShare,
  demoHdIntent,
  demoArmedVideoIds,
  armDemoVideo,
}: {
  pages: PageData[];
  visibleLeftPageId: string | null;
  visibleRightPageId: string | null;
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
  updateElement: (
    pageId: string,
    el: PageElement,
    saveHistory?: boolean,
  ) => void;
  onVideoAudibleChange: (id: string, audible: boolean) => void;
  onDropImageIntoPolaroid: (
    pageId: string,
    imageEl: PageElement,
    frameId: string,
  ) => void;
  isVideoMuted: (id: string) => boolean;
  setVideoMuted: (id: string, muted: boolean) => void;
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
  isDemoShare: boolean;
  demoHdIntent: boolean;
  demoArmedVideoIds: Record<string, boolean>;
  armDemoVideo: (id: string) => void;
}) {
  const left = visibleLeftPageId
    ? pages.find((p) => p.id === visibleLeftPageId)
    : undefined;
  const right = visibleRightPageId
    ? pages.find((p) => p.id === visibleRightPageId)
    : undefined;

  const shell =
    "shadow-[0_2px_10px_rgba(0,0,0,0.1)] overflow-hidden border border-black/10";

  return (
    <div
      className="absolute inset-0 z-10 flex items-stretch"
      onClick={() => setSelectedElementId(null)}
    >
      {left && right && (
        <>
          <div
            className={`w-1/2 shrink-0 h-full rounded-l-2xl rounded-r-sm border-r-black/20 ${shell}`}
          >
            <PageContent
              page={left}
              isEditing
              selectedElementId={selectedElementId}
              onSelectElement={setSelectedElementId}
              onUpdateElement={updateElement}
              onVideoAudibleChange={onVideoAudibleChange}
              onDropImageIntoPolaroid={onDropImageIntoPolaroid}
              isVideoMuted={isVideoMuted}
              setVideoMuted={setVideoMuted}
              isActive={selectedPageId === left.id}
              onSelectPage={() => setSelectedPageId(left.id)}
              isDemoShare={isDemoShare}
              demoHdIntent={demoHdIntent}
              demoArmedVideoIds={demoArmedVideoIds}
              armDemoVideo={armDemoVideo}
            />
          </div>
          <div
            className={`w-1/2 shrink-0 h-full rounded-r-2xl rounded-l-sm border-l-black/20 ${shell}`}
          >
            <PageContent
              page={right}
              isEditing
              selectedElementId={selectedElementId}
              onSelectElement={setSelectedElementId}
              onUpdateElement={updateElement}
              onVideoAudibleChange={onVideoAudibleChange}
              onDropImageIntoPolaroid={onDropImageIntoPolaroid}
              isVideoMuted={isVideoMuted}
              setVideoMuted={setVideoMuted}
              isActive={selectedPageId === right.id}
              onSelectPage={() => setSelectedPageId(right.id)}
              isDemoShare={isDemoShare}
              demoHdIntent={demoHdIntent}
              demoArmedVideoIds={demoArmedVideoIds}
              armDemoVideo={armDemoVideo}
            />
          </div>
        </>
      )}
      {left && !right && (
        <div
          className={`absolute left-0 top-0 w-1/2 h-full rounded-l-2xl rounded-r-sm border-r-black/20 ${shell}`}
        >
          <PageContent
            page={left}
            isEditing
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={updateElement}
            onVideoAudibleChange={onVideoAudibleChange}
            onDropImageIntoPolaroid={onDropImageIntoPolaroid}
            isVideoMuted={isVideoMuted}
            setVideoMuted={setVideoMuted}
            isActive={selectedPageId === left.id}
            onSelectPage={() => setSelectedPageId(left.id)}
            isDemoShare={isDemoShare}
            demoHdIntent={demoHdIntent}
            demoArmedVideoIds={demoArmedVideoIds}
            armDemoVideo={armDemoVideo}
          />
        </div>
      )}
      {!left && right && (
        <div
          className={`absolute left-1/2 top-0 w-1/2 h-full rounded-r-2xl rounded-l-sm border-l-black/20 ${shell}`}
        >
          <PageContent
            page={right}
            isEditing
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={updateElement}
            onVideoAudibleChange={onVideoAudibleChange}
            onDropImageIntoPolaroid={onDropImageIntoPolaroid}
            isVideoMuted={isVideoMuted}
            setVideoMuted={setVideoMuted}
            isActive={selectedPageId === right.id}
            onSelectPage={() => setSelectedPageId(right.id)}
            isDemoShare={isDemoShare}
            demoHdIntent={demoHdIntent}
            demoArmedVideoIds={demoArmedVideoIds}
            armDemoVideo={armDemoVideo}
          />
        </div>
      )}
    </div>
  );
}

function FlipPage({
  leaf,
  i,
  currentLeaf,
  totalLeaves,
  isEditing,
  selectedElementId,
  setSelectedElementId,
  updateElement,
  onVideoAudibleChange,
  onDropImageIntoPolaroid,
  isVideoMuted,
  setVideoMuted,
  selectedPageId,
  setSelectedPageId,
  bendIntensity = 1.2,
  liteMode = false,
  isDemoShare = false,
  demoHdIntent = false,
  demoArmedVideoIds = {},
  armDemoVideo = () => {},
}: any) {
  const isFlipped = i < currentLeaf;

  const rotateYTarget = useMotionValue(isFlipped ? -180 : 0);
  // Slightly softer spring for a "heavy paper" feel
  const rotateY = useSpring(rotateYTarget, {
    stiffness: liteMode ? 62 : 58,
    damping: liteMode ? 22 : 18,
    mass: liteMode ? 0.95 : 1.05,
    restDelta: 0.01,
  });

  // zIndex swaps exactly at -90 degrees
  const zIndex = useTransform(rotateY, (value) => (value < -90 ? i : 100 - i));

  // Lift the page up during the flip to prevent z-fighting and add realism
  // Also offset based on index to create a physical stack of pages
  const z = useTransform(
    rotateY,
    [-180, -90, 0],
    liteMode ? [i * 0.8, 22, -i * 0.8] : [i * 1.5, 58, -i * 1.5],
    { clamp: true },
  );

  // Paper bending effect (droop) - subtle enough for iPhone Safari.
  const rotateXTarget = useTransform(
    rotateY,
    [-180, -90, 0],
    liteMode ? [0, bendIntensity * 0.35, 0] : [0, bendIntensity, 0],
    { clamp: true },
  );

  // Add secondary spring physics to the bend for a realistic paper wobble
  const rotateX = useSpring(rotateXTarget, {
    stiffness: 45,
    damping: 15,
    mass: 1,
  });

  // Dynamic lighting/shading to simulate curvature
  const frontLightingOpacity = useTransform(
    rotateY,
    [-90, 0],
    liteMode ? [0.22, 0] : [0.48, 0],
    {
      clamp: true,
    },
  );
  const backLightingOpacity = useTransform(
    rotateY,
    [-180, -90],
    liteMode ? [0, 0.22] : [0, 0.48],
    { clamp: true },
  );
  const foldOpacity = useTransform(
    rotateY,
    [-180, -135, -90, -45, 0],
    liteMode ? [0.06, 0.16, 0.3, 0.16, 0.04] : [0.08, 0.26, 0.58, 0.26, 0.06],
    { clamp: true },
  );
  const edgeOpacity = useTransform(
    rotateY,
    [-180, -135, -90, -45, 0],
    liteMode ? [0.12, 0.22, 0.38, 0.22, 0.12] : [0.18, 0.34, 0.68, 0.34, 0.18],
    { clamp: true },
  );
  const paperBackGlowOpacity = useTransform(
    rotateY,
    [-180, -90, 0],
    liteMode ? [0.04, 0.16, 0.04] : [0.06, 0.3, 0.06],
    { clamp: true },
  );
  const curlOpacity = useTransform(
    rotateY,
    [-180, -150, -90, -30, 0],
    liteMode ? [0, 0.16, 0.34, 0.16, 0] : [0, 0.26, 0.62, 0.26, 0],
    { clamp: true },
  );
  const curlScaleX = useTransform(
    rotateY,
    [-180, -150, -90, -30, 0],
    [0.34, 0.72, 1, 0.72, 0.34],
    { clamp: true },
  );

  // Drop shadow moving across the book
  const shadowOpacity = useTransform(
    rotateY,
    [-180, -90, 0],
    liteMode ? [0, 0.12, 0] : [0, 0.32, 0],
    { clamp: true },
  );
  const shadowX = useTransform(
    rotateY,
    [-180, -90, 0],
    ["-100%", "-50%", "0%"],
  );
  const shadowScale = useTransform(rotateY, [-180, -90, 0], [1, 1.18, 1]);
  const shadowZIndex = useTransform(zIndex, (z) => z - 1);

  useEffect(() => {
    rotateYTarget.set(isFlipped ? -180 : 0);
  }, [isFlipped, rotateYTarget]);

  const isInteractive = i === currentLeaf || i === currentLeaf - 1;
  const [isDemoPromoted, setIsDemoPromoted] = useState(false);

  useEffect(() => {
    if (!isDemoShare || !isInteractive) {
      setIsDemoPromoted(false);
      return;
    }
    setIsDemoPromoted(true);
    const id = window.setTimeout(() => setIsDemoPromoted(false), 700);
    return () => window.clearTimeout(id);
  }, [isDemoShare, isFlipped, isInteractive]);

  // FIX-J (demo): Diagnostics overlay — only on leaf i===0 to avoid creating
  // and destroying the overlay on every leaf mount/unmount cycle.
  // Guard: only activates when ?diag is present in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (i !== 0) return; // Only the first leaf manages the overlay
    if (!new URLSearchParams(window.location.search).has("diag")) return;
    let el = document.getElementById("diag-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "diag-overlay";
      document.body.appendChild(el);
    }
    const diagEl = el;
    const id = window.setInterval(() => {
      const mem = (performance as any).memory;
      const layers = document.querySelectorAll(
        ".paper-flip-leaf, .paper-face",
      ).length;
      diagEl.textContent = mem
        ? `JS heap: ${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}MB\nDOM layers: ${layers}`
        : `DOM layers: ${layers}\n(no memory API on this browser)`;
    }, 2000);
    return () => {
      window.clearInterval(id);
      diagEl.remove();
    };
  }, [i]);

  return (
    <>
      {/* FIX-D: The blur-2xl shadow div uses CSS filter:blur() on a large element,
          creating a full-viewport GPU compositing surface on every frame.
          On iOS WebKit this alone can exhaust VRAM and trigger jetsam kills.
          Replace with a simple rgba shadow that needs no compositing layer. */}
      {!liteMode && (
        <motion.div
          className="absolute top-4 left-1/2 w-[45%] h-[95%] pointer-events-none rounded-full"
          style={{
            opacity: shadowOpacity,
            x: shadowX,
            scale: shadowScale,
            zIndex: shadowZIndex,
            /* FIX-D: box-shadow instead of filter:blur — no compositing surface */
            background: "rgba(0,0,0,0.22)",
            boxShadow: "0 0 48px 32px rgba(0,0,0,0.28)",
          }}
        />
      )}

      {/* FIX-C: Add is-flipping class only on the two interactive leaves so
          will-change:transform is promoted only where needed, not on all leaves. */}
      <motion.div
        className={`paper-flip-leaf absolute top-0 left-1/2 w-1/2 h-full origin-left preserve-3d ${!isInteractive ? "pointer-events-none" : "is-flipping"} ${isDemoPromoted ? "demo-promote" : ""}`}
        style={{
          rotateY,
          rotateX,
          zIndex,
          z,
        }}
      >
        {/* Front Page (Right side when not flipped) */}
        <motion.div
          className={`paper-face paper-face--front absolute inset-0 backface-hidden bg-white shadow-[0_2px_10px_rgba(0,0,0,0.1)] overflow-hidden rounded-r-2xl rounded-l-sm border border-black/10 border-r-black/20 ${isFlipped ? "pointer-events-none" : ""}`}
          style={{ transform: "translateZ(0.5px)" }}
        >
          <PageContent
            page={leaf.front}
            isEditing={isEditing}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={updateElement}
            onVideoAudibleChange={onVideoAudibleChange}
            onDropImageIntoPolaroid={onDropImageIntoPolaroid}
            isVideoMuted={isVideoMuted}
            setVideoMuted={setVideoMuted}
            isActive={selectedPageId === leaf.front?.id}
            onSelectPage={() => isEditing && setSelectedPageId(leaf.front?.id)}
            isDemoShare={isDemoShare}
            demoHdIntent={demoHdIntent}
            demoArmedVideoIds={demoArmedVideoIds}
            armDemoVideo={armDemoVideo}
          />

          {/* Static spine shadow */}
          <div className="absolute inset-y-0 left-0 pointer-events-none bg-gradient-to-r from-black/10 to-transparent w-12 z-50" />

          <div className="paper-fiber-overlay" />

          {isInteractive && (
            <>
              <motion.div
                className="paper-fold-shadow paper-fold-shadow--front"
                style={{ opacity: foldOpacity }}
              />
              <motion.div
                className="paper-edge-highlight paper-edge-highlight--front"
                style={{ opacity: edgeOpacity }}
              />
              <motion.div
                className="paper-back-glow paper-back-glow--front"
                style={{ opacity: paperBackGlowOpacity }}
              />
              <motion.div
                className="paper-curl-lip paper-curl-lip--front"
                style={{ opacity: curlOpacity, scaleX: curlScaleX }}
              />
            </>
          )}

          {isInteractive && (
            <motion.div
              className="paper-turn-light paper-turn-light--front"
              style={{
                opacity: frontLightingOpacity,
              }}
            />
          )}
        </motion.div>

        {/* Back Page (Left side when flipped) */}
        <motion.div
          className={`paper-face paper-face--back absolute inset-0 backface-hidden bg-white shadow-[0_2px_10px_rgba(0,0,0,0.1)] overflow-hidden rounded-l-2xl rounded-r-sm border border-black/10 border-l-black/20 ${!isFlipped ? "pointer-events-none" : ""}`}
          style={{ transform: "rotateY(180deg) translateZ(0.5px)" }}
        >
          <PageContent
            page={leaf.back}
            isEditing={isEditing}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={updateElement}
            onVideoAudibleChange={onVideoAudibleChange}
            onDropImageIntoPolaroid={onDropImageIntoPolaroid}
            isVideoMuted={isVideoMuted}
            setVideoMuted={setVideoMuted}
            isActive={selectedPageId === leaf.back?.id}
            onSelectPage={() => isEditing && setSelectedPageId(leaf.back?.id)}
            isDemoShare={isDemoShare}
            demoHdIntent={demoHdIntent}
            demoArmedVideoIds={demoArmedVideoIds}
            armDemoVideo={armDemoVideo}
          />

          {/* Static spine shadow */}
          <div className="absolute inset-y-0 right-0 pointer-events-none bg-gradient-to-l from-black/10 to-transparent w-12 z-50" />

          <div className="paper-fiber-overlay" />

          {isInteractive && (
            <>
              <motion.div
                className="paper-fold-shadow paper-fold-shadow--back"
                style={{ opacity: foldOpacity }}
              />
              <motion.div
                className="paper-edge-highlight paper-edge-highlight--back"
                style={{ opacity: edgeOpacity }}
              />
              <motion.div
                className="paper-back-glow paper-back-glow--back"
                style={{ opacity: paperBackGlowOpacity }}
              />
              <motion.div
                className="paper-curl-lip paper-curl-lip--back"
                style={{ opacity: curlOpacity, scaleX: curlScaleX }}
              />
            </>
          )}

          {isInteractive && (
            <motion.div
              className="paper-turn-light paper-turn-light--back"
              style={{
                opacity: backLightingOpacity,
              }}
            />
          )}
        </motion.div>
      </motion.div>
    </>
  );
}

function DemoResponsiveImage({
  src,
  isDemoShare,
  hdReady,
  alt,
  sizes,
  className,
  pictureClassName,
  style,
  maxWidth = 1280,
  draggable = false,
}: {
  src: string;
  isDemoShare: boolean;
  hdReady: boolean;
  alt: string;
  sizes: string;
  className?: string;
  pictureClassName?: string;
  style?: React.CSSProperties;
  maxWidth?: number;
  draggable?: boolean;
}) {
  if (!isDemoShare) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        sizes={sizes}
        className={className}
        style={style}
        draggable={draggable}
      />
    );
  }
  const attrs = demoResponsiveImageAttrs(src, hdReady, maxWidth);
  return (
    <picture className={pictureClassName}>
      {attrs.srcSet && <source srcSet={attrs.srcSet} sizes={sizes} />}
      <img
        src={attrs.src}
        alt={alt}
        loading="lazy"
        decoding="async"
        sizes={sizes}
        data-hi={attrs.dataHi}
        className={className}
        style={style}
        draggable={draggable}
      />
    </picture>
  );
}

function PageContent({
  page,
  isEditing,
  selectedElementId,
  onSelectElement,
  onUpdateElement,
  onVideoAudibleChange,
  onDropImageIntoPolaroid,
  isVideoMuted,
  setVideoMuted,
  isActive,
  onSelectPage,
  isDemoShare,
  demoHdIntent,
  demoArmedVideoIds,
  armDemoVideo,
}: {
  page?: PageData;
  isEditing: boolean;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (
    pageId: string,
    el: PageElement,
    saveHistory?: boolean,
  ) => void;
  onVideoAudibleChange?: (id: string, audible: boolean) => void;
  onDropImageIntoPolaroid: (
    pageId: string,
    imageEl: PageElement,
    frameId: string,
  ) => void;
  isVideoMuted: (id: string) => boolean;
  setVideoMuted: (id: string, muted: boolean) => void;
  isActive: boolean;
  onSelectPage: () => void;
  isDemoShare: boolean;
  demoHdIntent: boolean;
  demoArmedVideoIds: Record<string, boolean>;
  armDemoVideo: (id: string) => void;
}) {
  if (!page) return <div className="w-full h-full bg-stone-200" />;
  const useClassBackground = page.background.startsWith("bg-");
  const pageBackgroundImage = page.backgroundImage?.trim();
  const renderDemoImageBackground = isDemoShare && Boolean(pageBackgroundImage);
  const pageBackgroundStyle: React.CSSProperties | undefined =
    pageBackgroundImage && !renderDemoImageBackground
      ? {
          ...(useClassBackground ? {} : { backgroundColor: page.background }),
          backgroundImage: cssImageUrl(pageBackgroundImage),
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
        }
      : useClassBackground
        ? undefined
        : { backgroundColor: page.background };

  return (
    <div
      className={`w-full h-full relative ${useClassBackground ? page.background : ""} ${page.pattern} transition-all ${isActive && isEditing ? "ring-inset ring-4 ring-rose-400" : ""}`}
      style={pageBackgroundStyle}
      onClick={(e) => {
        if (isEditing) {
          onSelectPage();
          onSelectElement(null);
        }
      }}
    >
      {renderDemoImageBackground && pageBackgroundImage && (
        <DemoResponsiveImage
          src={pageBackgroundImage}
          alt=""
          isDemoShare={isDemoShare}
          hdReady={demoHdIntent}
          sizes="50vw"
          maxWidth={1280}
          pictureClassName="pointer-events-none absolute inset-0 z-0 block"
          className="h-full w-full object-cover"
          draggable={false}
        />
      )}
      {page.elements.map((el) => (
        <DraggableElement
          key={el.id}
          element={el}
          isEditing={isEditing}
          isSelected={selectedElementId === el.id}
          onSelect={() => {
            onSelectPage();
            onSelectElement(el.id);
          }}
          onUpdate={(newEl, saveHistory) =>
            onUpdateElement(page.id, newEl, saveHistory)
          }
          pageElements={page.elements}
          onDropImageIntoPolaroid={(imageEl, frameId) =>
            onDropImageIntoPolaroid(page.id, imageEl, frameId)
          }
          onVideoAudibleChange={onVideoAudibleChange ?? (() => {})}
          videoMuted={isVideoMuted(el.id)}
          setVideoMuted={(muted) => setVideoMuted(el.id, muted)}
          isDemoShare={isDemoShare}
          demoHdIntent={demoHdIntent}
          isDemoVideoArmed={Boolean(demoArmedVideoIds[el.id])}
          armDemoVideo={armDemoVideo}
        />
      ))}
    </div>
  );
}

function DraggableElement({
  element,
  isEditing,
  isSelected,
  onSelect,
  onUpdate,
  pageElements,
  onDropImageIntoPolaroid,
  onVideoAudibleChange,
  videoMuted,
  setVideoMuted,
  isDemoShare,
  demoHdIntent,
  isDemoVideoArmed,
  armDemoVideo,
}: {
  key?: React.Key;
  element: PageElement;
  isEditing: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (el: PageElement, saveHistory?: boolean) => void;
  pageElements: PageElement[];
  onDropImageIntoPolaroid: (imageEl: PageElement, frameId: string) => void;
  onVideoAudibleChange: (id: string, audible: boolean) => void;
  videoMuted: boolean;
  setVideoMuted: (muted: boolean) => void;
  isDemoShare: boolean;
  demoHdIntent: boolean;
  isDemoVideoArmed: boolean;
  armDemoVideo: (id: string) => void;
}) {
  const stageScale = useBookStageScale();
  const inv = stageScale > 0 ? 1 / stageScale : 1;
  const dragControls = useDragControls();
  const [isTransforming, setIsTransforming] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [isDemoVideoDomArmed, setIsDemoVideoDomArmed] = useState(false);
  const isPolaroid =
    element.type === "sticker" && element.content === POLAROID_STICKER_TOKEN;
  const lastReportedAudibleRef = useRef(false);
  const onVideoAudibleChangeRef = useRef(onVideoAudibleChange);
  const canResize =
    element.type === "image" ||
    element.type === "video" ||
    element.type === "text" ||
    isPolaroid;
  const baseWidth = canResize
    ? element.width ||
      (isPolaroid
        ? 210
        : element.type === "video"
          ? 320
          : element.type === "text"
            ? 260
            : 192)
    : undefined;
  const baseHeight = canResize
    ? element.height ||
      (isPolaroid
        ? 260
        : element.type === "video"
          ? 180
          : element.type === "text"
            ? 120
            : 192)
    : undefined;
  const isDemoVideoReady = isDemoVideoArmed || isDemoVideoDomArmed;

  const armCurrentDemoVideo = useCallback(
    (event?: React.SyntheticEvent) => {
      event?.stopPropagation();
      event?.preventDefault();
      if (isEditing) onSelect();
      if (!isDemoShare || element.type !== "video") return;
      armDemoVideo(element.id);
      setIsDemoVideoDomArmed(true);
      const el = videoRef.current;
      if (el && !el.getAttribute("src")) {
        el.src = element.content;
        el.load();
      }
      logDemoDiagnostics("demo video armed");
    },
    [
      armDemoVideo,
      element.content,
      element.id,
      element.type,
      isDemoShare,
      isEditing,
      onSelect,
    ],
  );

  const startResize = (
    e: React.PointerEvent,
    dir: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
  ) => {
    if (!canResize || !baseWidth || !baseHeight) return;
    e.stopPropagation();
    e.preventDefault();
    setIsTransforming(true);
    const promoted = (e.currentTarget as HTMLElement).closest(
      ".scrapbook-element",
    ) as HTMLElement | null;
    if (isDemoShare) promoteDemoElement(promoted);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = element.x;
    const oy = element.y;
    const ow = baseWidth;
    const oh = baseHeight;
    const minSize = 40;
    const isCornerHandle = dir.length === 2;
    const minScale = minSize / Math.max(ow, oh);

    const calc = (dx: number, dy: number) => {
      let nx = ox;
      let ny = oy;
      let nw = ow;
      let nh = oh;

      if (isCornerHandle) {
        const sx = dir.includes("e") ? dx : -dx;
        const sy = dir.includes("s") ? dy : -dy;
        const dominant =
          Math.abs(sx / ow) > Math.abs(sy / oh) ? sx / ow : sy / oh;
        const scale = Math.max(minScale, 1 + dominant);
        nw = Math.max(minSize, ow * scale);
        nh = Math.max(minSize, oh * scale);
        if (dir.includes("w")) nx = ox + (ow - nw);
        if (dir.includes("n")) ny = oy + (oh - nh);
        return { nx, ny, nw, nh };
      }

      if (dir.includes("e")) nw = Math.max(minSize, ow + dx);
      if (dir.includes("s")) nh = Math.max(minSize, oh + dy);
      if (dir.includes("w")) {
        nw = Math.max(minSize, ow - dx);
        nx = ox + (ow - nw);
      }
      if (dir.includes("n")) {
        nh = Math.max(minSize, oh - dy);
        ny = oy + (oh - nh);
      }
      return { nx, ny, nw, nh };
    };

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) * inv;
      const dy = (ev.clientY - sy) * inv;
      const { nx, ny, nw, nh } = calc(dx, dy);
      onUpdate({ ...element, x: nx, y: ny, width: nw, height: nh }, false);
    };

    const up = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) * inv;
      const dy = (ev.clientY - sy) * inv;
      const { nx, ny, nw, nh } = calc(dx, dy);
      onUpdate({ ...element, x: nx, y: ny, width: nw, height: nh }, true);
      setIsTransforming(false);
      if (isDemoShare) unpromoteDemoElement(promoted);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startRotate = (e: React.PointerEvent) => {
    if (!isEditing) return;
    e.stopPropagation();
    e.preventDefault();
    setIsTransforming(true);
    const target = e.currentTarget as HTMLButtonElement;
    const parent = target.parentElement;
    if (!parent) return;
    if (isDemoShare) promoteDemoElement(parent);
    const rect = parent.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const base = element.rotation || 0;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);

    const move = (ev: PointerEvent) => {
      const now = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const delta = (now - startAngle) * (180 / Math.PI);
      onUpdate({ ...element, rotation: Math.round(base + delta) }, false);
    };
    const up = (ev: PointerEvent) => {
      const now = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const delta = (now - startAngle) * (180 / Math.PI);
      onUpdate({ ...element, rotation: Math.round(base + delta) }, true);
      setIsTransforming(false);
      if (isDemoShare) unpromoteDemoElement(parent);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resizeHandleClass =
    "absolute z-60 h-3 w-3 rounded-full border border-white bg-stone-800 shadow-md";

  useEffect(() => {
    onVideoAudibleChangeRef.current = onVideoAudibleChange;
  }, [onVideoAudibleChange]);

  useEffect(() => {
    if (element.type !== "video") return;
    const el = videoRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVideoVisible(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [element.type, element.id]);

  useEffect(() => {
    if (element.type !== "video") return;
    // Video should count as "audible" only while its page is actually visible.
    const audible =
      (!isDemoShare || isDemoVideoReady) &&
      !videoMuted &&
      isVideoVisible &&
      !document.hidden;
    if (lastReportedAudibleRef.current !== audible) {
      onVideoAudibleChangeRef.current(element.id, audible);
      lastReportedAudibleRef.current = audible;
    }
  }, [
    element.type,
    element.id,
    isDemoShare,
    isDemoVideoReady,
    isVideoVisible,
    videoMuted,
  ]);

  useEffect(
    () => () => {
      if (element.type !== "video") return;
      if (lastReportedAudibleRef.current) {
        onVideoAudibleChangeRef.current(element.id, false);
      }
      if (isDemoShare) {
        const el = videoRef.current;
        if (el) {
          el.pause();
          el.removeAttribute("src");
          el.load();
        }
      }
    },
    [element.type, element.id, isDemoShare],
  );

  useEffect(() => {
    if (element.type !== "video") return;
    const el = videoRef.current;
    if (!el) return;
    const syncPlayback = () => {
      const shouldPlay =
        (!isDemoShare || isDemoVideoReady) && isVideoVisible && !document.hidden;
      if (shouldPlay) {
        void el.play().catch(() => {});
      } else {
        el.pause();
      }
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => document.removeEventListener("visibilitychange", syncPlayback);
  }, [element.type, isDemoShare, isDemoVideoReady, isVideoVisible]);

  return (
    <motion.div
      drag={isEditing && !isTransforming}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onPointerDown={(e) => {
        if (
          !isEditing &&
          isDemoShare &&
          element.type === "video" &&
          !isDemoVideoReady
        ) {
          armCurrentDemoVideo(e);
          return;
        }
        if (!isEditing || isTransforming) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-transform-handle="true"]')) return;
        const current = e.currentTarget as HTMLElement;
        if (isDemoShare) {
          promoteDemoElement(current);
          const clearPromotion = () => unpromoteDemoElement(current);
          window.addEventListener("pointerup", clearPromotion, { once: true });
          window.addEventListener("pointercancel", clearPromotion, {
            once: true,
          });
        }
        dragControls.start(e);
      }}
      onDragEnd={(e, info) => {
        if (isDemoShare) unpromoteDemoElement(e.currentTarget as HTMLElement);
        const next = {
          ...element,
          x: element.x + info.offset.x,
          y: element.y + info.offset.y,
        };
        if (
          element.type === "sticker" &&
          element.content === POLAROID_STICKER_TOKEN
        ) {
          const fw = next.width || 210;
          const fh = next.height || 260;
          const frameCenterX = next.x + fw / 2;
          const frameCenterY = next.y + fh / 2;
          const targetImage = [...pageElements].reverse().find((img) => {
            if (img.type !== "image" || img.id === element.id) return false;
            const iw = img.width || 192;
            const ih = img.height || 192;
            return (
              frameCenterX >= img.x &&
              frameCenterX <= img.x + iw &&
              frameCenterY >= img.y &&
              frameCenterY <= img.y + ih
            );
          });
          if (targetImage) {
            onDropImageIntoPolaroid(targetImage, element.id);
            return;
          }
        }
        onUpdate(next);
      }}
      onClick={(e) => {
        if (isEditing) {
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`scrapbook-element absolute ${isEditing ? "cursor-move" : ""} ${isSelected && isEditing ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-transparent" : ""}`}
      style={{ "--item-z": element.zIndex ?? 10 } as React.CSSProperties}
      initial={{ x: element.x, y: element.y, rotate: element.rotation }}
      animate={{ x: element.x, y: element.y, rotate: element.rotation }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {element.type === "text" && (
        <div
          style={{
            color: element.color,
            fontSize: element.fontSize,
            fontWeight: element.fontWeight || "normal",
            fontStyle: element.fontStyle || "normal",
            textDecoration: element.textDecoration || "none",
            fontFamily: element.fontFamily || "var(--font-handwriting)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            width: element.width || 260,
            minHeight: element.height || 120,
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            textShadow:
              element.textEffect === "shadow"
                ? "2px 2px 4px rgba(0,0,0,0.5)"
                : element.textEffect === "outline"
                  ? `-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0px 0px 2px rgba(0,0,0,0.5)`
                  : element.textEffect === "glow"
                    ? `0 0 10px ${element.color}, 0 0 20px ${element.color}`
                    : "none",
          }}
        >
          {element.content}
        </div>
      )}
      {element.type === "sticker" &&
        (element.content === POLAROID_STICKER_TOKEN ? (
          <div
            className="rounded-sm border border-[#e6dfd5] bg-[#fbf8f1] shadow-[0_12px_18px_rgba(0,0,0,0.20)]"
            style={{
              width: element.width || 210,
              height: element.height || 260,
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(130,107,87,0.04) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgba(130,107,87,0.03) 0 1px, transparent 1px 5px)",
            }}
          >
            <div className="px-3 pt-3 pb-8 h-full">
              {element.frameImage ? (
                <DemoResponsiveImage
                  src={element.frameImage}
                  alt="polaroid"
                  isDemoShare={isDemoShare}
                  hdReady={demoHdIntent}
                  sizes="25vw"
                  maxWidth={960}
                  className="h-full w-full rounded-[2px] border border-black/10 object-cover"
                  draggable={false}
                />
              ) : (
                <div className="h-full w-full rounded-[2px] border border-black/10 bg-linear-to-br from-stone-200 to-stone-300" />
              )}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: element.fontSize, lineHeight: 1 }}>
            {element.content}
          </div>
        ))}
      {element.type === "image" && (
        <DemoResponsiveImage
          src={element.content}
          alt="scrapbook"
          isDemoShare={isDemoShare}
          hdReady={demoHdIntent}
          sizes="30vw"
          maxWidth={1280}
          className="object-cover"
          style={{
            width: element.width || 192,
            height: element.height ?? "auto",
          }}
          draggable={false}
        />
      )}
      {element.type === "video" && (
        <div className="relative inline-block">
          <video
            ref={videoRef}
            src={!isDemoShare || isDemoVideoReady ? element.content : undefined}
            poster={
              isDemoShare
                ? demoImageVariant(DEMO_LIGHT_IMAGE_URLS[1], 640, 72)
                : undefined
            }
            autoPlay={!isDemoShare}
            loop
            muted={videoMuted}
            playsInline
            preload={isDemoShare ? "none" : "metadata"}
            className="object-cover rounded-sm bg-black"
            style={{
              width: element.width || 320,
              height: element.height || 180,
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (isEditing) onSelect();
              if (isDemoShare && !isDemoVideoReady) {
                armCurrentDemoVideo(e);
                return;
              }
              const el = videoRef.current;
              if (!el) return;
              const nextMuted = !videoMuted;
              el.muted = nextMuted;
              setVideoMuted(nextMuted);
              // Apply ducking immediately on user click (don't wait for effect tick).
              onVideoAudibleChange(element.id, !nextMuted);
              void el.play().catch(() => {});
            }}
          />
          {isDemoShare && !isDemoVideoReady && (
            <button
              type="button"
              className="absolute inset-0 z-20 flex items-center justify-center rounded-sm bg-black/20 text-xs font-semibold text-white pointer-events-auto"
              onPointerDown={armCurrentDemoVideo}
              onClick={armCurrentDemoVideo}
            >
              Tap to preview
            </button>
          )}
        </div>
      )}
      {isEditing && isSelected && (
        <>
          <button
            type="button"
            onPointerDown={startRotate}
            data-transform-handle="true"
            className="absolute left-1/2 -top-7 -translate-x-1/2 z-60 h-4 w-4 rounded-full border border-white bg-blue-600 shadow-md cursor-grab active:cursor-grabbing"
            title="Rotate"
          />
          {canResize && (
            <>
              <button
                type="button"
                data-transform-handle="true"
                onPointerDown={(e) => startResize(e, "e")}
                className={`${resizeHandleClass} -right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`}
              />
              <button
                type="button"
                data-transform-handle="true"
                onPointerDown={(e) => startResize(e, "se")}
                className={`${resizeHandleClass} -bottom-1.5 -right-1.5 cursor-nwse-resize`}
              />
              <button
                type="button"
                data-transform-handle="true"
                onPointerDown={(e) => startResize(e, "s")}
                className={`${resizeHandleClass} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`}
              />
            </>
          )}
          {/* ── Layer controls: To Front / To Back ── */}
          <button
            type="button"
            data-transform-handle="true"
            title="Bring to front"
            onClick={(e) => {
              e.stopPropagation();
              const cur = element.zIndex ?? 10;
              onUpdate({ ...element, zIndex: Math.min(Z_MAX, cur + Z_JUMP) });
            }}
            className="layer-btn layer-btn--front"
          >
            ▲
          </button>
          <button
            type="button"
            data-transform-handle="true"
            title="Send to back"
            onClick={(e) => {
              e.stopPropagation();
              const cur = element.zIndex ?? 10;
              onUpdate({ ...element, zIndex: Math.max(Z_MIN, cur - Z_JUMP) });
            }}
            className="layer-btn layer-btn--back"
          >
            ▼
          </button>
        </>
      )}
    </motion.div>
  );
}
