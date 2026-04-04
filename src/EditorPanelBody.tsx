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
const PATTERNS = ["pattern-polka", "pattern-grid", "pattern-lines", ""];
const FONTS = [
  { name: "Гар бичмэл", value: "var(--font-handwriting)" },
  { name: "Санс сериф", value: "var(--font-sans)" },
  { name: "Pacifico", value: "var(--font-pacifico)" },
  { name: "Amatic", value: "var(--font-amatic)" },
  { name: "Indie", value: "var(--font-indie)" },
];
const TEXT_EFFECTS = [
  { name: "Байхгүй", value: "none" },
  { name: "Сүүдэр", value: "shadow" },
  { name: "Хүрээ", value: "outline" },
  { name: "Гэрэлтэлт", value: "glow" },
];

const GIPHY_PUBLIC_BETA_KEY = "dc6zaTOxFJmzC";
const TENOR_PUBLIC_KEY = "LIVDSRZULELA";

type GifPick = {
  id: string;
  previewUrl: string;
  fullUrl: string;
  title: string;
};

export function EditorPanelBody({
  selectedPageId,
  selectedElementId,
  pages,
  openAccordion,
  setOpenAccordion,
  appBackgroundColor,
  setAppBackgroundColor,
  backgroundMusicUrl,
  setBackgroundMusicUrl,
  saveMusicLink,
  addElement,
  handleImageUpload,
  handleVideoUpload,
  updatePageBackground,
  updatePagePattern,
  updateElement,
  updatePagesWithHistory,
  deleteElement,
  removePage,
  addPagesPair,
}: {
  selectedPageId: string | null;
  selectedElementId: string | null;
  pages: PageData[];
  openAccordion: EditorAccordionId | null;
  setOpenAccordion: Dispatch<SetStateAction<EditorAccordionId | null>>;
  appBackgroundColor: string;
  setAppBackgroundColor: (v: string) => void;
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
  updatePageBackground: (pageId: string, bg: string) => void;
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
        setGifError("GIF олдсонгүй. Өөр түлхүүр үг туршаарай.");
      }
    } catch {
      setGifError("Одоогоор GIF хайж чадсангүй.");
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
      setGifError("Зөв GIF URL оруулна уу (https://...)");
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

  if (!selectedPageId) {
    return (
      <p className="py-8 text-center text-sm text-stone-500">
        Засах хуудсаа нээгээд сонгоно уу.
      </p>
    );
  }

  const selectedEl = pages
    .flatMap((p) => p.elements)
    .find((e) => e.id === selectedElementId);
  const selectedPageBg = pages.find((p) => p.id === selectedPageId)?.background || "";
  const colorValue =
    /^#[0-9a-f]{6}$/i.test(selectedPageBg)
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

  return (
    <div className="space-y-2">
      <AccordionTrigger
        id="text"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Type}
        label="Текст"
      />
      {openAccordion === "text" && (
        <div className="mb-2 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <button
            type="button"
            onClick={() => {
              addElement(
                selectedPageId,
                "text",
                "Текстээ энд бичнэ үү",
                { width: 260, height: 120 },
              );
            }}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white py-4 hover:bg-rose-50"
          >
            <Type size={22} />
            <span className="text-sm font-medium">Текст нэмэх</span>
          </button>
        </div>
      )}

      <AccordionTrigger
        id="photo"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={ImageIcon}
        label="Зураг"
      />
      {openAccordion === "photo" && (
        <div className="mb-2 space-y-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white py-4 hover:bg-rose-50">
              <ImageIcon size={22} />
              <span className="text-sm font-medium">Зураг оруулах</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageUpload(selectedPageId, e)}
              />
            </label>
            <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white py-4 hover:bg-rose-50">
              <ImageIcon size={22} />
              <span className="text-sm font-medium">Видео оруулах</span>
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
              GIF линк оруулах
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
                Нэмэх
              </button>
            </div>
              <p className="mb-2 text-xs font-medium text-stone-600">
              GIF хайх (GIPHY / Tenor)
            </p>
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                value={gifQuery}
                onChange={(e) => setGifQuery(e.target.value)}
                onKeyDown={onGifQueryKeyDown}
                placeholder="хайр, төрсөн өдөр, цэцэг..."
                className="min-w-0 flex-1 rounded-md border border-stone-200 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                onClick={() => void searchGifs()}
                disabled={gifLoading || !gifQuery.trim()}
                className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {gifLoading ? "..." : "Хайх"}
              </button>
            </div>
            {gifError && <p className="mb-2 text-[11px] text-rose-600">{gifError}</p>}
            {gifResults.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => addElement(selectedPageId, "image", gif.fullUrl)}
                    className="group overflow-hidden rounded-md border border-stone-200 bg-stone-100 hover:border-rose-300"
                    title="Энэ GIF-ийг нэмэх"
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
        label="Стикер"
      />
      {openAccordion === "stickers" && (
        <div className="mb-2 space-y-3 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <button
            type="button"
            onClick={() =>
              addElement(selectedPageId, "sticker", POLAROID_STICKER_TOKEN)
            }
            className="w-full rounded-lg border border-stone-200 bg-white p-2 text-left hover:bg-rose-50"
          >
            <p className="mb-2 text-xs font-medium text-stone-600">
              Полароид стикер нэмэх
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
                onClick={() =>
                  addElement(selectedPageId, "sticker", sticker)
                }
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
        label="Хуудасны загвар"
      />
      {openAccordion === "pageStyle" && (
        <div className="mb-2 space-y-4 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div>
            <p className="mb-2 text-xs text-stone-500">Дэвсгэр өнгө</p>
            <input
              type="color"
              value={colorValue}
              onChange={(e) => updatePageBackground(selectedPageId, e.target.value)}
              className="h-10 w-full cursor-pointer rounded-lg border border-stone-200 bg-white p-1"
            />
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-500">Үндсэн дэвсгэр өнгө</p>
            <input
              type="color"
              value={appBackgroundColor}
              onChange={(e) => setAppBackgroundColor(e.target.value)}
              className="h-10 w-full cursor-pointer rounded-lg border border-stone-200 bg-white p-1"
            />
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-500">Хээ</p>
            <div className="grid grid-cols-2 gap-2">
              {PATTERNS.map((pattern) => (
                <button
                  key={pattern}
                  type="button"
                  onClick={() => updatePagePattern(selectedPageId, pattern)}
                  className={`rounded-lg border px-3 py-2 text-xs ${pages.find((p) => p.id === selectedPageId)?.pattern === pattern ? "border-rose-500 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-stone-600"}`}
                >
                  {pattern || "Байхгүй"}
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
        label="Арын хөгжим"
      />
      {openAccordion === "bookEffects" && (
        <div className="mb-2 space-y-4 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          <div>
            <p className="mb-2 text-xs text-stone-500">Арын хөгжим (YouTube линк)</p>
            <input
              type="url"
              value={backgroundMusicUrl}
              onChange={(e) => setBackgroundMusicUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <p className="mt-1 text-[11px] text-stone-500">
              Эхний товшилт/хүрэлтээс хойш тоглоно. Үндсэн дуу 50%, видеоны дууг
              нээхэд 20% болно.
            </p>
            <button
              type="button"
              onClick={saveMusicLink}
              className="mt-2 rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900"
            >
              Линк хадгалах
            </button>
          </div>
        </div>
      )}

      <AccordionTrigger
        id="selection"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={MousePointerClick}
        label="Сонгосон элемент"
        disabled={!selectedElementId}
      />
      {openAccordion === "selection" && selectedElementId && selectedEl && (
        <div className="mb-2 space-y-4 rounded-xl border border-stone-100 bg-stone-50/80 p-3">
          {selectedEl.type === "text" && (
            <>
              <div>
                <p className="mb-2 text-xs text-stone-500">Текст</p>
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
                <p className="mb-2 text-xs text-stone-500">Текстийн өнгө</p>
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
                <p className="mb-2 text-xs text-stone-500">Фонтын төрөл</p>
                <select
                  value={
                    selectedEl.fontFamily || "var(--font-handwriting)"
                  }
                  onChange={(e) =>
                    updateElement(selectedPageId, {
                      ...selectedEl,
                      fontFamily: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {FONTS.map((font) => (
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
                <p className="mb-2 text-xs text-stone-500">Текстийн хэв маяг</p>
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
                <p className="mb-2 text-xs text-stone-500">Текстийн хэмжээ</p>
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
                <p className="mb-2 text-xs text-stone-500">Текстийн эффект</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEXT_EFFECTS.map((effect) => (
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
            <p className="mb-2 text-xs text-stone-500">Эргүүлэх</p>
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
            <p className="mb-2 text-xs text-stone-500">Өргөн</p>
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
              <p className="mb-2 text-xs text-stone-500">Өндөр</p>
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
            onClick={() =>
              deleteElement(selectedPageId, selectedElementId)
            }
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 py-2 px-4 text-red-600 hover:bg-red-100"
          >
            <Trash2 size={16} />
            Элемент устгах
          </button>
        </div>
      )}

      <AccordionTrigger
        id="pages"
        openId={openAccordion}
        setOpenId={setOpenAccordion}
        icon={Files}
        label="Хуудсууд"
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
            Энэ хуудсыг устгах
          </button>
          <button
            type="button"
            onClick={addPagesPair}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-100 py-3 px-4 font-medium text-stone-700 hover:bg-stone-200"
          >
            <Plus size={18} />
            Шинэ хуудас нэмэх
          </button>
        </div>
      )}
    </div>
  );
}
