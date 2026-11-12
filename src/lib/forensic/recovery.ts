/**
 * KARALAMA / OBLİTERASYON İNCELEME ÇEKİRDEĞİ
 * Kalın karalama (marker) altında kalan ince yazıyı görünür kılmak için
 * gerçek adli görüntü laboratuvarlarında kullanılan tekniklerin yazılım
 * uygulaması:
 *
 *  - Spektral bant ve kanal-oranı (band ratio) görüntüleri
 *  - RGB üzerinden PCA (temel bileşen) ayrıştırma
 *  - Macenko renk ayrıştırması (optik yoğunluk uzayında mürekkep unmixing)
 *  - Morfolojik black top-hat (ince kalem çizgisini kalın karalamadan çıkarır)
 *  - Çok ölçekli DoG (difference of Gaussians)
 *  - Otomatik parametre taraması + bölge bazlı okunabilirlik skorlaması
 *
 * Tüm fonksiyonlar tarayıcıda çalışır; scoring, bölge (Rect 0..1 normalize)
 * verildiyse yalnızca o bölge üzerinden yapılır.
 */
import {
  GrayImage,
  Rect,
  RGB,
  applyGamma,
  applyLevels,
  clahe,
  gaussBlur,
  grayToImageData,
  invert,
  mixToGray,
  otsuThreshold,
  percentileStretch,
  resizeImageData,
  unsharpMask,
} from './filters';

/* ------------------------------------------------------------------ */
/* Gri morfoloji — kare yapılandırıcı eleman (separable min/max)       */
/* ------------------------------------------------------------------ */

function erode(g: GrayImage, r: number): GrayImage {
  const { w, h } = g;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        m = Math.min(m, g.d[y * w + xx]);
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        m = Math.min(m, tmp[yy * w + x]);
      }
      out[y * w + x] = m;
    }
  }
  return { w, h, d: out };
}

function dilate(g: GrayImage, r: number): GrayImage {
  const { w, h } = g;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        m = Math.max(m, g.d[y * w + xx]);
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        m = Math.max(m, tmp[yy * w + x]);
      }
      out[y * w + x] = m;
    }
  }
  return { w, h, d: out };
}

/** Black top-hat = closing(g) − g → SE'den ince KOYU yapıları parlakştırır. */
export function blackTopHat(g: GrayImage, radius: number): GrayImage {
  const closed = erode(dilate(g, radius), radius);
  const out = new Float32Array(g.d.length);
  for (let i = 0; i < g.d.length; i++) out[i] = Math.max(0, closed.d[i] - g.d[i]);
  return { w: g.w, h: g.h, d: out };
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function channelGray(src: ImageData, ch: 0 | 1 | 2): GrayImage {
  const g = mixToGray(src, ch === 0 ? [1, 0, 0] : ch === 1 ? [0, 1, 0] : [0, 0, 1]);
  return g;
}

/** Görüntüyü verilen genişliğe en yakın komşu ile ölçekler. */
export function scaleToWidth(src: ImageData, targetW: number): ImageData {
  if (targetW >= src.width) return src;
  const w = targetW;
  const h = Math.max(1, Math.round((src.height * targetW) / src.width));
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width));
      const sp = (sy * src.width + sx) * 4;
      const op = (y * w + x) * 4;
      out.data[op] = src.data[sp];
      out.data[op + 1] = src.data[sp + 1];
      out.data[op + 2] = src.data[sp + 2];
      out.data[op + 3] = 255;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3x3 eigen (güç yinelemesi + deflasyon) — PCA ve Macenko için        */
/* ------------------------------------------------------------------ */

