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
  ArrowLeft,
  PenTool,
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
import DrawingModal from "./DrawingModal";
import CropModal from "./CropModal";

// This used to be React.lazy()-loaded as its own chunk, since share-link
// viewers never open the editor. But the production build runs through
// vite-plugin-javascript-obfuscator (stringArrayRotate/stringArrayShuffle),
// which corrupts Vite's chunk-URL lookup table for dynamically-imported
// modules — the request ends up going to a URL with no hash and no
// extension (e.g. /assets/EditorPanelBody instead of
// /assets/EditorPanelBody-XXXX.js), which 200s into the SPA's index.html
// fallback and throws a MIME-type error. Since this is the only lazy-loaded
// chunk in the app, opening the editor was completely broken in production
// for every real customer. A static import sidesteps the whole class of
// bug — worth the small increase to the initial bundle size.
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
import {
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  type Language,
} from "./i18n";

// â”€â”€â”€ z-index layering constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const Z_STEP = 1;
const Z_JUMP = 10;
const Z_MIN = 1;
const Z_MAX = 200;
// Whole-page ink sits below every element's default z (10) so a fresh
// photo isn't obscured by page-wide drawing unless the user explicitly
// sends it back — one click of the existing "Send to back" button
// (10 - Z_JUMP, floored at Z_MIN) already lands below this.
const PAGE_DRAWING_Z = 5;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Safe layout zone: image right edge ≤ 680, bottom edge ≤ 520.
// Rotation adds ~20px visual bleed, so stay well inside 800×600.
const defaultPages: PageData[] = [
  { id: "blank-page", background: "bg-white", pattern: "", elements: [] },
];

const POLAROID_STICKER_TOKEN = "__POLAROID__";

// Self-heals shares saved by the old add-page code, which minted ids from
// the page array's length at creation time (`page-${pages.length}`) — after
// any delete-then-add sequence that number can collide with an id still
// used by another page. Every page-update function matches by
// `p.id === pageId`, so two pages sharing an id silently mirror every edit
// made to either one. Reassigns a fresh unique id to each id seen more than
// once (keeping the first occurrence), applied whenever pages load from a
// server bundle so an already-broken share repairs itself on next open.
function dedupePageIds(pages: PageData[]): PageData[] {
  const seen = new Set<string>();
  return pages.map((p) => {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      return p;
    }
    const freshId = `page-${Math.random().toString(36).slice(2, 11)}`;
    seen.add(freshId);
    return { ...p, id: freshId };
  });
}

