export const DEMO_SHARE_ID = "Es8MGMZo5IweOb8a";

declare global {
  interface Window {
    __DEMO_DIAG?: boolean;
  }
}

export function isDemoShareId(id: string | null | undefined): boolean {
  return id === DEMO_SHARE_ID;
}

export function isDemoRouteActive(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("share") === DEMO_SHARE_ID;
}

function canResizeUrl(url: string): boolean {
  return /^https:\/\/images\.unsplash\.com\//i.test(url);
}

export function demoImageVariant(
  url: string,
  width: number,
  quality: number,
): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (!canResizeUrl(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("auto", "format");
    parsed.searchParams.set("fit", "crop");
    parsed.searchParams.set("w", String(width));
    parsed.searchParams.set("q", String(quality));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function demoResponsiveImageAttrs(
  url: string,
  hdReady: boolean,
  maxWidth = 1280,
): {
  src: string;
  srcSet?: string;
  dataHi: string;
} {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) {
    return { src: url, dataHi: url };
  }
  const low = demoImageVariant(url, 360, 68);
  const mid = demoImageVariant(url, 640, 72);
  const hi = demoImageVariant(url, maxWidth, 82);
  return {
    src: hdReady ? mid : low,
    srcSet: hdReady
      ? `${mid} 640w, ${hi} ${maxWidth}w`
      : `${low} 360w, ${mid} 640w`,
    dataHi: hi,
  };
}

export function promoteDemoElement(el: HTMLElement | null | undefined): void {
  if (!el || !isDemoRouteActive()) return;
  el.classList.add("demo-promote");
}

export function unpromoteDemoElement(el: HTMLElement | null | undefined): void {
  if (!el || !isDemoRouteActive()) return;
  el.classList.remove("demo-promote");
}

export function releaseCanvasResource(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  try {
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl" as never) as unknown as
        | WebGLRenderingContext
        | null);
    const loseContext = gl?.getExtension?.("WEBGL_lose_context");
    loseContext?.loseContext?.();
  } catch {
    // A 2D canvas cannot be rebound as WebGL; zeroing still releases backing memory.
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
  } catch {
    // ignore cleanup failures
  }
}

export function enableDemoDiagnosticsFromUrl(): void {
  if (!isDemoRouteActive()) return;
  if (new URLSearchParams(window.location.search).has("diag")) {
    window.__DEMO_DIAG = true;
  }
}

export function logDemoDiagnostics(label: string): void {
  if (typeof window === "undefined" || !window.__DEMO_DIAG) return;
  const loadedImages = [...document.images].filter((img) => img.complete);
  const imagePixels = loadedImages.reduce(
    (sum, img) => sum + (img.naturalWidth || 0) * (img.naturalHeight || 0),
    0,
  );
  const memory = (performance as unknown as { memory?: unknown }).memory;
  console.log("[demo-diag]", {
    label,
    loadedImageCount: loadedImages.length,
    loadedImageMP: Number((imagePixels / 1_000_000).toFixed(2)),
    activeCanvases: document.querySelectorAll("canvas").length,
    memory,
  });
}
