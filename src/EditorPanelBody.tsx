import { useState, type KeyboardEvent } from "react";
import type {
  ChangeEvent,
  ComponentType,
  Dispatch,
  SetStateAction,
} from "react";
import {
  Type,
  Image as ImageIcon,
  Trash2,
  Palette,
  Sticker,
  MousePointerClick,
  Files,
  Plus,
  ChevronDown,
  Pipette,
} from "lucide-react";
import type { ElementType, PageData, PageElement } from "./scrapbookShare";

export type EditorAccordionId =
  | "text"
  | "photo"
  | "stickers"
  | "pageStyle"
  | "bookEffects"
  | "selection"
  | "pages";

type AccordionTriggerProps = {
  id: EditorAccordionId;
  openId: EditorAccordionId | null;
  setOpenId: Dispatch<SetStateAction<EditorAccordionId | null>>;
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  disabled?: boolean;
};

export function AccordionTrigger({
  id,
  openId,
  setOpenId,
  icon: Icon,
  label,
  disabled,
}: AccordionTriggerProps) {
  const open = openId === id;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setOpenId((a) => (a === id ? null : id))}
      className="flex w-full items-center justify-between gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-2 text-left text-xs font-medium text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 md:gap-2 md:rounded-xl md:px-3 md:py-2.5 md:text-sm"
    >
      <span className="flex min-w-0 items-center gap-1.5 md:gap-2">
        <Icon className="size-4 shrink-0 text-stone-500 md:size-[18px]" />
        <span className="truncate">{label}</span>
      </span>
      <ChevronDown
        className={`size-4 shrink-0 text-stone-400 transition-transform duration-200 md:size-[18px] ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

const STICKERS = ["🌸", "✨", "💖", "🎀", "🧸", "🦋", "🎈", "🎨", "📸", "⭐"];
const POLAROID_STICKER_TOKEN = "__POLAROID__";
const PATTERNS: { name: string; value: string }[] = [
  { name: "Цэгтэй", value: "pattern-polka" },
  { name: "Дөрвөлжин", value: "pattern-grid" },
  { name: "Тууш", value: "pattern-lines" },
  { name: "Хоосон", value: "" },
];
const DEMO_PATTERNS: { name: string; value: string }[] = [
  { name: "Polka dots", value: "pattern-polka" },
  { name: "Grid", value: "pattern-grid" },
  { name: "Lines", value: "pattern-lines" },
  { name: "None", value: "" },
];
const FONTS = [
  { name: "Гар бичмэл", value: "var(--font-handwriting)" },
  { name: "Санс сериф", value: "var(--font-sans)" },
  { name: "Pacifico", value: "var(--font-pacifico)" },
  { name: "Amatic", value: "var(--font-amatic)" },
  { name: "Indie", value: "var(--font-indie)" },
  { name: "SYSTEM", value: "var(--font-system)" },
  { name: "Meteor", value: "var(--font-meteor)" },
  { name: "Playfair-Bd", value: "var(--font-playfair-display)" },
  { name: "RubikWetPaint-RG", value: "var(--font-rubik-wet-paint)" },
  { name: "FlicFlac", value: "var(--font-flic-flac)" },
  { name: "Kabeltouw", value: "var(--font-kabeltouw)" },
  { name: "Ralfine-RG", value: "var(--font-ralfine-rg)" },
  { name: "Ralfine-BD", value: "var(--font-ralfine-bd)" },
  { name: "OpenSerif-RG", value: "var(--font-open-serif-rg)" },
  { name: "HarmonyOSCn-It", value: "var(--font-harmony-cn-it)" },
  { name: "PT Sans", value: "var(--font-pt-sans)" },
  { name: "OpenSerif-Bd", value: "var(--font-open-serif-bd)" },
  { name: "HarmonyOS-Bdlt", value: "var(--font-harmony-bdlt)" },
  { name: "Roboto-BlkCn", value: "var(--font-roboto-condensed)" },
  { name: "Nunito", value: "var(--font-sans)" },
  { name: "Древесина", value: "var(--font-drevensina)" },
  { name: "Holz", value: "var(--font-holz)" },
  { name: "PlayfairDisplay", value: "var(--font-playfair-display)" },
  { name: "Hand", value: "var(--font-hand)" },
  { name: "Italic", value: "var(--font-italic-custom)" },
  { name: "Playfair Display", value: "var(--font-playfair-display)" },
  { name: "Oswald", value: "var(--font-oswald)" },
  { name: "Robert", value: "var(--font-robert)" },
  { name: "Inter-BlkCn", value: "var(--font-inter)" },
];
const DEMO_FONTS = FONTS.map((font) =>
  font.value === "var(--font-handwriting)"
    ? { ...font, name: "Handwriting" }
    : font.value === "var(--font-sans)"
      ? { ...font, name: "Sans serif" }
      : font.value === "var(--font-drevensina)"
        ? { ...font, name: "Drevensina" }
        : font,
);
const TEXT_EFFECTS = [
  { name: "Байхгүй", value: "none" },
  { name: "Сүүдэр", value: "shadow" },
  { name: "Хүрээ", value: "outline" },
  { name: "Гэрэлтэлт", value: "glow" },
];
const DEMO_TEXT_EFFECTS = [
  { name: "None", value: "none" },
  { name: "Shadow", value: "shadow" },
  { name: "Outline", value: "outline" },
  { name: "Glow", value: "glow" },
];

const GIPHY_PUBLIC_BETA_KEY = "dc6zaTOxFJmzC";
const TENOR_PUBLIC_KEY = "LIVDSRZULELA";

type GifPick = {
  id: string;
  previewUrl: string;
  fullUrl: string;
  title: string;
};
type GraphicPick = {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
};

type EyeDropperResult = { sRGBHex: string };
type EyeDropperApi = { open: () => Promise<EyeDropperResult> };
type EyeDropperCtor = new () => EyeDropperApi;

const CUTE_ICON_PREFIXES = [
  "fluent-emoji-flat",
  "twemoji",
  "noto",
  "openmoji",
  "fxemoji",
] as const;

const GRAPHIC_PRESETS: GraphicPick[] = [
  {
    id: "fluent-emoji-flat:ribbon",
    title: "Ribbon",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/ribbon.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/ribbon.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:red-heart",
    title: "Heart",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/red-heart.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/red-heart.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:sparkles",
    title: "Sparkles",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/sparkles.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/sparkles.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:camera",
    title: "Camera",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/camera.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/camera.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:party-popper",
    title: "Party",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/party-popper.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/party-popper.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:cherry-blossom",
    title: "Flower",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/cherry-blossom.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/cherry-blossom.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:butterfly",
    title: "Butterfly",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/butterfly.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/butterfly.svg?height=512",
  },
  {
    id: "fluent-emoji-flat:framed-picture",
    title: "Frame",
    previewUrl:
      "https://api.iconify.design/fluent-emoji-flat/framed-picture.svg?height=96",
    fullUrl:
      "https://api.iconify.design/fluent-emoji-flat/framed-picture.svg?height=512",
  },
];

export function EditorPanelBody({
  selectedPageId,
  isDemoMode = false,
  selectedElementId,
  pages,
  openAccordion,
  setOpenAccordion,
  appBackgroundColor,
  setAppBackgroundColor,
  appBackgroundImageUrl,
  setAppBackgroundImageUrl,
  backgroundMusicUrl,
  setBackgroundMusicUrl,
  saveMusicLink,
  addElement,
  handleImageUpload,
  handleVideoUpload,
  handlePageBackgroundImageUpload,
  handleAppBackgroundImageUpload,
  updatePageBackground,
  updatePageBackgroundImage,
  updatePagePattern,
  updateElement,
  updatePagesWithHistory,
  deleteElement,
  removePage,
  addPagesPair,
}: {
  selectedPageId: string | null;
  isDemoMode?: boolean;
  selectedElementId: string | null;
  pages: PageData[];
  openAccordion: EditorAccordionId | null;
  setOpenAccordion: Dispatch<SetStateAction<EditorAccordionId | null>>;
  appBackgroundColor: string;
  setAppBackgroundColor: (v: string) => void;
  appBackgroundImageUrl: string;
  setAppBackgroundImageUrl: (v: string) => void;
  backgroundMusicUrl: string;
  setBackgroundMusicUrl: (v: string) => void;
  saveMusicLink: () => void;
  addElement: (
    pageId: string,
    type: ElementType,
    content: string,
    opts?: { width?: number; height?: number },
  ) => void;
  handleImageUpload: (pageId: string, e: ChangeEvent<HTMLInputElement>) => void;
  handleVideoUpload: (pageId: string, e: ChangeEvent<HTMLInputElement>) => void;
  handlePageBackgroundImageUpload: (
    pageId: string,
    e: ChangeEvent<HTMLInputElement>,
  ) => void;
  handleAppBackgroundImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  updatePageBackground: (pageId: string, bg: string) => void;
  updatePageBackgroundImage: (pageId: string, imageUrl: string) => void;
  updatePagePattern: (pageId: string, pattern: string) => void;
  updateElement: (
    pageId: string,
    el: PageElement,
    saveHistory?: boolean,
  ) => void;
  updatePagesWithHistory: (newPages: PageData[]) => void;
  deleteElement: (pageId: string, elementId: string) => void;
  removePage: (pageId: string) => void;
  addPagesPair: () => void;
}) {
  const [gifQuery, setGifQuery] = useState("love");
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const [gifResults, setGifResults] = useState<GifPick[]>([]);
  const [gifDirectUrl, setGifDirectUrl] = useState("");
  const [graphicQuery, setGraphicQuery] = useState("ribbon");
  const [graphicLoading, setGraphicLoading] = useState(false);
  const [graphicError, setGraphicError] = useState<string | null>(null);
  const [graphicResults, setGraphicResults] = useState<GraphicPick[]>([]);

  const searchGifs = async () => {
    const q = gifQuery.trim();
    if (!q) return;
    setGifLoading(true);
    setGifError(null);
    try {
      const giphyKey =
        (import.meta.env.VITE_GIPHY_API_KEY || "").trim() ||
        GIPHY_PUBLIC_BETA_KEY;
      const giphyUrl =
        `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyKey)}` +
        `&q=${encodeURIComponent(q)}&limit=12&rating=g&lang=en`;
      const giphyRes = await fetch(giphyUrl);
      let picks: GifPick[] = [];
      if (giphyRes.ok) {
        const body = (await giphyRes.json()) as {
          data?: Array<{
            id?: string;
            title?: string;
            images?: {
              fixed_width?: { url?: string };
              original?: { url?: string };
            };
          }>;
        };
        picks = (body.data || [])
          .map((gif) => {
            const previewUrl = gif.images?.fixed_width?.url || "";
            const fullUrl = gif.images?.original?.url || previewUrl;
            if (!gif.id || !previewUrl || !fullUrl) return null;
            return {
              id: gif.id,
              title: gif.title || "GIF",
              previewUrl,
              fullUrl,
            };
          })
          .filter((v): v is GifPick => v !== null);
      }

      // GIPHY public beta key is often blocked; use Tenor as fallback without forcing API signup.
      if (picks.length === 0) {
        const tenorKey =
          (import.meta.env.VITE_TENOR_API_KEY || "").trim() || TENOR_PUBLIC_KEY;
        const tenorUrl =
          `https://g.tenor.com/v1/search?key=${encodeURIComponent(tenorKey)}` +
          `&q=${encodeURIComponent(q)}&limit=12&media_filter=minimal&contentfilter=high`;
        const tenorRes = await fetch(tenorUrl);
        if (tenorRes.ok) {
          const tenor = (await tenorRes.json()) as {
            results?: Array<{
              id?: string;
              title?: string;
              media?: Array<{
                gif?: { url?: string };
                tinygif?: { url?: string };
              }>;
            }>;
          };
          picks = (tenor.results || [])
            .map((gif) => {
              const media0 = gif.media?.[0];
              const fullUrl = media0?.gif?.url || "";
              const previewUrl = media0?.tinygif?.url || fullUrl;
              if (!gif.id || !previewUrl || !fullUrl) return null;
              return {
                id: `tenor-${gif.id}`,
                title: gif.title || "GIF",
                previewUrl,
                fullUrl,
              };
            })
            .filter((v): v is GifPick => v !== null);
        }
      }
      setGifResults(picks);
      if (picks.length === 0) {
        setGifError(
          isDemoMode
            ? "No GIFs found. Try another search word."
            : "GIF олдсонгүй. Өөр түлхүүр үг туршаарай.",
        );
      }
    } catch {
      setGifError(
        isDemoMode
          ? "Could not search GIFs right now."
          : "Одоогоор GIF хайж чадсангүй.",
      );
    } finally {
      setGifLoading(false);
    }
  };

  const onGifQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void searchGifs();
  };

  const addGifFromUrl = () => {
    const url = gifDirectUrl.trim();
    if (!url) return;
    const looksLikeUrl = /^https?:\/\/\S+/i.test(url);
    if (!looksLikeUrl) {
      setGifError(
        isDemoMode
          ? "Enter a valid GIF URL (https://...)."
          : "Зөв GIF URL оруулна уу (https://...)",
      );
      return;
    }
    addElement(selectedPageId, "image", url);
    setGifDirectUrl("");
    setGifError(null);
  };

  const onGifUrlKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addGifFromUrl();
  };

  const searchGraphics = async () => {
    const q = graphicQuery.trim();
    if (!q) return;
    setGraphicLoading(true);
    setGraphicError(null);
    try {
      let picks: GraphicPick[] = [];
      const pixabayKey = (import.meta.env.VITE_PIXABAY_API_KEY || "").trim();
      if (pixabayKey) {
        const pixabayUrl =
          `https://pixabay.com/api/?key=${encodeURIComponent(pixabayKey)}` +
          `&q=${encodeURIComponent(q)}&image_type=vector&safesearch=true&per_page=24`;
        const pixabayRes = await fetch(pixabayUrl);
        if (pixabayRes.ok) {
          const body = (await pixabayRes.json()) as {
            hits?: Array<{
              id?: number;
              tags?: string;
              previewURL?: string;
              webformatURL?: string;
              largeImageURL?: string;
            }>;
          };
          picks = (body.hits || [])
            .map((h) => {
              const id = h.id ? `pixabay-${h.id}` : "";
              const previewUrl = h.previewURL || h.webformatURL || "";
              const fullUrl = h.largeImageURL || h.webformatURL || previewUrl;
              if (!id || !previewUrl || !fullUrl) return null;
              return {
                id,
                title: h.tags || "Graphic",
                previewUrl,
                fullUrl,
              } satisfies GraphicPick;
            })
            .filter((v): v is GraphicPick => v !== null);
        }
      }
      if (picks.length === 0) {
        const res = await fetch(
          `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=40`,
        );
        if (!res.ok) throw new Error(`Iconify HTTP ${res.status}`);
        const body = (await res.json()) as { icons?: string[] };
        picks = (body.icons || [])
          .filter((id) => {
            const prefix = id.split(":")[0] || "";
            return CUTE_ICON_PREFIXES.includes(
              prefix as (typeof CUTE_ICON_PREFIXES)[number],
            );
          })
          .slice(0, 18)
          .map((id) => {
            const [prefix, name] = id.split(":");
            if (!prefix || !name) return null;
            const base = `https://api.iconify.design/${prefix}/${encodeURIComponent(name)}.svg`;
            return {
              id,
              title: id,
              previewUrl: `${base}?height=96`,
              fullUrl: `${base}?height=512`,
            } satisfies GraphicPick;
          })
          .filter((v): v is GraphicPick => v !== null);
      }
      setGraphicResults(picks);
      if (picks.length === 0) {
        setGraphicError(
          isDemoMode
            ? "No graphics found. Try another search word."
            : "Илэрц олдсонгүй. Өөр үгээр хайгаад үзээрэй.",
        );
      }
    } catch {
      setGraphicError(
        isDemoMode
          ? "Graphic search failed. Please try again."
          : "Graphic хайлт амжилтгүй боллоо. Дахин оролдоно уу.",
      );
      setGraphicResults([]);
    } finally {
      setGraphicLoading(false);
    }
  };

  const onGraphicQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void searchGraphics();
  };

  const selectedEl = pages
    .flatMap((p) => p.elements)
    .find((e) => e.id === selectedElementId);
  const selectedPageBg = selectedPageId
    ? pages.find((p) => p.id === selectedPageId)?.background || ""
    : "";
  const selectedPageBgImage = selectedPageId
    ? pages.find((p) => p.id === selectedPageId)?.backgroundImage || ""
    : "";
  const graphicItems =
    graphicResults.length > 0 ? graphicResults : GRAPHIC_PRESETS;
  const patterns = isDemoMode ? DEMO_PATTERNS : PATTERNS;
  const fonts = isDemoMode ? DEMO_FONTS : FONTS;
  const textEffects = isDemoMode ? DEMO_TEXT_EFFECTS : TEXT_EFFECTS;

  if (!selectedPageId) {
    return (
      <p className="py-8 text-center text-sm text-stone-500">
        {isDemoMode
          ? "Open and select a page to edit."
          : "Засах хуудсаа нээгээд сонгоно уу."}
      </p>
    );
  }

  const colorValue = /^#[0-9a-f]{6}$/i.test(selectedPageBg)
    ? selectedPageBg
    : selectedPageBg === "bg-rose-200"
      ? "#fecdd3"
      : selectedPageBg === "bg-orange-50"
        ? "#fff7ed"
        : selectedPageBg === "bg-blue-50"
          ? "#eff6ff"
          : selectedPageBg === "bg-green-50"
            ? "#f0fdf4"
            : selectedPageBg === "bg-purple-50"
              ? "#faf5ff"
          : selectedPageBg === "bg-yellow-50"
            ? "#fefce8"
            : "#f5f5f4";

  const toHexInputValue = (v: string | undefined, fallback: string) =>
    /^#[0-9a-f]{6}$/i.test(v || "") ? (v as string) : fallback;

  const pickColorFromScreen = async (): Promise<string | null> => {
    const ctor = (window as Window & { EyeDropper?: EyeDropperCtor })
      .EyeDropper;
    if (!ctor) {
      window.alert(
        isDemoMode
          ? "Your device does not support picking a color from the screen."
          : "Таны төхөөрөмж дээр дэлгэцээс өнгө сонгох (eyedropper) дэмжигдэхгүй байна.",
      );
      return null;
    }
    try {
      const result = await new ctor().open();
      return /^#[0-9a-f]{6}$/i.test(result.sRGBHex) ? result.sRGBHex : null;
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-2">
      <AccordionTrigger
        id="text"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Type}
        label={isDemoMode ? "Text" : "Текст"}
      />
      {openAccordion === "text" && (
        <div className="mb-2 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <button
            type="button"
            onClick={() => {
              addElement(
                selectedPageId,
                "text",
                isDemoMode ? "Write your text here" : "Текстээ энд бичнэ үү",
                {
                width: 260,
                height: 120,
                },
              );
            }}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white py-4 hover:bg-rose-50"
          >
            <Type size={22} />
            <span className="text-sm font-medium">
              {isDemoMode ? "Add text" : "Текст нэмэх"}
            </span>
          </button>
        </div>
      )}

      <AccordionTrigger
        id="photo"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={ImageIcon}
        label={isDemoMode ? "Photo / video" : "Зураг"}
      />
      {openAccordion === "photo" && (
        <div className="mb-2 space-y-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white py-4 hover:bg-rose-50">
              <ImageIcon size={22} />
              <span className="text-sm font-medium">
                {isDemoMode ? "Upload photo" : "Зураг оруулах"}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageUpload(selectedPageId, e)}
              />
            </label>
            <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white py-4 hover:bg-rose-50">
              <ImageIcon size={22} />
              <span className="text-sm font-medium">
                {isDemoMode ? "Upload video" : "Видео оруулах"}
              </span>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => void handleVideoUpload(selectedPageId, e)}
              />
            </label>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-2">
            <p className="mb-2 text-xs font-medium text-stone-600">
              {isDemoMode ? "Add GIF link" : "GIF линк оруулах"}
            </p>
            <div className="mb-3 flex gap-2">
              <input
                type="url"
                value={gifDirectUrl}
                onChange={(e) => setGifDirectUrl(e.target.value)}
                onKeyDown={onGifUrlKeyDown}
                placeholder="https://media.giphy.com/...gif"
                className="min-w-0 flex-1 rounded-md border border-stone-200 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                onClick={addGifFromUrl}
                disabled={!gifDirectUrl.trim()}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isDemoMode ? "Add" : "Нэмэх"}
              </button>
            </div>
            <p className="mb-2 text-xs font-medium text-stone-600">
              {isDemoMode ? "Search GIFs (GIPHY / Tenor)" : "GIF хайх (GIPHY / Tenor)"}
            </p>
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                value={gifQuery}
                onChange={(e) => setGifQuery(e.target.value)}
                onKeyDown={onGifQueryKeyDown}
                placeholder={isDemoMode ? "travel, friends, sparkle..." : "хайр, төрсөн өдөр, цэцэг..."}
                className="min-w-0 flex-1 rounded-md border border-stone-200 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                onClick={() => void searchGifs()}
                disabled={gifLoading || !gifQuery.trim()}
                className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {gifLoading ? "..." : isDemoMode ? "Search" : "Хайх"}
              </button>
            </div>
            {gifError && (
              <p className="mb-2 text-[11px] text-rose-600">{gifError}</p>
            )}
            {gifResults.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() =>
                      addElement(selectedPageId, "image", gif.fullUrl)
                    }
                    className="group overflow-hidden rounded-md border border-stone-200 bg-stone-100 hover:border-rose-300"
                    title={isDemoMode ? "Add this GIF" : "Энэ GIF-ийг нэмэх"}
                  >
                    <img
                      src={gif.previewUrl}
                      alt={gif.title}
                      className="h-16 w-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AccordionTrigger
        id="stickers"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Sticker}
        label={isDemoMode ? "Stickers / graphics" : "Стикер"}
      />
      {openAccordion === "stickers" && (
        <div className="mb-2 space-y-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div className="rounded-lg border border-stone-200 bg-white p-2">
            <p className="mb-2 text-xs font-medium text-stone-600">
              {isDemoMode ? "Cute graphics" : "Хөөрхөн Graphic"}
            </p>
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                value={graphicQuery}
                onChange={(e) => setGraphicQuery(e.target.value)}
                onKeyDown={onGraphicQueryKeyDown}
                placeholder="ribbon, bow, frame, heart, vinyl..."
                className="min-w-0 flex-1 rounded-md border border-stone-200 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                onClick={() => void searchGraphics()}
                disabled={graphicLoading || !graphicQuery.trim()}
                className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {graphicLoading ? "..." : isDemoMode ? "Search" : "Хайх"}
              </button>
            </div>
            {graphicError && (
              <p className="mb-2 text-[11px] text-rose-600">{graphicError}</p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {graphicItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    addElement(selectedPageId, "image", item.fullUrl)
                  }
                  className="group overflow-hidden rounded-md border border-stone-200 bg-white hover:border-rose-300"
                  title={isDemoMode ? "Add this graphic" : "Энэ graphic-ийг нэмэх"}
                >
                  <img
                    src={item.previewUrl}
                    alt={item.title}
                    className="h-16 w-full object-contain p-1 transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            {graphicItems.length === 0 && !graphicError && (
              <p className="mt-2 text-[11px] text-stone-500">
                {isDemoMode
                  ? "Search to load more graphics."
                  : "Хайлт хийгээд graphic-уудаа гаргаж ирнэ."}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() =>
              addElement(selectedPageId, "sticker", POLAROID_STICKER_TOKEN)
            }
            className="w-full rounded-lg border border-stone-200 bg-white p-2 text-left hover:bg-rose-50"
          >
            <p className="mb-2 text-xs font-medium text-stone-600">
              {isDemoMode ? "Add photo frame" : "Полароид стикер нэмэх"}
            </p>
            <div className="mx-auto h-20 w-16 rounded-sm border border-[#e6dfd5] bg-[#fbf8f1] p-1 shadow-md">
              <div className="h-full w-full rounded-[2px] border border-black/10 bg-linear-to-br from-stone-200 to-stone-300" />
            </div>
          </button>
          <div className="grid grid-cols-4 gap-0.5 sm:grid-cols-5 sm:gap-1">
            {STICKERS.map((sticker) => (
              <button
                key={sticker}
                type="button"
                onClick={() => addElement(selectedPageId, "sticker", sticker)}
                className="p-1 text-2xl transition-transform hover:scale-125"
              >
                {sticker}
              </button>
            ))}
          </div>
        </div>
      )}

      <AccordionTrigger
        id="pageStyle"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Palette}
        label={isDemoMode ? "Page style" : "Хуудасны загвар"}
      />
      {openAccordion === "pageStyle" && (
        <div className="mb-2 space-y-4 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div>
            <p className="mb-2 text-xs text-stone-500">
              {isDemoMode ? "Page background color" : "Дэвсгэр өнгө"}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorValue}
                onChange={(e) =>
                  updatePageBackground(selectedPageId, e.target.value)
                }
                className="h-10 w-full cursor-pointer rounded-lg border border-stone-200 bg-white p-1"
              />
              <button
                type="button"
                onClick={async () => {
                  const c = await pickColorFromScreen();
                  if (c) updatePageBackground(selectedPageId, c);
                }}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                title={isDemoMode ? "Pick color from screen" : "Зурагнаас өнгө авах"}
              >
                <Pipette size={16} />
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-500">
              Page background image
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-rose-50">
                Choose image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    handlePageBackgroundImageUpload(selectedPageId, e)
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => updatePageBackgroundImage(selectedPageId, "")}
                disabled={!selectedPageBgImage}
                className="min-h-11 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-500">
              {isDemoMode ? "Website background color" : "Үндсэн дэвсгэр өнгө"}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={appBackgroundColor}
                onChange={(e) => setAppBackgroundColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border border-stone-200 bg-white p-1"
              />
              <button
                type="button"
                onClick={async () => {
                  const c = await pickColorFromScreen();
                  if (c) setAppBackgroundColor(c);
                }}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                title={isDemoMode ? "Pick color from screen" : "Зурагнаас өнгө авах"}
              >
                <Pipette size={16} />
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-500">
              App background image
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-rose-50">
                Choose image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAppBackgroundImageUpload}
                />
              </label>
              <button
                type="button"
                onClick={() => setAppBackgroundImageUrl("")}
                disabled={!appBackgroundImageUrl}
                className="min-h-11 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-500">
              {isDemoMode ? "Pattern" : "Хээ"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {patterns.map(({ name, value }) => (
                <button
                  key={value || "none"}
                  type="button"
                  onClick={() => updatePagePattern(selectedPageId, value)}
                  className={`rounded-lg border px-3 py-2 text-xs ${pages.find((p) => p.id === selectedPageId)?.pattern === value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-stone-600"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <AccordionTrigger
        id="bookEffects"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Palette}
        label={isDemoMode ? "Background music" : "Арын хөгжим"}
      />
      {openAccordion === "bookEffects" && (
        <div className="mb-2 space-y-4 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div>
            <p className="mb-2 text-xs text-stone-500">
              {isDemoMode ? "Background music (YouTube link)" : "Арын хөгжим (YouTube линк)"}
            </p>
            <input
              type="url"
              value={backgroundMusicUrl}
              onChange={(e) => setBackgroundMusicUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <p className="mt-1 text-[11px] text-stone-500">
              {isDemoMode
                ? "Paste a YouTube music link. In demo mode this does not save publicly."
                : "Youtube-ээс дууны линкийг хуулж оруулна уу."}
            </p>
            <button
              type="button"
              onClick={saveMusicLink}
              className="mt-2 rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900"
            >
              {isDemoMode ? "Preview music" : "Линк хадгалах"}
            </button>
          </div>
        </div>
      )}

      <AccordionTrigger
        id="selection"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={MousePointerClick}
        label={isDemoMode ? "Selected item" : "Сонгосон элемент"}
        disabled={!selectedElementId}
      />
      {openAccordion === "selection" && selectedElementId && selectedEl && (
        <div className="mb-2 space-y-4 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          {selectedEl.type === "text" && (
            <>
              <div>
                <p className="mb-2 text-xs text-stone-500">
                  {isDemoMode ? "Text" : "Текст"}
                </p>
                <textarea
                  value={selectedEl.content}
                  onChange={(e) =>
                    updateElement(selectedPageId, {
                      ...selectedEl,
                      content: e.target.value,
                    })
                  }
                  rows={4}
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
              <div>
                <p className="mb-2 text-xs text-stone-500">
                  {isDemoMode ? "Text color" : "Текстийн өнгө"}
                </p>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="color"
                    value={toHexInputValue(selectedEl.color, "#333333")}
                    onChange={(e) =>
                      updateElement(selectedPageId, {
                        ...selectedEl,
                        color: e.target.value,
                      })
                    }
                    className="h-9 w-full cursor-pointer rounded-lg border border-stone-200 bg-white p-1"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const c = await pickColorFromScreen();
                      if (!c) return;
                      updateElement(selectedPageId, {
                        ...selectedEl,
                        color: c,
                      });
                    }}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                    title={isDemoMode ? "Pick color from screen" : "Зурагнаас өнгө авах"}
                  >
                    <Pipette size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    "#333333",
                    "#e11d48",
                    "#d97706",
                    "#059669",
                    "#2563eb",
                    "#7c3aed",
                    "#ffffff",
                  ].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() =>
                        updateElement(selectedPageId, { ...selectedEl, color })
                      }
                      className={`h-8 w-8 rounded-full border-2 ${selectedEl.color === color ? "border-stone-800" : "border-stone-200"}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs text-stone-500">
                  {isDemoMode ? "Font" : "Фонтын төрөл"}
                </p>
                <select
                  value={selectedEl.fontFamily || "var(--font-handwriting)"}
                  onChange={(e) =>
                    updateElement(selectedPageId, {
                      ...selectedEl,
                      fontFamily: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {fonts.map((font) => (
                    <option
                      key={font.name}
                      value={font.value}
                      style={{ fontFamily: font.value }}
                    >
                      {font.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-2 text-xs text-stone-500">
                  {isDemoMode ? "Text style" : "Текстийн хэв маяг"}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selectedPageId, {
                        ...selectedEl,
                        fontWeight:
                          selectedEl.fontWeight === "bold" ? "normal" : "bold",
                      })
                    }
                    className={`rounded-lg border px-3 py-2 text-sm ${selectedEl.fontWeight === "bold" ? "border-rose-500 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-stone-700"}`}
                  >
                    <span className="font-bold">B</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selectedPageId, {
                        ...selectedEl,
                        fontStyle:
                          selectedEl.fontStyle === "italic"
                            ? "normal"
                            : "italic",
                      })
                    }
                    className={`rounded-lg border px-3 py-2 text-sm ${selectedEl.fontStyle === "italic" ? "border-rose-500 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-stone-700"}`}
                  >
                    <span className="italic">I</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selectedPageId, {
                        ...selectedEl,
                        textDecoration:
                          selectedEl.textDecoration === "underline"
                            ? "none"
                            : "underline",
                      })
                    }
                    className={`rounded-lg border px-3 py-2 text-sm ${selectedEl.textDecoration === "underline" ? "border-rose-500 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-stone-700"}`}
                  >
                    <span className="underline">U</span>
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs text-stone-500">
                  {isDemoMode ? "Text size" : "Текстийн хэмжээ"}
                </p>
                <input
                  type="range"
                  min="12"
                  max="96"
                  value={selectedEl.fontSize || 32}
                  onChange={(e) =>
                    updateElement(
                      selectedPageId,
                      { ...selectedEl, fontSize: parseInt(e.target.value, 10) },
                      false,
                    )
                  }
                  onPointerUp={() => updatePagesWithHistory(pages)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-stone-200 accent-rose-500"
                />
              </div>
              <div>
                <p className="mb-2 text-xs text-stone-500">
                  {isDemoMode ? "Text effect" : "Текстийн эффект"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {textEffects.map((effect) => (
                    <button
                      key={effect.name}
                      type="button"
                      onClick={() =>
                        updateElement(selectedPageId, {
                          ...selectedEl,
                          textEffect: effect.value,
                        })
                      }
                      className={`rounded-lg border px-3 py-2 text-xs ${selectedEl.textEffect === effect.value ? "border-rose-500 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-stone-600"}`}
                    >
                      {effect.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <p className="mb-2 text-xs text-stone-500">
              {isDemoMode ? "Rotate" : "Эргүүлэх"}
            </p>
            <input
              type="range"
              min="-180"
              max="180"
              value={selectedEl.rotation || 0}
              onChange={(e) =>
                updateElement(
                  selectedPageId,
                  {
                    ...selectedEl,
                    rotation: parseInt(e.target.value, 10),
                  },
                  false,
                )
              }
              onPointerUp={() => updatePagesWithHistory(pages)}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-stone-200 accent-rose-500"
            />
          </div>

          <div>
            <p className="mb-2 text-xs text-stone-500">
              {isDemoMode ? "Width / size" : "Өргөн"}
            </p>
            <input
              type="range"
              min={
                selectedEl.type === "image" ||
                selectedEl.type === "video" ||
                selectedEl.type === "text"
                  ? "50"
                  : "16"
              }
              max={
                selectedEl.type === "image" ||
                selectedEl.type === "video" ||
                selectedEl.type === "text" ||
                selectedEl.content === POLAROID_STICKER_TOKEN
                  ? "500"
                  : "128"
              }
              value={
                selectedEl.type === "image" ||
                selectedEl.type === "video" ||
                selectedEl.type === "text" ||
                selectedEl.content === POLAROID_STICKER_TOKEN
                  ? selectedEl.width || 192
                  : selectedEl.fontSize || 32
              }
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (
                  selectedEl.type === "image" ||
                  selectedEl.type === "video" ||
                  selectedEl.type === "text" ||
                  selectedEl.content === POLAROID_STICKER_TOKEN
                ) {
                  updateElement(
                    selectedPageId,
                    { ...selectedEl, width: v },
                    false,
                  );
                } else {
                  updateElement(
                    selectedPageId,
                    { ...selectedEl, fontSize: v },
                    false,
                  );
                }
              }}
              onPointerUp={() => updatePagesWithHistory(pages)}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-stone-200 accent-rose-500"
            />
          </div>
          {(selectedEl.type === "image" ||
            selectedEl.type === "video" ||
            selectedEl.type === "text" ||
            selectedEl.content === POLAROID_STICKER_TOKEN) && (
            <div>
              <p className="mb-2 text-xs text-stone-500">
                {isDemoMode ? "Height" : "Өндөр"}
              </p>
              <input
                type="range"
                min="50"
                max="500"
                value={selectedEl.height || 192}
                onChange={(e) =>
                  updateElement(
                    selectedPageId,
                    { ...selectedEl, height: parseInt(e.target.value, 10) },
                    false,
                  )
                }
                onPointerUp={() => updatePagesWithHistory(pages)}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-stone-200 accent-rose-500"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => deleteElement(selectedPageId, selectedElementId)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 py-2 px-4 text-red-600 hover:bg-red-100"
          >
            <Trash2 size={16} />
            {isDemoMode ? "Delete item" : "Элемент устгах"}
          </button>
        </div>
      )}

      <AccordionTrigger
        id="pages"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Files}
        label={isDemoMode ? "Pages" : "Хуудсууд"}
      />
      {openAccordion === "pages" && (
        <div className="mb-2 space-y-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <button
            type="button"
            onClick={() => removePage(selectedPageId)}
            disabled={pages.length <= 2}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 py-3 px-4 font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-50"
          >
            <Trash2 size={18} />
            {isDemoMode ? "Delete this page" : "Энэ хуудсыг устгах"}
          </button>
          <button
            type="button"
            onClick={addPagesPair}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-100 py-3 px-4 font-medium text-stone-700 hover:bg-stone-200"
          >
            <Plus size={18} />
            {isDemoMode ? "Add new pages" : "Шинэ хуудас нэмэх"}
          </button>
        </div>
      )}
    </div>
  );
}
