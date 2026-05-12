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

const hasR2Config =
  R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET;
const MAX_SHARE_BYTES = 15 * 1024 * 1024;
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

function currentMediaBytes(shareData) {
  const n = Number(shareData?.mediaBytes || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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

  const img = sharp(inputBuffer, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const maxSide = options.hd ? 2560 : 1920;
  const resized = img.resize({
    width: meta.width && meta.width > maxSide ? maxSide : undefined,
    height: meta.height && meta.height > maxSide ? maxSide : undefined,
    fit: "inside",
    withoutEnlargement: true,
  });
  const avif = await resized
    .avif({ quality: options.hd ? 58 : 45, effort: 6 })
    .toBuffer();
  const webp = await resized
    .webp({ quality: options.hd ? 82 : 68, effort: 5 })
    .toBuffer();
  if (avif.length <= webp.length) {
    return {
      body: avif,
      contentType: "image/avif",
      ext: ".avif",
    };
  }
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
      "scale=min(1280\\,iw):-2:flags=lanczos",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-maxrate",
      "1400k",
      "-bufsize",
      "2800k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
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
    let editUntil = null;
    if (
      typeof editDays === "number" &&
      Number.isFinite(editDays) &&
      editDays > 0
    ) {
      const days = Math.min(Math.max(1, Math.floor(editDays)), maxDays);
      editUntil = new Date(Date.now() + days * 86400000).toISOString();
    }
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
      ...(editUntil ? { editUntil } : {}),
    };
    await persistShare(id, payload);
    res.json({ id, ...(editUntil ? { editUntil } : {}) });
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
    const { v, pages, musicUrl, appBackgroundImage } = req.body;
    if (v !== 1 || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "Expected { v: 1, pages: [...] }" });
    }
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
    };
    await persistShare(id, payload);
    res.json({ ok: true, existed: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/share/:id", async (req, res) => {
  const record = await loadShareOrNull(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "not found" });
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

    const mediaBytes = currentMediaBytes(prev);
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
        ? { appBackgroundImage: appBackgroundImage.trim() }
        : typeof prev?.appBackgroundImage === "string"
          ? { appBackgroundImage: prev.appBackgroundImage }
          : {}),
      ...(editUntil ? { editUntil } : {}),
    };
    await persistShare(req.params.id, payload);
    res.json({ ok: true });
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
      const mediaBytes = currentMediaBytes(record.data);
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
