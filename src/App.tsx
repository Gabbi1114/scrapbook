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
  saveSharedPagesById,
  uploadImageFileForShare,
  SHARE_STORAGE_LIMIT_BYTES,
  resolveShareableUrl,
  canPublishShareLinks,
} from "./scrapbookShare";
import {
  BookStageScaleContext,
  BOOK_STAGE_HEIGHT,
  BOOK_STAGE_WIDTH,
  useBookStageScale,
} from "./bookStage";
import {
  EditorPanelBody,
  type EditorAccordionId,
} from "./EditorPanelBody";

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
        y: 200,
        rotation: -3,
        content: "https://picsum.photos/seed/cute/300/200",
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
        content: "The End",
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

export default function App() {
  const init = getInitialPagesAndShare();
  const initialShareId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("share")
      : null;
  const [pages, setPages] = useState<PageData[]>(init.pages);
  const [sharedViewMode, setSharedViewMode] = useState(
    init.openedFromShareLink,
  );
  const [currentShareId, setCurrentShareId] = useState<string | null>(
    initialShareId,
  );
  const [history, setHistory] = useState<PageData[][]>([init.pages]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [shareHint, setShareHint] = useState<string | null>(null);
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
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [bendIntensity, setBendIntensity] = useState(1.2);

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

  useEffect(() => {
    editorPlacementRef.current = editorPlacement;
  }, [editorPlacement]);

  useEffect(() => {
    const onResize = () => {
      setEditorPlacement((p) => {
        const w = editorPanelWidthPx(window.innerWidth);
        const h =
          editorPanelRef.current?.getBoundingClientRect().height ?? 480;
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
        left: Math.min(
          window.innerWidth - pw - 8,
          Math.max(8, orig.left + dx),
        ),
        top: Math.min(
          window.innerHeight - ph - 8,
          Math.max(8, orig.top + dy),
        ),
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

  /** Uniform scale so the fixed 800×600 stage matches preview/edit on every screen size. */
  useLayoutEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      const s =
        Math.min(w / BOOK_STAGE_WIDTH, h / BOOK_STAGE_HEIGHT) * 0.98;
      setStageScale(Math.max(0.08, Math.min(s, 4)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [isEditing, sharedViewMode]);

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
      const deadlineMs = shareEditUntilIso ? Date.parse(shareEditUntilIso) : NaN;
      const expired =
        shareEditUntilIso !== null &&
        Number.isFinite(deadlineMs) &&
        Date.now() > deadlineMs;
      if (!expired) return;
    }
    if (sharedViewMode) setIsEditing(false);
  }, [sharedViewMode, currentShareId, shareEditUntilIso]);

  useEffect(() => {
    if (sharedViewMode && currentShareId) return;
    const id = window.setTimeout(() => saveDraftToStorage(pages), 500);
    return () => window.clearTimeout(id);
  }, [pages, sharedViewMode, currentShareId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("share");
    if (!sid) return;
    let cancelled = false;
    (async () => {
      const bundle = await fetchSharedBundleById(sid);
      if (cancelled) return;
      if (bundle) {
        setCurrentShareId(sid);
        setPages(bundle.pages);
        setShareEditUntilIso(bundle.editUntil);
        setShareStorageUsedBytes(bundle.mediaBytes);
        setSharedViewMode(true);
        setHistory([bundle.pages]);
        setHistoryIndex(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  void shareDeadlineTick;

  const showPublishLinkUi = !sharedViewMode && canPublishShareLinks();

  const copyShareLink = async () => {
    if (!showPublishLinkUi) return;
    const resolved = await resolveShareableUrl(pages);
    if (resolved.kind === "hash" || resolved.kind === "server") {
      try {
        await navigator.clipboard.writeText(resolved.url);
        setShareHint(
          "Link copied — paste it in a message or email to send your scrapbook.",
        );
        window.setTimeout(() => setShareHint(null), 5000);
      } catch {
        window.prompt("Copy this link:", resolved.url);
      }
      return;
    }
    window.alert(
      "We couldn't create a share link. If your scrapbook has many large photos, try using fewer or smaller pictures, check your internet connection, and try again. If you keep seeing this, the sharing service may need to be turned on by the person who gave you this scrapbook.",
    );
  };

  useEffect(() => {
    if (!canEditSharedLink || !currentShareId) return;
    const id = window.setTimeout(async () => {
      const r = await saveSharedPagesById(currentShareId, pages);
      if (!r.ok) {
        setShareHint(
          "Could not save edits to this link. Refresh and try again.",
        );
        return;
      }
      setShareHint("Changes saved.");
      window.setTimeout(() => setShareHint(null), 1200);
    }, 700);
    return () => window.clearTimeout(id);
  }, [canEditSharedLink, currentShareId, pages]);

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

  const addElement = (pageId: string, type: ElementType, content: string) => {
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
      width: isPolaroidSticker ? 210 : undefined,
      height: isPolaroidSticker ? 260 : undefined,
      color: "#333333",
      fontFamily: type === "text" ? "var(--font-handwriting)" : undefined,
      textEffect: type === "text" ? "none" : undefined,
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
        reject(new Error("Could not read video metadata."));
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
      window.alert("At least two pages must stay in the book.");
      return;
    }
    if (
      !window.confirm(
        "Remove this page from the scrapbook? You can still use Undo afterward.",
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

  const updatePagePattern = (pageId: string, pattern: string) => {
    updatePagesWithHistory(
      pages.map((p) => (p.id === pageId ? { ...p, pattern } : p)),
    );
  };

  const handleImageUpload = (
    pageId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (currentShareId) {
      setShareHint("Uploading image...");
      void (async () => {
        const uploaded = await uploadImageFileForShare(currentShareId, file);
        if (uploaded.ok === false) {
          setShareHint(null);
          window.alert(`Image upload failed: ${uploaded.error}`);
          return;
        }
        if (typeof uploaded.bytesUsed === "number") {
          setShareStorageUsedBytes(uploaded.bytesUsed);
        }
        if (typeof uploaded.bytesLimit === "number") {
          setShareStorageLimitBytes(uploaded.bytesLimit);
        }
        addElement(pageId, "image", uploaded.url);
        setShareHint("Image uploaded.");
        window.setTimeout(() => setShareHint(null), 1400);
      })();
      e.target.value = "";
      return;
    }

    // Keep JSON light: force cloud upload workflow (no base64 fallback).
    window.alert(
      "Please create/open a share link first, then upload photos there. This keeps images in cloud storage instead of huge base64 JSON.",
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
        "Please create/open a share link first, then upload videos there.",
      );
      e.target.value = "";
      return;
    }
    if (!file.type.startsWith("video/")) {
      window.alert("Please select a video file.");
      e.target.value = "";
      return;
    }
    try {
      const sec = await probeVideoDurationSec(file);
      if (sec > 60) {
        window.alert("One video can be maximum 1 minute.");
        e.target.value = "";
        return;
      }
    } catch {
      window.alert("Could not validate video duration.");
      e.target.value = "";
      return;
    }

    setShareHint("Uploading video...");
    const uploaded = await uploadImageFileForShare(currentShareId, file);
    if (uploaded.ok === false) {
      setShareHint(null);
      window.alert(`Video upload failed: ${uploaded.error}`);
      e.target.value = "";
      return;
    }
    if (typeof uploaded.bytesUsed === "number") {
      setShareStorageUsedBytes(uploaded.bytesUsed);
    }
    if (typeof uploaded.bytesLimit === "number") {
      setShareStorageLimitBytes(uploaded.bytesLimit);
    }
    addElement(pageId, "video", uploaded.url);
    setShareHint("Video uploaded.");
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

  return (
    <div className="h-dvh bg-[#4A5568] font-sans flex flex-col overflow-hidden">
      {/* Sidebar is overlaid (not flex-shrink) so book size stays the same in edit vs preview */}
      <div className="flex-1 relative min-h-0">
        {sharedViewMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 mx-2 max-w-lg text-center text-xs sm:text-sm text-white bg-white/15 rounded-xl py-2 px-3 sm:px-4 border border-white/25 shadow-lg">
            {!canEditSharedLink ? (
              <p className="mb-2 text-white/95">
                {isShareEditExpired
                  ? "The editing period for this link has ended"
                  : "This shared link is view-only"}
                {isShareEditExpired && Number.isFinite(shareEditDeadlineMs)
                  ? ` (${new Date(shareEditDeadlineMs).toLocaleString()})`
                  : ""}
                . This scrapbook stays exactly as saved.
              </p>
            ) : (
              <p className="mb-2 text-white/95">
                This private link can be edited directly on this page
                {shareEditUntilIso && Number.isFinite(shareEditDeadlineMs) ? (
                  <>
                    {" "}
                    until{" "}
                    <span className="font-semibold whitespace-nowrap">
                      {new Date(shareEditDeadlineMs).toLocaleString()}
                    </span>
                    .
                  </>
                ) : (
                  "."
                )}
                {" "}
                Changes are auto-saved to this same link.
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
                  Copy link
                </button>
              )}
            </div>
          </div>
        )}

        <main className="absolute inset-0 flex flex-col min-h-0 min-w-0 overflow-hidden p-2 sm:p-3">
          {/* Row: nav + book fills height minus bottom bar space */}
          <div className="flex flex-1 min-h-0 w-full items-center justify-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={turnPrev}
              disabled={currentLeaf === 0}
              className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm text-white rounded-full flex items-center justify-center hover:bg-white/30 disabled:opacity-0 disabled:pointer-events-none transition-all z-10"
              aria-label="Previous page"
            >
              <ChevronLeft size={26} />
            </button>

            <BookStageScaleContext.Provider value={stageScale}>
              <div
                ref={stageViewportRef}
                className="flex min-h-0 min-w-0 flex-1 h-full max-h-full items-center justify-center overflow-visible"
              >
                <div
                  className="relative shrink-0 overflow-visible"
                  style={{
                    width: BOOK_STAGE_WIDTH * stageScale,
                    height: BOOK_STAGE_HEIGHT * stageScale,
                  }}
                >
                  <div
                    className="absolute left-0 top-0 perspective-[1500px] preserve-3d"
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
                      <EditingSpread
                        pages={pages}
                        visibleLeftPageId={visibleLeftPageId}
                        visibleRightPageId={visibleRightPageId}
                        selectedElementId={selectedElementId}
                        setSelectedElementId={setSelectedElementId}
                        updateElement={updateElement}
                        selectedPageId={selectedPageId}
                        setSelectedPageId={setSelectedPageId}
                      />
                    ) : (
                      leaves.map((leaf, i) => (
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
                          selectedPageId={selectedPageId}
                          setSelectedPageId={setSelectedPageId}
                          bendIntensity={bendIntensity}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </BookStageScaleContext.Provider>

            <button
              type="button"
              onClick={turnNext}
              disabled={currentLeaf === totalLeaves}
              className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm text-white rounded-full flex items-center justify-center hover:bg-white/30 disabled:opacity-0 disabled:pointer-events-none transition-all z-10"
              aria-label="Next page"
            >
              <ChevronRight size={26} />
            </button>
          </div>
        </main>

        {/* Bottom Floating Controls */}
        <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 max-w-[95vw]">
          {sharedViewMode && (
            <p className="text-xs text-white/90 bg-black/40 px-3 py-1.5 rounded-full border border-white/20">
              Storage left: {storageLeftMb.toFixed(2)} MB
            </p>
          )}
          {shareHint && (
            <p className="text-xs text-white/90 bg-black/40 px-3 py-1.5 rounded-full border border-white/20">
              {shareHint}
            </p>
          )}
          <div className="bg-white/10 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-4 shadow-xl border border-white/20">
            {!sharedViewMode && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isEditing ? "bg-stone-800 text-white" : "bg-white text-stone-800 hover:bg-stone-100"}`}
                  title={isEditing ? "Preview" : "Edit"}
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
                      title="Undo"
                    >
                      <Undo2 size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={redo}
                      disabled={historyIndex === history.length - 1}
                      className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Redo"
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
                      title="Copy link to send this scrapbook"
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
                  title="Add Page"
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
                  title={isEditing ? "Preview" : "Edit"}
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
                      title="Undo"
                    >
                      <Undo2 size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={redo}
                      disabled={historyIndex === history.length - 1}
                      className="w-10 h-10 bg-white text-stone-800 rounded-full flex items-center justify-center hover:bg-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Redo"
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
                Copy link
              </button>
            )}
          </div>
        </div>

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
                Editor
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:p-4">
              <EditorPanelBody
                selectedPageId={selectedPageId}
                selectedElementId={selectedElementId}
                pages={pages}
                openAccordion={openAccordion}
                setOpenAccordion={setOpenAccordion}
                bendIntensity={bendIntensity}
                setBendIntensity={setBendIntensity}
                addElement={addElement}
                handleImageUpload={handleImageUpload}
                handleVideoUpload={handleVideoUpload}
                updatePageBackground={updatePageBackground}
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
    </div>
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
  selectedPageId,
  setSelectedPageId,
}: {
  pages: PageData[];
  visibleLeftPageId: string | null;
  visibleRightPageId: string | null;
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
  updateElement: (pageId: string, el: PageElement, saveHistory?: boolean) => void;
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
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
              isActive={selectedPageId === left.id}
              onSelectPage={() => setSelectedPageId(left.id)}
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
              isActive={selectedPageId === right.id}
              onSelectPage={() => setSelectedPageId(right.id)}
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
            isActive={selectedPageId === left.id}
            onSelectPage={() => setSelectedPageId(left.id)}
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
            isActive={selectedPageId === right.id}
            onSelectPage={() => setSelectedPageId(right.id)}
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
  selectedPageId,
  setSelectedPageId,
  bendIntensity = 1.2,
}: any) {
  const isFlipped = i < currentLeaf;

  const rotateYTarget = useMotionValue(isFlipped ? -180 : 0);
  // Slightly softer spring for a "heavy paper" feel
  const rotateY = useSpring(rotateYTarget, {
    stiffness: 55,
    damping: 16,
    mass: 1,
    restDelta: 0.01,
  });

  // zIndex swaps exactly at -90 degrees
  const zIndex = useTransform(rotateY, (value) => (value < -90 ? i : 100 - i));

  // Lift the page up during the flip to prevent z-fighting and add realism
  // Also offset based on index to create a physical stack of pages
  const z = useTransform(rotateY, [-180, -90, 0], [i * 1.5, 50, -i * 1.5], {
    clamp: true,
  });

  // Paper bending effect (droop) - more subtle and realistic
  const rotateXTarget = useTransform(
    rotateY,
    [-180, -90, 0],
    [0, bendIntensity, 0],
    { clamp: true },
  );
  const rotateZTarget = useTransform(
    rotateY,
    [-180, -90, 0],
    [0, -bendIntensity, 0],
    { clamp: true },
  );

  // Add secondary spring physics to the bend for a realistic paper wobble
  const rotateX = useSpring(rotateXTarget, {
    stiffness: 45,
    damping: 15,
    mass: 1,
  });
  const rotateZ = useSpring(rotateZTarget, {
    stiffness: 45,
    damping: 15,
    mass: 1,
  });

  // Dynamic lighting/shading to simulate curvature
  const frontLightingOpacity = useTransform(rotateY, [-90, 0], [0.5, 0], {
    clamp: true,
  });
  const backLightingOpacity = useTransform(rotateY, [-180, -90], [0, 0.5], {
    clamp: true,
  });

  // Drop shadow moving across the book
  const shadowOpacity = useTransform(rotateY, [-180, -90, 0], [0, 0.25, 0], {
    clamp: true,
  });
  const shadowX = useTransform(
    rotateY,
    [-180, -90, 0],
    ["-100%", "-50%", "0%"],
  );
  const shadowScale = useTransform(rotateY, [-180, -90, 0], [1, 1.1, 1]);
  const shadowZIndex = useTransform(zIndex, (z) => z - 1);

  useEffect(() => {
    rotateYTarget.set(isFlipped ? -180 : 0);
  }, [isFlipped, rotateYTarget]);

  const isInteractive = i === currentLeaf || i === currentLeaf - 1;

  return (
    <>
      {/* Moving Drop Shadow */}
      <motion.div
        className="absolute top-4 left-1/2 w-[45%] h-[95%] bg-black blur-2xl pointer-events-none rounded-full"
        style={{
          opacity: shadowOpacity,
          x: shadowX,
          scale: shadowScale,
          zIndex: shadowZIndex,
        }}
      />

      <motion.div
        className={`absolute top-0 left-1/2 w-1/2 h-full origin-left preserve-3d ${!isInteractive ? "pointer-events-none" : ""}`}
        style={{
          rotateY,
          rotateX,
          rotateZ,
          zIndex,
          z,
        }}
      >
        {/* Front Page (Right side when not flipped) */}
        <motion.div
          className={`absolute inset-0 backface-hidden bg-white shadow-[0_2px_10px_rgba(0,0,0,0.1)] overflow-hidden rounded-r-2xl rounded-l-sm border border-black/10 border-r-black/20 ${isFlipped ? "pointer-events-none" : ""}`}
          style={{ transform: "translateZ(0.5px)" }}
        >
          <PageContent
            page={leaf.front}
            isEditing={isEditing}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={updateElement}
            isActive={selectedPageId === leaf.front?.id}
            onSelectPage={() => isEditing && setSelectedPageId(leaf.front?.id)}
          />

          {/* Static spine shadow */}
          <div className="absolute inset-y-0 left-0 pointer-events-none bg-gradient-to-r from-black/10 to-transparent w-12 z-50" />

          {/* Dynamic bending shadow */}
          <motion.div
            className="absolute inset-0 pointer-events-none z-50"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 30%, rgba(255,255,255,0.4) 100%)",
              opacity: frontLightingOpacity,
            }}
          />
        </motion.div>

        {/* Back Page (Left side when flipped) */}
        <motion.div
          className={`absolute inset-0 backface-hidden bg-white shadow-[0_2px_10px_rgba(0,0,0,0.1)] overflow-hidden rounded-l-2xl rounded-r-sm border border-black/10 border-l-black/20 ${!isFlipped ? "pointer-events-none" : ""}`}
          style={{ transform: "rotateY(180deg) translateZ(0.5px)" }}
        >
          <PageContent
            page={leaf.back}
            isEditing={isEditing}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={updateElement}
            isActive={selectedPageId === leaf.back?.id}
            onSelectPage={() => isEditing && setSelectedPageId(leaf.back?.id)}
          />

          {/* Static spine shadow */}
          <div className="absolute inset-y-0 right-0 pointer-events-none bg-gradient-to-l from-black/10 to-transparent w-12 z-50" />

          {/* Dynamic bending shadow */}
          <motion.div
            className="absolute inset-0 pointer-events-none z-50"
            style={{
              background:
                "linear-gradient(to left, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 30%, rgba(255,255,255,0.4) 100%)",
              opacity: backLightingOpacity,
            }}
          />
        </motion.div>
      </motion.div>
    </>
  );
}

function PageContent({
  page,
  isEditing,
  selectedElementId,
  onSelectElement,
  onUpdateElement,
  isActive,
  onSelectPage,
}: {
  page?: PageData;
  isEditing: boolean;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (pageId: string, el: PageElement, saveHistory?: boolean) => void;
  isActive: boolean;
  onSelectPage: () => void;
}) {
  if (!page) return <div className="w-full h-full bg-stone-200" />;

  return (
    <div
      className={`w-full h-full relative ${page.background} ${page.pattern} transition-all ${isActive && isEditing ? "ring-inset ring-4 ring-rose-400" : ""}`}
      onClick={(e) => {
        if (isEditing) {
          onSelectPage();
          onSelectElement(null);
        }
      }}
    >
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
}: {
  key?: React.Key;
  element: PageElement;
  isEditing: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (el: PageElement, saveHistory?: boolean) => void;
}) {
  const stageScale = useBookStageScale();
  const inv = stageScale > 0 ? 1 / stageScale : 1;
  const dragControls = useDragControls();
  const [isTransforming, setIsTransforming] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const isPolaroid = element.type === "sticker" && element.content === POLAROID_STICKER_TOKEN;
  const canResize = element.type === "image" || element.type === "video" || isPolaroid;
  const baseWidth = canResize
    ? (element.width || (isPolaroid ? 210 : element.type === "video" ? 320 : 192))
    : undefined;
  const baseHeight = canResize
    ? (element.height || (isPolaroid ? 260 : element.type === "video" ? 180 : 192))
    : undefined;

  const startResize = (
    e: React.PointerEvent,
    dir: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
  ) => {
    if (!canResize || !baseWidth || !baseHeight) return;
    e.stopPropagation();
    e.preventDefault();
    setIsTransforming(true);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = element.x;
    const oy = element.y;
    const ow = baseWidth;
    const oh = baseHeight;
    const minSize = 40;

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) * inv;
      const dy = (ev.clientY - sy) * inv;
      let nx = ox;
      let ny = oy;
      let nw = ow;
      let nh = oh;

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

      onUpdate({ ...element, x: nx, y: ny, width: nw, height: nh }, false);
    };

    const up = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) * inv;
      const dy = (ev.clientY - sy) * inv;
      let nx = ox;
      let ny = oy;
      let nw = ow;
      let nh = oh;
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
      onUpdate({ ...element, x: nx, y: ny, width: nw, height: nh }, true);
      setIsTransforming(false);
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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resizeHandleClass =
    "absolute z-60 h-3 w-3 rounded-full border border-white bg-stone-800 shadow-md";

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
    const el = videoRef.current;
    if (!el) return;
    const syncPlayback = () => {
      const shouldPlay = isVideoVisible && !document.hidden;
      if (shouldPlay) {
        void el.play().catch(() => {});
      } else {
        el.pause();
      }
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => document.removeEventListener("visibilitychange", syncPlayback);
  }, [element.type, isVideoVisible]);

  return (
    <motion.div
      drag={isEditing && !isTransforming}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onPointerDown={(e) => {
        if (!isEditing || isTransforming) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-transform-handle="true"]')) return;
        dragControls.start(e);
      }}
      onDragEnd={(e, info) => {
        onUpdate({
          ...element,
          x: element.x + info.offset.x * inv,
          y: element.y + info.offset.y * inv,
        });
      }}
      onClick={(e) => {
        if (isEditing) {
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`absolute ${isEditing ? "cursor-move" : ""} ${isSelected && isEditing ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-transparent z-50" : "z-10"}`}
      initial={{ x: element.x, y: element.y, rotate: element.rotation }}
      animate={{ x: element.x, y: element.y, rotate: element.rotation }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      whileHover={isEditing ? { scale: 1.05 } : {}}
      whileTap={isEditing ? { scale: 0.95 } : {}}
    >
      {element.type === "text" && (
        <div
          style={{
            color: element.color,
            fontSize: element.fontSize,
            fontFamily: element.fontFamily || "var(--font-handwriting)",
            whiteSpace: "nowrap",
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
      {element.type === "sticker" && (
        element.content === POLAROID_STICKER_TOKEN ? (
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
              <div className="h-full w-full rounded-[2px] border border-black/10 bg-linear-to-br from-stone-200 to-stone-300" />
            </div>
          </div>
        ) : (
          <div style={{ fontSize: element.fontSize, lineHeight: 1 }}>
            {element.content}
          </div>
        )
      )}
      {element.type === "image" && (
        <img
          src={element.content}
          alt="scrapbook"
          className="object-cover"
          style={{
            width: element.width || 192,
            height: element.height ?? "auto",
          }}
          draggable={false}
        />
      )}
      {element.type === "video" && (
        <video
          ref={videoRef}
          src={element.content}
          autoPlay
          loop
          muted={videoMuted}
          playsInline
          preload="metadata"
          className="object-cover rounded-sm bg-black"
          style={{
            width: element.width || 320,
            height: element.height || 180,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (isEditing) onSelect();
            setVideoMuted((m) => !m);
            const el = videoRef.current;
            if (el) void el.play().catch(() => {});
          }}
        />
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
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "nw")} className={`${resizeHandleClass} -left-1.5 -top-1.5 cursor-nwse-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "n")} className={`${resizeHandleClass} left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "ne")} className={`${resizeHandleClass} -right-1.5 -top-1.5 cursor-nesw-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "e")} className={`${resizeHandleClass} -right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "se")} className={`${resizeHandleClass} -bottom-1.5 -right-1.5 cursor-nwse-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "s")} className={`${resizeHandleClass} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "sw")} className={`${resizeHandleClass} -bottom-1.5 -left-1.5 cursor-nesw-resize`} />
              <button type="button" data-transform-handle="true" onPointerDown={(e) => startResize(e, "w")} className={`${resizeHandleClass} -left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`} />
            </>
          )}
        </>
      )}
    </motion.div>
  );
}