function matVec(C: number[][], v: number[]): number[] {
  return C.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

function normalize(v: number[]): number[] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function topTwoEigenvectors(C: number[][]): [number[], number[]] {
  let v = normalize([1, 0.6, 0.3]);
  for (let it = 0; it < 40; it++) v = normalize(matVec(C, v));
  const e1 = v.slice();
  // deflasyon: C' = C − λ1 e1 e1ᵀ  (λ1 ≈ e1ᵀCe1)
  const Ce = matVec(C, e1);
  const lambda1 = e1[0] * Ce[0] + e1[1] * Ce[1] + e1[2] * Ce[2];
  const C2 = C.map((row, i) =>
    row.map((val, j) => val - lambda1 * e1[i] * e1[j])
  );
  let w = normalize([0.3, 1, 0.6]);
  for (let it = 0; it < 40; it++) w = normalize(matVec(C2, w));
  // e1'e dik olduğundan emin ol (Gram-Schmidt)
  const dot = e1[0] * w[0] + e1[1] * w[1] + e1[2] * w[2];
  const e2 = normalize([w[0] - dot * e1[0], w[1] - dot * e1[1], w[2] - dot * e1[2]]);
  return [e1, e2];
}

function percentileOf(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

/* ------------------------------------------------------------------ */
/* Macenko renk ayrıştırması (optik yoğunluk uzayı)                    */
/* ------------------------------------------------------------------ */

export interface UnmixVectors {
  sA: number[]; // baskın mürekkep (karalama)
  sB: number[]; // ikinci mürekkep (alttaki yazı)
  ok: boolean;
}

/** Piksel optik yoğunluklarından iki mürekkep vektörünü Macenko yöntemiyle bulur. */
export function computeUnmixVectors(src: ImageData): UnmixVectors {
  const small = scaleToWidth(src, 480);
  const d = small.data;
  const n = small.width * small.height;
  const ods: number[][] = [];
  const norms: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const od = [
      -Math.log10((d[p] + 1) / 256),
      -Math.log10((d[p + 1] + 1) / 256),
      -Math.log10((d[p + 2] + 1) / 256),
    ];
    const norm = Math.hypot(od[0], od[1], od[2]);
    ods.push(od);
    norms.push(norm);
  }
  const thr = Math.max(0.08, percentileOf(norms, 62));
  const masked: number[][] = [];
  for (let i = 0; i < n; i++) if (norms[i] > thr) masked.push(ods[i]);
  if (masked.length < n * 0.02) return { sA: [1, 1, 1], sB: [0, 1, 0], ok: false };

  // kovaryans
  const mean = [0, 0, 0];
  for (const m of masked) for (let k = 0; k < 3; k++) mean[k] += m[k] / masked.length;
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const m of masked) {
    const c = [m[0] - mean[0], m[1] - mean[1], m[2] - mean[2]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) C[i][j] += (c[i] * c[j]) / masked.length;
  }
  const [e1, e2] = topTwoEigenvectors(C);

  // açı dağılımı → uçlarda iki mürekkep
  const angles: number[] = masked.map((m) => {
    const a = m[0] * e1[0] + m[1] * e1[1] + m[2] * e1[2];
    const b = m[0] * e2[0] + m[1] * e2[1] + m[2] * e2[2];
    return Math.atan2(b, a);
  });
  const phi1 = percentileOf(angles, 3);
  let phi2 = percentileOf(angles, 97);
  // açı farkı yetersizse dik varsay
  if (Math.abs(phi2 - phi1) < 0.18) phi2 = phi1 + Math.PI / 2;

  const mk = (phi: number) =>
    normalize([
      Math.cos(phi) * e1[0] + Math.sin(phi) * e2[0],
      Math.cos(phi) * e1[1] + Math.sin(phi) * e2[1],
      Math.cos(phi) * e1[2] + Math.sin(phi) * e2[2],
    ]);
  const sA = mk(phi1);
  const sB = mk(phi2);
  return { sA, sB, ok: true };
}

