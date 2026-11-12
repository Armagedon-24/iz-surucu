/**
 * ADLİ GÖRÜNTÜ İŞLEME ÇEKİRDEĞİ
 * Gerçek adli belge inceleme (Questioned Document Examination) tekniklerinin
 * yazılım simülasyonu: spektral bant ayrımı, CLAHE, Sauvola/Otsu eşikleme,
 * Sobel kenar, eğik ışık (raking light), false-color yoğunluk haritaları,
 * anomali taraması.
 *
 * Tüm işlemler Float32 gri (0..1) üzerinden yürür; sonuç ImageData'ya çevrilir.
 */

export interface GrayImage {
  w: number;
  h: number;
  d: Float32Array; // 0..1
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RGB = [number, number, number];

/* ------------------------------------------------------------------ */
/* Temel dönüşümler                                                    */
/* ------------------------------------------------------------------ */

/** RGB ImageData'yı kanal ağırlıklarıyla tek banda (gri) indirger. */
export function mixToGray(src: ImageData, mix: RGB): GrayImage {
  const { width: w, height: h, data } = src;
  const out = new Float32Array(w * h);
  const [mr, mg, mb] = mix;
  const sum = Math.abs(mr) + Math.abs(mg) + Math.abs(mb) || 1;
  const kr = mr / sum;
  const kg = mg / sum;
  const kb = mb / sum;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (kr * data[p] + kg * data[p + 1] + kb * data[p + 2]) / 255;
  }
  return { w, h, d: out };
}

/** Gri görüntüyü ImageData'ya renklendirir (tonlama + isteğe bağlı LUT). */
export function grayToImageData(
  g: GrayImage,
  tint?: RGB,
  tintMix = 0,
  lut?: Uint8ClampedArray
): ImageData {
  const out = new ImageData(g.w, g.h);
  const o = out.data;
  const [tr, tg, tb] = tint ?? [1, 1, 1];
  const tm = lut ? 0 : tintMix;
  for (let i = 0, p = 0; i < g.d.length; i++, p += 4) {
    let r: number, gg: number, b: number;
    if (lut) {
      const idx = Math.max(0, Math.min(255, Math.round(g.d[i] * 255))) * 3;
      r = lut[idx];
      gg = lut[idx + 1];
      b = lut[idx + 2];
    } else {
      const v = clamp01(g.d[i]) * 255;
      r = v * ((1 - tm) + tm * tr);
      gg = v * ((1 - tm) + tm * tg);
      b = v * ((1 - tm) + tm * tb);
    }
    o[p] = r;
    o[p + 1] = gg;
    o[p + 2] = b;
    o[p + 3] = 255;
  }
  return out;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/* ------------------------------------------------------------------ */
/* Nokta işlemleri                                                     */
/* ------------------------------------------------------------------ */

export function applyLevels(g: GrayImage, black: number, white: number): void {
  const range = Math.max(0.02, white - black);
  for (let i = 0; i < g.d.length; i++) {
    g.d[i] = clamp01((g.d[i] - black) / range);
  }
}

/** Yüzdelik germesi: histogram uçlarındaki %p1..%p99 aralığını 0..1'e gerer. */
export function percentileStretch(g: GrayImage, pLow = 1, pHigh = 99): void {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.d.length; i++) {
    hist[Math.min(255, Math.max(0, (g.d[i] * 255) | 0))]++;
  }
  const total = g.d.length || 1;
  const loCount = Math.round((pLow / 100) * total);
  const hiCount = Math.round((pHigh / 100) * total);
  let acc = 0, black = 0, white = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= loCount) { black = i; break; }
  }
  acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= hiCount) { white = i; break; }
  }
  if (white - black < 8) {
    // seyrek özellik (top-hat/unmix gibi): p1..p99 yetersiz → gerçek min/max ile ger
    let mn = 1, mx = 0;
    for (let i = 0; i < g.d.length; i++) {
      const v = g.d[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx - mn < 0.01) return; // düz görüntü
    applyLevels(g, mn, mx);
    return;
  }
  applyLevels(g, black / 255, white / 255);
}

export function applyExposureContrast(g: GrayImage, exposure: number, contrast: number): void {
  const c = Math.pow(2, contrast); // contrast: -1..3 → 0.5x..8x
  for (let i = 0; i < g.d.length; i++) {
    let v = g.d[i] + exposure;
    v = (v - 0.5) * c + 0.5;
    g.d[i] = clamp01(v);
  }
}

export function applyGamma(g: GrayImage, gamma: number): void {
  const inv = 1 / Math.max(0.05, gamma);
  for (let i = 0; i < g.d.length; i++) {
    g.d[i] = Math.pow(clamp01(g.d[i]), inv);
  }
}

