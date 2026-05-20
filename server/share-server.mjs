/**
 * Local share API: stores scrapbooks as JSON files so share links stay short
 * even with large base64 photos. Run via `npm run dev` (starts with Vite) or
 * `node server/share-server.mjs` alone on port 3001.
 */
import express from "express";
import { Resend } from "resend";
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

const hasR2Config =
  R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET;
const MAX_SHARE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;
const SANDBOX_DEMO_SHARE_ID = "pfM_LkLxbqxN7TUX";
// Bump this string whenever you change DEMO_BIRTHDAY_PAGES so the server
// re-seeds the demo on next restart without any manual step.
const DEMO_DATA_VERSION = "v5-hbd-handmade-2025";
// CC0 background music — replace with any direct MP3/OGG CDN URL.
// Free options: https://pixabay.com/music/search/birthday/ (download → copy CDN link)
const DEMO_LIGHT_MUSIC_URL = "";
const DEMO_LIGHT_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
// Birthday / celebration themed Unsplash photos (Unsplash license — free commercial use).
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
];
const DEMO_LIGHT_BACKGROUND_URLS = [
  "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b", // warm bokeh lights
  "https://images.unsplash.com/photo-1518568814500-bf0f8d125f46", // pink rose petals
  "https://images.unsplash.com/photo-1490750967868-88df5691cc1e", // spring blossoms
  "https://images.unsplash.com/photo-1523438885200-e635ba2c371e", // soft pastel floral
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5", // purple pink bokeh
  "https://images.unsplash.com/photo-1517697471339-4aa32003c11a", // soft yellow bokeh
  "https://images.unsplash.com/photo-1546484396-fb3fc6f95f98", // pastel pink
  "https://images.unsplash.com/photo-1549490349-8643362247b5", // confetti bokeh
];