/** İki mürekkep vektörüne göre OD uzayında çözüm → konsantrasyon haritaları. */
function unmixGray(src: ImageData, s: number[], other: number[]): GrayImage {
  const g = mixToGray(src, [0.299, 0.587, 0.114]); // sadece boyut için
  const d = src.data;
  const out = new Float32Array(g.d.length);
  const G = [
    [s[0] * s[0] + s[1] * s[1] + s[2] * s[2], s[0] * other[0] + s[1] * other[1] + s[2] * other[2]],
    [s[0] * other[0] + s[1] * other[1] + s[2] * other[2], other[0] * other[0] + other[1] * other[1] + other[2] * other[2]],
  ];
  const det = G[0][0] * G[1][1] - G[0][1] * G[1][0] || 1e-6;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const od = [
      -Math.log10((d[p] + 1) / 256),
      -Math.log10((d[p + 1] + 1) / 256),
      -Math.log10((d[p + 2] + 1) / 256),
    ];
    const rhs = [od[0] * s[0] + od[1] * s[1] + od[2] * s[2],
                 od[0] * other[0] + od[1] * other[1] + od[2] * other[2]];
    const c = (G[1][1] * rhs[0] - G[0][1] * rhs[1]) / det; // s konsantrasyonu
    out[i] = Math.max(0, c);
  }
  return { w: g.w, h: g.h, d: out };
}

/* ------------------------------------------------------------------ */
/* PCA bileşen görüntüleri                                             */
/* ------------------------------------------------------------------ */

export function pcaVectors(src: ImageData): { e1: number[]; e2: number[]; e3: number[] } {
  const small = scaleToWidth(src, 480);
  const d = small.data;
  const n = small.width * small.height;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    mean[0] += d[i * 4] / (n * 255);
    mean[1] += d[i * 4 + 1] / (n * 255);
    mean[2] += d[i * 4 + 2] / (n * 255);
  }
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    c[0] = d[i * 4] / 255 - mean[0];
    c[1] = d[i * 4 + 1] / 255 - mean[1];
    c[2] = d[i * 4 + 2] / 255 - mean[2];
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) C[a][b] += (c[a] * c[b]) / n;
  }
  const [e1, e2] = topTwoEigenvectors(C);
  const e3 = normalize([
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ]);
  return { e1, e2, e3 };
}

