import type { PageData } from "./scrapbookShare";

// Autosaves the demo sandbox's in-progress edits (including any uploaded
// photos/videos) to this browser's own IndexedDB, so an accidental refresh
// or dropped connection doesn't throw away what a visitor was making.
// Entirely local to this device — never touches the server, never affects
// what any other visitor sees on the shared /?share=test link, and expires
// after a day so it doesn't linger forever.

const DB_NAME = "scrapbook-demo-local";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const BLOB_STORE = "blobs";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DemoSnapshot {
  pages: PageData[];
  backgroundMusicUrl: string;
  appBackgroundImageUrl: string;
  appBackgroundColor: string;
}

interface StoredSnapshot extends DemoSnapshot {
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function isBlobUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("blob:");
}

// The handful of fields anywhere in a page/element that can hold a local
// blob: preview — photos, videos, whole-page ink, and per-photo ink overlays.
function collectBlobUrls(pages: PageData[], extras: (string | undefined)[]): Set<string> {
  const urls = new Set<string>();
  for (const u of extras) if (isBlobUrl(u)) urls.add(u);
  for (const p of pages) {
    if (isBlobUrl(p.backgroundImage)) urls.add(p.backgroundImage as string);
    if (isBlobUrl(p.drawing)) urls.add(p.drawing as string);
    for (const el of p.elements) {
      if (isBlobUrl(el.content)) urls.add(el.content);
      if (isBlobUrl(el.frameImage)) urls.add(el.frameImage as string);
      if (isBlobUrl(el.drawingOverlay)) urls.add(el.drawingOverlay as string);
    }
  }
  return urls;
}

function rewritePages(pages: PageData[], map: Map<string, string>): PageData[] {
  const swap = (v: string | undefined) =>
    v && map.has(v) ? map.get(v) : v;
  return pages.map((p) => ({
    ...p,
    backgroundImage: swap(p.backgroundImage),
    drawing: swap(p.drawing),
    elements: p.elements.map((el) => ({
      ...el,
      content: swap(el.content) ?? el.content,
      frameImage: swap(el.frameImage),
      drawingOverlay: swap(el.drawingOverlay),
    })),
  }));
}

/**
 * Saves the current demo state, including the actual bytes behind any
 * blob: preview (fetched back into a real Blob so it survives a reload —
 * the blob: URL itself would not). One snapshot per demo id; the blob
 * store is cleared and rebuilt each save, which is correct as long as
 * there's a single demo id ("test") sharing it.
 */
export async function saveDemoSnapshot(
  id: string,
  snapshot: DemoSnapshot,
): Promise<void> {
  const blobUrls = collectBlobUrls(snapshot.pages, [
    snapshot.appBackgroundImageUrl,
    snapshot.backgroundMusicUrl,
  ]);
  const entries: [string, Blob][] = [];
  await Promise.all(
    Array.from(blobUrls).map(async (url) => {
      try {
        const res = await fetch(url);
        entries.push([url, await res.blob()]);
      } catch {
        // Already revoked (e.g. swapped for a hosted URL mid-flight) —
        // just skip it, the rest of the book still saves fine.
      }
    }),
  );
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOT_STORE, BLOB_STORE], "readwrite");
    const blobStore = tx.objectStore(BLOB_STORE);
    blobStore.clear();
    for (const [url, blob] of entries) blobStore.put(blob, url);
    const record: StoredSnapshot = { ...snapshot, savedAt: Date.now() };
    tx.objectStore(SNAPSHOT_STORE).put(record, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function clearDemoSnapshot(id: string, db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOT_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(SNAPSHOT_STORE).delete(id);
    tx.objectStore(BLOB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Loads a still-fresh (<24h old) snapshot for this demo id, rehydrating
 * every stored blob back into a brand-new blob: URL. Returns null (and
 * quietly wipes the stale record) if there's nothing saved or it's expired.
 */
export async function loadDemoSnapshot(
  id: string,
): Promise<DemoSnapshot | null> {
  const db = await openDb();
  try {
    const record = await new Promise<StoredSnapshot | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, "readonly");
        const req = tx.objectStore(SNAPSHOT_STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      },
    );
    if (!record || typeof record.savedAt !== "number") return null;
    if (Date.now() - record.savedAt > MAX_AGE_MS) {
      await clearDemoSnapshot(id, db);
      return null;
    }

    const blobUrls = collectBlobUrls(record.pages, [
      record.appBackgroundImageUrl,
      record.backgroundMusicUrl,
    ]);
    const map = new Map<string, string>();
    await new Promise<void>((resolve) => {
      if (blobUrls.size === 0) return resolve();
      const tx = db.transaction(BLOB_STORE, "readonly");
      const store = tx.objectStore(BLOB_STORE);
      let pending = blobUrls.size;
      for (const url of blobUrls) {
        const req = store.get(url);
        req.onsuccess = () => {
          if (req.result instanceof Blob) {
            map.set(url, URL.createObjectURL(req.result));
          }
          if (--pending === 0) resolve();
        };
        req.onerror = () => {
          if (--pending === 0) resolve();
        };
      }
    });

    return {
      pages: rewritePages(record.pages, map),
      backgroundMusicUrl: map.get(record.backgroundMusicUrl) ?? record.backgroundMusicUrl ?? "",
      appBackgroundImageUrl:
        map.get(record.appBackgroundImageUrl) ?? record.appBackgroundImageUrl ?? "",
      appBackgroundColor: record.appBackgroundColor,
    };
  } finally {
    db.close();
  }
}