function getInitialPagesAndShare(): {
  pages: PageData[];
  openedFromShareLink: boolean;
} {
  if (typeof window === "undefined") {
    return { pages: defaultPages, openedFromShareLink: false };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("share") || params.get("id")) {
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

/** Matches Tailwind `md` (768px): narrower panel on phones than desktop's 320px. */
function editorPanelWidthPx(viewportWidth: number): number {
  if (viewportWidth < 768) {
    // 160px (roughly half the old 320px desktop width) was too narrow for
    // several MN-language accordion labels — "Хуудасны загвар", "Сонгосон
    // элемент" — which truncated to "..." with no way to read the rest.
    // 78% of viewport comfortably fits them while still leaving a sliver
    // of the card preview visible behind the panel.
    return Math.min(280, Math.max(220, Math.floor(viewportWidth * 0.78)));
  }
  return Math.min(320, viewportWidth - 16);
}

function defaultEditorLeftPx(): number {
  if (typeof window === "undefined") return 400;
  const vw = window.innerWidth;
  const pw = editorPanelWidthPx(vw);
  return Math.max(8, vw - pw - 12);
}

/** Default top offset for the editor panel — pushed down on phones so it
 *  doesn't open directly on top of the shared-view hint banner, which can
 *  wrap to several lines at narrow widths. Desktop's banner rarely wraps
 *  past one or two lines, so it keeps its original tight offset. */
function defaultEditorTopPx(): number {
  if (typeof window === "undefined") return 12;
  return window.innerWidth < 768 ? 132 : 12;
}

function parseYouTubeVideoId(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  // Pasted ID only (no https://) â€” common when copying from the address bar on mobile
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
  language: Language = "mn",
): string {
  const t = (rawError || "").toLowerCase();
  const en = language === "en";


  if (t.includes("1 minute")) {
    if (en) return "This video is longer than 1 minute. Please choose a shorter video.";
    return "Энэ видео 1 минутаас урт байна. Богино видео сонгоно уу.";
  }
  if (
    t.includes("storage limit") ||
    t.includes("15mb") ||
    t.includes("too large")
  ) {
    if (en) return "The file is too large, or this link's storage is full. Please choose a smaller photo or video.";
    return "Файл хэт том эсвэл энэ линкний багтаамж дүүрсэн байна. Жижиг хэмжээтэй зураг/видео сонгоно уу.";
  }
  if (t.includes("only image/video")) {
    if (en) {
      return kind === "image"
        ? "This image type is not supported. Please choose a JPG, PNG, WebP, or GIF file."
        : "This video type is not supported. Please choose an MP4, WebM, or MOV file.";
    }
    return kind === "image"
      ? "Энэ төрлийн зураг дэмжигдэхгүй байна. JPG, PNG, WebP эсвэл GIF файл сонгоно уу."
      : "Энэ төрлийн видео дэмжигдэхгүй байна. MP4, WebM эсвэл MOV файл сонгоно уу.";
  }
  if (t.includes("edit window expired")) {
    if (en) return "This link's editing window has expired, so new files cannot be added.";
    return "Энэ линкний засварлах хугацаа дууссан тул шинэ файл нэмэх боломжгүй.";
  }
  if (t.includes("share not found") || t.includes("not found")) {
    if (en) return "Link not found. Please check the link and try again.";
    return "Линк олдсонгүй. Линк зөв эсэхийг шалгаад дахин оролдоно уу.";
  }
  if (t.includes("file is required")) {
    if (en) return "No file was selected. Please choose a file and try again.";
    return "Файл сонгогдоогүй байна. Дахин сонгоод оролдоно уу.";
  }
  if (t.includes("r2 not configured") || t.includes("service unavailable")) {
    if (en) return "File uploads are not available right now. Please wait a moment and try again.";
    return "Одоогоор файл байршуулах боломжгүй байна. Түр хүлээгээд дахин оролдоно уу.";
  }

  if (en) {
    return kind === "image"
      ? "This image could not be uploaded. Please choose another image and try again."
      : "This video could not be uploaded. Please choose another video and try again.";
  }

  return kind === "image"
    ? "Энэ зургийг оруулах боломжгүй байна. Өөр зураг сонгоод дахин оролдоно уу."
    : "Энэ видеог оруулах боломжгүй байна. Өөр видео сонгоод дахин оролдоно уу.";
}

function toFriendlyFinalizeError(rawError: string, language: Language = "mn"): string {
  const t = (rawError || "").toLowerCase();
  if (t.includes("not found")) {
    if (language === "en") return "Link not found. Refresh the page and try again.";
    return "Линк олдсонгүй. Хуудсаа сэргээгээд дахин оролдоно уу.";
  }
  if (language === "en") return "Something went wrong while finalizing edits. Please try again.";
  return "Засварыг дуусгах үед алдаа гарлаа. Дахин оролдоно уу.";
}

const STUDIO_UNLOCK_KEY = "scrapbook-studio-unlock";

// â”€â”€â”€ Demo-route helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
 * device-appropriate value. On iOS we use 900px (â‰ˆ iPhone 15 Pro @3x logical
 * width of 393px Ã— 2 = 786px, rounded up). On desktop we use 1200px.
 * This is tighter than the existing 1100/1400 split and avoids loading
 * 2200px-wide bitmaps that exhaust iOS VRAM.
 */
function getDemoImageMaxWidth(): number {
  if (typeof window === "undefined") return 1200;
  // Use devicePixelRatio-aware cap: logical width Ã— DPR, max 1200 on mobile.
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
// Public-domain birthday music for the fixed demo scrapbook.
const DEMO_LIGHT_MUSIC_URL =
  "https://upload.wikimedia.org/wikipedia/commons/0/02/Happy_Birthday_to_You.ogg";
// CC0 music â€” set DEMO_LIGHT_MUSIC_URL in server/share-server.mjs to add a track.
const DEMO_LIGHT_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
// Birthday / celebration themed Unsplash photos (must match server/share-server.mjs).
const DEMO_LIGHT_IMAGE_URLS = [
  "https://images.unsplash.com/photo-1464349153735-7db50ed83c84", // birthday candles
  "https://images.unsplash.com/photo-1527529482837-4698179dc6ce", // friends celebrating
  "https://images.unsplash.com/photo-1513151233558-d860c5398176", // colorful balloons
  "https://images.unsplash.com/photo-1530103862676-de8c9debad1d", // pink birthday cake
  "https://images.unsplash.com/photo-1602173574767-37ac01994b2a", // flowers close-up
  "https://images.unsplash.com/photo-1533038590840-1cde6e668a91", // flower bouquet
  "https://images.unsplash.com/photo-1519741497674-611481863552", // sparklers
  "https://images.unsplash.com/photo-1558618666-fcd25c85cd64", // pastel balloons
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30", // confetti celebration
  "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e", // cupcakes with candle
  "https://images.unsplash.com/photo-1549465220-1a8b9238cd48", // wrapped gift boxes
  "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3", // champagne toast
  "https://images.unsplash.com/photo-1530268729831-4b0b9e170218", // birthday party crowd
  "https://images.unsplash.com/photo-1574371339068-c68e09bfbb25", // rainbow confetti
  "https://images.unsplash.com/photo-1559181567-c3190ca9d5db", // pink roses bouquet
] as const;
const DEMO_LIGHT_BACKGROUND_URLS = [
  "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b", // warm bokeh lights
  "https://images.unsplash.com/photo-1518568814500-bf0f8d125f46", // pink rose petals
  "https://images.unsplash.com/photo-1490750967868-88df5691cc1e", // spring blossoms
  "https://images.unsplash.com/photo-1523438885200-e635ba2c371e", // soft pastel floral
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5", // purple pink bokeh
  "https://images.unsplash.com/photo-1517697471339-4aa32003c11a", // soft yellow bokeh
  "https://images.unsplash.com/photo-1546484396-fb3fc6f95f98", // pastel pink
  "https://images.unsplash.com/photo-1549490349-8643362247b5", // confetti bokeh
] as const;

const DEMO_PAGE_BG_COLORS = [
  "#f3d7b8",
  "#ffe0ec",
  "#dff3ef",
  "#fff1b8",
  "#dfebff",
  "#f6dfef",
  "#e7f5d8",
  "#ffe3cc",
  "#eadffc",
  "#f7e7c8",
] as const;

const DEMO_PATTERNS = [
  "pattern-grid",
  "pattern-polka",
  "pattern-lines",
  "",
] as const;

function demoText(
  id: string,
  content: string,
  x: number,
  y: number,
  options: Partial<PageElement> = {},
): PageElement {
  return {
    id,
    type: "text",
    x,
    y,
    rotation: options.rotation ?? 0,
    content,
    fontSize: options.fontSize ?? 24,
    color: options.color ?? "#6f4326",
    fontFamily: options.fontFamily ?? "var(--font-handwriting)",
    textEffect: options.textEffect ?? "none",
    width: options.width ?? 250,
    height: options.height ?? 80,
    zIndex: options.zIndex ?? 40,
    ...(options.fontWeight ? { fontWeight: options.fontWeight } : {}),
    ...(options.fontStyle ? { fontStyle: options.fontStyle } : {}),
    ...(options.textDecoration
      ? { textDecoration: options.textDecoration }
      : {}),
    ...(options.textBackgroundColor
      ? { textBackgroundColor: options.textBackgroundColor }
      : {}),
  };
}

function isDirectAudioUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return /\.(mp3|m4a|ogg|oga|wav|webm)(\?.*)?$/i.test(
      parsed.pathname + parsed.search,
    );
  } catch {
    return false;
  }
}

function demoImage(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  zIndex = 20,
): PageElement {
  const assetIndex = Math.abs(
    [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0),
  );
  return {
    id,
    type: "image",
    x,
    y,
    rotation,
    content: DEMO_LIGHT_IMAGE_URLS[assetIndex % DEMO_LIGHT_IMAGE_URLS.length],
    width,
    height,
    zIndex,
  };
}

function demoPolaroid(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  zIndex = 18,
): PageElement {
  const assetIndex = Math.abs(
    [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0),
  );
  return {
    id,
    type: "sticker",
    x,
    y,
    rotation,
    content: POLAROID_STICKER_TOKEN,
    width,
    height,
    frameImage:
      DEMO_LIGHT_IMAGE_URLS[(assetIndex + 3) % DEMO_LIGHT_IMAGE_URLS.length],
    zIndex,
  };
}

function demoSticker(
  id: string,
  content: string,
  x: number,
  y: number,
  fontSize: number,
  rotation = 0,
  zIndex = 55,
): PageElement {
  return {
    id,
    type: "sticker",
    x,
    y,
    rotation,
    content,
    fontSize,
    zIndex,
  };
}

function demoVideo(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): PageElement {
  return {
    id,
    type: "video",
    x,
    y,
    rotation,
    content: DEMO_LIGHT_VIDEO_URL,
    width,
    height,
    zIndex: 24,
  };
}

// True while any photo/drawing on the page is still showing its optimistic
// local blob: preview (upload not yet resolved to a real hosted URL).
function pagesHavePendingBlobUrls(pages: PageData[]): boolean {
  const isBlob = (v: unknown): v is string =>
    typeof v === "string" && v.startsWith("blob:");
  return pages.some(
    (p) =>
      isBlob(p.drawing) ||
      p.elements.some(
        (e) => isBlob(e.content) || isBlob(e.frameImage) || isBlob(e.drawingOverlay),
      ),
  );
}

function fitDemoElementToPage(element: PageElement): PageElement {
  const xScale = 0.52;
  const sizeScale = 0.84;
  return {
    ...element,
    x: Math.round(14 + element.x * xScale),
    width:
      typeof element.width === "number"
        ? Math.round(element.width * xScale)
        : element.width,
    fontSize:
      typeof element.fontSize === "number"
        ? Math.max(12, Math.round(element.fontSize * sizeScale))
        : element.fontSize,
  };
}

function buildDemoBirthdayPages(maxWidth: number = 900): PageData[] {
  const bg = (index: number) => demoCdnBackgroundAt(index, maxWidth);
  return [
    {
      id: "demo-cover",
      background: "#eac08f",
      backgroundImage: bg(0),
      pattern: "pattern-grid",
      elements: [
        demoText("d1-title", "Happy\nBirthday\nmy friend", 52, 72, {
          rotation: -4,
          fontSize: 48,
          color: "#7b321e",
          fontFamily: "var(--font-pacifico)",
          width: 430,
          height: 185,
          fontWeight: "bold",
          textEffect: "outline",
          zIndex: 60,
        }),
        demoPolaroid("d1-polaroid", 506, 72, 188, 238, 7),
        demoText("d1-note", "a little book of tiny sparks, big laughs, and favorite days", 92, 318, {
          rotation: 2,
          fontSize: 23,
          color: "#5c3925",
          width: 430,
          height: 92,
        }),
        demoSticker("d1-stars", "* * *", 534, 358, 34, -8),
        demoSticker("d1-cake", "🎂", 98, 432, 32, -5),
        demoSticker("d1-heart", "💛", 636, 434, 34, 8),
      ],
    },
    {
      id: "demo-page-2",
      background: "#ffe0ec",
      backgroundImage: bg(1),
      pattern: "pattern-polka",
      elements: [
        demoText("d2-head", "open when you need a smile", 40, 42, {
          rotation: -2,
          fontSize: 36,
          color: "#b43b64",
          width: 410,
          height: 70,
          fontWeight: "bold",
        }),
        demoImage("d2-img-a", 62, 128, 230, 286, -6),
        demoPolaroid("d2-polaroid", 416, 106, 210, 260, 4),
        demoText("d2-note", "you make ordinary afternoons feel like confetti", 334, 392, {
          rotation: -4,
          fontSize: 22,
          color: "#8b3151",
          width: 330,
          height: 86,
          fontStyle: "italic",
        }),
        demoSticker("d2-bow", "🎀", 636, 54, 28, 12),
        demoSticker("d2-spark", "✨", 300, 452, 24, 7),
      ],
    },
    {
      id: "demo-page-3",
      background: "#dff3ef",
      backgroundImage: bg(2),
      pattern: "pattern-lines",
      elements: [
        demoPolaroid("d3-polaroid-a", 46, 70, 190, 246, -8),
        demoPolaroid("d3-polaroid-b", 280, 108, 176, 230, 6),
        demoImage("d3-img", 520, 70, 160, 210, -2),
        demoText("d3-title", "favorite silly snapshots", 86, 354, {
          rotation: 2,
          fontSize: 34,
          color: "#21665f",
          width: 450,
          height: 72,
          fontWeight: "bold",
        }),
        demoText("d3-caption", "proof that the best plans are usually the least serious ones", 116, 426, {
          rotation: -1,
          fontSize: 20,
          color: "#2d5c55",
          width: 520,
          height: 70,
        }),
        demoSticker("d3-flowers", "🌸", 616, 338, 30, 10),
      ],
    },
    {
      id: "demo-page-4",
      background: "#fff1b8",
      backgroundImage: bg(3),
      pattern: "pattern-grid",
      elements: [
        demoText("d4-title", "birthday wish list", 54, 44, {
          rotation: -3,
          fontSize: 42,
          color: "#8a5a15",
          width: 360,
          height: 72,
          fontFamily: "var(--font-amatic)",
          fontWeight: "bold",
        }),
        demoText("d4-list", "1. soft mornings\n2. loud laughing\n3. cake with extra frosting\n4. more photos together", 78, 132, {
          rotation: -1,
          fontSize: 25,
          color: "#6b4614",
          width: 390,
          height: 220,
        }),
        demoPolaroid("d4-polaroid", 500, 126, 174, 230, 8),
        demoSticker("d4-tape-a", "✦", 464, 104, 25, -14),
        demoSticker("d4-tape-b", "✦", 626, 338, 25, 8),
        demoText("d4-small", "all checked, obviously", 408, 412, {
          rotation: 6,
          fontSize: 24,
          color: "#9a5b12",
          width: 250,
          height: 62,
          textEffect: "glow",
        }),
      ],
    },
    {
      id: "demo-page-5",
      background: "#dfebff",
      backgroundImage: bg(4),
      pattern: "pattern-polka",
      elements: [
        demoVideo("d5-video", 68, 104, 292, 178, -4),
        demoText("d5-title", "tiny video memory", 86, 48, {
          rotation: -2,
          fontSize: 34,
          color: "#1f5e89",
          width: 320,
          height: 64,
          fontWeight: "bold",
        }),
        demoPolaroid("d5-polaroid", 466, 74, 182, 236, 5),
        demoText("d5-note", "tap the clip, then keep flipping through the party", 78, 318, {
          rotation: 2,
          fontSize: 23,
          color: "#24577a",
          width: 550,
          height: 76,
        }),
        demoSticker("d5-star", "⭐", 612, 382, 32, -8),
        demoSticker("d5-heart", "💗", 394, 112, 28, 12),
      ],
    },
    {
      id: "demo-page-6",
      background: "#f6dfef",
      backgroundImage: bg(5),
      pattern: "pattern-lines",
      elements: [
        demoImage("d6-img-a", 42, 78, 196, 246, -5),
        demoImage("d6-img-b", 296, 58, 164, 210, 4),
        demoPolaroid("d6-polaroid", 514, 162, 166, 216, -7),
        demoText("d6-title", "little notes from me", 80, 366, {
          rotation: -2,
          fontSize: 38,
          color: "#9c3a78",
          width: 360,
          height: 74,
          fontWeight: "bold",
        }),
        demoText("d6-note", "you are rare, warm, and very easy to celebrate", 352, 396, {
          rotation: 3,
          fontSize: 22,
          color: "#75305e",
          width: 320,
          height: 86,
        }),
        demoSticker("d6-doodle", "xoxo", 480, 72, 28, -12),
      ],
    },
    {
      id: "demo-page-7",
      background: "#e7f5d8",
      backgroundImage: bg(6),
      pattern: "pattern-grid",
      elements: [
        demoText("d7-title", "our best-day recipe", 56, 50, {
          rotation: -1,
          fontSize: 38,
          color: "#466a25",
          width: 390,
          height: 68,
          fontWeight: "bold",
        }),
        demoPolaroid("d7-polaroid-a", 74, 140, 180, 232, -6),
        demoPolaroid("d7-polaroid-b", 306, 124, 174, 226, 5),
        demoPolaroid("d7-polaroid-c", 526, 144, 150, 202, -3),
        demoText("d7-list", "sunlight + snacks + your playlist + absolutely no schedule", 132, 402, {
          rotation: -2,
          fontSize: 23,
          color: "#3c5d1f",
          width: 500,
          height: 78,
        }),
        demoSticker("d7-leaf", "🍃", 618, 52, 30, 8),
      ],
    },
    {
      id: "demo-page-8",
      background: "#ffe3cc",
      backgroundImage: bg(7),
      pattern: "pattern-polka",
      elements: [
        demoText("d8-title", "party crumbs", 52, 42, {
          rotation: -4,
          fontSize: 44,
          color: "#9a4b20",
          width: 290,
          height: 76,
          fontFamily: "var(--font-pacifico)",
        }),
        demoImage("d8-img-a", 64, 132, 238, 190, -5),
        demoImage("d8-img-b", 388, 94, 228, 286, 6),
        demoText("d8-note", "the cake disappeared suspiciously fast", 84, 366, {
          rotation: 2,
          fontSize: 24,
          color: "#7b3e20",
          width: 330,
          height: 84,
          fontStyle: "italic",
        }),
        demoSticker("d8-candle", "🕯️", 634, 390, 28, 8),
        demoSticker("d8-confetti", "* *", 316, 108, 30, 14),
      ],
    },
    {
      id: "demo-page-9",
      background: "#eadffc",
      backgroundImage: bg(8),
      pattern: "pattern-lines",
      elements: [
        demoPolaroid("d9-polaroid", 66, 72, 218, 276, -5),
        demoText("d9-title", "main character energy", 340, 70, {
          rotation: 3,
          fontSize: 38,
          color: "#6744a0",
          width: 310,
          height: 120,
          fontWeight: "bold",
          textEffect: "outline",
        }),
        demoText("d9-note", "today the whole page is yours", 356, 218, {
          rotation: -2,
          fontSize: 25,
          color: "#4f377b",
          width: 280,
          height: 92,
        }),
        demoImage("d9-img", 398, 352, 230, 118, 4),
        demoSticker("d9-crown", "👑", 566, 42, 34, 12),
        demoSticker("d9-heart", "💛", 286, 374, 32, -8),
      ],
    },
    {
      id: "demo-page-10",
      background: "#f7e7c8",
      backgroundImage: bg(9),
      pattern: "pattern-grid",
      elements: [
        demoText("d10-title", "caption corner", 48, 42, {
          rotation: -2,
          fontSize: 40,
          color: "#805a2b",
          width: 330,
          height: 72,
          fontWeight: "bold",
        }),
        demoText("d10-note-a", "\"remember this?\"", 78, 132, {
          rotation: -6,
          fontSize: 32,
          color: "#5d4324",
          width: 250,
          height: 72,
          textEffect: "shadow",
        }),
        demoText("d10-note-b", "yes. instantly.", 112, 208, {
          rotation: 4,
          fontSize: 30,
          color: "#9c552d",
          width: 210,
          height: 64,
        }),
        demoPolaroid("d10-polaroid-a", 366, 76, 170, 224, 7),
        demoPolaroid("d10-polaroid-b", 516, 230, 162, 210, -8),
        demoSticker("d10-pin", "•", 338, 64, 26, -12),
        demoSticker("d10-smile", ":)", 92, 390, 30, -3),
      ],
    },
    {
      id: "demo-page-11",
      background: "#ffe0ec",
      backgroundImage: bg(10),
      pattern: "pattern-polka",
      elements: [
        demoImage("d11-img-a", 48, 70, 190, 250, -3),
        demoImage("d11-img-b", 280, 94, 172, 218, 5),
        demoVideo("d11-video", 476, 118, 188, 120, -4),
        demoText("d11-title", "mini highlight reel", 70, 360, {
          rotation: -2,
          fontSize: 38,
          color: "#a33b68",
          width: 360,
          height: 72,
          fontWeight: "bold",
        }),
        demoText("d11-note", "photos, video, notes, stickers, frames - the full tiny museum", 356, 356, {
          rotation: 3,
          fontSize: 21,
          color: "#743354",
          width: 310,
          height: 105,
        }),
        demoSticker("d11-spark", "✨", 650, 66, 26, 8),
      ],
    },
    {
      id: "demo-page-12",
      background: "#dff3ef",
      backgroundImage: bg(11),
      pattern: "pattern-lines",
      elements: [
        demoText("d12-title", "things i love about you", 50, 42, {
          rotation: -2,
          fontSize: 36,
          color: "#27605d",
          width: 430,
          height: 74,
          fontWeight: "bold",
        }),
        demoText("d12-list", "your laugh\nhow you notice small things\nyour big soft heart\nthe way you make people feel included", 72, 132, {
          rotation: 1,
          fontSize: 24,
          color: "#244f4b",
          width: 430,
          height: 250,
        }),
        demoPolaroid("d12-polaroid", 510, 104, 172, 226, 6),
        demoSticker("d12-flower", "🌼", 546, 368, 30, -7),
        demoText("d12-bottom", "never change the sweet parts", 118, 424, {
          rotation: -3,
          fontSize: 24,
          color: "#2d6960",
          width: 410,
          height: 64,
          fontStyle: "italic",
        }),
      ],
    },
    {
      id: "demo-page-13",
      background: "#fff1b8",
      backgroundImage: bg(12),
      pattern: "pattern-grid",
      elements: [
        demoPolaroid("d13-polaroid-a", 50, 70, 176, 228, -7),
        demoPolaroid("d13-polaroid-b", 250, 92, 176, 228, 4),
        demoPolaroid("d13-polaroid-c", 494, 74, 176, 228, 7),
        demoText("d13-title", "three cheers for you", 102, 360, {
          rotation: -2,
          fontSize: 40,
          color: "#8a5a15",
          width: 500,
          height: 74,
          fontFamily: "var(--font-amatic)",
          fontWeight: "bold",
        }),
        demoText("d13-note", "one for your past, one for today, one for every bright thing coming", 112, 424, {
          rotation: 1,
          fontSize: 22,
          color: "#684412",
          width: 500,
          height: 70,
        }),
        demoSticker("d13-stars", "* * *", 334, 316, 28, -4),
      ],
    },
    {
      id: "demo-page-14",
      background: "#dfebff",
      backgroundImage: bg(13),
      pattern: "pattern-polka",
      elements: [
        demoText("d14-title", "one last wish", 58, 54, {
          rotation: -3,
          fontSize: 48,
          color: "#1d5d85",
          width: 360,
          height: 86,
          fontFamily: "var(--font-pacifico)",
        }),
        demoImage("d14-img", 430, 74, 230, 298, 5),
        demoText("d14-note", "may this year bring you places that feel kind, people who feel easy, and days worth saving.", 70, 170, {
          rotation: 1,
          fontSize: 25,
          color: "#235b78",
          width: 330,
          height: 210,
        }),
        demoSticker("d14-tape", "✦", 402, 54, 25, -8),
        demoSticker("d14-moon", "☾", 128, 408, 30, 5),
        demoText("d14-small", "with love", 460, 408, {
          rotation: -4,
          fontSize: 30,
          color: "#1e4f70",
          width: 180,
          height: 60,
          textDecoration: "underline",
        }),
      ],
    },
    {
      id: "demo-back-cover",
      background: "#eac08f",
      backgroundImage: bg(14),
      pattern: "pattern-grid",
      elements: [
        demoText("d15-title", "the end\nfor now", 126, 118, {
          rotation: -4,
          fontSize: 58,
          color: "#7b321e",
          fontFamily: "var(--font-pacifico)",
          width: 360,
          height: 168,
          fontWeight: "bold",
          textEffect: "outline",
        }),
        demoPolaroid("d15-polaroid", 504, 98, 170, 224, 6),
        demoText("d15-note", "flip back anytime you need a birthday-sized hug", 124, 336, {
          rotation: 2,
          fontSize: 26,
          color: "#5c3925",
          width: 470,
          height: 90,
        }),
        demoSticker("d15-spark", "*", 92, 82, 42, 12),
        demoSticker("d15-heart", "💛", 604, 390, 34, -10),
      ],
    },
  ].map((page, pageIndex) => ({
    ...page,
    background: DEMO_PAGE_BG_COLORS[pageIndex % DEMO_PAGE_BG_COLORS.length],
    backgroundImage: undefined,
    pattern: page.pattern || DEMO_PATTERNS[pageIndex % DEMO_PATTERNS.length],
    elements: page.elements.map(fitDemoElementToPage),
  }));
}

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

const DEMO_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 420'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23fff8ed'/%3E%3Cstop offset='1' stop-color='%23efd9ba'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='420' fill='url(%23g)'/%3E%3Cpath d='M58 294c40-58 66-82 94-55 17 17 32 34 54 13 20-19 38-8 57 42' fill='none' stroke='%23c79a72' stroke-width='14' stroke-linecap='round'/%3E%3Ccircle cx='220' cy='136' r='34' fill='%23e9bd83'/%3E%3C/svg%3E";

function demoFallbackImageFor(src: string, maxWidth: number): string {
  if (!src) return DEMO_IMAGE_PLACEHOLDER;
  const hash = [...src].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const fallbackBase =
    DEMO_LIGHT_IMAGE_URLS[(Math.abs(hash) + 7) % DEMO_LIGHT_IMAGE_URLS.length];
  const fallback = demoImageVariant(
    fallbackBase,
    Math.min(Math.max(maxWidth, 640), 960),
    74,
  );
  return fallback === src ? DEMO_IMAGE_PLACEHOLDER : fallback;
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

      if (element.type === "sticker" && element.content === "__POLAROID__") {
        return {
          ...element,
          frameImage: demoCdnImageAt(assetIndex + 2, maxWidth),
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
  isDemoShare: boolean = false,
): boolean {
  if (isDemoShare) {
    return (
      Math.abs(index - currentLeaf) <= 1 ||
      Math.abs(index - (currentLeaf - 1)) <= 1
    );
  }
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
      <div className="brand">Бяцхан ном</div>
      <div className="brand-sub">little book of memories</div>
      <div className="progress progress--polished">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="noise" />
    </div>
  );
}

export default function App() {
  const [uiLanguage, setUiLanguage] = useState<Language>(() => {
    if (typeof window === "undefined") return "mn";
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  });
  const uiEnglish = uiLanguage === "en";
  const ui = useCallback(
    (mn: string, en: string) => (uiEnglish ? en : mn),
    [uiEnglish],
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, uiLanguage);
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

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
  /** Server `?share=` only: ISO time after which â€œMake my own copyâ€ is hidden. */
  const [shareEditUntilIso, setShareEditUntilIso] = useState<string | null>(
    null,
  );
  const [shareDeadlineTick, setShareDeadlineTick] = useState(0);

  const [currentLeaf, setCurrentLeaf] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  // A dedicated full-screen editor for one page — "Edit Left" / "Edit Right"
  // open this instead of just selecting a page in the small floating panel.
  const [fullScreenPageId, setFullScreenPageId] = useState<string | null>(
    null,
  );
  // Freehand drawing tool — draws on a scratch canvas, then the result is
  // inserted as a regular movable/resizable "image" element, reusing the
  // whole photo pipeline instead of a new element type. When
  // drawTargetElementId is set, the tool draws over that specific photo
  // (matching its exact box) instead of the whole page.
  const [showDrawing, setShowDrawing] = useState(false);
  const [drawTargetElementId, setDrawTargetElementId] = useState<
    string | null
  >(null);
  // Rectangular crop tool — replaces the same photo element's content in
  // place (not a new element), same optimistic-then-swap upload as a fresh
  // photo.
  const [cropTargetElementId, setCropTargetElementId] = useState<
    string | null
  >(null);
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
    top: defaultEditorTopPx(),
  }));
  const [openAccordion, setOpenAccordion] = useState<EditorAccordionId | null>(
    null,
  );
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const editorPlacementRef = useRef(editorPlacement);
  const prevSelectedElementId = useRef<string | null>(null);
  // Set by jumpToPage() right before it changes currentLeaf — the
  // leaf-change effect below picks it up on its next run instead of
  // defaulting to "whichever page ends up on the right", which would
  // silently select the wrong page when the requested one lands on the left.
  const pendingPageSelectionRef = useRef<string | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const directAudioRef = useRef<HTMLAudioElement | null>(null);
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
    return () => window.clearTimeout(startExit);
  }, [
    isInitialBootstrapDone,
    isWindowLoaded,
    isLoadingSceneVisible,
    isLoadingSceneExiting,
  ]);

  // Unmount the loader after its exit transition. This must live in its own
  // effect: scheduling it alongside startExit self-cancels, because the
  // isLoadingSceneExiting flip re-runs that effect and its cleanup clears the
  // pending hide timer — leaving the invisible loader animating forever.
  useEffect(() => {
    if (!isLoadingSceneExiting || !isLoadingSceneVisible) return;
    const hide = window.setTimeout(
      () => setIsLoadingSceneVisible(false),
      LOADING_SCENE_EXIT_MS,
    );
    return () => window.clearTimeout(hide);
  }, [isLoadingSceneExiting, isLoadingSceneVisible]);

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
    const audio = directAudioRef.current;
    if (audio) {
      audio.volume = audibleVideoIds.length > 0 ? 0.18 : 0.42;
      void audio.play().catch(() => {});
    }
    const p = ytPlayerRef.current;
    if (!p) return;
    p.unMute?.();
    p.playVideo?.();
  }, [audibleVideoIds.length]);

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

  const directAudioUrl = isDirectAudioUrl(backgroundMusicUrl)
    ? backgroundMusicUrl.trim()
    : "";
  const ytVideoId = directAudioUrl ? null : parseYouTubeVideoId(backgroundMusicUrl);

  useEffect(() => {
    // Load the YouTube iframe API only when this book actually uses a
    // YouTube track — most visitors never need the ~500KB player script.
    if (!ytVideoId) return;
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
  }, [ytVideoId]);

  useEffect(() => {
    const audio = directAudioRef.current;
    if (!audio) return;
    audio.volume = audibleVideoIds.length > 0 ? 0.18 : 0.42;
  }, [audibleVideoIds.length]);

  useEffect(() => {
    if (!directAudioUrl) return;
    if (hasAudioGesture) tryStartBackgroundMusic();
  }, [directAudioUrl, hasAudioGesture, tryStartBackgroundMusic]);

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
      // 2-finger pinch is handled by the stage's own listener â†’ don't block it here.
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

  // Same fixed-logical-space-plus-uniform-scale approach as stageScale
  // above, but for the full-screen single-page editor (fullScreenPageId):
  // that view previously sized its page container with CSS aspect-ratio/
  // max-width instead, with no BookStageScaleContext.Provider at all — so
  // element x/y/width/height (authored in the ~400×600 logical space every
  // other view uses) rendered unscaled into a container whose real pixel
  // size rarely matched 400×600, shifting the layout and clipping anything
  // that fell outside the mismatched bounds. This keeps the full-screen
  // editor's single page geometrically identical to how it looks
  // everywhere else — same logical box, same scale mechanism, just fit to
  // this view's own container.
  const fsStageViewportRef = useRef<HTMLDivElement>(null);
  const [fsStageScale, setFsStageScale] = useState(1);
  useLayoutEffect(() => {
    if (!fullScreenPageId) return;
    const el = fsStageViewportRef.current;
    if (!el) return;
    const pageW = BOOK_STAGE_WIDTH / 2;
    const pageH = BOOK_STAGE_HEIGHT;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      const s = Math.min(w / pageW, h / pageH);
      setFsStageScale(Math.max(0.08, Math.min(s, 4)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [fullScreenPageId]);

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
          // double-tap â†’ reset zoom and pan
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
        // Finger count dropped from 2 â†’ 1, restart pan tracking
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

  /** Uniform scale so the fixed 800Ã—600 stage matches preview/edit on every screen size. */
  useLayoutEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      // Slightly under-fill so the spread never touches the viewport edge —
      // the small margin reads as intentional framing rather than clipping.
      const fill = preferLiteEffects ? 0.955 : 0.97;
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
    const sid = params.get("share") || params.get("id");
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
          const isDemo = isSandboxDemoShareId(sid);
          if (isDemo) {
            // Demo content is built entirely on the client — never touches
            // the share API at all, so it renders instantly.
            // FIX-A (demo): Use DPR-aware width cap instead of hardcoded 1100/1400.
            // getDemoImageMaxWidth() computes: min(pageLogicalWidth × DPR, 1100 on iOS / 1400 on desktop).
            // This prevents loading 2200px Unsplash bitmaps on a 390px-wide iPhone screen.
            const demoAssetMaxWidth = getDemoImageMaxWidth();
            const displayPages = buildDemoBirthdayPages(demoAssetMaxWidth);
            setShareLinkLoadError(null);
            setCurrentShareId(sid);
            setPages(displayPages);
            setBackgroundMusicUrl(DEMO_LIGHT_MUSIC_URL);
            setAppBackgroundImageUrl(
              demoCdnBackgroundAt(99, demoAssetMaxWidth),
            );
            setShareEditUntilIso(getDemoEditUntilIso(sid));
            setSharedViewMode(true);
            setHistory([displayPages]);
            setHistoryIndex(0);
            setShareHint(null);
            // Genuinely local-only now — no network call at all, not even to
            // fetch quota info. setShareStorageUsedBytes already defaults to 0.
            window.setTimeout(() => logDemoDiagnostics("demo load"), 0);
            return;
          }
          setShareHint(
            ui("Линкний өгөгдлийг ачаалж байна...", "Loading link data..."),
          );
          const bundle = await fetchSharedBundleWithAttempts(
            sid,
            SHARE_FETCH_ATTEMPTS,
            SHARE_FETCH_TIMEOUT_MS,
          );
          if (cancelled || !applyShareBundleRef.current) return;
          if (bundle) {
            const repairedPages = dedupePageIds(bundle.pages);
            setShareLinkLoadError(null);
            setCurrentShareId(sid);
            setPages(repairedPages);
            setBackgroundMusicUrl(bundle.musicUrl || "");
            setAppBackgroundImageUrl(bundle.appBackgroundImage || "");
            setShareEditUntilIso(bundle.editUntil);
            setShareStorageUsedBytes(bundle.mediaBytes);
            setSharedViewMode(true);
            setHistory([repairedPages]);
            setHistoryIndex(0);
            setShareHint(null);
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
          const repairedPages = dedupePageIds(bundle.pages);
          setCurrentShareId(studioRootShareId);
          setPages(repairedPages);
          setBackgroundMusicUrl(bundle.musicUrl || "");
          setAppBackgroundImageUrl(bundle.appBackgroundImage || "");
          setShareEditUntilIso(bundle.editUntil);
          setShareStorageUsedBytes(bundle.mediaBytes);
          setSharedViewMode(false);
          setHistory([repairedPages]);
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
        setShareHint(
          ui(
            "Линк хууллаа. Мессеж эсвэл и-мэйлээр явуулаарай.",
            "Link copied. Send it by message or email.",
          ),
        );
        window.setTimeout(() => setShareHint(null), 5000);
      } catch {
        window.prompt(
          ui("Энэ линкийг хуулна уу:", "Copy this link:"),
          resolved.url,
        );
      }
      return;
    }
    window.alert(
      ui(
        "Хуваалцах линк үүсгэж чадсангүй. Хэт олон том зурагтай бол цөөн эсвэл жижиг зураг ашиглаад, интернетээ шалгаад дахин оролдоно уу. Энэ алдаа үргэлжилбэл линк үүсгэх үйлчилгээ идэвхжээгүй байж магадгүй.",
        "Could not create a share link. If this scrapbook has many large photos, use fewer or smaller images, check your internet connection, and try again. If this keeps happening, link creation may not be enabled.",
      ),
    );
  };

  const finalizeEditingNow = async () => {
    if (!currentShareId) return;
    if (isDemoShare) {
      setIsEditing(false);
      setShowFinalizePrompt(false);
      setShareHint(
      ui(
        "Демо горим: таны өөрчлөлт энэ нийтийн линк дээр хадгалагдахгүй.",
        "Demo mode: your changes are not saved to this public link.",
      ),
      );
      window.setTimeout(() => setShareHint(null), 2400);
      return;
    }
    setIsFinalizing(true);
    const r = await finalizeSharedEditingById(currentShareId);
    setIsFinalizing(false);
    if (r.ok === false) {
      window.alert(toFriendlyFinalizeError(r.error, uiLanguage));
      return;
    }
    setShareEditUntilIso(r.editUntil);
    setIsEditing(false);
    setShowFinalizePrompt(false);
    setShareHint(
      ui(
        "Засварыг дуусгалаа. Одоо энэ линк зөвхөн харах горимтой.",
        "Editing is finished. This link is now view-only.",
      ),
    );
    window.setTimeout(() => setShareHint(null), 2200);
  };

  const saveMusicLinkNow = async () => {
    if (!currentShareId) return;
    if (sharedViewMode && !canEditSharedLink) return;
    if (isDemoShare) {
      setShareHint(
        ui(
          "Демо горим: хөгжмийн өөрчлөлт зөвхөн энэ браузер дээр үлдэнэ.",
          "Demo mode: music changes stay only in this browser session.",
        ),
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
      setShareHint(
        ui(
          "Хөгжмийн линк хадгалж чадсангүй. Дахин оролдоно уу.",
          "Could not save the music link. Please try again.",
        ),
      );
      return;
    }
    setShareHint(ui("Хөгжмийн линк хадгалагдлаа.", "Music link saved."));
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
    setStudioAuthError(ui("Нууц үг буруу байна.", "Incorrect password."));
  };

  useEffect(() => {
    if (!canSaveToServer || !currentShareId) return;
    // A blob: URL is only valid in this tab — it means some element's photo/
    // drawing is still mid-upload. Saving it now would let the server's
    // prune-unused-media step see the freshly-uploaded real file as
    // "unreferenced" (this save's payload still points at the blob) and
    // delete it before the follow-up save (once the upload resolves) ever
    // gets to reference it — the file's gone, the URL 404s from then on.
    // Skipping this round is safe: the swap-to-real-URL step changes `pages`
    // again, which re-runs this effect and saves correctly.
    if (pagesHavePendingBlobUrls(pages)) return;
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
          ui(
            "Энэ линк дээрх өөрчлөлтийг хадгалж чадсангүй. Хуудсаа сэргээгээд дахин оролдоно уу.",
            "Could not save changes to this link. Refresh the page and try again.",
          ),
        );
        return;
      }
      if (typeof r.bytesUsed === "number") {
        setShareStorageUsedBytes(r.bytesUsed);
      }
      if (typeof r.bytesLimit === "number") {
        setShareStorageLimitBytes(r.bytesLimit);
      }
      setShareHint(ui("Өөрчлөлт хадгалагдлаа.", "Changes saved."));
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
    opts?: {
      width?: number;
      height?: number;
      x?: number;
      y?: number;
      rotation?: number;
    },
  ) => {
    const isPolaroidSticker =
      type === "sticker" && content === POLAROID_STICKER_TOKEN;
    const newElement: PageElement = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      x: opts?.x ?? 100,
      y: opts?.y ?? 100,
      rotation: opts?.rotation ?? Math.random() * 20 - 10,
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
    return newElement.id;
  };

  const storageLeftMb = Math.max(
    0,
    (shareStorageLimitBytes - shareStorageUsedBytes) / (1024 * 1024),
  );

  // Swaps one element's content in place (e.g. a local blob URL -> the real
  // uploaded URL once it's ready) without creating an undo step and without
  // closing over a possibly-stale `pages` snapshot — a functional setState
  // update always sees the latest state, which matters here since this runs
  // from a background upload that can resolve well after other edits.
  const swapElementContent = (
    pageId: string,
    elementId: string,
    newContent: string,
  ) => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? {
              ...p,
              elements: p.elements.map((e) =>
                e.id === elementId ? { ...e, content: newContent } : e,
              ),
            }
          : p,
      ),
    );
  };

  // Same idea as swapElementContent, generalized to any page/element field —
  // used for the drawing tool's ink layers, which are fields on the page or
  // element itself (not separate elements), so a plain photo swap helper
  // doesn't cover them.
  const swapPageField = <K extends "drawing">(
    pageId: string,
    field: K,
    value: PageData[K],
  ) => {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, [field]: value } : p)),
    );
  };

  const swapElementField = <K extends "drawingOverlay">(
    pageId: string,
    elementId: string,
    field: K,
    value: PageElement[K],
  ) => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? {
              ...p,
              elements: p.elements.map((e) =>
                e.id === elementId ? { ...e, [field]: value } : e,
              ),
            }
          : p,
      ),
    );
  };

  // Draws directly onto the whole page — a fixed layer on the page itself
  // (page.drawing), not a new movable/resizable element like a photo.
  const applyPageDrawing = (pageId: string, file: File) => {
    void (async () => {
      const blobUrl = URL.createObjectURL(file);
      swapPageField(pageId, "drawing", blobUrl);
      if (!currentShareId || isDemoShare) return; // already showing it locally; nothing to persist
      setShareHint(ui("Байршуулж байна...", "Uploading..."));
      let preparedFile = file;
      try {
        preparedFile = await optimizeImageForUpload(file, {});
      } catch {
        preparedFile = file;
      }
      const uploaded = await uploadImageFileForShare(currentShareId, preparedFile);
      if (uploaded.ok === false) {
        setShareHint(null);
        window.alert(toFriendlyUploadError(uploaded.error, "image", uiLanguage));
        return;
      }
      if (typeof uploaded.bytesUsed === "number") setShareStorageUsedBytes(uploaded.bytesUsed);
      if (typeof uploaded.bytesLimit === "number") setShareStorageLimitBytes(uploaded.bytesLimit);
      swapPageField(pageId, "drawing", uploaded.url);
      URL.revokeObjectURL(blobUrl);
      setShareHint(ui("Зураг байршууллаа.", "Image uploaded."));
      window.setTimeout(() => setShareHint(null), 1400);
    })();
  };

  const removePageDrawing = (pageId: string) => {
    swapPageField(pageId, "drawing", undefined);
  };

  // Draws directly onto one specific photo — a fixed layer on that element
  // (element.drawingOverlay), moving/resizing/rotating with it automatically
  // instead of being its own separately-selectable sticker.
  const applyElementDrawingOverlay = (
    pageId: string,
    elementId: string,
    file: File,
  ) => {
    void (async () => {
      const blobUrl = URL.createObjectURL(file);
      swapElementField(pageId, elementId, "drawingOverlay", blobUrl);
      if (!currentShareId || isDemoShare) return;
      setShareHint(ui("Байршуулж байна...", "Uploading..."));
      let preparedFile = file;
      try {
        preparedFile = await optimizeImageForUpload(file, {});
      } catch {
        preparedFile = file;
      }
      const uploaded = await uploadImageFileForShare(currentShareId, preparedFile);
      if (uploaded.ok === false) {
        setShareHint(null);
        window.alert(toFriendlyUploadError(uploaded.error, "image", uiLanguage));
        return;
      }
      if (typeof uploaded.bytesUsed === "number") setShareStorageUsedBytes(uploaded.bytesUsed);
      if (typeof uploaded.bytesLimit === "number") setShareStorageLimitBytes(uploaded.bytesLimit);
      swapElementField(pageId, elementId, "drawingOverlay", uploaded.url);
      URL.revokeObjectURL(blobUrl);
      setShareHint(ui("Зураг байршууллаа.", "Image uploaded."));
      window.setTimeout(() => setShareHint(null), 1400);
    })();
  };

  const removeElementDrawingOverlay = (pageId: string, elementId: string) => {
    swapElementField(pageId, elementId, "drawingOverlay", undefined);
  };

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
        ui(
          "Номонд хамгийн багадаа 2 хуудас үлдэх ёстой.",
          "The book needs at least 2 pages.",
        ),
      );
      return;
    }
    if (
      !window.confirm(
        ui(
          "Энэ хуудсыг устгах уу? Дараа нь Буцаах товчоор сэргээж болно.",
          "Delete this page? You can restore it with Undo.",
        ),
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

  // Jump straight to a page and open it for editing — the explicit
  // alternative to flipping through with next/prev and clicking whichever
  // page happens to be visible in the spread.
  const jumpToPage = (pageId: string) => {
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    // Covers both cases: jumping to a page on a different leaf (currentLeaf
    // changes, the leaf-change effect picks this up on its next run) and
    // jumping to the *other* page already on the current leaf (currentLeaf
    // stays the same, so that effect never re-fires — this direct call is
    // what actually selects it then).
    pendingPageSelectionRef.current = pageId;
    setSelectedPageId(pageId);
    setCurrentLeaf(Math.ceil(idx / 2));
    setSelectedElementId(null);
  };

  // Opens the dedicated full-screen editor for whichever page is currently
  // on the left/right of the spread — the direct equivalent of book's
  // "Edit Left" / "Edit Right".
  const editSideOfSpread = (side: "left" | "right") => {
    const pageId = side === "left" ? visibleLeftPageId : visibleRightPageId;
    if (!pageId) return;
    setSelectedPageId(pageId);
    setSelectedElementId(null);
    setIsEditing(true);
    setFullScreenPageId(pageId);
  };

  const addPagesPair = () => {
    const newPages = [...pages];
    const backCover = newPages.pop();
    // Not page-${newPages.length} — that collides after any delete-then-add
    // sequence (length can revisit a number still used by another page),
    // and every page-update function below matches by `p.id === pageId`,
    // so two pages sharing an id silently receive the same edit forever.
    newPages.push({
      id: `page-${Math.random().toString(36).slice(2, 11)}`,
      background: "bg-stone-50",
      pattern: "",
      elements: [],
    });
    newPages.push({
      id: `page-${Math.random().toString(36).slice(2, 11)}`,
      background: "bg-stone-50",
      pattern: "",
      elements: [],
    });
    if (backCover) newPages.push(backCover);
    updatePagesWithHistory(newPages);
  };

  // Shared between the floating editor panel and the full-screen page
  // editor so tool logic (add text/photo/sticker/background, accordions)
  // isn't duplicated in two places.
  const renderEditorPanelBody = () => (
    <EditorPanelBody
      selectedPageId={selectedPageId}
      isDemoMode={isDemoShare}
      language={uiLanguage}
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
      handlePageBackgroundImageUpload={handlePageBackgroundImageUpload}
      handleAppBackgroundImageUpload={handleAppBackgroundImageUpload}
      updatePageBackground={updatePageBackground}
      updatePageBackgroundImage={updatePageBackgroundImage}
      updatePagePattern={updatePagePattern}
      updateElement={updateElement}
      updatePagesWithHistory={updatePagesWithHistory}
      deleteElement={deleteElement}
      removePage={removePage}
      onJumpToPage={jumpToPage}
      addPagesPair={addPagesPair}
      onOpenDrawing={() => {
        setDrawTargetElementId(null);
        setShowDrawing(true);
      }}
      onDrawOnElement={(elementId) => {
        setDrawTargetElementId(elementId);
        setShowDrawing(true);
      }}
      onCropElement={(elementId) => setCropTargetElementId(elementId)}
    />
  );

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
      window.alert(ui("Зураг файл сонгоно уу.", "Please choose an image file."));
      return null;
    }
    if (!currentShareId) {
      window.alert(
        ui(
          "Эхлээд хуваалцах линк үүсгэх/нээх хэрэгтэй. Дараа нь зургаа байршуулна уу.",
          "Create or open a share link first. Then the image can be uploaded and saved.",
        ),
      );
      return null;
    }
    setShareHint(
      isDemoShare
        ? ui(
            "Демо горим: дэвсгэрийг зөвхөн таны браузер дээр харуулж байна...",
            "Demo mode: previewing background locally...",
          )
        : ui(
            "Дэвсгэр зураг байршуулж байна...",
            "Background image is uploading...",
          ),
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
      setShareHint(
        ui(
          "Демо дэвсгэр нэмэгдлээ. Нийтийн линк дээр хадгалагдахгүй.",
          "Demo background preview added. It will not save publicly.",
        ),
      );
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
      window.alert(toFriendlyUploadError(uploaded.error, "image", uiLanguage));
      return null;
    }
    if (typeof uploaded.bytesUsed === "number") {
      setShareStorageUsedBytes(uploaded.bytesUsed);
    }
    if (typeof uploaded.bytesLimit === "number") {
      setShareStorageLimitBytes(uploaded.bytesLimit);
    }
    setShareHint(ui("Дэвсгэр зураг шинэчлэгдлээ.", "Background image updated."));
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

  // Shared by the file-picker upload path and the drawing tool (which
  // produces a PNG Blob instead of a picked File) so both funnel through
  // the same optimize -> upload -> addElement pipeline.
  const addImageFileToPage = (
    pageId: string,
    file: File,
    opts?: { width?: number; height?: number; x?: number; y?: number; rotation?: number },
  ) => {
    if (currentShareId) {
      if (isDemoShare) {
        setShareHint(
          ui(
            "Демо горим: зургийг зөвхөн таны браузер дээр нэмж байна...",
            "Demo mode: adding image locally...",
          ),
        );
        void (async () => {
          let preparedFile = file;
          try {
            preparedFile = await optimizeImageForUpload(file, {
              maxSide: getDemoImageMaxWidth(),
            });
          } catch {
            preparedFile = file;
          }
          let mediaSize: { width: number; height: number } | null = null;
          try {
            mediaSize = await probeImageSize(preparedFile);
          } catch {
            mediaSize = null;
          }
          const targetWidth = opts?.width ?? 220;
          const ratio =
            mediaSize && mediaSize.height > 0
              ? mediaSize.width / mediaSize.height
              : 1;
          const targetHeight =
            opts?.height ?? Math.max(60, Math.round(targetWidth / ratio));
          addElement(pageId, "image", URL.createObjectURL(preparedFile), {
            width: targetWidth,
            height: targetHeight,
            x: opts?.x,
            y: opts?.y,
            rotation: opts?.rotation,
          });
          window.setTimeout(() => logDemoDiagnostics("after adding image"), 0);
          setShareHint(
            ui(
              "Демо зураг нэмэгдлээ. Нийтийн линк дээр хадгалагдахгүй.",
              "Demo image added. It will not save publicly.",
            ),
          );
          window.setTimeout(() => setShareHint(null), 1800);
        })();
        return;
      }

      // Show the photo immediately from a local blob URL — like Canva, not
      // like our old wait-for-the-full-upload-round-trip behavior. The real
      // optimize/upload happens in the background and swaps the blob URL
      // for the hosted one once it's ready, matching book's addImage().
      void (async () => {
        let mediaSize: { width: number; height: number } | null = null;
        try {
          mediaSize = await probeImageSize(file);
        } catch {
          mediaSize = null;
        }
        const targetWidth = opts?.width ?? 220;
        const ratio =
          mediaSize && mediaSize.height > 0
            ? mediaSize.width / mediaSize.height
            : 1;
        const targetHeight =
          opts?.height ?? Math.max(60, Math.round(targetWidth / ratio));
        const blobUrl = URL.createObjectURL(file);
        const newId = addElement(pageId, "image", blobUrl, {
          width: targetWidth,
          height: targetHeight,
          x: opts?.x,
          y: opts?.y,
          rotation: opts?.rotation,
        });
        setShareHint(ui("Байршуулж байна...", "Uploading..."));

        let preparedFile = file;
        try {
          preparedFile = await optimizeImageForUpload(file, {});
        } catch {
          preparedFile = file;
        }
        const uploaded = await uploadImageFileForShare(
          currentShareId,
          preparedFile,
        );
        if (uploaded.ok === false) {
          setShareHint(null);
          window.alert(toFriendlyUploadError(uploaded.error, "image", uiLanguage));
          return;
        }
        if (typeof uploaded.bytesUsed === "number") {
          setShareStorageUsedBytes(uploaded.bytesUsed);
        }
        if (typeof uploaded.bytesLimit === "number") {
          setShareStorageLimitBytes(uploaded.bytesLimit);
        }
        swapElementContent(pageId, newId, uploaded.url);
        URL.revokeObjectURL(blobUrl);
        setShareHint(ui("Зураг байршууллаа.", "Image uploaded."));
        window.setTimeout(() => setShareHint(null), 1400);
      })();
      return;
    }

    // Keep JSON light: force cloud upload workflow (no base64 fallback).
    window.alert(
      ui(
        "Эхлээд хуваалцах линк үүсгэх/нээх хэрэгтэй. Дараа нь тэнд зургаа байршуулна уу. Ингэснээр зураг cloud дээр хадгалагдана.",
        "Create or open a share link first. Then upload your image there so it can be saved in the cloud.",
      ),
    );
  };

  const handleImageUpload = (
    pageId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addImageFileToPage(pageId, file);
    e.target.value = "";
  };

  // Crop replaces an existing photo element's own content in place (not a
  // new element) — same instant-local-preview-then-background-upload
  // pattern as a fresh photo, just targeting an id that already exists.
  // For a photo dropped into a polaroid frame, the frame box stays a fixed
  // size (it's rendered with object-cover), so only frameImage changes —
  // for a plain photo element, height is recomputed to the crop's new
  // aspect ratio so the box doesn't stretch the result.
  const applyCropToElement = (
    pageId: string,
    element: PageElement,
    croppedFile: File,
  ) => {
    const isFramedPhoto = element.type === "sticker" && element.frameImage;
    void (async () => {
      let newHeight = element.height;
      if (!isFramedPhoto) {
        try {
          const size = await probeImageSize(croppedFile);
          if (element.width && size.height > 0) {
            newHeight = Math.round((element.width * size.height) / size.width);
          }
        } catch {
          // keep the existing height if the crop result can't be probed
        }
      }
      const blobUrl = URL.createObjectURL(croppedFile);
      updateElement(
        pageId,
        isFramedPhoto
          ? { ...element, frameImage: blobUrl }
          : { ...element, content: blobUrl, height: newHeight },
      );
      if (!currentShareId || isDemoShare) return; // already showing the crop locally; nothing to persist

      setShareHint(ui("Байршуулж байна...", "Uploading..."));
      let preparedFile = croppedFile;
      try {
        preparedFile = await optimizeImageForUpload(croppedFile, {});
      } catch {
        preparedFile = croppedFile;
      }
      const uploaded = await uploadImageFileForShare(currentShareId, preparedFile);
      if (uploaded.ok === false) {
        setShareHint(null);
        window.alert(toFriendlyUploadError(uploaded.error, "image", uiLanguage));
        return;
      }
      if (typeof uploaded.bytesUsed === "number") {
        setShareStorageUsedBytes(uploaded.bytesUsed);
      }
      if (typeof uploaded.bytesLimit === "number") {
        setShareStorageLimitBytes(uploaded.bytesLimit);
      }
      if (isFramedPhoto) {
        setPages((prev) =>
          prev.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  elements: p.elements.map((e) =>
                    e.id === element.id
                      ? { ...e, frameImage: uploaded.url }
                      : e,
                  ),
                }
              : p,
          ),
        );
      } else {
        swapElementContent(pageId, element.id, uploaded.url);
      }
      URL.revokeObjectURL(blobUrl);
      setShareHint(ui("Зураг байршууллаа.", "Image uploaded."));
      window.setTimeout(() => setShareHint(null), 1400);
    })();
  };

  const handleVideoUpload = async (
    pageId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!currentShareId) {
      window.alert(
        ui(
          "Эхлээд хуваалцах линк үүсгэх/нээх хэрэгтэй. Дараа нь тэнд видео байршуулна уу.",
          "Create or open a share link first. Then upload your video there.",
        ),
      );
      e.target.value = "";
      return;
    }
    if (!file.type.startsWith("video/")) {
      window.alert(ui("Видео файл сонгоно уу.", "Please choose a video file."));
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
        window.alert(ui("Нэг видео хамгийн ихдээ 1 минут байна.", "One video can be at most 1 minute."));
        e.target.value = "";
        return;
      }
      mediaSize = size;
    } catch {
      window.alert(ui("Видеоны уртыг шалгаж чадсангүй.", "Could not check the video length."));
      e.target.value = "";
      return;
    }

    setShareHint(
      isDemoShare
        ? ui(
            "Демо горим: видеог зөвхөн таны браузер дээр нэмж байна...",
            "Demo mode: adding video locally...",
          )
        : ui("Видео байршуулж байна...", "Uploading video..."),
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
      setShareHint(
        ui(
          "Демо видео нэмэгдлээ. Нийтийн линк дээр хадгалагдахгүй.",
          "Demo video added. It will not save publicly.",
        ),
      );
      window.setTimeout(() => setShareHint(null), 1800);
      e.target.value = "";
      return;
    }
    const uploaded = await uploadImageFileForShare(currentShareId, file);
    if (uploaded.ok === false) {
      setShareHint(null);
      window.alert(toFriendlyUploadError(uploaded.error, "video", uiLanguage));
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
    setShareHint(ui("Видео байршууллаа.", "Video uploaded."));
    window.setTimeout(() => setShareHint(null), 1400);
    e.target.value = "";
  };

  // Determine which pages are currently visible based on currentLeaf
  // currentLeaf 0: left = null, right = 0
  // currentLeaf 1: left = 1, right = 2
  // currentLeaf 2: left = 3, right = 4
  // "Delete this page" removes exactly one page, not a pair, so pages.length
  // can be odd — at the final currentLeaf, `currentLeaf * 2 - 1` then points
  // one past the end of an odd-length array (pages[pages.length], undefined),
  // which made the last page render as nothing at all while editing. The
  // true last page is always pages[pages.length - 1], whether the count
  // ended up odd or even.
  const visibleLeftPageId =
    currentLeaf === 0
      ? null
      : currentLeaf === totalLeaves
        ? pages[pages.length - 1]?.id
        : pages[currentLeaf * 2 - 1]?.id;
  const visibleRightPageId =
    currentLeaf === totalLeaves ? null : pages[currentLeaf * 2]?.id;

  // Set selected page to right page by default if available, else left —
  // unless jumpToPage() just requested a specific one explicitly.
  React.useEffect(() => {
    if (isEditing) {
      const pending = pendingPageSelectionRef.current;
      if (
        pending &&
        (pending === visibleLeftPageId || pending === visibleRightPageId)
      ) {
        pendingPageSelectionRef.current = null;
        setSelectedPageId(pending);
      } else if (visibleRightPageId) {
        setSelectedPageId(visibleRightPageId);
      } else if (visibleLeftPageId) {
        setSelectedPageId(visibleLeftPageId);
      }
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
          className="h-dvh font-sans flex items-center justify-center px-4 relative"
          style={{ backgroundColor: "#1f2937" }}
        >
          <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-full border border-white/25 bg-white/10 p-1 text-[11px] font-semibold text-white shadow-lg">
            <button
              type="button"
              onClick={() => setUiLanguage("mn")}
              className={`rounded-full px-3 py-1.5 transition-colors ${uiLanguage === "mn" ? "bg-white text-stone-900" : "text-white/85 hover:bg-white/15"}`}
              aria-pressed={uiLanguage === "mn"}
            >
              MN
            </button>
            <button
              type="button"
              onClick={() => setUiLanguage("en")}
              className={`rounded-full px-3 py-1.5 transition-colors ${uiLanguage === "en" ? "bg-white text-stone-900" : "text-white/85 hover:bg-white/15"}`}
              aria-pressed={uiLanguage === "en"}
            >
              EN
            </button>
          </div>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h1 className="text-lg font-semibold text-stone-900">
              {ui("Нууц үг оруулна уу", "Enter password")}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              {ui(
                "Үндсэн scrapbook редакторт нэвтрэхийн тулд нууц үгээ оруулна уу.",
                "Enter the password to access the main scrapbook editor.",
              )}
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
              {ui("Нэвтрэх", "Sign in")}
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
        // Full-screen block, not just a dismissible banner — a link that
        // failed to load (wrong id, expired, or the create call never
        // actually reached the server) must not leave a usable blank editor
        // sitting underneath it. Nothing beneath this is reachable while it
        // shows: no accidental "editing" a book that was never really there
        // to save to, and no way for an invalid id to look like it worked.
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-neutral-950/95 backdrop-blur-sm px-6"
          role="alert"
        >
          <div className="max-w-sm w-full text-center">
            <p className="text-white font-semibold text-lg mb-2">
              {shareLinkLoadError === "timeout"
                ? ui("Холболт удаан байна", "The connection is slow")
                : ui("Энэ линк ажиллахгүй байна", "This link isn't working")}
            </p>
            <p className="text-white/60 text-sm leading-relaxed mb-6">
              {shareLinkLoadError === "timeout"
                ? ui(
                    "Дахин ачаалж үзнэ үү. Хэрэв энэ нь захиалгаас ирсэн линк бол 56 Moments-тэй холбогдоно уу.",
                    "Try reloading. If this link came from an order, please contact 56 Moments for help.",
                  )
                : ui(
                    "Энэ линк хүчингүй эсвэл дуусгавар болсон байна. Хэрэв энэ нь захиалгаас ирсэн бол 56 Moments-тэй холбогдоно уу.",
                    "This link is invalid or has expired. If it came from an order, please contact 56 Moments for help.",
                  )}
            </p>
            <button
              type="button"
              onClick={retryShareBootstrap}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-white/90"
            >
              {ui("Дахин ачаалах", "Try again")}
            </button>
          </div>
        </div>
      )}
      <div
        className={`h-dvh font-sans flex touch-auto flex-col overflow-hidden relative ${!appBackgroundImage ? "app-ambient" : ""} ${isDemoShare ? "demo-route" : ""}`}
        style={appShellStyle}
      >
        <div className="fixed right-3 top-3 z-80 flex overflow-hidden rounded-full border border-white/35 bg-black/35 p-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={() => setUiLanguage("mn")}
            className={`rounded-full px-3 py-1.5 transition-colors ${uiLanguage === "mn" ? "bg-white text-stone-900" : "text-white/85 hover:bg-white/15"}`}
            aria-pressed={uiLanguage === "mn"}
          >
            MN
          </button>
          <button
            type="button"
            onClick={() => setUiLanguage("en")}
            className={`rounded-full px-3 py-1.5 transition-colors ${uiLanguage === "en" ? "bg-white text-stone-900" : "text-white/85 hover:bg-white/15"}`}
            aria-pressed={uiLanguage === "en"}
          >
            EN
          </button>
        </div>
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
                    ? ui(
                        "Энэ линкний засварлах хугацаа дууссан",
                        "This link's editing window has expired",
                      )
                    : ui(
                        "Энэ хуваалцсан линк зөвхөн харах горимтой",
                        "This shared link is view-only",
                      )}
                  {isShareEditExpired && Number.isFinite(shareEditDeadlineMs)
                    ? ` (${new Date(shareEditDeadlineMs).toLocaleString()})`
                    : ""}
                  {ui(
                    ". Скрапбүүк яг хадгалсан хэвээр үлдэнэ.",
                    ". The scrapbook stays exactly as it was saved.",
                  )}
                </p>
              ) : (
                <p className="mb-2 text-white/95">
                  {isDemoShare ? (
                    <>
                      {ui(
                        "Демо sandbox: зочин бүр ",
                        "Demo sandbox: each visitor can try editing until ",
                      )}
                      {shareEditUntilIso &&
                      Number.isFinite(shareEditDeadlineMs) ? (
                        <span className="font-semibold whitespace-nowrap">
                          {new Date(shareEditDeadlineMs).toLocaleString()}
                        </span>
                      ) : (
                        ui(
                          "анх нээснээс хойш тав хоног",
                          "five days after first opening",
                        )
                      )}
                      {ui(
                        " хүртэл засаж туршиж болно. Өөрчлөлтүүд хувийн бөгөөд энэ нийтийн линк дээр хадгалагдахгүй.",
                        ". Changes are private and never save to this public link.",
                      )}
                    </>
                  ) : (
                    <>
                      {ui(
                        "Засвар хийх боломжит хугацаа",
                        "Editing is available",
                      )}
                      {shareEditUntilIso &&
                      Number.isFinite(shareEditDeadlineMs) ? (
                        <>
                          {" "}
                          <span className="font-semibold whitespace-nowrap">
                            {new Date(shareEditDeadlineMs).toLocaleString()}
                          </span>{" "}
                          {ui("хүртэл.", "until.")}
                        </>
                      ) : (
                        "."
                      )}{" "}
                      {ui(
                        "Өөрчлөлтүүд энэ линк дээр автоматаар хадгалагдана.",
                        "Changes are saved automatically to this link.",
                      )}
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
                    {ui("Линк хуулах", "Copy link")}
                  </button>
                )}
                {canEditSharedLink && !isDemoShare && (
                  <button
                    type="button"
                    onClick={() => setShowFinalizePrompt(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-medium hover:bg-rose-700"
                  >
                    {ui("Засвар дуусгах", "Finish editing")}
                  </button>
                )}
              </div>
            </div>
          )}

          <main className="absolute inset-0 flex flex-col min-h-0 min-w-0 overflow-hidden p-0">
            {/* "Edit Left" / "Edit Right" — opens the dedicated full-screen
                editor for whichever page is on that side of the spread,
                same pattern as book's page navigation buttons. Only the
                side(s) actually showing a page are offered. */}
            {isEditing && !fullScreenPageId && (visibleLeftPageId || visibleRightPageId) && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[45] flex gap-2">
                {visibleLeftPageId && (
                  <button
                    type="button"
                    onClick={() => editSideOfSpread("left")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 text-stone-800 text-xs font-medium shadow-lg hover:bg-white"
                  >
                    <Edit3 size={13} />
                    {ui("Зүүн талыг засах", "Edit Left")}
                  </button>
                )}
                {visibleRightPageId && (
                  <button
                    type="button"
                    onClick={() => editSideOfSpread("right")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 text-stone-800 text-xs font-medium shadow-lg hover:bg-white"
                  >
                    <Edit3 size={13} />
                    {ui("Баруун талыг засах", "Edit Right")}
                  </button>
                )}
              </div>
            )}

            {/* Row: nav + book fills height minus bottom bar space */}
            <div className="relative flex flex-1 min-h-0 w-full items-center justify-center">
              <button
                type="button"
                onClick={turnPrev}
                disabled={currentLeaf === 0}
                className={`nav-fab absolute left-2 top-1/2 -translate-y-1/2 sm:left-3 shrink-0 w-10 h-10 sm:w-12 sm:h-12 text-white rounded-full flex items-center justify-center disabled:opacity-0 disabled:pointer-events-none transition-all z-20 ${
                  preferLiteEffects || isDemoShare
                    ? "demo-frosted bg-white/35 hover:bg-white/45"
                    : "bg-white/20 backdrop-blur-sm hover:bg-white/30"
                }`}
                aria-label={ui("Өмнөх хуудас", "Previous page")}
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
                      // Closed book (front/back cover) only fills half the
                      // spread stage, so nudge the stage a quarter width to
                      // keep the visible cover optically centered.
                      transform: `translate(${
                        panOffset.x +
                        (isEditing || userZoom !== 1
                          ? 0
                          : currentLeaf === 0
                            ? -(BOOK_STAGE_WIDTH * stageScale) / 4
                            : currentLeaf === totalLeaves
                              ? (BOOK_STAGE_WIDTH * stageScale) / 4
                              : 0)
                      }px, ${panOffset.y}px) scale(${userZoom})`,
                      transformOrigin: "center center",
                      transition:
                        userZoom === 1
                          ? "transform 0.45s cubic-bezier(0.25, 0.8, 0.35, 1)"
                          : "none",
                    }}
                  >
                    <div className="book-ground-shadow" aria-hidden />
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
                            language={uiLanguage}
                          />
                        </MotionConfig>
                      ) : (
                        leaves.map((leaf, i) => {
                          if (
                            !shouldRenderLeaf(
                              i,
                              currentLeaf,
                              totalLeaves,
                              isDemoShare,
                            )
                          ) {
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
                              language={uiLanguage}
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
                className={`nav-fab absolute right-2 top-1/2 -translate-y-1/2 sm:right-3 shrink-0 w-10 h-10 sm:w-12 sm:h-12 text-white rounded-full flex items-center justify-center disabled:opacity-0 disabled:pointer-events-none transition-all z-20 ${
                  preferLiteEffects || isDemoShare
                    ? "demo-frosted bg-white/35 hover:bg-white/45"
                    : "bg-white/20 backdrop-blur-sm hover:bg-white/30"
                }`}
                aria-label={ui("Дараагийн хуудас", "Next page")}
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
                    ? ui(
                        "Демо горим: засварууд хувийн бөгөөд хадгалагдахгүй",
                        "Demo mode: edits are private and not saved",
                      )
                    : `${ui("Үлдсэн зай", "Storage left")}: ${storageLeftMb.toFixed(2)} MB`}
                </p>
              )}
              {shareHint && (
                <p className="text-xs text-white/90 bg-black/40 px-3 py-1.5 rounded-full border border-white/20">
                  {shareHint}
                </p>
              )}
              <div
                className={`toolbar-glass px-6 py-3 rounded-full flex items-center gap-4 border border-white/20 ${
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
                            ? ui("Урьдчилж харах", "Preview")
                            : ui("Засах", "Edit")
                          : isEditing
                            ? ui("Урьдчилж харах", "Preview")
                            : ui("Засах", "Edit")
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
                          title={ui("Буцаах", "Undo")}
                        >
                          <Undo2 size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={redo}
                          disabled={historyIndex === history.length - 1}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={ui("Дахин хийх", "Redo")}
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
                          title={ui(
                            "Энэ скрапбүүкийг явуулах линк хуулах",
                            "Copy the link to send this scrapbook",
                          )}
                        >
                          <Link2 size={18} />
                        </button>
                      </>
                    )}

                    <div className="w-px h-6 bg-white/30 mx-1" />
                    <button
                      type="button"
                      onClick={addPagesPair}
                      className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors"
                      title={ui("Хуудас нэмэх", "Add page")}
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
                            ? ui("Урьдчилж харах", "Preview")
                            : ui("Засах", "Edit")
                          : isEditing
                            ? ui("Урьдчилж харах", "Preview")
                            : ui("Засах", "Edit")
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
                          title={ui("Буцаах", "Undo")}
                        >
                          <Undo2 size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={redo}
                          disabled={historyIndex === history.length - 1}
                          className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={ui("Дахин хийх", "Redo")}
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
                    {ui("Линк хуулах", "Copy link")}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* The old floating accordion panel used to live here on the front
              spread view. All of its tools now live exclusively inside the
              full-screen per-page editor (opened via "Edit Left"/"Edit
              Right" below) — the front view only ever shows those two
              buttons while editing, matching book's PageEditor.jsx model
              where the front view has no persistent tool panel at all. */}
        </div>

        {/* Dedicated full-screen page editor, opened by "Edit Left" /
            "Edit Right". Mirrors book's PageEditor.jsx: fixed full-screen
            overlay with a header, a large focused page, and the same tool
            panel used for the floating editor, restyled as a sidebar.
            Rendered as a sibling of (not nested inside) the z-10 stage
            wrapper above — that wrapper's own z-index otherwise traps any
            fixed-position descendant in its stacking context, which would
            put it below the top-right language switcher (z-80) no matter
            how high a z-index it's given locally. */}
        {fullScreenPageId &&
          (() => {
            const fsPage = pages.find((p) => p.id === fullScreenPageId);
            const fsIndex = pages.findIndex((p) => p.id === fullScreenPageId);
            if (!fsPage) return null;
            return (
              <div className="fixed inset-0 z-[100] flex flex-col bg-stone-950 text-white">
                <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-stone-900 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setFullScreenPageId(null)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
                  >
                    <ArrowLeft size={14} />
                    {ui("Буцах", "Back")}
                  </button>
                  <span className="ml-1 text-xs font-semibold text-white/70">
                    {ui("Хуудас", "Page")} {fsIndex + 1}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawTargetElementId(null);
                        setShowDrawing(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
                    >
                      <PenTool size={14} />
                      {ui("Зурах", "Draw")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFullScreenPageId(null)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-700"
                    >
                      <Check size={14} />
                      {ui("Болсон", "Done")}
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
                  {/* min-h reserves a guaranteed share of the viewport on
                      mobile so the page is always visible, no matter how
                      tall the tool panel below it gets — previously this
                      region had no floor, so a tall panel could squeeze the
                      page preview down to nothing. */}
                  <div
                    ref={fsStageViewportRef}
                    className="flex min-h-[42dvh] flex-1 items-center justify-center overflow-hidden p-4 md:min-h-0 md:p-8"
                  >
                    {/* Fixed logical 400×600 box (half of the normal spread's
                        800×600 stage — see BOOK_STAGE_WIDTH/HEIGHT) scaled
                        uniformly to fit this view's own container, same
                        mechanism as the main stage's stageScale. Without
                        this, element coordinates (authored in that logical
                        space) rendered unscaled into whatever this
                        container's real CSS size happened to be. */}
                    <div
                      className="relative shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl"
                      style={{
                        width: (BOOK_STAGE_WIDTH / 2) * fsStageScale,
                        height: BOOK_STAGE_HEIGHT * fsStageScale,
                      }}
                    >
                      <BookStageScaleContext.Provider value={fsStageScale}>
                        <div
                          style={{
                            width: BOOK_STAGE_WIDTH / 2,
                            height: BOOK_STAGE_HEIGHT,
                            transform: `scale(${fsStageScale})`,
                            transformOrigin: "top left",
                          }}
                        >
                          <PageContent
                            page={fsPage}
                            isEditing
                            selectedElementId={selectedElementId}
                            onSelectElement={setSelectedElementId}
                            onUpdateElement={updateElement}
                            onVideoAudibleChange={setVideoAudible}
                            onDropImageIntoPolaroid={dropImageIntoPolaroid}
                            isVideoMuted={isVideoMuted}
                            setVideoMuted={setVideoMuted}
                            isActive
                            onSelectPage={() => setSelectedPageId(fullScreenPageId)}
                            isDemoShare={isDemoShare}
                            demoHdIntent={demoHdIntent}
                            demoArmedVideoIds={demoArmedVideoIds}
                            armDemoVideo={armDemoVideo}
                            language={uiLanguage}
                          />
                        </div>
                      </BookStageScaleContext.Provider>
                    </div>
                  </div>
                  <div
                    // The app's global touchmove handler (see the effect
                    // building shouldAllowNativeScroll) calls
                    // preventDefault() on every single-finger touch move by
                    // default, to keep touches from fighting the stage's own
                    // pinch/pan handling — and only skips that for elements
                    // (or an ancestor) opted in via this attribute. Without
                    // it, this panel's overflow-y-auto never actually
                    // receives a native scroll gesture on touch devices —
                    // GIF results (or any tall accordion content) render
                    // fine but can't be reached by scrolling to them.
                    data-allow-native-scroll="true"
                    className="max-h-[45dvh] w-full shrink-0 overflow-y-auto border-t border-white/10 bg-white p-3 text-stone-800 md:max-h-none md:h-full md:w-80 md:border-l md:border-t-0"
                  >
                    <React.Suspense
                      fallback={
                        <div className="flex items-center justify-center py-8">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
                        </div>
                      }
                    >
                      {renderEditorPanelBody()}
                    </React.Suspense>
                  </div>
                </div>
              </div>
            );
          })()}

        {showDrawing &&
          (() => {
            const targetPageId = fullScreenPageId ?? selectedPageId;
            const targetPage = pages.find((p) => p.id === targetPageId);
            const targetEl = drawTargetElementId
              ? pages
                  .flatMap((p) => p.elements)
                  .find((e) => e.id === drawTargetElementId)
              : null;

            // Drawing on a specific photo: canvas matches that photo's own
            // box (2x for a crisp brush). The result is saved as that
            // element's own drawingOverlay field — not a new element — so
            // it moves/rotates/resizes with the photo automatically and
            // can't be separately dragged around like a sticker.
            if (targetEl && targetPageId) {
              const elW = Math.max(40, Math.round(targetEl.width || 220));
              const elH = Math.max(
                40,
                Math.round(targetEl.height || elW * 0.75),
              );
              return (
                <DrawingModal
                  language={uiLanguage}
                  canvasWidth={elW * 2}
                  canvasHeight={elH * 2}
                  initialDrawingUrl={targetEl.drawingOverlay}
                  background={
                    <img
                      src={targetEl.frameImage || targetEl.content}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  }
                  onCancel={() => {
                    setShowDrawing(false);
                    setDrawTargetElementId(null);
                  }}
                  onRemove={
                    targetEl.drawingOverlay
                      ? () => {
                          removeElementDrawingOverlay(
                            targetPageId,
                            targetEl.id,
                          );
                          setShowDrawing(false);
                          setDrawTargetElementId(null);
                        }
                      : undefined
                  }
                  onInsert={(file) => {
                    applyElementDrawingOverlay(targetPageId, targetEl.id, file);
                    setShowDrawing(false);
                    setDrawTargetElementId(null);
                  }}
                />
              );
            }

            return (
              <DrawingModal
                language={uiLanguage}
                initialDrawingUrl={targetPage?.drawing}
                background={
                  targetPage && (
                    <PageContent
                      page={targetPage}
                      isEditing={false}
                      selectedElementId={null}
                      onSelectElement={() => {}}
                      onUpdateElement={() => {}}
                      onVideoAudibleChange={setVideoAudible}
                      onDropImageIntoPolaroid={() => {}}
                      isVideoMuted={isVideoMuted}
                      setVideoMuted={setVideoMuted}
                      isActive={false}
                      onSelectPage={() => {}}
                      isDemoShare={isDemoShare}
                      hideDrawing
                      demoHdIntent={demoHdIntent}
                      demoArmedVideoIds={demoArmedVideoIds}
                      armDemoVideo={armDemoVideo}
                      language={uiLanguage}
                    />
                  )
                }
                onCancel={() => setShowDrawing(false)}
                onRemove={
                  targetPage?.drawing
                    ? () => {
                        removePageDrawing(targetPage.id);
                        setShowDrawing(false);
                      }
                    : undefined
                }
                onInsert={(file) => {
                  if (targetPageId) applyPageDrawing(targetPageId, file);
                  setShowDrawing(false);
                }}
              />
            );
          })()}

        {cropTargetElementId &&
          (() => {
            const ownerPage = pages.find((p) =>
              p.elements.some((e) => e.id === cropTargetElementId),
            );
            const targetEl = ownerPage?.elements.find(
              (e) => e.id === cropTargetElementId,
            );
            if (!ownerPage || !targetEl) return null;
            const cropSrc = targetEl.frameImage || targetEl.content;
            return (
              <CropModal
                imageSrc={cropSrc}
                language={uiLanguage}
                onCancel={() => setCropTargetElementId(null)}
                onApply={(file) => {
                  applyCropToElement(ownerPage.id, targetEl, file);
                  setCropTargetElementId(null);
                }}
              />
            );
          })()}
        <div
          className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
          aria-hidden
        >
          <div ref={ytHostRef} />
          {directAudioUrl && (
            <audio
              ref={directAudioRef}
              src={directAudioUrl}
              loop
              preload="none"
            />
          )}
        </div>
        {showFinalizePrompt && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
              <p className="text-base font-semibold text-stone-900 mb-2">
                {ui("Анхааруулга", "Warning")}
              </p>
              <p className="text-sm leading-6 text-stone-700">
                {ui(
                  "Үүнийг буцаах боломжгүй, дахин засвар оруулах боломжгүй болно. Та дууссандаа итгэлтэй байна уу?",
                  "This cannot be undone, and no more edits can be made. Are you sure you are finished?",
                )}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowFinalizePrompt(false)}
                  disabled={isFinalizing}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  {ui("Үгүй", "No")}
                </button>
                <button
                  type="button"
                  onClick={() => void finalizeEditingNow()}
                  disabled={isFinalizing}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {isFinalizing
                    ? ui("Түр хүлээнэ үү...", "Please wait...")
                    : ui("Тийм", "Yes")}
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

/** Flat 2D spread while editing â€” avoids broken pointer hit-testing from 3D transforms (bends / translateZ). */
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
  language,
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
  language: Language;
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
              language={language}
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
              language={language}
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
            language={language}
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
            language={language}
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
  language = "mn",
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

  // FIX-J (demo): Diagnostics overlay â€” only on leaf i===0 to avoid creating
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
            /* FIX-D: box-shadow instead of filter:blur â€” no compositing surface */
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
            language={language}
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
            language={language}
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
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  useEffect(() => {
    setFallbackSrc(null);
  }, [src]);
  const displaySrc = fallbackSrc || src;
  const handleImageError = useCallback(() => {
    const next = fallbackSrc
      ? DEMO_IMAGE_PLACEHOLDER
      : demoFallbackImageFor(src, maxWidth);
    setFallbackSrc(next);
  }, [fallbackSrc, maxWidth, src]);

  if (!isDemoShare) {
    return (
      <img
        src={displaySrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        sizes={sizes}
        className={className}
        style={style}
        draggable={draggable}
        onError={handleImageError}
      />
    );
  }
  const attrs = demoResponsiveImageAttrs(displaySrc, hdReady, maxWidth);
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
        onError={handleImageError}
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
  hideDrawing,
  demoHdIntent,
  demoArmedVideoIds,
  armDemoVideo,
  language,
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
  /** Skips rendering page.drawing — used only when this PageContent is
   *  itself the drawing tool's background reference for that same page, so
   *  semi-transparent strokes don't get composited twice (once from the
   *  saved layer, once live on the canvas on top). */
  hideDrawing?: boolean;
  demoHdIntent: boolean;
  demoArmedVideoIds: Record<string, boolean>;
  armDemoVideo: (id: string) => void;
  language: Language;
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
      className={`w-full h-full relative ${isDemoShare ? "demo-page-content" : ""} ${useClassBackground ? page.background : ""} ${page.pattern} transition-all ${isActive && isEditing ? "ring-inset ring-4 ring-rose-400" : ""}`}
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
          language={language}
        />
      ))}
      {/* Freehand ink drawn on the whole page — a fixed overlay, not a
          selectable/movable element, so it reads as drawing directly on
          the paper rather than adding a photo-like sticker. */}
      {page.drawing && !hideDrawing && (
        <img
          src={page.drawing}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ zIndex: PAGE_DRAWING_Z }}
        />
      )}
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
  language,
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
  language: Language;
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
            background: element.textBackgroundColor || "transparent",
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
            <div className="relative px-3 pt-3 pb-8 h-full">
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
              {element.drawingOverlay && (
                // Matches the photo's own box exactly: px-3/pt-3/pb-8 on
                // the parent become explicit insets here since absolutely
                // positioned offsets ignore the parent's padding.
                <img
                  src={element.drawingOverlay}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute left-3 right-3 top-3 bottom-8 rounded-[2px]"
                />
              )}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: element.fontSize, lineHeight: 1 }}>
            {element.content}
          </div>
        ))}
      {element.type === "image" && (
        <>
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
          {element.drawingOverlay && (
            <img
              src={element.drawingOverlay}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0"
              style={{
                width: element.width || 192,
                height: element.height ?? "auto",
              }}
            />
          )}
        </>
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
              {language === "en" ? "Tap to preview" : "Урьдчилж харах"}
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
          {/* â”€â”€ Layer controls: To Front / To Back â”€â”€ */}
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