function projectGray(src: ImageData, v: number[]): GrayImage {
  const g = mixToGray(src, [0.299, 0.587, 0.114]);
  const d = src.data;
  for (let i = 0, p = 0; i < g.d.length; i++, p += 4) {
    g.d[i] = (d[p] * v[0] + d[p + 1] * v[1] + d[p + 2] * v[2]) / 255;
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Kanal-oranı görüntüleri                                             */
/* ------------------------------------------------------------------ */

type RatioOp = 'r-g' | 'r-b' | 'g-b' | '2g-r-b' | 'sat';

function ratioGray(src: ImageData, op: RatioOp): GrayImage {
  const g = mixToGray(src, [0.299, 0.587, 0.114]);
  const d = src.data;
  for (let i = 0, p = 0; i < g.d.length; i++, p += 4) {
    const r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255;
    let v: number;
    switch (op) {
      case 'r-g': v = r - gg; break;
      case 'r-b': v = r - b; break;
      case 'g-b': v = gg - b; break;
      case '2g-r-b': v = 2 * gg - r - b; break;
      case 'sat': {
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        v = mx > 0.02 ? (mx - mn) / mx : 0;
        break;
      }
    }
    g.d[i] = 0.5 + 0.5 * v; // işaretli farkı 0..1'e taşı
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Tarif (recipe) sistemi — tarama küçükte, uygulama tam boyda         */
/* ------------------------------------------------------------------ */

export type Recipe =
  | { kind: 'band'; label: string; mix: RGB }
  | { kind: 'ratio'; label: string; op: RatioOp }
  | { kind: 'pca'; label: string; vec: number[] }
  | { kind: 'unmix'; label: string; s: number[]; other: number[] }
  | { kind: 'tophat'; label: string; mix: RGB; radius: number }
  | { kind: 'dog'; label: string; s1: number; s2: number };

/** Tarif çekirdeği — görüntüleme son işlemesi OLMADAN gri görüntü üretir. */
function renderRecipeBase(src: ImageData, r: Recipe): GrayImage {
  let g: GrayImage;
  switch (r.kind) {
    case 'band': g = mixToGray(src, r.mix); break;
    case 'ratio': g = ratioGray(src, r.op); break;
    case 'pca': g = projectGray(src, r.vec); break;
    case 'unmix': g = unmixGray(src, r.s, r.other); break;
    case 'tophat': g = blackTopHat(mixToGray(src, r.mix), r.radius); break;
    case 'dog': {
      const a = gaussBlur(mixToGray(src, [0.299, 0.587, 0.114]), r.s1);
      const b = gaussBlur(mixToGray(src, [0.299, 0.587, 0.114]), r.s2);
      for (let i = 0; i < a.d.length; i++) a.d[i] = 0.5 + 0.5 * (a.d[i] - b.d[i]) * 2.2;
      g = a;
      break;
    }
  }
  return g;
}

/** Tarifi gri görüntüye çevirir ve varsayılan görüntüleme son işlemesini uygular. */
export function renderRecipe(src: ImageData, r: Recipe): GrayImage {
  const g = renderRecipeBase(src, r);
  postProcess(g);
  return g;
}

/** Tarif sonrası standart görüntüleme zinciri: yüzdelik germesi + CLAHE. */
function postProcess(g: GrayImage): void {
  percentileStretch(g, 1, 99);
  clahe(g, 8, 8, 2.6);
}

/* ------------------------------------------------------------------ */
/* İnce ayar — otomatik optimizasyon sonrası manuel kalibrasyon        */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcının seçtiği varyantı elle kalibre etmesi için ince ayar seti.
 * Varsayılanlar postProcess ile birebir aynıdır — sıfırlama her zaman
 * otomatik optimizasyonun çıktısına döner.
 */
export interface FineTune {
  gamma: number; // 0.4..2.6 — 1 nötr, >1 aydınlatır, <1 karartır
  lowPct: number; // 0..8 — yüzdelik germe alt kesmesi (gölge temizleme)
  highPct: number; // 92..100 — üst kesme (parlak alanları beyaza itme)
  claheClip: number; // 0..6 — yerel kontrast; 0 = kapalı
  sharpen: number; // 0..2 — unsharp keskinlik miktarı
  invert: boolean; // negatif görüntü
}

export const DEFAULT_FINE_TUNE: FineTune = {
  gamma: 1,
  lowPct: 1,
  highPct: 99,
  claheClip: 2.6,
  sharpen: 0,
  invert: false,
};

export function isDefaultTune(t: FineTune): boolean {
  return (
    t.gamma === DEFAULT_FINE_TUNE.gamma &&
    t.lowPct === DEFAULT_FINE_TUNE.lowPct &&
    t.highPct === DEFAULT_FINE_TUNE.highPct &&
    t.claheClip === DEFAULT_FINE_TUNE.claheClip &&
    t.sharpen === DEFAULT_FINE_TUNE.sharpen &&
    t.invert === DEFAULT_FINE_TUNE.invert
  );
}

/**
 * Hızlı görünüm ön ayarları — tek tıkla yaygın kalibrasyon hedefleri.
 * "NETLEŞTİR" ince yazı izlerini görünür kılmak için agresif yerel kontrast +
 * keskinlik uygular; KARART açık zemin üzerinde soluk izleri, AYDINLAT koyu
 * karalama içinde kalan izleri, NEGATİF ters kontrastlı mürekkepleri hedefler.
 */
export const TUNE_PRESETS: ReadonlyArray<{ id: string; label: string; tune: FineTune }> = [
  {
    id: 'netlestir',
    label: 'NETLEŞTİR',
    tune: { gamma: 1.18, lowPct: 1.5, highPct: 98.5, claheClip: 4.8, sharpen: 0.85, invert: false },
  },
  {
    id: 'aydinlat',
    label: 'AYDINLAT',
    tune: { gamma: 1.7, lowPct: 0.5, highPct: 99.5, claheClip: 2.4, sharpen: 0.3, invert: false },
  },
  {
    id: 'karart',
    label: 'KARART',
    tune: { gamma: 0.62, lowPct: 0.5, highPct: 99, claheClip: 3.2, sharpen: 0.4, invert: false },
  },
  { id: 'negatif', label: 'NEGATİF', tune: { ...DEFAULT_FINE_TUNE, invert: true } },
];

/** İnce ayar zinciri: germe → gamma → CLAHE → keskinlik → negatif. */
export function applyFineTune(g: GrayImage, t: FineTune): void {
  percentileStretch(g, t.lowPct, t.highPct);
  if (Math.abs(t.gamma - 1) > 0.01) applyGamma(g, t.gamma);
  if (t.claheClip >= 0.05) clahe(g, 8, 8, t.claheClip);
  if (t.sharpen >= 0.01) unsharpMask(g, 1.2, t.sharpen);
  if (t.invert) invert(g);
}

/** Tarifi ince ayar zinciriyle işler (canlı önizleme ve tam boy uygulama). */
export function renderRecipeTuned(src: ImageData, r: Recipe, t: FineTune): GrayImage {
  const g = renderRecipeBase(src, r);
  applyFineTune(g, t);
  return g;
}

/**
 * Canlı ince ayar üreticisi — tarif tabanını BİR kez hesaplayıp önbelleğe alır;
 * her çağrıda yalnızca ince ayar zinciri tabanın kopyası üzerinde çalışır.
 * Kaydırıcı sürüklenirken kare başına düşük maliyetle canlı önizleme sağlar
 * (renderRecipeTuned ile birebir aynı çıktıyı üretir).
 */
export function createLiveTuner(src: ImageData, r: Recipe): (t: FineTune) => GrayImage {
  const base = renderRecipeBase(src, r);
  return (t: FineTune) => {
    const g: GrayImage = { w: base.w, h: base.h, d: new Float32Array(base.d) };
    applyFineTune(g, t);
    return g;
  };
}

/* ------------------------------------------------------------------ */
/* Okunabilirlik skoru                                                 */
/* ------------------------------------------------------------------ */

/**
 * Okunabilirlik skoru.
 * `obscureMask` verildiyse istatistikler YALNIZCA karalama/tahrip alanının
 * içindeki piksellerden alınır — böylece markerın kendi kenarları değil,
 * altından sızan yazı yapısı ödüllendirilir. Mask yoksa tüm bölge kullanılır.
 */
export function scoreRegion(g: GrayImage, region: Rect | null, obscureMask?: Uint8Array): number {
  const x0 = region ? Math.max(0, Math.floor(region.x * g.w)) : 0;
  const y0 = region ? Math.max(0, Math.floor(region.y * g.h)) : 0;
  const x1 = region ? Math.min(g.w, Math.ceil((region.x + region.w) * g.w)) : g.w;
  const y1 = region ? Math.min(g.h, Math.ceil((region.y + region.h) * g.h)) : g.h;
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 8) return 0;
  const inMask = (i: number): boolean => (obscureMask ? obscureMask[i] === 1 : true);

  let n = 0, sum = 0, sumSq = 0, content = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * g.w + x;
      if (!inMask(i)) continue;
      const v = g.d[i];
      n++;
      sum += v;
      sumSq += v * v;
      if (v > 0.08 && v < 0.92) content++;
    }
  }
  if (n < 200) {
    // mask bölgede yetersiz → tüm bölgeye düş (eski davranış)
    return scoreRegion(g, region);
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

  let grad = 0, gn = 0;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const i = y * g.w + x;
      if (!inMask(i) || !inMask(i - 1) || !inMask(i + 1) ||
          !inMask(i - g.w) || !inMask(i + g.w)) continue;
      grad += Math.abs(g.d[i + 1] - g.d[i - 1]) + Math.abs(g.d[i + g.w] - g.d[i - g.w]);
      gn++;
    }
  }
  grad /= gn || 1;

  // uzamsal tutarlılık: gerçek çizgiler hafif bulanıklıktan hayatta kalır,
  // yükseltilmiş gürültü kaybolur. Gürültü sömürüsünü cezalandırır.
  let coherence = 1;
  if (grad > 0.01) {
    const gb = gaussBlur(g, 1.0);
    let gradB = 0;
    for (let y = y0 + 1; y < y1 - 1; y++) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        const i = y * g.w + x;
        if (!inMask(i) || !inMask(i - 1) || !inMask(i + 1) ||
            !inMask(i - g.w) || !inMask(i + g.w)) continue;
        gradB += Math.abs(gb.d[i + 1] - gb.d[i - 1]) + Math.abs(gb.d[i + g.w] - gb.d[i - g.w]);
      }
    }
    gradB /= gn || 1;
    coherence = Math.max(0, Math.min(1, (gradB / grad) * 1.9));
  }

  const contentFrac = content / n;
  if (std < 0.015) return 0;
  return (std * 0.62 + grad * 2.4) * (0.25 + 0.75 * contentFrac) * (0.3 + 0.7 * coherence);
}

