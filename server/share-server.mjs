/**
 * Local share API: stores scrapbooks as JSON files so share links stay short
 * even with large base64 photos. Run via `npm run dev` (starts with Vite) or
 * `node server/share-server.mjs` alone on port 3001.
 */
import express from "express";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  R2_ENDPOINT &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_BUCKET;
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Scrapbook-Create-Secret");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function shareFilePath(id) {
  return path.join(DATA_DIR, `${path.basename(id)}.json`);
}

function loadShareOrNull(id) {
  const file = shareFilePath(id);
  if (!fs.existsSync(file)) return null;
  return {
    file,
    data: JSON.parse(fs.readFileSync(file, "utf8")),
  };
}

app.post("/api/share", (req, res) => {
  try {
    const requiredSecret = process.env.SHARE_CREATE_SECRET;
    if (requiredSecret) {
      const sent = req.get("x-scrapbook-create-secret");
      if (sent !== requiredSecret) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    const { v, pages, editDays } = req.body;
    if (v !== 1 || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "Expected { v: 1, pages: [...] }" });
    }
    const envMax = Number(process.env.SHARE_MAX_EDIT_DAYS);
    const maxDays = Number.isFinite(envMax) && envMax > 0
      ? Math.min(Math.floor(envMax), 3650)
      : 365;
    let editUntil = null;
    if (typeof editDays === "number" && Number.isFinite(editDays) && editDays > 0) {
      const days = Math.min(Math.max(1, Math.floor(editDays)), maxDays);
      editUntil = new Date(Date.now() + days * 86400000).toISOString();
    }
    const id = randomBytes(12).toString("base64url");
    const file = path.join(DATA_DIR, `${id}.json`);
    const payload = { v: 1, pages, ...(editUntil ? { editUntil } : {}) };
    fs.writeFileSync(file, JSON.stringify(payload), "utf8");
    res.json({ id, ...(editUntil ? { editUntil } : {}) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/share/:id", (req, res) => {
  const record = loadShareOrNull(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "not found" });
  }
  res.type("json").send(JSON.stringify(record.data));
});

app.put("/api/share/:id", (req, res) => {
  try {
    const record = loadShareOrNull(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "not found" });
    }

    const prev = record.data;
    const editUntil =
      typeof prev?.editUntil === "string" ? prev.editUntil : null;
    if (editUntil && Date.now() > Date.parse(editUntil)) {
      return res.status(403).json({ error: "edit window expired" });
    }

    const { v, pages } = req.body;
    if (v !== 1 || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "Expected { v: 1, pages: [...] }" });
    }

    const payload = { v: 1, pages, ...(editUntil ? { editUntil } : {}) };
    fs.writeFileSync(record.file, JSON.stringify(payload), "utf8");
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/share/:id/upload-url", async (req, res) => {
  try {
    if (!r2) {
      return res.status(503).json({
        error:
          "R2 is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
      });
    }
    const record = loadShareOrNull(req.params.id);
    if (!record) return res.status(404).json({ error: "share not found" });
    const editUntil =
      typeof record.data?.editUntil === "string" ? record.data.editUntil : null;
    if (editUntil && Date.now() > Date.parse(editUntil)) {
      return res.status(403).json({ error: "edit window expired" });
    }

    const { filename, contentType } = req.body || {};
    const name = typeof filename === "string" ? filename : "image";
    const safeName = path
      .basename(name)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(safeName) || ".bin";
    const objectName = `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
    const key = `${path.basename(req.params.id)}/${objectName}`;
    const type =
      typeof contentType === "string" && contentType.length > 0
        ? contentType
        : "application/octet-stream";
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: type,
    });
    const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 600 });
    const base =
      PUBLIC_API_BASE ||
      `${req.protocol}://${req.get("host")}`;
    const objectUrl = `${base}/api/media/${encodeURIComponent(key)}`;
    res.json({ uploadUrl, objectUrl, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

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
  console.log(`[scrapbook share] http://localhost:${PORT}  (POST /api/share, GET /api/share/:id)`);
});