export function invert(g: GrayImage): void {
  for (let i = 0; i < g.d.length; i++) g.d[i] = 1 - g.d[i];
}

/* ------------------------------------------------------------------ */
/* Bulanıklaştırma                                                     */
/* ------------------------------------------------------------------ */

/** Ayrılabilir Gauss bulanıklığı. */
export function gaussBlur(g: GrayImage, sigma: number): GrayImage {
  if (sigma <= 0.05) return { w: g.w, h: g.h, d: g.d.slice() };
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  const s2 = 2 * sigma * sigma;
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / s2);
    k[i + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ksum;

  const { w, h } = g;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  // yatay
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        acc += g.d[row + xx] * k[i + radius];
      }
      tmp[row + x] = acc;
    }
  }
  // dikey
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        acc += tmp[yy * w + x] * k[i + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return { w, h, d: out };
}

/* ------------------------------------------------------------------ */
/* CLAHE — Adaptif lokal kontrast (tomografi/adli standart algoritma)  */
/* ------------------------------------------------------------------ */

export function clahe(g: GrayImage, tilesX = 8, tilesY = 8, clipLimit = 2.5): void {
  const { w, h, d } = g;
  const tx = Math.max(1, Math.min(16, tilesX));
  const ty = Math.max(1, Math.min(16, tilesY));
  if (tx < 2 || ty < 2) {
    histEqGlobal(d);
    return;
  }
  const tileW = Math.ceil(w / tx);
  const tileH = Math.ceil(h / ty);
  const histSize = 256;
  const clipCount = Math.max(1, Math.floor((clipLimit * tileW * tileH) / histSize));

  const maps: Float32Array[] = [];
  for (let tyi = 0; tyi < ty; tyi++) {
    for (let txi = 0; txi < tx; txi++) {
      const x0 = txi * tileW;
      const y0 = tyi * tileH;
      const x1 = Math.min(w, x0 + tileW);
      const y1 = Math.min(h, y0 + tileH);
      const hist = new Uint32Array(histSize);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.min(255, Math.max(0, (d[y * w + x] * 255) | 0))]++;
          count++;
        }
      }
      if (count === 0) {
        maps.push(new Float32Array(histSize));
        continue;
      }
      // kırpma + yeniden dağıtım
      let excess = 0;
      for (let i = 0; i < histSize; i++) {
        if (hist[i] > clipCount) {
          excess += hist[i] - clipCount;
          hist[i] = clipCount;
        }
      }
      const bonus = excess / histSize;
      const cdf = new Float32Array(histSize);
      let acc = 0;
      for (let i = 0; i < histSize; i++) {
        acc += hist[i] + bonus;
        cdf[i] = acc / count;
      }
      maps.push(cdf);
    }
  }

  // bilinear interpolasyonla uygula
  for (let y = 0; y < h; y++) {
    const fy = Math.min(y / tileH - 0.5, ty - 1);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(ty - 1, y0 + 1);
    const wy = clamp01(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = Math.min(x / tileW - 0.5, tx - 1);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(tx - 1, x0 + 1);
      const wx = clamp01(fx - x0);
      const bin = Math.min(255, Math.max(0, (d[y * w + x] * 255) | 0));
      const a = maps[y0 * tx + x0][bin];
      const b = maps[y0 * tx + x1][bin];
      const c = maps[y1 * tx + x0][bin];
      const e = maps[y1 * tx + x1][bin];
      d[y * w + x] = a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + e * wx * wy;
    }
  }
}

export function histEqGlobal(d: Float32Array): void {
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i++) {
    hist[Math.min(255, Math.max(0, (d[i] * 255) | 0))]++;
  }
  const cdf = new Float32Array(256);
  let acc = 0;
  const total = d.length || 1;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    cdf[i] = acc / total;
  }
  for (let i = 0; i < d.length; i++) {
    d[i] = cdf[Math.min(255, Math.max(0, (d[i] * 255) | 0))];
  }
}

/* ------------------------------------------------------------------ */
/* Unsharp maske — keskinleştirme                                      */
/* ------------------------------------------------------------------ */

export function unsharpMask(g: GrayImage, sigma: number, amount: number): void {
  const blurred = gaussBlur(g, sigma);
  for (let i = 0; i < g.d.length; i++) {
    g.d[i] = clamp01(g.d[i] + amount * (g.d[i] - blurred.d[i]));
  }
}

/* ------------------------------------------------------------------ */
/* Sobel kenar / gradyan                                               */
/* ------------------------------------------------------------------ */