/**
 * Karalama/tahrip alanı maskesi: beyaz ışık grisi üzerinde Otsu eşiği,
 * ardından 2px AŞINDIRMA — böylece skorlama markerın saf iç kısmına odaklanır;
 * markerın kendi yüksek kontrastlı kenar bantları skorlama dışı kalır.
 */
export function buildObscureMask(src: ImageData): Uint8Array {
  const g = mixToGray(src, [0.299, 0.587, 0.114]);
  percentileStretch(g, 1, 99);
  const t = Math.max(0.08, Math.min(0.6, otsuThreshold(g) * 0.92));
  const { w, h } = g;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = g.d[i] < t ? 1 : 0;
  // 2 kez 3x3 aşındırma (erode): kenar bandını at, iç kısmı koru
  for (let it = 0; it < 2; it++) {
    const prev = mask.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!prev[i]) continue;
        const edge =
          x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          !prev[i - 1] || !prev[i + 1] || !prev[i - w] || !prev[i + w];
        if (edge) mask[i] = 0;
      }
    }
  }
  return mask;
}

/* ------------------------------------------------------------------ */
/* Otomatik tarama: tarif üretimi + sıralama                           */
/* ------------------------------------------------------------------ */

export interface Candidate {
  id: string;
  recipe: Recipe;
  score: number;
  /** Tarama çözünürlüğünde görüntü (küçük önizleme için). */
  preview: ImageData;
}

