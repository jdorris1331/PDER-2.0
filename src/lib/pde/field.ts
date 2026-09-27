import type { BC, Stats } from "@/lib/pde/types";

export function ix(n: number, i: number, j: number) {
  return j * n + i;
}

function ghost(
  src: Float32Array,
  n: number,
  i: number,
  j: number,
  bc: BC,
): number {
  if (bc === "periodic") {
    const ii = ((i % n) + n) % n;
    const jj = ((j % n) + n) % n;
    return src[jj * n + ii];
  }
  if (i < 0 || j < 0 || i >= n || j >= n) {
    if (bc === "neumann") {
      const ii = Math.max(0, Math.min(n - 1, i));
      const jj = Math.max(0, Math.min(n - 1, j));
      return src[jj * n + ii];
    }
    return 0;
  }
  return src[j * n + i];
}

/** Five-point Laplacian in grid units: east+west+north+south−4·center. */
export function lap5(src: Float32Array, dst: Float32Array, n: number, bc: BC) {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = src[ix(n, i, j)];
      dst[ix(n, i, j)] =
        ghost(src, n, i + 1, j, bc) +
        ghost(src, n, i - 1, j, bc) +
        ghost(src, n, i, j + 1, bc) +
        ghost(src, n, i, j - 1, bc) -
        4 * c;
    }
  }
}

/**
 * PDER 1.0 laplacian: div(grad) with centered differences,
 * i.e. (u[i+2] − 2u + u[i−2]) / 4 on each axis. Outside samples are 0.
 */
export function laplacLegacy(src: Float32Array, dst: Float32Array, n: number, bc: BC) {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = src[ix(n, i, j)];
      const xx = (ghost(src, n, i + 2, j, bc) - 2 * c + ghost(src, n, i - 2, j, bc)) / 4;
      const yy = (ghost(src, n, i, j + 2, bc) - 2 * c + ghost(src, n, i, j - 2, bc)) / 4;
      dst[ix(n, i, j)] = xx + yy;
    }
  }
}

export function derivX(src: Float32Array, dst: Float32Array, n: number, bc: BC) {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      dst[ix(n, i, j)] =
        (ghost(src, n, i + 1, j, bc) - ghost(src, n, i - 1, j, bc)) / 2;
    }
  }
}

export function derivY(src: Float32Array, dst: Float32Array, n: number, bc: BC) {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      dst[ix(n, i, j)] =
        (ghost(src, n, i, j + 1, bc) - ghost(src, n, i, j - 1, bc)) / 2;
    }
  }
}

export function lap1(src: Float32Array, dst: Float32Array, n: number, bc: BC) {
  for (let i = 0; i < n; i++) {
    const c = src[i];
    const l =
      i > 0 ? src[i - 1] : bc === "periodic" ? src[n - 1] : bc === "neumann" ? c : 0;
    const r =
      i < n - 1 ? src[i + 1] : bc === "periodic" ? src[0] : bc === "neumann" ? c : 0;
    dst[i] = l + r - 2 * c;
  }
}

export function fill(a: Float32Array, v: number) {
  a.fill(v);
}

export function addGaussian2(
  a: Float32Array,
  n: number,
  cx: number,
  cy: number,
  radius: number,
  amp: number,
) {
  const r2 = radius * radius;
  const i0 = Math.max(0, Math.floor((cx - radius * 3) * (n - 1)));
  const i1 = Math.min(n - 1, Math.ceil((cx + radius * 3) * (n - 1)));
  const j0 = Math.max(0, Math.floor((cy - radius * 3) * (n - 1)));
  const j1 = Math.min(n - 1, Math.ceil((cy + radius * 3) * (n - 1)));
  for (let j = j0; j <= j1; j++) {
    const y = j / (n - 1);
    for (let i = i0; i <= i1; i++) {
      const x = i / (n - 1);
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      a[ix(n, i, j)] += amp * Math.exp(-d2 / Math.max(1e-8, r2));
    }
  }
}

export function addGaussian1(a: Float32Array, n: number, cx: number, sigma: number, amp: number) {
  const s2 = sigma * sigma;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const d = x - cx;
    a[i] += amp * Math.exp(-(d * d) / Math.max(1e-8, s2));
  }
}

export function scan(a: Float32Array): { min: number; max: number; mean: number; l2: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sum2 = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sum2 += v * v;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0, mean: 0, l2: 0 };
  return { min, max, mean: sum / n, l2: Math.sqrt(sum2 / n) };
}

export function isBlown(a: Float32Array) {
  const mid = a[(a.length / 2) | 0];
  if (!Number.isFinite(mid) || Math.abs(mid) > 1e5) return true;
  const edge = a[0];
  if (!Number.isFinite(edge) || Math.abs(edge) > 1e5) return true;
  return false;
}

export function makeStats(
  a: Float32Array,
  t: number,
  badge: Stats["badge"],
  badgeText: string,
  extra?: string,
): Stats {
  const s = scan(a);
  return { t, ...s, badge, badgeText, extra };
}

export function hash01(i: number, seed = 1) {
  let h = Math.imul(i ^ seed, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** In-place radix-2 complex FFT. Length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array, invert: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? 1 : -1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * wRe - im[b] * wIm;
        const vi = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}