export function sobel(g: GrayImage): void {
  const { w, h, d } = g;
  const src = d.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = src[i - w - 1], t = src[i - w], tr = src[i - w + 1];
      const l = src[i - 1], r = src[i + 1];
      const bl = src[i + w - 1], b = src[i + w], br = src[i + w + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      d[i] = Math.sqrt(gx * gx + gy * gy) * 0.25;
    }
  }
  // kenarlar
  for (let x = 0; x < w; x++) {
    d[x] = 0;
    d[(h - 1) * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    d[y * w] = 0;
    d[y * w + w - 1] = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Eğik ışık (raking light) — girinti/baskı izi simülasyonu            */
/* ------------------------------------------------------------------ */

export function rakingLight(g: GrayImage, angleDeg: number, strength: number): void {
  const pre = gaussBlur(g, 1.1);
  const { w, h, d } = g;
  const src = pre.d;
  const rad = (angleDeg * Math.PI) / 180;
  const cx = Math.cos(rad);
  const cy = Math.sin(rad);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (src[i - w + 1] + 2 * src[i + 1] + src[i + w + 1]) -
                 (src[i - w - 1] + 2 * src[i - 1] + src[i + w - 1]);
      const gy = (src[i + w - 1] + 2 * src[i + w] + src[i + w + 1]) -
                 (src[i - w - 1] + 2 * src[i - w] + src[i - w + 1]);
      const shade = (gx * cx + gy * cy) * 4 * strength;
      d[i] = clamp01(0.5 + shade);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Eşikleme — Otsu ve Sauvola                                          */
/* ------------------------------------------------------------------ */

export function otsuThreshold(g: GrayImage): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.d.length; i++) {
    hist[Math.min(255, Math.max(0, (g.d[i] * 255) | 0))]++;
  }
  const total = g.d.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold / 255;
}

export function applyOtsu(g: GrayImage): void {
  const t = otsuThreshold(g);
  for (let i = 0; i < g.d.length; i++) g.d[i] = g.d[i] >= t ? 1 : 0;
}

/** Sauvola adaptif eşikleme (integral imaj tabanlı) — OCR ön işlemesi standardı. */
export function applySauvola(g: GrayImage, window = 31, k = 0.34): void {
  const { w, h, d } = g;
  const win = Math.max(3, Math.round(window) | 1);
  const half = win >> 1;
  const R = 0.5;

  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  const integralSq = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = d[y * w + x];
      rowSum += v;
      rowSq += v * v;
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
      integralSq[(y + 1) * iw + (x + 1)] = integralSq[y * iw + (x + 1)] + rowSq;
    }
  }

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const ix0 = x0, iy0 = y0, ix1 = x1 + 1, iy1 = y1 + 1;
      const s =
        integral[iy1 * iw + ix1] - integral[iy0 * iw + ix1] -
        integral[iy1 * iw + ix0] + integral[iy0 * iw + ix0];
      const sq =
        integralSq[iy1 * iw + ix1] - integralSq[iy0 * iw + ix1] -
        integralSq[iy1 * iw + ix0] + integralSq[iy0 * iw + ix0];
      const mean = s / area;
      const variance = Math.max(0, sq / area - mean * mean);
      const sd = Math.sqrt(variance);
      const t = mean * (1 + k * (sd / R - 1));
      out[y * w + x] = d[y * w + x] > t ? 1 : 0;
    }
  }
  d.set(out);
}

/* ------------------------------------------------------------------ */
/* False-color LUT'lar (yoğunluk haritaları)                           */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildLut(stops: Array<[number, string]>): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (t >= stops[j][0] && t <= stops[j + 1][0]) {
        s0 = stops[j];
        s1 = stops[j + 1];
        break;
      }
    }
    const span = s1[0] - s0[0] || 1;
    const f = Math.min(1, Math.max(0, (t - s0[0]) / span));
    const c0 = hexToRgb(s0[1]);
    const c1 = hexToRgb(s1[1]);
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * f;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * f;
  }
  return lut;
}

export const LUTS: Record<string, Uint8ClampedArray> = {
  ironbow: buildLut([
    [0, '#0a0208'], [0.15, '#2b0140'], [0.35, '#841a05'],
    [0.55, '#d94f00'], [0.75, '#ffb32c'], [0.9, '#ffe9a8'], [1, '#ffffff'],
  ]),
  spectral: buildLut([
    [0, '#0b0b14'], [0.2, '#5b1a8a'], [0.4, '#c8352b'],
    [0.6, '#e8a02c'], [0.8, '#8bc03c'], [1, '#f4f9e0'],
  ]),
  viridis: buildLut([
    [0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'],
    [0.75, '#5ec962'], [1, '#fde725'],
  ]),
};

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function histogram(g: GrayImage): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.d.length; i++) {
    hist[Math.min(255, Math.max(0, (g.d[i] * 255) | 0))]++;
  }
  return hist;
}