export interface ScanResult {
  candidates: Candidate[];
  /** Tarama çözünürlüğünde kaynak görüntü — ince ayar önizlemesi bunun üzerinden çalışır. */
  scanSrc: ImageData;
  /** Karalama alanı maskesi — ince ayar sırasında canlı skor için. */
  obscureMask: Uint8Array;
}

export interface ScanProgress {
  done: number;
  total: number;
}

const SCAN_MAX_W = 720;

function buildRecipes(src: ImageData): Recipe[] {
  const uv = computeUnmixVectors(src);
  const pca = pcaVectors(src);
  const list: Recipe[] = [
    { kind: 'band', label: 'Beyaz Işık', mix: [0.299, 0.587, 0.114] },
    { kind: 'band', label: 'IR 850nm', mix: [0.68, 0.32, 0.0] },
    { kind: 'band', label: 'IR Derin 980nm', mix: [0.82, 0.18, 0.0] },
    { kind: 'band', label: 'Kırmızı 630nm', mix: [0.93, 0.14, 0.02] },
    { kind: 'band', label: 'Mavi 470nm', mix: [0.08, 0.3, 0.72] },
    { kind: 'band', label: 'Yeşil 530nm', mix: [0.22, 0.7, 0.08] },
    { kind: 'band', label: 'UV-A 365nm', mix: [0.16, 0.36, 0.62] },
    { kind: 'ratio', label: 'Oran R−G', op: 'r-g' },
    { kind: 'ratio', label: 'Oran R−B', op: 'r-b' },
    { kind: 'ratio', label: 'Oran G−B', op: 'g-b' },
    { kind: 'ratio', label: 'Aşırı Yeşil 2G−R−B', op: '2g-r-b' },
    { kind: 'ratio', label: 'Doygunluk', op: 'sat' },
    { kind: 'pca', label: 'PCA B1 (luminans)', vec: pca.e1 },
    { kind: 'pca', label: 'PCA B2 (renk-farkı)', vec: pca.e2 },
    { kind: 'pca', label: 'PCA B3 (kalıntı)', vec: pca.e3 },
    { kind: 'tophat', label: 'Top-Hat r=3 · Beyaz', mix: [0.299, 0.587, 0.114], radius: 3 },
    { kind: 'tophat', label: 'Top-Hat r=6 · Beyaz', mix: [0.299, 0.587, 0.114], radius: 6 },
    { kind: 'tophat', label: 'Top-Hat r=10 · Beyaz', mix: [0.299, 0.587, 0.114], radius: 10 },
    { kind: 'tophat', label: 'Top-Hat r=3 · IR', mix: [0.68, 0.32, 0.0], radius: 3 },
    { kind: 'tophat', label: 'Top-Hat r=6 · IR', mix: [0.68, 0.32, 0.0], radius: 6 },
    { kind: 'tophat', label: 'Top-Hat r=10 · IR', mix: [0.68, 0.32, 0.0], radius: 10 },
    { kind: 'tophat', label: 'Top-Hat r=6 · Kırmızı', mix: [0.93, 0.14, 0.02], radius: 6 },
    { kind: 'dog', label: 'DoG 1/4', s1: 1, s2: 4 },
    { kind: 'dog', label: 'DoG 2/8', s1: 2, s2: 8 },
  ];
  if (uv.ok) {
    list.push({ kind: 'unmix', label: 'Ayrıştırma A (karalama)', s: uv.sB, other: uv.sA });
    list.push({ kind: 'unmix', label: 'Ayrıştırma B (alt yazı)', s: uv.sA, other: uv.sB });
  }
  return list;
}

