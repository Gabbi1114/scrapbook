import LZString from "lz-string";

/** Hash format: #s=<lz-string payload> */
export const SHARE_HASH_PREFIX = "s=";

/** Stay under common browser / server URL limits when possible */
export const MAX_SHARE_HASH_CHARS = 55_000;

export type ElementType = "image" | "text" | "sticker";

export interface PageElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  rotation: number;
  content: string;
  color?: string;
  fontSize?: number;
  width?: number;
  height?: number;
  fontFamily?: string;
  textEffect?: string;
}

export interface PageData {
  id: string;
  background: string;
  pattern: string;
  elements: PageElement[];
}

interface PayloadV1 {
  v: 1;
  pages: PageData[];
}

/** Validate `{ v: 1, pages }` from API, file import, or hash JSON. */
export function parsePayloadV1(raw: unknown): PageData[] | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as PayloadV1;
  if (data.v !== 1 || !Array.isArray(data.pages)) return null;
  const pages: PageData[] = [];
  for (const page of data.pages) {
    const parsed = parsePage(page);
    if (parsed) pages.push(parsed);
  }
  return pages.length > 0 ? pages : null;
}

function isElementType(t: unknown): t is ElementType {
  return t === "image" || t === "text" || t === "sticker";
}

function parseElement(raw: unknown): PageElement | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !isElementType(e.type)) return null;
  if (typeof e.x !== "number" || typeof e.y !== "number") return null;
  if (typeof e.rotation !== "number" || typeof e.content !== "string")
    return null;
  const out: PageElement = {
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    rotation: e.rotation,
    content: e.content,
  };
  if (typeof e.color === "string") out.color = e.color;
  if (typeof e.fontSize === "number") out.fontSize = e.fontSize;
  if (typeof e.width === "number") out.width = e.width;
  if (typeof e.height === "number") out.height = e.height;
  if (typeof e.fontFamily === "string") out.fontFamily = e.fontFamily;
  if (typeof e.textEffect === "string") out.textEffect = e.textEffect;
  return out;
}

function parsePage(raw: unknown): PageData | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string") return null;
  if (typeof p.background !== "string") return null;
  if (typeof p.pattern !== "string") return null;
  if (!Array.isArray(p.elements)) return null;
  const elements: PageElement[] = [];
  for (const el of p.elements) {
    const parsed = parseElement(el);
    if (parsed) elements.push(parsed);
  }
  return { id: p.id, background: p.background, pattern: p.pattern, elements };
}

export function parsePagesFromHash(hash: string): PageData[] | null {
  if (!hash || hash === "#") return null;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body.startsWith(SHARE_HASH_PREFIX)) return null;
  const encoded = body.slice(SHARE_HASH_PREFIX.length);
  if (!encoded) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const data = JSON.parse(json) as unknown;
    return parsePayloadV1(data);
  } catch {
    return null;
  }
}

export function buildShareHash(pages: PageData[]): string {
  const payload: PayloadV1 = { v: 1, pages };
  const json = JSON.stringify(payload);
  return SHARE_HASH_PREFIX + LZString.compressToEncodedURIComponent(json);
}

export type ShareUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function tryBuildShareUrl(pages: PageData[]): ShareUrlResult {
  const hash = buildShareHash(pages);
  if (hash.length > MAX_SHARE_HASH_CHARS) {
    return {
      ok: false,
      reason:
        "This scrapbook is too large for a single link (often too many or too big photos). Try fewer images, smaller files, or host images online and paste URLs instead.",
    };
  }
  const path = typeof window !== "undefined" ? window.location.pathname || "/" : "/";
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return { ok: true, url: `${origin}${path}#${hash}` };
}

export const LOCAL_STORAGE_KEY = "scrapbook-draft-v1";

export function loadDraftFromStorage(): PageData[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    const pages: PageData[] = [];
    for (const page of data) {
      const parsed = parsePage(page);
      if (parsed) pages.push(parsed);
    }
    return pages.length > 0 ? pages : null;
  } catch {
    return null;
  }
}

export function saveDraftToStorage(pages: PageData[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(pages));
  } catch {
    /* quota or private mode */
  }
}