/* ------------------------------------------------------------------ */
/* Otomatik anomali taraması                                           */
/* ------------------------------------------------------------------ */

export interface AnomalyCell {
  gx: number; // grid x
  gy: number; // grid y
  score: number; // 0..1
  band: string; // en çok ayrışan bant
}

/**
 * Spektral tutarlılık taraması: farklı sanal bantlarda (UV/IR/kırmızı/mavi)
 * piksel yanıtları arasındaki yapısal sapmaları ölçer. Kimyasal silme,
 * mürekkep farkı ve sonradan ekleme bölgeleri bantlar arasında farklı davranır.
 */
export function anomalyScan(src: ImageData, grid = 22): {
  cells: AnomalyCell[];
  gridW: number;
  gridH: number;
} {
  // küçük ölçekli çalışma kopyası
  const scale = Math.min(1, 480 / Math.max(src.width, src.height));
  const tw = Math.max(32, Math.round(src.width * scale));
  const th = Math.max(32, Math.round(src.height * scale));
  const thumb = new ImageData(tw, th);
  // nearest-neighbor downscale
  const sd = src.data;
  const td = thumb.data;
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / th) * src.height));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / tw) * src.width));
      const sp = (sy * src.width + sx) * 4;
      const tp = (y * tw + x) * 4;
      td[tp] = sd[sp];
      td[tp + 1] = sd[sp + 1];
      td[tp + 2] = sd[sp + 2];
      td[tp + 3] = 255;
    }
  }

  const bands: Array<{ id: string; mix: RGB }> = [
    { id: 'UV-A', mix: [0.15, 0.35, 0.68] },
    { id: 'IR', mix: [0.72, 0.28, 0.0] },
    { id: 'Kırmızı', mix: [0.95, 0.1, 0.0] },
    { id: 'Mavi', mix: [0.1, 0.3, 0.78] },
  ];
  const grays = bands.map((b) => gaussBlur(mixToGray(thumb, b.mix), 1.0));

  const gw = grid;
  const gh = Math.max(4, Math.round((grid * th) / tw));
  const scores: number[][] = Array.from({ length: gh }, () => new Array(gw).fill(0));
  const bestBand: string[][] = Array.from({ length: gh }, () => new Array(gw).fill('-'));

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx / gw) * tw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) / gw) * tw));
      const y0 = Math.floor((gy / gh) * th);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) / gh) * th));
      let best = 0;
      let band = '-';
      for (let b = 1; b < grays.length; b++) {
        let diff = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * tw + x;
            diff += Math.abs(grays[b].d[i] - grays[0].d[i]);
            n++;
          }
        }
        diff /= n || 1;
        if (diff > best) {
          best = diff;
          band = bands[b].id;
        }
      }
      scores[gy][gx] = best;
      bestBand[gy][gx] = band;
    }
  }

  // istatistiksel eşik: medyan + 2.6 * MAD
  const flat: number[] = [];
  for (const row of scores) for (const s of row) flat.push(s);
  flat.sort((a, b) => a - b);
  const median = flat[Math.floor(flat.length / 2)] || 0;
  const devs = flat.map((s) => Math.abs(s - median)).sort((a, b) => a - b);
  const mad = devs[Math.floor(devs.length / 2)] || 0.001;
  const cutoff = median + 2.6 * mad * 1.4826 + 0.012;

  const cells: AnomalyCell[] = [];
  const maxScore = flat[flat.length - 1] || 1;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const s = scores[gy][gx];
      if (s > cutoff && s > 0.02) {
        cells.push({ gx, gy, score: Math.min(1, s / (maxScore || 1)), band: bestBand[gy][gx] });
      }
    }
  }
  return { cells, gridW: gw, gridH: gh };
}

/** ImageData'yı belirtilen maksimum boyuta yeniden boyutlar (nearest neighbor). */
export function resizeImageData(src: ImageData, maxDim: number): ImageData {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new ImageData(w, h);
  const sd = src.data;
  const od = out.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width));
      const sp = (sy * src.width + sx) * 4;
      const op = (y * w + x) * 4;
      od[op] = sd[sp];
      od[op + 1] = sd[sp + 1];
      od[op + 2] = sd[sp + 2];
      od[op + 3] = 255;
    }
  }
  return out;
}

export { clamp255 };