/**
 * Otomatik tarama: görüntüyü tarama çözünürlüğüne indirir, tüm tarifleri
 * üretip skorlar; en iyi `top` adet döndürür. Uzun sürebileceği için her
 * adımda `onProgress` çağrılır ve tarayıcıya nefes payı bırakılır.
 */
/**
 * Aile bazlı çeşitlilik: her teknik ailesinden (band/ratio/pca/unmix/tophat/dog)
 * en iyi aday ilk tura alınır — farklı ailelerin mutlak skor farkları yüzünden
 * işe yarayan tekniklerin galereye girmemesi engellenir (VSC uzmanı akışı).
 */
function diverseTopK(scored: Candidate[], k: number): Candidate[] {
  const byFam = new Map<string, Candidate[]>();
  for (const c of scored) {
    const f = c.recipe.kind;
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f)!.push(c); // scored zaten azalan sırada → aile listesi de sıralı
  }
  const fams = [...byFam.entries()].sort(
    (a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0)
  );
  const out: Candidate[] = [];
  let added = true;
  while (out.length < k && added) {
    added = false;
    for (const [, list] of fams) {
      if (list.length && out.length < k) {
        out.push(list.shift()!);
        added = true;
      }
    }
  }
  return out;
}

export async function autoScan(
  srcFull: ImageData,
  region: Rect | null,
  top = 9,
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  const scan = scaleToWidth(resizeImageData(srcFull, 1400), SCAN_MAX_W);
  // bölgeyi tarama görüntüsüne göre ölçekle (0..1 normalize olduğu için aynen geçerli)
  const obscureMask = buildObscureMask(scan);
  const recipes = buildRecipes(scan);
  const scored: Candidate[] = [];
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    const g = renderRecipe(scan, r);
    const score = scoreRegion(g, region, obscureMask);
    scored.push({
      id: `${r.kind}-${i}`,
      recipe: r,
      score,
      preview: grayToImageData(g),
    });
    onProgress?.({ done: i + 1, total: recipes.length });
    if (i % 4 === 3) await new Promise((res) => setTimeout(res, 0));
  }
  scored.sort((a, b) => b.score - a.score);
  return { candidates: diverseTopK(scored, top), scanSrc: scan, obscureMask };
}

/** Seçilen tarifi TAM çözünürlükte işleyip görüntüleyiciye uygulanacak hale getirir.
 *  `tune` verilirse ince ayar zinciriyle, verilmezse varsayılan zincirle işlenir. */
export function renderCandidateFull(srcFull: ImageData, recipe: Recipe, tune?: FineTune): ImageData {
  const g = tune ? renderRecipeTuned(srcFull, recipe, tune) : renderRecipe(srcFull, recipe);
  return grayToImageData(g);
}