/** Download full scrapbook JSON (no size limit). */
export function downloadScrapbookFile(pages: PageData[]): void {
  const json = JSON.stringify({ v: 1, pages } as PayloadV1);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `scrapbook-${new Date().toISOString().slice(0, 10)}.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

export function parseScrapbookJsonText(text: string): PageData[] | null {
  try {
    return parsePayloadV1(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function shareApiBase(): string {
  const fromEnv = import.meta.env.VITE_SHARE_API as string | undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  return "";
}

/**
 * UI + client may create new share links (hash or POST /api/share).
 * Development: allowed for convenience. Production: only if VITE_ENABLE_PUBLISH_LINK=true (seller build).
 */
export function canPublishShareLinks(): boolean {
  if (import.meta.env.DEV) return true;
  return import.meta.env.VITE_ENABLE_PUBLISH_LINK === "true";
}

/** Fixed edit window for newly created share links: 5 days. */
export function editDaysForNewServerShare(): number | undefined {
  return 5;
}

export type SharedScrapbookBundle = {
  pages: PageData[];
  /** ISO8601 end of edit window, or null if unlimited / hash-only / legacy share */
  editUntil: string | null;
};

export function parseSharedScrapbookResponse(
  raw: unknown,
): SharedScrapbookBundle | null {
  const pages = parsePayloadV1(raw);
  if (!pages) return null;
  let editUntil: string | null = null;
  if (raw && typeof raw === "object") {
    const eu = (raw as Record<string, unknown>).editUntil;
    if (typeof eu === "string" && eu.length > 0) {
      const t = Date.parse(eu);
      if (!Number.isNaN(t)) editUntil = eu;
    }
  }
  return { pages, editUntil };
}

/** POST scrapbook to server; returns short id for `?share=id` links. */
export async function uploadPagesForShare(
  pages: PageData[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const base = shareApiBase();
  const url = `${base}/api/share`;
  const editDays = editDaysForNewServerShare();
  const requestPayload: PayloadV1 & { editDays?: number } = { v: 1, pages };
  if (editDays !== undefined) requestPayload.editDays = editDays;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const createSecret = import.meta.env.VITE_SHARE_CREATE_SECRET as
    | string
    | undefined;
  if (createSecret && createSecret.length > 0) {
    headers["X-Scrapbook-Create-Secret"] = createSecret;
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: t || r.statusText };
    }
    const json = (await r.json()) as { id?: string };
    if (!json.id) return { ok: false, error: "No id from server" };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function fetchSharedBundleById(
  id: string,
): Promise<SharedScrapbookBundle | null> {
  const base = shareApiBase();
  const url = `${base}/api/share/${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    return parseSharedScrapbookResponse(data);
  } catch {
    return null;
  }
}

/** Save edits back to the same shared id. Server enforces edit window. */
export async function saveSharedPagesById(
  id: string,
  pages: PageData[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = shareApiBase();
  const url = `${base}/api/share/${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, pages } as PayloadV1),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: t || r.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

type UploadUrlResponse = {
  uploadUrl: string;
  objectUrl: string;
};

/**
 * Upload image file into the share's own folder in cloud storage and return
 * a stable URL to store in page elements.
 */
export async function uploadImageFileForShare(
  shareId: string,
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const base = shareApiBase();
  const api = `${base}/api/share/${encodeURIComponent(shareId)}/upload-url`;
  try {
    const create = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name || "image",
        contentType: file.type || "application/octet-stream",
      }),
    });
    if (!create.ok) {
      const t = await create.text();
      return { ok: false, error: t || "Could not create upload URL" };
    }
    const body = (await create.json()) as UploadUrlResponse;
    if (!body.uploadUrl || !body.objectUrl) {
      return { ok: false, error: "Invalid upload response" };
    }
    const put = await fetch(body.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!put.ok) {
      const t = await put.text();
      return { ok: false, error: t || "Upload failed" };
    }
    return { ok: true, url: body.objectUrl };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** @deprecated Prefer fetchSharedBundleById when you need edit deadlines. */
export async function fetchSharedPagesById(
  id: string,
): Promise<PageData[] | null> {
  const b = await fetchSharedBundleById(id);
  return b?.pages ?? null;
}

export function buildShareUrlWithQueryId(id: string): string {
  const path = typeof window !== "undefined" ? window.location.pathname || "/" : "/";
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const u = new URL(origin + path);
  u.searchParams.set("share", id);
  return u.toString();
}

/** Share link: always prefer server random id; hash only as fallback. */
export async function resolveShareableUrl(
  pages: PageData[],
): Promise<
  | { kind: "hash"; url: string }
  | { kind: "server"; url: string }
  | { kind: "none"; reason: string }
> {
  if (!canPublishShareLinks()) {
    return {
      kind: "none",
      reason: "Publishing is disabled in this app build.",
    };
  }
  const hashTry = tryBuildShareUrl(pages);
  const up = await uploadPagesForShare(pages);
  if (up.ok) return { kind: "server", url: buildShareUrlWithQueryId(up.id) };
  if (hashTry.ok === true) return { kind: "hash", url: hashTry.url };
  if (up.ok === false) {
    return { kind: "none", reason: `${hashTry.reason} — ${up.error}` };
  }
  return { kind: "none", reason: "Unknown share error" };
}
