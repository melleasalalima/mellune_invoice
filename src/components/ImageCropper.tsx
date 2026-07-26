import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Crop, RotateCcw, X } from "lucide-react";

interface ImageCropperProps {
  source: string;
  aspect?: number;
  outputWidth?: number;
  title?: string;
  onCancel: () => void;
  onComplete: (dataUrl: string) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const drawCrop = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  zoom: number,
  positionX: number,
  positionY: number
) => {
  const context = canvas.getContext("2d");
  if (!context) return;

  const baseScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const scale = baseScale * zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const overflowX = Math.max(0, drawWidth - canvas.width);
  const overflowY = Math.max(0, drawHeight - canvas.height);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    -(overflowX * positionX) / 100,
    -(overflowY * positionY) / 100,
    drawWidth,
    drawHeight
  );
};

export default function ImageCropper({
  source,
  aspect = 1,
  outputWidth = 800,
  title = "Crop Photo",
  onCancel,
  onComplete,
}: ImageCropperProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(50);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; positionX: number; positionY: number } | null>(null);

  useEffect(() => {
    const nextImage = new Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = source;
  }, [source]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (canvas && image) drawCrop(canvas, image, zoom, positionX, positionY);
  }, [image, zoom, positionX, positionY]);

  const resetCrop = () => {
    setZoom(1);
    setPositionX(50);
    setPositionY(50);
  };

  const finishCrop = () => {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = Math.round(outputWidth / aspect);
    drawCrop(canvas, image, zoom, positionX, positionY);
    onComplete(canvas.toDataURL("image/jpeg", 0.88));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      positionX,
      positionY,
    };
  };

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPositionX(clamp(dragRef.current.positionX - ((event.clientX - dragRef.current.x) / rect.width) * 100, 0, 100));
    setPositionY(clamp(dragRef.current.positionY - ((event.clientY - dragRef.current.y) / rect.height) * 100, 0, 100));
  }, []);

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Crop className="h-4 w-4 text-rose-400" />
              <h3 className="text-sm font-black text-white">{title}</h3>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-500">Drag the photo to position it, then zoom if needed.</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-full bg-zinc-800 p-2 text-zinc-300 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <div className="relative mx-auto overflow-hidden rounded-2xl border border-zinc-700 bg-black shadow-inner">
            <canvas
              ref={previewCanvasRef}
              width={900}
              height={Math.round(900 / aspect)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
              className="block max-h-[55vh] w-full cursor-grab touch-none active:cursor-grabbing"
            />
            <div className="pointer-events-none absolute inset-3 rounded-xl border border-white/35" />
            {!image && <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">Loading photo…</div>}
          </div>

          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Zoom</label>
              <button type="button" onClick={resetCrop} className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-white">
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            </div>
            <input className="w-full accent-rose-500" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            <div className="mt-1 flex justify-between text-[9px] text-zinc-600"><span>Fit</span><span>{zoom.toFixed(2)}×</span><span>Close up</span></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-zinc-800 p-4">
          <button type="button" onClick={onCancel} className="rounded-xl border border-zinc-700 px-4 py-3 text-xs font-bold text-zinc-300 hover:bg-zinc-800">Cancel</button>
          <button type="button" onClick={finishCrop} disabled={!image} className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-3 text-xs font-bold text-white hover:bg-rose-400 disabled:opacity-50">
            <Check className="h-4 w-4" />
            Use This Crop
          </button>
        </div>
      </div>
    </div>
  );
}
