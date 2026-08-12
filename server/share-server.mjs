/**
 * Local share API: stores scrapbooks as JSON files so share links stay short
 * even with large base64 photos. Run via `npm run dev` (starts with Vite) or
 * `node server/share-server.mjs` alone on port 3001.
 */
import express from "express";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { promises as fsp } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import multer from "multer";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "share-data");
const PORT = Number(process.env.SHARE_SERVER_PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || "";
const STUDIO_ROOT_SHARE_ID = (
  process.env.STUDIO_ROOT_SHARE_ID ||
  process.env.VITE_STUDIO_ROOT_SHARE_ID ||
  "studio-root"
).trim();

const hasR2Config =
  R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET;
const MAX_SHARE_BYTES = 15 * 1024 * 1024; // matches box/book's per-share storage cap
const DEFAULT_EDIT_DAYS = 30; // matches book's default edit window
const MAX_VIDEO_SECONDS = 60;
const execFileAsync = promisify(execFile);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});
const r2 = hasR2Config
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "80mb" }));
app.use(express.urlencoded({ extended: true, limit: "80mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Scrapbook-Create-Secret",
  );
  if (req.method === "OPTIONS") return res.status(204).end();

  // Prevent all API responses from being cached by browsers or CDNs.
  if (req.path.startsWith("/api/")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }

  next();
});


function shareFilePath(id) {
  return path.join(DATA_DIR, `${path.basename(id)}.json`);
}

async function loadShareOrNull(id) {
  const safeId = path.basename(id);
  const file = shareFilePath(id);
  if (fs.existsSync(file)) {
    return {
      file,
      data: JSON.parse(fs.readFileSync(file, "utf8")),
    };
  }
  if (!r2) return null;
  try {
    const out = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: `shares/${safeId}.json` }),
    );
    if (!out.Body || typeof out.Body.transformToString !== "function") {
      return null;
    }
    const text = await out.Body.transformToString();
    const data = JSON.parse(text);
    fs.writeFileSync(file, text, "utf8");
    return { file, data };
  } catch {
    return null;
  }
}

async function persistShare(id, payload) {
  const file = shareFilePath(id);
  const text = JSON.stringify(payload);
  fs.writeFileSync(file, text, "utf8");
  if (!r2) return;
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: `shares/${path.basename(id)}.json`,
      ContentType: "application/json",
      Body: text,
    }),
  );
}

// ---------------------------------------------------------------------------
// Self-heal: if a share isn't on disk (or R2) yet, ask 56moments.store's main
// server whether this id was ever actually issued (paid for) before creating
// it here. Covers two real gaps: the background /ensure call that runs right
// after an order is approved can still be mid-retry (cold Render backend)
// when the customer clicks the link, or it can have exhausted its retries
// entirely — either way, without this, a link nobody did anything wrong to
// just 404s forever with "invalid or expired". A random unpaid id still gets
// rejected, since verify only returns true for ids that exist in a real order.
// ---------------------------------------------------------------------------
const MAIN_STORE_API_BASE = (
  process.env.MAIN_STORE_API_BASE || "https://56moments.store"
).replace(/\/$/, "");

function defaultScrapbookPayload() {
  return {
    v: 1,
    pages: [
      { id: "p1", background: "bg-rose-100", pattern: "pattern-polka", elements: [] },
    ],
  };
}

