import { useEffect, useRef, useState } from "react";
import { Check, Eraser, Trash2, Undo2, X } from "lucide-react";
import type { Language } from "./i18n";

const COLORS = [
  "#1c1917",
  "#ffffff",
  "#e11d48",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#0ea5e9",
  "#7c3aed",
];

const CANVAS_W = 800;
const CANVAS_H = 1200;

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  size: number;
  erase: boolean;
}

/**
 * Freehand drawing tool. Draws on a transparent canvas so the result reads
 * as a sticker when inserted, then hands back a PNG File through the same
 * pipeline as an uploaded photo — no new element type needed.
 */
export default function DrawingModal({
  language,
  onCancel,
  onInsert,
}: {
  language?: Language;
  onCancel: () => void;
  onInsert: (file: File) => void;
}) {
  const uiEnglish = language === "en";
  const ui = (mn: string, en: string) => (uiEnglish ? en : mn);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const [color, setColor] = useState("#1c1917");
  const [size, setSize] = useState(6);
  const [erasing, setErasing] = useState(false);

  const redraw = (list: Stroke[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of list) {
      if (stroke.points.length === 0) continue;
      ctx.globalCompositeOperation = stroke.erase
        ? "destination-out"
        : "source-over";
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const [first, ...rest] = stroke.points;
      ctx.moveTo(first.x, first.y);
      if (rest.length === 0) {
        ctx.lineTo(first.x + 0.01, first.y + 0.01);
      }
      for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  };

  useEffect(() => {
    redraw(strokes);
  }, [strokes]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = {
      points: [pointFromEvent(e)],
      color,
      size: erasing ? size * 3 : size,
      erase: erasing,
    };
    drawingRef.current = stroke;
    setStrokes((prev) => [...prev, stroke]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    stroke.points.push(pointFromEvent(e));
    redraw([...strokes.slice(0, -1), stroke]);
  };

  const handlePointerUp = () => {
    drawingRef.current = null;
  };

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clear = () => setStrokes([]);

  const insert = () => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      onInsert(new File([blob], "drawing.png", { type: "image/png" }));
    }, "image/png");
  };

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-stone-950/95 text-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-stone-900 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
        >
          <X size={14} />
          {ui("Цуцлах", "Cancel")}
        </button>
        <span className="ml-1 text-xs font-semibold text-white/70">
          {ui("Зурах", "Draw")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={strokes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20 disabled:opacity-40"
          >
            <Undo2 size={14} />
            {ui("Буцаах", "Undo")}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={strokes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20 disabled:opacity-40"
          >
            <Trash2 size={14} />
            {ui("Цэвэрлэх", "Clear")}
          </button>
          <button
            type="button"
            onClick={insert}
            disabled={strokes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-700 disabled:opacity-40"
          >
            <Check size={14} />
            {ui("Оруулах", "Insert")}
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <div
          className="relative w-full shrink-0 touch-none rounded-xl shadow-2xl"
          style={{
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            maxWidth: "min(90vw, 420px)",
            maxHeight: "100%",
            backgroundImage:
              "linear-gradient(45deg, #44403c 25%, transparent 25%), linear-gradient(-45deg, #44403c 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #44403c 75%), linear-gradient(-45deg, transparent 75%, #44403c 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            backgroundColor: "#292524",
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="h-full w-full touch-none"
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-white/10 bg-stone-900 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setColor(c);
                setErasing(false);
              }}
              className={`h-6 w-6 rounded-full border-2 ${
                !erasing && color === c ? "border-rose-400" : "border-white/30"
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setErasing(false);
            }}
            className="h-6 w-6 cursor-pointer rounded-full border-2 border-white/30 bg-transparent p-0"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-white/70">
          {ui("Зузаан", "Size")}
          <input
            type="range"
            min={2}
            max={40}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24"
          />
        </label>
        <button
          type="button"
          onClick={() => setErasing((v) => !v)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            erasing ? "bg-rose-600" : "bg-white/10 hover:bg-white/20"
          }`}
        >
          <Eraser size={14} />
          {ui("Арчигч", "Eraser")}
        </button>
      </div>
    </div>
  );
}