// 15-page "Happy Birthday, My Friend!" scrapbook structure.
// Images/video/music are placeholder strings — withDemoLightCdnAssets()
// replaces them with real CDN URLs from the lists above at serve time.
// Layout rules: keep image right edge ≤ 680, bottom edge ≤ 520 (rotation adds ~20px visual bleed).
const DEMO_BIRTHDAY_PAGES = [
  // pg 1 – cover
  { id:"cover", background:"bg-rose-100", pattern:"pattern-polka", elements:[
    { id:"t1a", type:"text", x:45, y:108, rotation:-4, content:"HAPPY", fontSize:72, color:"#e11d48", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t1b", type:"text", x:45, y:188, rotation:3, content:"BIRTHDAY!", fontSize:64, color:"#e11d48", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t1c", type:"text", x:58, y:278, rotation:-1, content:"my friend ♡", fontSize:22, color:"#f43f5e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t1d", type:"text", x:58, y:322, rotation:-3, content:" ✿ 2025 ✿ ", fontSize:14, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#e11d48" },
    { id:"i1a", type:"image", x:432, y:72, rotation:5, content:"https://placeholder.img", width:172, height:218 },
    { id:"s1a", type:"sticker", x:555, y:42, rotation:22, content:"🎉", fontSize:58 },
    { id:"s1b", type:"sticker", x:590, y:318, rotation:-10, content:"🎈", fontSize:50 },
    { id:"s1c", type:"sticker", x:42, y:372, rotation:12, content:"🌸", fontSize:46 },
    { id:"s1d", type:"sticker", x:248, y:400, rotation:0, content:"✨", fontSize:38 },
    { id:"s1e", type:"sticker", x:648, y:168, rotation:5, content:"🎀", fontSize:36 },
  ]},
  // pg 2 – dedication
  { id:"page-2", background:"bg-amber-50", pattern:"pattern-grid", elements:[
    { id:"t2a", type:"text", x:46, y:68, rotation:2, content:"This is for", fontSize:28, color:"#d97706", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t2b", type:"text", x:46, y:105, rotation:-1, content:"You ♡", fontSize:50, color:"#d97706", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t2c", type:"text", x:50, y:178, rotation:0, content:"you make every day brighter", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t2d", type:"text", x:50, y:205, rotation:0, content:"and every moment more special.", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t2e", type:"text", x:50, y:260, rotation:-2, content:" 💌 open with love ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#d97706" },
    { id:"i2a", type:"image", x:312, y:62, rotation:-5, content:"https://placeholder.img", width:155, height:198 },
    { id:"i2b", type:"image", x:482, y:145, rotation:4, content:"https://placeholder.img", width:148, height:188 },
    { id:"s2a", type:"sticker", x:625, y:355, rotation:12, content:"💛", fontSize:46 },
    { id:"s2b", type:"sticker", x:42, y:385, rotation:-8, content:"🌻", fontSize:42 },
    { id:"t2f", type:"text", x:50, y:432, rotation:1, content:"june 2025 📅", fontSize:13, color:"#a16207", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
  ]},
  // pg 3 – you are amazing
  { id:"page-3", background:"bg-violet-50", pattern:"pattern-polka", elements:[
    { id:"t3a", type:"text", x:44, y:58, rotation:-2, content:"YOU ARE", fontSize:44, color:"#7c3aed", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t3b", type:"text", x:44, y:112, rotation:2, content:"AMAZING", fontSize:44, color:"#7c3aed", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t3c", type:"text", x:44, y:172, rotation:0, content:"✨ never forget that ✨", fontSize:15, color:"#6d28d9", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"i3a", type:"image", x:44, y:212, rotation:-7, content:"https://placeholder.img", width:148, height:188 },
    { id:"i3b", type:"image", x:215, y:185, rotation:3, content:"https://placeholder.img", width:158, height:202 },
    { id:"i3c", type:"image", x:402, y:75, rotation:-4, content:"https://placeholder.img", width:155, height:198 },
    { id:"t3d", type:"text", x:402, y:295, rotation:2, content:" ⭐ star of the show ", fontSize:12, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#7c3aed" },
    { id:"s3a", type:"sticker", x:575, y:48, rotation:15, content:"⭐", fontSize:50 },
    { id:"s3b", type:"sticker", x:638, y:355, rotation:-8, content:"💜", fontSize:42 },
    { id:"t3e", type:"text", x:44, y:442, rotation:-1, content:'"the world is better with you in it"', fontSize:13, color:"#6d28d9", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
  ]},
  // pg 4 – favorite memories (4 photos in a row)
  { id:"page-4", background:"bg-sky-50", pattern:"pattern-lines", elements:[
    { id:"t4a", type:"text", x:42, y:45, rotation:-1, content:"Our Favorite Memories 📸", fontSize:28, color:"#0369a1", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i4a", type:"image", x:42, y:105, rotation:-8, content:"https://placeholder.img", width:142, height:182 },
    { id:"i4b", type:"image", x:196, y:85, rotation:4, content:"https://placeholder.img", width:142, height:182 },
    { id:"i4c", type:"image", x:372, y:98, rotation:-3, content:"https://placeholder.img", width:142, height:182 },
    { id:"i4d", type:"image", x:528, y:118, rotation:6, content:"https://placeholder.img", width:138, height:178 },
    { id:"t4b", type:"text", x:42, y:310, rotation:3, content:"remember this? 😊", fontSize:13, color:"#0c4a6e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t4c", type:"text", x:372, y:302, rotation:-2, content:"best day ever!", fontSize:13, color:"#0c4a6e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s4a", type:"sticker", x:310, y:382, rotation:0, content:"💙", fontSize:42 },
    { id:"t4d", type:"text", x:42, y:435, rotation:-1, content:" 📅 summer 2025 ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#0369a1" },
  ]},
  // pg 5 – laughs
  { id:"page-5", background:"bg-yellow-50", pattern:"pattern-grid", elements:[
    { id:"t5a", type:"text", x:42, y:52, rotation:2, content:"Laughs We've Had 😂", fontSize:28, color:"#b45309", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i5a", type:"image", x:42, y:108, rotation:-6, content:"https://placeholder.img", width:165, height:210 },
    { id:"i5b", type:"image", x:238, y:88, rotation:7, content:"https://placeholder.img", width:155, height:198 },
    { id:"t5b", type:"text", x:420, y:100, rotation:-2, content:"the funniest", fontSize:18, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t5c", type:"text", x:420, y:130, rotation:1, content:"moments with", fontSize:18, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t5d", type:"text", x:420, y:160, rotation:-1, content:"my fav person!", fontSize:18, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s5a", type:"sticker", x:420, y:215, rotation:-12, content:"🥹", fontSize:50 },
    { id:"s5b", type:"sticker", x:532, y:268, rotation:8, content:"😂", fontSize:46 },
    { id:"t5e", type:"text", x:42, y:352, rotation:1, content:" 🤣 can't stop laughing ", fontSize:12, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#b45309" },
  ]},
  // pg 6 – adventures (3 photos)
  { id:"page-6", background:"bg-emerald-50", pattern:"pattern-lines", elements:[
    { id:"t6a", type:"text", x:42, y:48, rotation:-2, content:"Adventures Together", fontSize:28, color:"#065f46", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i6a", type:"image", x:42, y:105, rotation:-5, content:"https://placeholder.img", width:152, height:195 },
    { id:"i6b", type:"image", x:218, y:122, rotation:4, content:"https://placeholder.img", width:145, height:185 },
    { id:"i6c", type:"image", x:395, y:92, rotation:-3, content:"https://placeholder.img", width:152, height:195 },
    { id:"t6b", type:"text", x:42, y:330, rotation:1, content:"every trip is better with you!", fontSize:14, color:"#064e3b", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s6a", type:"sticker", x:568, y:298, rotation:15, content:"✈️", fontSize:50 },
    { id:"s6b", type:"sticker", x:318, y:388, rotation:-5, content:"🗺️", fontSize:42 },
    { id:"t6c", type:"text", x:42, y:432, rotation:-2, content:" 🌍 let's go everywhere ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#065f46" },
  ]},
  // pg 7 – birthday day
  { id:"page-7", background:"bg-pink-50", pattern:"pattern-polka", elements:[
    { id:"t7a", type:"text", x:42, y:48, rotation:-3, content:"TODAY IS", fontSize:38, color:"#be185d", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t7b", type:"text", x:42, y:96, rotation:2, content:"YOUR DAY!", fontSize:38, color:"#be185d", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i7a", type:"image", x:42, y:158, rotation:-5, content:"https://placeholder.img", width:162, height:208 },
    { id:"i7b", type:"image", x:238, y:138, rotation:4, content:"https://placeholder.img", width:150, height:192 },
    { id:"s7a", type:"sticker", x:418, y:142, rotation:10, content:"🎂", fontSize:62 },
    { id:"s7b", type:"sticker", x:532, y:242, rotation:-15, content:"🎁", fontSize:50 },
    { id:"t7c", type:"text", x:418, y:325, rotation:1, content:"celebrating you!", fontSize:16, color:"#9d174d", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t7d", type:"text", x:42, y:405, rotation:-1, content:" 🎊 happy birthday queen! ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#be185d" },
  ]},
  // pg 8 – video message
  { id:"page-8", background:"bg-fuchsia-50", pattern:"pattern-grid", elements:[
    { id:"t8a", type:"text", x:46, y:52, rotation:1, content:"A Little Message 🎬", fontSize:28, color:"#86198f", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"v8a", type:"video", x:162, y:118, rotation:-2, content:"https://placeholder.vid", width:240, height:136 },
    { id:"t8b", type:"text", x:188, y:288, rotation:0, content:"press play! 🎥", fontSize:16, color:"#701a75", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s8a", type:"sticker", x:568, y:48, rotation:20, content:"🎬", fontSize:50 },
    { id:"s8b", type:"sticker", x:46, y:355, rotation:-8, content:"💫", fontSize:46 },
    { id:"t8c", type:"text", x:46, y:432, rotation:2, content:" 🎵 with love, always ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#86198f" },
  ]},
  // pg 9 – polaroid gallery (3 polaroids)
  { id:"page-9", background:"bg-rose-50", pattern:"pattern-polka", elements:[
    { id:"t9a", type:"text", x:42, y:42, rotation:-2, content:"Polaroid Moments 📸", fontSize:28, color:"#be185d", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"s9p1", type:"sticker", x:42, y:100, rotation:-7, content:"__POLAROID__", width:182, height:238, frameImage:"https://placeholder.img" },
    { id:"s9p2", type:"sticker", x:248, y:82, rotation:4, content:"__POLAROID__", width:182, height:238, frameImage:"https://placeholder.img" },
    { id:"s9p3", type:"sticker", x:455, y:108, rotation:-3, content:"__POLAROID__", width:182, height:238, frameImage:"https://placeholder.img" },
    { id:"s9a", type:"sticker", x:625, y:335, rotation:0, content:"📸", fontSize:42 },
    { id:"t9b", type:"text", x:42, y:378, rotation:1, content:"freeze the moment forever 🌸", fontSize:14, color:"#be185d", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
  ]},
  // pg 10 – things i love about you
  { id:"page-10", background:"bg-amber-50", pattern:"pattern-lines", elements:[
    { id:"t10a", type:"text", x:42, y:45, rotation:-1, content:"Things I Love", fontSize:34, color:"#b45309", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t10b", type:"text", x:42, y:90, rotation:1, content:"About You ♡", fontSize:34, color:"#b45309", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t10c", type:"text", x:55, y:148, rotation:1, content:"1. Your laugh 😄", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t10d", type:"text", x:55, y:180, rotation:-1, content:"2. Your kindness 🤍", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t10e", type:"text", x:55, y:212, rotation:0, content:"3. Your energy ⚡", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t10f", type:"text", x:55, y:244, rotation:1, content:"4. Your smile 😊", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t10g", type:"text", x:55, y:276, rotation:-1, content:"5. Everything! 💛", fontSize:17, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"i10a", type:"image", x:412, y:108, rotation:4, content:"https://placeholder.img", width:162, height:208 },
    { id:"s10a", type:"sticker", x:592, y:335, rotation:15, content:"❤️", fontSize:42 },
    { id:"t10h", type:"text", x:42, y:368, rotation:-2, content:" because you're just THE best! 🌟 ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#d97706" },
  ]},
  // pg 11 – places we'll go
  { id:"page-11", background:"bg-sky-50", pattern:"pattern-grid", elements:[
    { id:"t11a", type:"text", x:42, y:48, rotation:-2, content:"Places We'll Go 🌍", fontSize:30, color:"#0369a1", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i11a", type:"image", x:42, y:108, rotation:-6, content:"https://placeholder.img", width:165, height:210 },
    { id:"i11b", type:"image", x:240, y:88, rotation:5, content:"https://placeholder.img", width:152, height:195 },
    { id:"t11b", type:"text", x:415, y:88, rotation:-1, content:'"oh the places', fontSize:18, color:"#0c4a6e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t11c", type:"text", x:415, y:118, rotation:1, content:"you'll go!\"", fontSize:18, color:"#0c4a6e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s11a", type:"sticker", x:415, y:162, rotation:15, content:"✈️", fontSize:54 },
    { id:"s11b", type:"sticker", x:548, y:262, rotation:-10, content:"🌟", fontSize:42 },
    { id:"t11d", type:"text", x:42, y:360, rotation:1, content:"the world is waiting for us! 🗺️", fontSize:14, color:"#075985", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t11e", type:"text", x:42, y:425, rotation:-2, content:" 📍 next destination: everywhere ", fontSize:13, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#0369a1" },
  ]},
  // pg 12 – wishing you
  { id:"page-12", background:"bg-violet-50", pattern:"pattern-polka", elements:[
    { id:"t12a", type:"text", x:46, y:52, rotation:-3, content:"Wishing You...", fontSize:36, color:"#7c3aed", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t12b", type:"text", x:55, y:112, rotation:1, content:"✦ all the happiness 🌈", fontSize:16, color:"#6d28d9", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t12c", type:"text", x:55, y:145, rotation:-1, content:"✦ every dream come true ⭐", fontSize:16, color:"#6d28d9", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t12d", type:"text", x:55, y:178, rotation:0, content:"✦ endless adventures ✨", fontSize:16, color:"#6d28d9", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t12e", type:"text", x:55, y:211, rotation:1, content:"✦ the best year yet! 🎉", fontSize:16, color:"#6d28d9", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"i12a", type:"image", x:382, y:88, rotation:5, content:"https://placeholder.img", width:162, height:208 },
    { id:"i12b", type:"image", x:558, y:132, rotation:-4, content:"https://placeholder.img", width:118, height:152 },
    { id:"s12a", type:"sticker", x:42, y:272, rotation:-10, content:"✨", fontSize:50 },
    { id:"s12b", type:"sticker", x:608, y:302, rotation:10, content:"💜", fontSize:42 },
    { id:"t12f", type:"text", x:46, y:428, rotation:2, content:" make a wish! 🌠 ", fontSize:15, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#7c3aed" },
  ]},
  // pg 13 – year in highlights (3 photos)
  { id:"page-13", background:"bg-rose-50", pattern:"pattern-grid", elements:[
    { id:"t13a", type:"text", x:42, y:45, rotation:2, content:"Year in Highlights ⭐", fontSize:28, color:"#e11d48", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i13a", type:"image", x:42, y:105, rotation:-7, content:"https://placeholder.img", width:142, height:182 },
    { id:"i13b", type:"image", x:208, y:85, rotation:4, content:"https://placeholder.img", width:142, height:182 },
    { id:"i13c", type:"image", x:382, y:105, rotation:-3, content:"https://placeholder.img", width:142, height:182 },
    { id:"t13b", type:"text", x:42, y:318, rotation:3, content:"jan–jun 📅", fontSize:13, color:"#9f1239", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t13c", type:"text", x:208, y:298, rotation:-2, content:"summer 🌞", fontSize:13, color:"#9f1239", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t13d", type:"text", x:382, y:318, rotation:1, content:"jul–dec 📅", fontSize:13, color:"#9f1239", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s13a", type:"sticker", x:548, y:205, rotation:0, content:"🗓️", fontSize:42 },
    { id:"t13e", type:"text", x:42, y:392, rotation:-1, content:" ✦ what a year it's been! ✦ ", fontSize:14, color:"#fff", fontFamily:"var(--font-handwriting)", textEffect:"none", textBackgroundColor:"#e11d48" },
  ]},
  // pg 14 – more memories (3 photos overlapping)
  { id:"page-14", background:"bg-amber-50", pattern:"pattern-polka", elements:[
    { id:"t14a", type:"text", x:42, y:48, rotation:-2, content:"More Memories 💛", fontSize:32, color:"#d97706", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"i14a", type:"image", x:42, y:108, rotation:-5, content:"https://placeholder.img", width:185, height:235 },
    { id:"i14b", type:"image", x:252, y:88, rotation:6, content:"https://placeholder.img", width:165, height:210 },
    { id:"i14c", type:"image", x:445, y:115, rotation:-3, content:"https://placeholder.img", width:155, height:198 },
    { id:"s14a", type:"sticker", x:622, y:325, rotation:20, content:"💛", fontSize:46 },
    { id:"s14b", type:"sticker", x:42, y:385, rotation:-8, content:"🌻", fontSize:42 },
    { id:"t14b", type:"text", x:118, y:402, rotation:1, content:"every photo tells a story ✨", fontSize:14, color:"#92400e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
  ]},
  // pg 15 – back cover
  { id:"back-cover", background:"bg-rose-100", pattern:"pattern-polka", elements:[
    { id:"t15a", type:"text", x:72, y:145, rotation:-3, content:"Happy Birthday!", fontSize:50, color:"#e11d48", fontFamily:"var(--font-handwriting)", textEffect:"none", fontWeight:"bold" },
    { id:"t15b", type:"text", x:98, y:225, rotation:0, content:"with all my love 💕", fontSize:24, color:"#f43f5e", fontFamily:"var(--font-handwriting)", textEffect:"none" },
    { id:"t15c", type:"text", x:85, y:285, rotation:2, content:"may all your wishes come true ✨", fontSize:17, color:"#f43f5e", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"t15d", type:"text", x:112, y:422, rotation:1, content:"← flip back to the beginning", fontSize:13, color:"#9f1239", fontFamily:"var(--font-handwriting)", textEffect:"none", fontStyle:"italic" },
    { id:"s15a", type:"sticker", x:558, y:50, rotation:25, content:"🎉", fontSize:70 },
    { id:"s15b", type:"sticker", x:548, y:278, rotation:-15, content:"🎂", fontSize:50 },
    { id:"s15c", type:"sticker", x:608, y:422, rotation:10, content:"🎈", fontSize:42 },
    { id:"s15d", type:"sticker", x:38, y:80, rotation:10, content:"✨", fontSize:50 },
  ]},
];
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

const resend = new Resend(process.env.RESEND_API_KEY);

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

function demoCdnImageUrl(url, width = 640) {
  return `${url}?auto=format&fit=crop&w=${width}&q=72`;
}

function demoCdnImageAt(index, width = 640) {
  return demoCdnImageUrl(
    DEMO_LIGHT_IMAGE_URLS[index % DEMO_LIGHT_IMAGE_URLS.length],
    width,
  );
}

function demoCdnBackgroundAt(index) {
  return demoCdnImageUrl(
    DEMO_LIGHT_BACKGROUND_URLS[index % DEMO_LIGHT_BACKGROUND_URLS.length],
    720,
  );
}

function withDemoLightCdnAssets(data) {
  if (!data || !Array.isArray(data.pages)) return data;
  return {
    ...data,
    musicUrl: DEMO_LIGHT_MUSIC_URL,
    appBackgroundImage: demoCdnBackgroundAt(99),
    pages: data.pages.map((page, pageIndex) => ({
      ...page,
      backgroundImage: demoCdnBackgroundAt(pageIndex),
      elements: Array.isArray(page.elements)
        ? page.elements.map((element, elementIndex) => {
            const assetIndex = pageIndex * 5 + elementIndex;
            if (element?.type === "video") {
              return {
                ...element,
                content: DEMO_LIGHT_VIDEO_URL,
                width: Math.min(element.width || 300, 240),
                height: Math.min(element.height || 160, 136),
              };
            }
            if (element?.type === "image") {
              return {
                ...element,
                content:
                  element.content === "__POLAROID__"
                    ? element.content
                    : demoCdnImageAt(assetIndex),
                frameImage: element.frameImage
                  ? demoCdnImageAt(assetIndex + 2)
                  : element.frameImage,
              };
            }
            if (
              element?.type === "sticker" &&
              element.content === "__POLAROID__"
            ) {
              return {
                ...element,
                frameImage: demoCdnImageAt(assetIndex + 2),
              };
            }
            if (
              element?.type === "sticker" &&
              /^https?:\/\//i.test(element.content || "")
            ) {
              return {
                ...element,
                content: demoCdnImageAt(assetIndex),
              };
            }
            return {
              ...element,
              frameImage: element?.frameImage
                ? demoCdnImageAt(assetIndex + 2)
                : element?.frameImage,
            };
          })
        : [],
    })),
  };
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
    for (const el of Array.isArray(page?.elements) ? page.elements : []) {
      if (el?.type === "image" || el?.type === "video") {
        addMediaKey(keys, el.content, shareId);
      }
      addMediaKey(keys, el?.frameImage, shareId);
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

  const img = sharp(inputBuffer, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const maxSide = options.hd ? 2560 : 2200;
  const resized = img.resize({
    width: meta.width && meta.width > maxSide ? maxSide : undefined,
    height: meta.height && meta.height > maxSide ? maxSide : undefined,
    fit: "inside",
    withoutEnlargement: true,
    kernel: sharp.kernel.lanczos3,
  });
  if (options.preferAvif) {
    const avif = await resized
      .avif({ quality: options.hd ? 70 : 62, effort: 4 })
      .toBuffer();
    return {
      body: avif,
      contentType: "image/avif",
      ext: ".avif",
    };
  }
  const webp = await resized
    .webp({ quality: options.hd ? 86 : 84, effort: 4 })
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
      "scale=min(960\\,iw):-2:flags=fast_bilinear",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-maxrate",
      "1000k",
      "-bufsize",
      "2000k",
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

app.post("/gumroad-webhook", async (req, res) => {
  try {
    console.log("🔥 GUMROAD WEBHOOK HIT");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);

    const data = req.body || {};
    const customerEmail = data.email || data.purchaser_email || data.buyer_email;

    if (!customerEmail) {
      return res.status(400).send("No customer email found");
    }

    const shareId = randomBytes(12).toString("base64url");
    const shareUrl = `https://scrapbook.56moments.store/share?id=${shareId}`;

    await persistShare(shareId, {
      v: 1,
      pages: DEMO_BIRTHDAY_PAGES,
      mediaBytes: 0,
    });

    await resend.emails.send({
      from: process.env.RESEND_FROM || "56 Moments <onboarding@resend.dev>",
      to: customerEmail,
      subject: "Your design link is ready",
      html: `
        <h2>Thank you for your purchase!</h2>
        <p>Your design link is ready:</p>
        <p><a href="${shareUrl}">${shareUrl}</a></p>
      `,
    });

    res.status(200).send("Email sent");
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

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
  const responseData =
    path.basename(req.params.id) === SANDBOX_DEMO_SHARE_ID
      ? withDemoLightCdnAssets(record.data)
      : record.data;
  res.type("json").send(JSON.stringify(responseData));
});

app.put("/api/share/:id", async (req, res) => {
  try {
    const record = await loadShareOrNull(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "not found" });
    }
    if (path.basename(req.params.id) === SANDBOX_DEMO_SHARE_ID) {
      return res.json({
        ok: true,
        bytesUsed: currentMediaBytes(record.data),
        bytesLimit: MAX_SHARE_BYTES,
        demo: true,
      });
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
    if (path.basename(req.params.id) === SANDBOX_DEMO_SHARE_ID) {
      return res.json({
        ok: true,
        editUntil:
          typeof record.data?.editUntil === "string"
            ? record.data.editUntil
            : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        demo: true,
      });
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
      if (path.basename(req.params.id) === SANDBOX_DEMO_SHARE_ID) {
        return res.status(403).json({
          error: "Demo share uploads are browser-only and are not saved.",
        });
      }
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

// Seed the demo share on startup whenever DEMO_DATA_VERSION changes.
// Writes directly to the local file and R2, bypassing the PUT endpoint
// (which intentionally blocks saves to the demo ID from the browser).
async function bootstrapDemoShare() {
  try {
    const existing = await loadShareOrNull(SANDBOX_DEMO_SHARE_ID);
    if (existing?.data?.demoVersion === DEMO_DATA_VERSION) {
      console.log(`[demo] share ${SANDBOX_DEMO_SHARE_ID} is current (${DEMO_DATA_VERSION})`);
      return;
    }
    const payload = {
      v: 1,
      pages: DEMO_BIRTHDAY_PAGES,
      mediaBytes: 0,
      demoVersion: DEMO_DATA_VERSION,
    };
    await persistShare(SANDBOX_DEMO_SHARE_ID, payload);
    console.log(`[demo] seeded ${SANDBOX_DEMO_SHARE_ID} — ${DEMO_BIRTHDAY_PAGES.length} pages (${DEMO_DATA_VERSION})`);
  } catch (e) {
    console.error("[demo] bootstrap failed:", e);
  }
}

app.listen(PORT, () => {
  console.log(
    `[scrapbook share] http://localhost:${PORT}  (POST /api/share, GET /api/share/:id)`,
  );
  bootstrapDemoShare();
});
