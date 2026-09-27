import { scan } from "@/lib/pde/field";
import type { Cmap, Sim } from "@/lib/pde/types";

type RGB = [number, number, number];

function build(stops: [number, RGB][]) {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const u = (t - a[0]) / (b[0] - a[0] || 1);
    out[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * u;
    out[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * u;
    out[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * u;
  }
  return out;
}

const MAPS: Record<Cmap | "signed", Uint8ClampedArray> = {
  ember: build([
    [0, [16, 18, 16]],
    [0.28, [92, 42, 22]],
    [0.58, [224, 138, 69]],
    [0.8, [242, 196, 138]],
    [1, [244, 241, 234]],
  ]),
  ink: build([
    [0, [16, 22, 20]],
    [0.3, [28, 62, 54]],
    [0.62, [196, 107, 50]],
    [1, [243, 239, 228]],
  ]),
  tide: build([
    [0, [16, 22, 20]],
    [0.4, [48, 68, 56]],
    [0.72, [224, 138, 69]],
    [1, [244, 241, 234]],
  ]),
  signed: build([
    [0, [47, 74, 68]],
    [0.5, [16, 22, 20]],
    [1, [224, 138, 69]],
  ]),
};

const cache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function offscreen(canvas: HTMLCanvasElement) {
  let off = cache.get(canvas);
  if (!off) {
    off = document.createElement("canvas");
    cache.set(canvas, off);
  }
  return off;
}

function rangeOf(sim: Sim, data: Float32Array) {
  if (sim.colorWindow) {
    const { min, max } = sim.colorWindow;
    return { min, max, signed: sim.forceSigned || (min < 0 && max > 0) };
  }
  const s = scan(data);
  let min = s.min;
  let max = s.max;
  if (!Number.isFinite(min)) return { min: 0, max: 1, signed: false };
  const signed = sim.forceSigned || (min < -1e-5 && max > 1e-5);
  if (signed) {
    const m = Math.max(Math.abs(min), Math.abs(max), 1e-4);
    return { min: -m, max: m, signed: true };
  }
  if (max - min < 1e-6) max = min + 1;
  return { min, max, signed: false };
}

function idxOf(v: number, min: number, max: number) {
  const t = (v - min) / (max - min || 1);
  if (t <= 0) return 0;
  if (t >= 1) return 255;
  return (t * 255) | 0;
}

function prepare(canvas: HTMLCanvasElement) {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW < 2 || cssH < 2) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#101614";
  ctx.fillRect(0, 0, cssW, cssH);
  return { ctx, cssW, cssH };
}

export function paintField(canvas: HTMLCanvasElement, sim: Sim) {
  const prep = prepare(canvas);
  if (!prep) return;
  const { ctx, cssW, cssH } = prep;
  const { min, max, signed } = rangeOf(sim, sim.frame);
  const map = signed ? MAPS.signed : MAPS[sim.cmap];
  if (sim.dim === 2) blit2(ctx, canvas, sim, map, min, max, cssW, cssH);
  else draw1(ctx, sim, min, max, cssW, cssH);
}

function blit2(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sim: Sim,
  map: Uint8ClampedArray,
  min: number,
  max: number,
  cssW: number,
  cssH: number,
) {
  const n = sim.n;
  const off = offscreen(canvas);
  if (off.width !== n || off.height !== n) {
    off.width = n;
    off.height = n;
  }
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(n, n);
  const src = sim.frame;
  const px = img.data;
  for (let i = 0; i < src.length; i++) {
    const c = idxOf(src[i], min, max) * 3;
    const p = i * 4;
    px[p] = map[c];
    px[p + 1] = map[c + 1];
    px[p + 2] = map[c + 2];
    px[p + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, cssW, cssH);
  sim.overlay?.(ctx, { x: 0, y: 0, w: cssW, h: cssH }, 1);
}

function draw1(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  min: number,
  max: number,
  cssW: number,
  cssH: number,
) {
  const n = sim.n;
  const pad = 16;
  const plotW = cssW - pad * 2;
  const plotH = cssH - pad * 2;
  const yOf = (v: number) => pad + ((max - v) / (max - min || 1)) * plotH;
  const xOf = (i: number) => pad + (i / (n - 1)) * plotW;

  if (sim.guide) {
    let gmax = 0;
    for (let i = 0; i < n; i++) gmax = Math.max(gmax, sim.guide[i]);
    if (gmax > 0) {
      ctx.fillStyle = "rgba(224,138,69,0.18)";
      for (let i = 0; i < n; i++) {
        if (sim.guide[i] <= 0) continue;
        const h = (sim.guide[i] / gmax) * plotH * 0.45;
        const x = xOf(i);
        ctx.fillRect(x, pad + plotH - h, Math.max(1, plotW / n + 0.5), h);
      }
    }
  }

  ctx.strokeStyle = "rgba(147,167,156,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, yOf(0));
  ctx.lineTo(pad + plotW, yOf(0));
  ctx.stroke();

  const fillPath = (data: Float32Array) => {
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(0));
    for (let i = 0; i < n; i++) ctx.lineTo(xOf(i), yOf(data[i]));
    ctx.lineTo(xOf(n - 1), yOf(0));
    ctx.closePath();
  };
  fillPath(sim.frame);
  ctx.fillStyle = "rgba(224,138,69,0.2)";
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xOf(i);
    const y = yOf(sim.frame[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#e08a45";
  ctx.lineWidth = 1.75;
  ctx.stroke();

  if (sim.exact) {
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xOf(i);
      const y = yOf(sim.exact[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#93a79c";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function paintFilm(canvas: HTMLCanvasElement, sim: Sim) {
  const prep = prepare(canvas);
  if (!prep || !sim.film) return;
  const { ctx, cssW, cssH } = prep;
  const n = sim.n;
  const h = sim.filmH;
  const { min, max, signed } = rangeOf(sim, sim.frame);
  const map = signed || sim.forceSigned ? MAPS.signed : MAPS[sim.cmap];
  const off = offscreen(canvas);
  if (off.width !== n || off.height !== h) {
    off.width = n;
    off.height = h;
  }
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(n, h);
  const px = img.data;
  const count = Math.max(0, Math.min(h, sim.filmCount));
  const start = count < h ? 0 : sim.filmRow;
  const gap = h - count;
  px.fill(16);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  for (let row = 0; row < count; row++) {
    const srcRow = (start + row) % h;
    const dest = gap + row;
    for (let i = 0; i < n; i++) {
      const v = sim.film[srcRow * n + i];
      const c = idxOf(v, min, max) * 3;
      const p = (dest * n + i) * 4;
      px[p] = map[c];
      px[p + 1] = map[c + 1];
      px[p + 2] = map[c + 2];
      px[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, cssW, cssH);
}

export function legendGradient(sim: Sim) {
  const { signed } = rangeOf(sim, sim.frame);
  const map = signed || sim.forceSigned ? MAPS.signed : MAPS[sim.cmap];
  const stops = [0, 64, 128, 192, 255]
    .map((i) => {
      const t = Math.round((i / 255) * 100);
      const r = map[i * 3];
      const g = map[i * 3 + 1];
      const b = map[i * 3 + 2];
      return `rgb(${r} ${g} ${b}) ${t}%`;
    })
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}