async function selfHealShare(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const r = await fetch(
      `${MAIN_STORE_API_BASE}/api/webcard-verify/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!r.ok) return null;
    const { valid } = await r.json();
    if (!valid) return null;
  } catch (e) {
    clearTimeout(timer);
    console.warn(`Self-heal verify failed for ${id}:`, e.message);
    return null;
  }
  const payload = { ...defaultScrapbookPayload(), mediaBytes: 0, editDays: DEFAULT_EDIT_DAYS, editUntil: null };
  await persistShare(id, payload);
  console.log(`Self-healed share ${id} (verified with main store, was never created here)`);
  return { file: shareFilePath(id), data: payload };
}

function currentMediaBytes(shareData) {
  const n = Number(shareData?.mediaBytes || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function currentMediaObjects(shareData) {
  const raw = shareData?.mediaObjects;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const bytes = Number(value);
    if (
      typeof key === "string" &&
      key.length > 0 &&
      !key.includes("..") &&
      Number.isFinite(bytes) &&
      bytes > 0
    ) {
      out[key] = Math.floor(bytes);
    }
  }
  return out;
}

function mediaKeyFromUrl(value, shareId) {
  if (typeof value !== "string" || !value.includes("/api/media/")) return null;
  const encoded = value.split("/api/media/")[1]?.split(/[?#]/)[0] || "";
  if (!encoded) return null;
  let key = "";
  try {
    key = decodeURIComponent(encoded);
  } catch {
    key = encoded;
  }
  const prefix = `${path.basename(shareId)}/`;
  if (!key.startsWith(prefix) || key.includes("..")) return null;
  return key;
}

function addMediaKey(keys, value, shareId) {
  const key = mediaKeyFromUrl(value, shareId);
  if (key) keys.add(key);
}

function collectReferencedMediaKeys(shareId, pages, appBackgroundImage) {
  const keys = new Set();
  addMediaKey(keys, appBackgroundImage, shareId);
  for (const page of Array.isArray(pages) ? pages : []) {
    addMediaKey(keys, page?.backgroundImage, shareId);
    addMediaKey(keys, page?.drawing, shareId);
    for (const el of Array.isArray(page?.elements) ? page.elements : []) {
      if (el?.type === "image" || el?.type === "video") {
        addMediaKey(keys, el.content, shareId);
      }
      addMediaKey(keys, el?.frameImage, shareId);
      addMediaKey(keys, el?.drawingOverlay, shareId);
    }
  }
  return keys;
}

async function hydrateMediaObjectsFromReferences(shareId, shareData) {
  const mediaObjects = currentMediaObjects(shareData);
  if (!r2) return mediaObjects;

  const referenced = collectReferencedMediaKeys(
    shareId,
    shareData?.pages,
    typeof shareData?.appBackgroundImage === "string"
      ? shareData.appBackgroundImage
      : "",
  );

  for (const key of referenced) {
    if (mediaObjects[key]) continue;
    try {
      const head = await r2.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      );
      const bytes = Number(head.ContentLength || 0);
      if (Number.isFinite(bytes) && bytes > 0) {
        mediaObjects[key] = Math.floor(bytes);
      }
    } catch (e) {
      console.warn(`Could not read media object size ${key}:`, e);
    }
  }

  return mediaObjects;
}

async function pruneUnusedMediaObjects(
  shareId,
  shareData,
  nextPages,
  appBackgroundImage,
) {
  const mediaObjects = await hydrateMediaObjectsFromReferences(
    shareId,
    shareData,
  );
  const referenced = collectReferencedMediaKeys(
    shareId,
    nextPages,
    appBackgroundImage,
  );
  let mediaBytes = Object.values(mediaObjects).reduce(
    (sum, bytes) => sum + bytes,
    0,
  );
  if (mediaBytes <= 0) {
    mediaBytes = currentMediaBytes(shareData);
  }

  if (!r2) {
    return { mediaObjects, mediaBytes };
  }

  for (const [key, bytes] of Object.entries(mediaObjects)) {
    if (referenced.has(key)) continue;
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      delete mediaObjects[key];
      mediaBytes = Math.max(0, mediaBytes - bytes);
    } catch (e) {
      console.warn(`Could not delete unused media object ${key}:`, e);
    }
  }

  return { mediaObjects, mediaBytes };
}

function pagesJsonBytes(pages) {
  return Buffer.byteLength(JSON.stringify({ v: 1, pages }), "utf8");
}

function isImageMime(m) {
  return typeof m === "string" && m.startsWith("image/");
}

function isVideoMime(m) {
  return typeof m === "string" && m.startsWith("video/");
}

async function convertImageForStorage(inputBuffer, mime, options = {}) {
  // Keep animated gifs as-is; converting often drops animation frames.
  if (mime === "image/gif") {
    return {
      body: inputBuffer,
      contentType: "image/gif",
      ext: ".gif",
    };
  }

  // WebP, not AVIF — AVIF at effort 4 was ~10x slower to encode than WebP
  // at effort 0 on Render's free-tier CPU, and that gap was most of what
  // made uploads feel slow next to something like Canva. WebP's smaller
  // file-size edge over AVIF isn't worth paying that encode time for here.
  const img = sharp(inputBuffer, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const maxSide = 1920;
  const resized = img.resize({
    width: meta.width && meta.width > maxSide ? maxSide : undefined,
    height: meta.height && meta.height > maxSide ? maxSide : undefined,
    fit: "inside",
    withoutEnlargement: true,
    kernel: sharp.kernel.lanczos3,
  });
  const webp = await resized
    .webp({ quality: options.hd ? 82 : 78, effort: 0 })
    .toBuffer();
  return {
    body: webp,
    contentType: "image/webp",
    ext: ".webp",
  };
}

function extFromMime(mime, fallback = ".bin") {
  const m = String(mime || "").toLowerCase();
  if (m === "image/webp") return ".webp";
  if (m === "image/avif") return ".avif";
  if (m === "image/png") return ".png";
  if (m === "image/jpeg") return ".jpg";
  if (m === "image/gif") return ".gif";
  if (m === "video/mp4") return ".mp4";
  if (m === "video/webm") return ".webm";
  if (m === "video/quicktime") return ".mov";
  return fallback;
}

async function transcodeVideoForStorage(inputBuffer, mime) {
  if (!ffmpegPath || !ffprobeStatic.path) {
    return {
      body: inputBuffer,
      contentType: mime || "application/octet-stream",
      ext: extFromMime(mime, ".mp4"),
    };
  }
  const tmpBase = path.join(
    os.tmpdir(),
    `scrapbook-video-${Date.now()}-${randomBytes(5).toString("hex")}`,
  );
  const inputPath = `${tmpBase}${extFromMime(mime, ".bin")}`;
  const outputPath = `${tmpBase}-out.mp4`;
  try {
    await fsp.writeFile(inputPath, inputBuffer);
    const probe = await execFileAsync(ffprobeStatic.path, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    const durationSec = Number.parseFloat((probe.stdout || "").trim());
    if (Number.isFinite(durationSec) && durationSec > MAX_VIDEO_SECONDS) {
      const err = new Error("Video exceeds 1 minute limit.");
      err.code = "VIDEO_TOO_LONG";
      throw err;
    }
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-t",
      String(MAX_VIDEO_SECONDS),
      "-vf",
      // Single-quoted min(...), not a backslash-escaped comma — the
      // backslash form got silently stripped by Node's argv handling when
      // tested on Windows, breaking ffmpeg's filter-graph parser. Single
      // quotes are ffmpeg's own filter-value quoting and aren't touched by
      // any OS/child_process layer — verified scale-down-only (never
      // upscales) on both landscape and portrait sources before shipping.
      "scale='min(720,iw)':-2:flags=fast_bilinear",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "32",
      "-maxrate",
      "700k",
      "-bufsize",
      "1400k",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);
    const out = await fsp.readFile(outputPath);
    return {
      body: out,
      contentType: "video/mp4",
      ext: ".mp4",
    };
  } finally {
    void fsp.unlink(inputPath).catch(() => {});
    void fsp.unlink(outputPath).catch(() => {});
  }
}

app.post("/api/share", async (req, res) => {
  try {
    const requiredSecret = process.env.SHARE_CREATE_SECRET;
    if (requiredSecret) {
      const sent = req.get("x-scrapbook-create-secret");
      if (sent !== requiredSecret) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    const { v, pages, editDays, musicUrl, appBackgroundImage } = req.body;
    if (v !== 1 || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "Expected { v: 1, pages: [...] }" });
    }
    const envMax = Number(process.env.SHARE_MAX_EDIT_DAYS);
    const maxDays =
      Number.isFinite(envMax) && envMax > 0
        ? Math.min(Math.floor(envMax), 3650)
        : 365;
    const days =
      typeof editDays === "number" && Number.isFinite(editDays) && editDays > 0
        ? Math.min(Math.max(1, Math.floor(editDays)), maxDays)
        : DEFAULT_EDIT_DAYS;
    const id = randomBytes(12).toString("base64url");
    const jsonBytes = pagesJsonBytes(pages);
    if (jsonBytes > MAX_SHARE_BYTES) {
      return res.status(413).json({
        error: "Share is too large. Limit is 15MB per link.",
      });
    }
    const payload = {
      v: 1,
      pages,
      mediaBytes: 0,
      ...(typeof musicUrl === "string" && musicUrl.trim()
        ? { musicUrl: musicUrl.trim() }
        : {}),
      ...(typeof appBackgroundImage === "string" && appBackgroundImage.trim()
        ? { appBackgroundImage: appBackgroundImage.trim() }
        : {}),
      editDays: days,
      // Starts counting down from first open, not creation — see GET below.
      editUntil: null,
    };
    await persistShare(id, payload);
    res.json({ id, editUntil: null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/share/:id/ensure", async (req, res) => {
  try {
    const requiredSecret = process.env.SHARE_CREATE_SECRET;
    if (requiredSecret) {
      const sent = req.get("x-scrapbook-create-secret");
      if (sent !== requiredSecret) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    const id = path.basename(String(req.params.id || ""));
    if (!id) {
      return res.status(400).json({ error: "invalid id" });
    }
    const existing = await loadShareOrNull(id);
    if (existing) {
      return res.json({ ok: true, existed: true });
    }
    const { v, pages, musicUrl, appBackgroundImage, editDays } = req.body;
    if (v !== 1 || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "Expected { v: 1, pages: [...] }" });
    }
    const envMax = Number(process.env.SHARE_MAX_EDIT_DAYS);
    const maxDays =
      Number.isFinite(envMax) && envMax > 0
        ? Math.min(Math.floor(envMax), 3650)
        : 365;
    const days =
      typeof editDays === "number" && Number.isFinite(editDays) && editDays > 0
        ? Math.min(Math.max(1, Math.floor(editDays)), maxDays)
        : DEFAULT_EDIT_DAYS;
    const jsonBytes = pagesJsonBytes(pages);
    if (jsonBytes > MAX_SHARE_BYTES) {
      return res.status(413).json({
        error: "Share is too large. Limit is 15MB per link.",
      });
    }
    const payload = {
      v: 1,
      pages,
      mediaBytes: 0,
      ...(typeof musicUrl === "string" && musicUrl.trim()
        ? { musicUrl: musicUrl.trim() }
        : {}),
      ...(typeof appBackgroundImage === "string" && appBackgroundImage.trim()
        ? { appBackgroundImage: appBackgroundImage.trim() }
        : {}),
      editDays: days,
      // Starts counting down from first open, not creation — see GET below.
      editUntil: null,
    };
    await persistShare(id, payload);
    res.json({ ok: true, existed: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/share/:id", async (req, res) => {
  let record = await loadShareOrNull(req.params.id);
  if (!record) record = await selfHealShare(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "not found" });
  }
  // First view starts the edit-window countdown, not creation time — so a
  // creator who hasn't shared the link yet isn't burning down their own
  // window. Matches box/book's deferred-start behavior.
  if (record.data.editUntil == null && record.data.editDays != null) {
    record.data.editUntil = new Date(
      Date.now() + record.data.editDays * 86400000,
    ).toISOString();
    await persistShare(req.params.id, record.data);
  }
  res.type("json").send(JSON.stringify(record.data));
});

app.put("/api/share/:id", async (req, res) => {
  try {
    const record = await loadShareOrNull(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "not found" });
    }

    const prev = record.data;
    const editUntil =
      typeof prev?.editUntil === "string" ? prev.editUntil : null;
    if (editUntil && Date.now() > Date.parse(editUntil)) {
      return res.status(403).json({ error: "edit window expired" });
    }

    const { v, pages, musicUrl, appBackgroundImage } = req.body;
    if (v !== 1 || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "Expected { v: 1, pages: [...] }" });
    }

    const nextAppBackgroundImage =
      typeof appBackgroundImage === "string"
        ? appBackgroundImage.trim()
        : typeof prev?.appBackgroundImage === "string"
          ? prev.appBackgroundImage
          : "";
    const prunedMedia = await pruneUnusedMediaObjects(
      req.params.id,
      prev,
      pages,
      nextAppBackgroundImage,
    );
    const mediaBytes = prunedMedia.mediaBytes;
    const jsonBytes = pagesJsonBytes(pages);
    if (jsonBytes + mediaBytes > MAX_SHARE_BYTES) {
      return res.status(413).json({
        error: "Share is too large. Limit is 15MB per link.",
      });
    }
    const payload = {
      v: 1,
      pages,
      mediaBytes,
      ...(typeof musicUrl === "string"
        ? { musicUrl: musicUrl.trim() }
        : typeof prev?.musicUrl === "string"
          ? { musicUrl: prev.musicUrl }
          : {}),
      ...(typeof appBackgroundImage === "string"
        ? { appBackgroundImage: nextAppBackgroundImage }
        : typeof prev?.appBackgroundImage === "string"
          ? { appBackgroundImage: prev.appBackgroundImage }
          : {}),
      mediaObjects: prunedMedia.mediaObjects,
      ...(editUntil ? { editUntil } : {}),
      ...(typeof prev?.editDays === "number" ? { editDays: prev.editDays } : {}),
    };
    await persistShare(req.params.id, payload);
    res.json({
      ok: true,
      bytesUsed: mediaBytes,
      bytesLimit: MAX_SHARE_BYTES,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/share/:id/finalize", async (req, res) => {
  try {
    const record = await loadShareOrNull(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "not found" });
    }
    const prev = record.data || {};
    const currentEditUntil =
      typeof prev.editUntil === "string" ? prev.editUntil : null;
    if (currentEditUntil && Date.now() > Date.parse(currentEditUntil)) {
      return res.json({ ok: true, editUntil: currentEditUntil });
    }
    const editUntil = new Date().toISOString();
    const payload = {
      ...prev,
      editUntil,
    };
    await persistShare(req.params.id, payload);
    res.json({ ok: true, editUntil });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post(
  "/api/share/:id/upload-media",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!r2) {
        return res.status(503).json({
          error:
            "R2 is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
        });
      }
      const record = await loadShareOrNull(req.params.id);
      if (!record) return res.status(404).json({ error: "share not found" });
      const editUntil =
        typeof record.data?.editUntil === "string"
          ? record.data.editUntil
          : null;
      if (editUntil && Date.now() > Date.parse(editUntil)) {
        return res.status(403).json({ error: "edit window expired" });
      }

      const file = req.file;
      if (!file?.buffer || file.buffer.length === 0) {
        return res.status(400).json({ error: "file is required" });
      }
      const mime = String(file.mimetype || "").toLowerCase();
      const uploadKind = String(req.body?.uploadKind || "").toLowerCase();
      const isBackgroundUpload = uploadKind === "background";
      let converted;
      if (isImageMime(mime)) {
        converted = await convertImageForStorage(file.buffer, mime, {
          hd: isBackgroundUpload,
        });
      } else if (isVideoMime(mime)) {
        try {
          converted = await transcodeVideoForStorage(file.buffer, mime);
        } catch (e) {
          if (e?.code === "VIDEO_TOO_LONG") {
            return res
              .status(413)
              .json({ error: "One video can be maximum 1 minute." });
          }
          throw e;
        }
      } else {
        return res.status(400).json({
          error: "Only image/video upload is supported.",
        });
      }
      const mediaObjects = await hydrateMediaObjectsFromReferences(
        req.params.id,
        record.data,
      );
      const trackedMediaBytes = Object.values(mediaObjects).reduce(
        (sum, bytes) => sum + bytes,
        0,
      );
      const mediaBytes =
        trackedMediaBytes > 0
          ? trackedMediaBytes
          : currentMediaBytes(record.data);
      const jsonBytes = pagesJsonBytes(record.data.pages || []);
      if (jsonBytes + mediaBytes + converted.body.length > MAX_SHARE_BYTES) {
        return res.status(413).json({
          error: "Storage limit reached (15MB per link).",
        });
      }

      const objectName = `${Date.now()}-${randomBytes(6).toString("hex")}${converted.ext}`;
      const key = `${path.basename(req.params.id)}/${objectName}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          ContentType: converted.contentType,
          Body: converted.body,
        }),
      );

      const updatedShare = {
        ...record.data,
        mediaBytes: mediaBytes + converted.body.length,
        mediaObjects: {
          ...mediaObjects,
          [key]: converted.body.length,
        },
      };
      await persistShare(req.params.id, updatedShare);

      const base = PUBLIC_API_BASE || `${req.protocol}://${req.get("host")}`;
      const objectUrl = `${base}/api/media/${encodeURIComponent(key)}`;
      res.json({
        objectUrl,
        key,
        bytesUsed: updatedShare.mediaBytes,
        bytesLimit: MAX_SHARE_BYTES,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  },
);

app.get("/api/media/:key(*)", async (req, res) => {
  try {
    if (!r2) return res.status(503).send("R2 not configured");
    const key = String(req.params.key || "");
    if (!key || key.includes("..")) return res.status(400).send("bad key");
    const out = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    if (out.ContentType) res.setHeader("Content-Type", out.ContentType);
    if (out.ContentLength) {
      res.setHeader("Content-Length", String(out.ContentLength));
    }
    // FIX-K: Cache media assets aggressively on the client and CDN.
    // Images/videos are content-addressed (keyed by timestamp+random hex),
    // so they are immutable once written. A 1-year cache eliminates repeated
    // fetches on page navigation — the #1 cause of memory spikes on iOS Safari
    // (each re-fetch decodes a fresh copy into the image cache).
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // FIX-K: Accept-Ranges lets Safari stream video with byte-range requests
    // instead of downloading the full file before playback begins.
    res.setHeader("Accept-Ranges", "bytes");
    if (!out.Body || typeof out.Body.pipe !== "function") {
      return res.status(404).send("not found");
    }
    out.Body.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(404).send("not found");
  }
});


app.listen(PORT, () => {
  console.log(
    `[scrapbook share] http://localhost:${PORT}  (POST /api/share, GET /api/share/:id)`,
  );
});
