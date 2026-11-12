/**
 * SPEKTRAL İŞLEM HATTI (Pipeline)
 * VSC (Video Spectral Comparator) cihazlarının ışık bantlarının yazılım
 * simülasyonu + adli görüntü işleme operasyonları zinciri.
 */
import {
  GrayImage,
  LUTS,
  Rect,
  RGB,
  anomalyScan,
  applyExposureContrast,
  applyGamma,
  applyLevels,
  applyOtsu,
  applySauvola,
  clahe,
  gaussBlur,
  grayToImageData,
  histogram,
  invert,
  mixToGray,
  rakingLight,
  sobel,
  unsharpMask,
} from './filters';

/* ------------------------------------------------------------------ */
/* Spektral bant tanımları                                             */
/* ------------------------------------------------------------------ */

export type BandId =
  | 'white' | 'uv365' | 'uvc254' | 'violet405' | 'blue470' | 'green530'
  | 'amber590' | 'red630' | 'deepred680' | 'ir850' | 'ir980'
  | 'luminesans' | 'custom';

export interface Band {
  id: BandId;
  name: string;
  nm: string;
  group: 'Görünür' | 'UV' | 'IR' | 'Filtre' | 'Özel';
  mix: RGB;
  tint?: RGB;
  tintMix?: number;
  blur?: number;
  gamma?: number;
  contrast?: number;
  luminesans?: boolean;
  desc: string;
}

export const BANDS: Band[] = [
  {
    id: 'white', name: 'Beyaz Işık', nm: '400–700 nm', group: 'Görünür',
    mix: [0.299, 0.587, 0.114],
    desc: 'Doğal görünür ışık; referans görüntü. Silme ve tahrip izleri en iyi diğer bantlarla karşılaştırılarak değerlendirilir.',
  },
  {
    id: 'uv365', name: 'UV-A Fluoresans', nm: '365 nm', group: 'UV',
    mix: [0.16, 0.36, 0.62], tint: [0.62, 0.5, 0.92], tintMix: 0.32,
    gamma: 0.82, contrast: 0.55,
    desc: 'Ultraviyole uyarım: kimyasal silme lekeleri, sıvı koruma mürekkepleri ve yapışkan kalıntıları fluorescence eder. Çok bantlı VSC incelemesinin temel modu.',
  },
  {
    id: 'uvc254', name: 'UV-C Absorpsiyon', nm: '254 nm', group: 'UV',
    mix: [0.1, 0.3, 0.74], contrast: 0.9, gamma: 0.95,
    desc: 'Kısa dalga UV; kağıt yüzeyindeki kimyasal bozulma ve beyazlatıcı farkları absorpsiyon modunda gösterir.',
  },
  {
    id: 'violet405', name: 'Mor', nm: '405 nm', group: 'Görünür',
    mix: [0.22, 0.36, 0.58], contrast: 0.4,
    desc: 'Mor bant; bazı mavi ve mor mürekkeplerde yüksek absorpsiyon, kağıt katkılarında farklı tepki.',
  },
  {
    id: 'blue470', name: 'Mavi', nm: '470 nm', group: 'Görünür',
    mix: [0.08, 0.3, 0.72], contrast: 0.45,
    desc: 'Mavi bant; sarı/turuncu ve yeşil mürekkepleri ayırt eder, silme bölgelerindeki renk kaymasını gösterir.',
  },
  {
    id: 'green530', name: 'Yeşil', nm: '530 nm', group: 'Görünür',
    mix: [0.22, 0.7, 0.08], contrast: 0.45,
    desc: 'Yeşil bant; kırmızı ve mavi mürekkepler arasındaki kontrastı artırır.',
  },
  {
    id: 'amber590', name: 'Amber', nm: '590 nm', group: 'Görünür',
    mix: [0.78, 0.44, 0.05], contrast: 0.4,
    desc: 'Amber bant; mavi mürekkepler koyu, sarı tonlar açık görünür — mürekkep karşılaştırması için kullanılır.',
  },
  {
    id: 'red630', name: 'Kırmızı', nm: '630 nm', group: 'Görünür',
    mix: [0.93, 0.14, 0.02], contrast: 0.5,
    desc: 'Kırmızı bant; mavi ve siyah mürekkepler güçlü absorbe eder (koyu görünür). Dolandırıcılık incelemelerinde kritik bant.',
  },
  {
    id: 'deepred680', name: 'Derin Kırmızı', nm: '680 nm', group: 'Görünür',
    mix: [1.0, 0.06, 0.0], contrast: 0.55,
    desc: 'IR öncesi geçiş bandı; bazı boya mürekkepleri şeffaflaşmaya başlar.',
  },
  {
    id: 'ir850', name: 'IR Yansıma', nm: '850 nm', group: 'IR',
    mix: [0.68, 0.32, 0.0], blur: 0.7, contrast: 0.35,
    desc: 'Kızılötesi yansıma (IRR): karbon siyahı koyu kalır, boya bazlı mürekkepler kaybolur. Silme ve üstüne yazma tespitinin standart modu.',
  },
  {
    id: 'ir980', name: 'IR Derin', nm: '980 nm', group: 'IR',
    mix: [0.82, 0.18, 0.0], blur: 0.9, contrast: 0.45,
    desc: 'Derin kızılötesi; sadece karbon içerikli mürekkepler görünür — kurşun kalem ve toner tespiti.',
  },
  {
    id: 'luminesans', name: 'Lüminesans', nm: 'Diferansiyel', group: 'Filtre',
    mix: [0.15, 0.35, 0.55], tint: [0.55, 0.85, 0.65], tintMix: 0.3, luminesans: true,
    desc: 'Fluoresans eksi yansıma: yalnızca parlayan (lümine-san) bileşenler kalır. UV altında parlayan mürekkepleri izole eder.',
  },
  {
    id: 'custom', name: 'Spektral Mikser', nm: 'Özel', group: 'Özel',
    mix: [0.299, 0.587, 0.114],
    desc: 'R/G/B kanal ağırlıklarını kendiniz ayarlayarak herhangi bir dalga boyu tepkisini simüle edin.',
  },
];

export function getBand(id: BandId): Band {
  return BANDS.find((b) => b.id === id) ?? BANDS[0];
}

/* ------------------------------------------------------------------ */
/* İşlem parametreleri                                                 */
/* ------------------------------------------------------------------ */

export interface Params {
  band: BandId;
  mixR: number;
  mixG: number;
  mixB: number;
  exposure: number;      // -0.4..0.4
  contrast: number;      // -0.8..2.5
  gamma: number;         // 0.4..2.2
  blackPoint: number;    // 0..0.35
  whitePoint: number;    // 0.65..1
  claheOn: boolean;
  claheClip: number;     // 0.5..6
  claheTiles: number;    // 2..16
  heqOn: boolean;
  unsharpOn: boolean;
  unsharpAmount: number; // 0..2.5
  unsharpSigma: number;  // 0.5..4
  sobelOn: boolean;
  rakeOn: boolean;
  rakeAngle: number;     // 0..360
  rakeStrength: number;  // 0..2
  threshold: 'off' | 'otsu' | 'sauvola';
  sauvolaWindow: number; // 15..99
  sauvolaK: number;      // 0.1..0.7
  falseColor: 'off' | 'ironbow' | 'spectral' | 'viridis';
  invertOn: boolean;
}

export const DEFAULT_PARAMS: Params = {
  band: 'white',
  mixR: 0.299,
  mixG: 0.587,
  mixB: 0.114,
  exposure: 0,
  contrast: 0,
  gamma: 1,
  blackPoint: 0,
  whitePoint: 1,
  claheOn: false,
  claheClip: 2.5,
  claheTiles: 8,
  heqOn: false,
  unsharpOn: false,
  unsharpAmount: 0.8,
  unsharpSigma: 1.4,
  sobelOn: false,
  rakeOn: false,
  rakeAngle: 45,
  rakeStrength: 0.8,
  threshold: 'off',
  sauvolaWindow: 31,
  sauvolaK: 0.34,
  falseColor: 'off',
  invertOn: false,
};

export interface ProcessResult {
  out: ImageData;
  hist: Uint32Array;
  ms: number;
}

/** Tam işlem hattı: bant → ton → kontrast → yapısallaştırma → eşik → renk. */
export function processPipeline(src: ImageData, p: Params): ProcessResult {
  const t0 = performance.now();
  const band = getBand(p.band);
  const mix: RGB = p.band === 'custom' ? [p.mixR, p.mixG, p.mixB] : band.mix;

  let g: GrayImage = mixToGray(src, mix);

  if (band.luminesans) {
    // Lüminesans = fluoresans yanıtı − yansıma tabanı
    const lum = mixToGray(src, [0.299, 0.587, 0.114]);
    for (let i = 0; i < g.d.length; i++) {
      g.d[i] = Math.max(0, Math.min(1, g.d[i] * 1.9 - lum.d[i] * 0.95));
    }
    applyGamma(g, 0.85);
  }
  if (band.blur) g = gaussBlur(g, band.blur);
  if (band.gamma) applyGamma(g, band.gamma);
  if (band.contrast) applyExposureContrast(g, 0, band.contrast);

  applyExposureContrast(g, p.exposure, p.contrast);
  if (p.blackPoint > 0 || p.whitePoint < 1) applyLevels(g, p.blackPoint, p.whitePoint);
  if (p.gamma !== 1) applyGamma(g, p.gamma);
  if (p.claheOn) clahe(g, p.claheTiles, p.claheTiles, p.claheClip);
  if (p.heqOn) clahe(g, 1, 1, 1);
  if (p.sobelOn) sobel(g);
  if (p.rakeOn) rakingLight(g, p.rakeAngle, p.rakeStrength);
  if (p.unsharpOn) unsharpMask(g, p.unsharpSigma, p.unsharpAmount);
  if (p.threshold === 'otsu') applyOtsu(g);
  else if (p.threshold === 'sauvola') applySauvola(g, p.sauvolaWindow, p.sauvolaK);
  if (p.invertOn) invert(g);

  const hist = histogram(g);
  const lut = p.falseColor !== 'off' ? LUTS[p.falseColor] : undefined;
  const out = grayToImageData(g, band.tint, band.tintMix ?? 0, lut);

  return { out, hist, ms: performance.now() - t0 };
}

/* ------------------------------------------------------------------ */
/* Hızlı reçeteler (presets)                                           */
/* ------------------------------------------------------------------ */

export interface Preset {
  id: string;
  name: string;
  icon: string;
  desc: string;
  params: Partial<Params>;
}

export const PRESETS: Preset[] = [
  {
    id: 'kimyasal-silme',
    name: 'Kimyasal Silme Tespiti',
    icon: 'flask',
    desc: 'UV-A fluoresans + yerel kontrast: silme lekeleri ve tahrip bölgeleri parlar.',
    params: {
      band: 'uv365', claheOn: true, claheClip: 3.2, contrast: 0.3, invertOn: false,
      falseColor: 'off', threshold: 'off', sobelOn: false, rakeOn: false, heqOn: false,
    },
  },
  {
    id: 'murekkep-ayrimi',
    name: 'Mürekkep Ayrımı (IR)',
    icon: 'pen',
    desc: 'IR yansıma: karbon mürekkebi kalır, boya mürekkebi kaybolur — üstüne yazma tespiti.',
    params: {
      band: 'ir850', claheOn: true, claheClip: 2.2, contrast: 0.2, invertOn: false,
      falseColor: 'off', threshold: 'off', sobelOn: false, rakeOn: false, heqOn: false,
    },
  },
  {
    id: 'girinti',
    name: 'Girinti / Baskı İzi',
    icon: 'layers',
    desc: 'Eğik ışık simülasyonu: kağıt yüzeyindeki baskı izlerini (ESDA benzeri) görünür kılar.',
    params: {
      band: 'white', rakeOn: true, rakeAngle: 45, rakeStrength: 1.1, claheOn: true,
      claheClip: 1.8, sobelOn: false, threshold: 'off', falseColor: 'off', invertOn: false,
      heqOn: false,
    },
  },
  {
    id: 'gizli-metin',
    name: 'Gizli Metin',
    icon: 'eye',
    desc: 'Mor bant + agresif düzey germesi: silik, silinmiş veya basılı gizli yazıları ortaya çıkarır.',
    params: {
      band: 'violet405', blackPoint: 0.28, whitePoint: 0.82, claheOn: true, claheClip: 4,
      contrast: 0.5, threshold: 'off', sobelOn: false, rakeOn: false, falseColor: 'off',
      invertOn: false, heqOn: false,
    },
  },
  {
    id: 'ocr-hazirlik',
    name: 'OCR Hazırlık',
    icon: 'scan',
    desc: 'Sauvola adaptif eşikleme: TAR / OCR motorları için ideal iki tonlu belge.',
    params: {
      band: 'white', threshold: 'sauvola', sauvolaWindow: 35, sauvolaK: 0.3,
      unsharpOn: true, unsharpAmount: 1.0, claheOn: false, invertOn: false,
      falseColor: 'off', sobelOn: false, rakeOn: false, heqOn: false,
    },
  },
  {
    id: 'yogunluk',
    name: 'Yoğunluk Haritası',
    icon: 'thermometer',
    desc: 'Ironbow renk haritası: mürekkep yoğunluğu ve baskı basıncı farklarını renkle gösterir.',
    params: {
      band: 'white', falseColor: 'ironbow', claheOn: true, claheClip: 2,
      threshold: 'off', sobelOn: false, rakeOn: false, invertOn: false, heqOn: false,
    },
  },
  {
    id: 'kanal-kirmizi',
    name: 'Kırmızı Kanal',
    icon: 'circle',
    desc: 'Mavi tükenmez kalem mürekkebini diğer içerikten ayıran klasik kanal izolasyonu.',
    params: {
      band: 'red630', contrast: 0.35, claheOn: false, threshold: 'off',
      sobelOn: false, rakeOn: false, invertOn: false, falseColor: 'off', heqOn: false,
    },
  },
  {
    id: 'negatif',
    name: 'Negatif Kontrast',
    icon: 'contrast',
    desc: 'Ters (negatif) görünüm: açık alanlardaki silik izler koyu arka planda belirginleşir.',
    params: {
      band: 'white', invertOn: true, claheOn: true, claheClip: 2.5, contrast: 0.25,
      threshold: 'off', sobelOn: false, rakeOn: false, falseColor: 'off', heqOn: false,
    },
  },
];

export function applyPreset(base: Params, preset: Preset): Params {
  return { ...base, ...preset.params };
}

/* ------------------------------------------------------------------ */
/* Montaj — çok bantlı dizi çekim (VSC rapor ekranı)                   */
/* ------------------------------------------------------------------ */

const MONTAGE_BANDS: Array<{ band: BandId; extra?: Partial<Params>; label: string }> = [
  { band: 'white', label: 'BEYAZ IŞIK 400–700nm' },
  { band: 'uv365', label: 'UV-A 365nm FLUORESANS' },
  { band: 'ir850', label: 'IR 850nm YANSIMA' },
  { band: 'red630', label: 'KIRMIZI 630nm' },
  { band: 'blue470', label: 'MAVİ 470nm' },
  { band: 'white', extra: { rakeOn: true, rakeAngle: 45, rakeStrength: 1.0 }, label: 'EĞİK IŞIK / GİRİNTİ' },
];

export function renderMontage(src: ImageData, base: Params, caseNo: string, date: string): HTMLCanvasElement {
  const panelW = 640;
  const captionH = 34;
  const cols = 2;
  const rows = 3;
  // panel yüksekliğini kaynak orandan hesapla
  const ph0 = Math.round((panelW * src.height) / src.width);
  const canvas = document.createElement('canvas');
  canvas.width = cols * panelW + (cols + 1) * 12;
  canvas.height = rows * (ph0 + captionH) + (rows + 1) * 12 + 52;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c0e0c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = '600 22px ui-monospace, monospace';
  ctx.fillStyle = '#f0a63a';
  ctx.fillText(`ADLI GORUNTULEME DIZI CEKIMI — VAKA ${caseNo}`, 14, 34);
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillStyle = '#8a938a';
  ctx.fillText(date, canvas.width - 260, 34);

  MONTAGE_BANDS.forEach((mb, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 12 + col * (panelW + 12);
    const y = 52 + row * (ph0 + captionH + 12);

    const res = processPipeline(src, {
      ...base,
      band: mb.band,
      ...(mb.extra ?? {}),
      claheOn: true,
      claheClip: 2.5,
    });
    const panel = document.createElement('canvas');
    panel.width = panelW;
    panel.height = ph0;
    const pctx = panel.getContext('2d')!;
    // yeniden ölçekle
    const scaled = scaleImageData(res.out, panelW, ph0);
    pctx.putImageData(scaled, 0, 0);
    ctx.drawImage(panel, x, y);
    ctx.strokeStyle = '#2c352c';
    ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, ph0 - 1);
    ctx.fillStyle = '#c8d2c8';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(mb.label, x + 2, y + ph0 + 22);
  });

  return canvas;
}

function scaleImageData(src: ImageData, w: number, h: number): ImageData {
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

/* ------------------------------------------------------------------ */
/* Anomali taraması sarmalayıcı                                        */
/* ------------------------------------------------------------------ */

export interface AnomalyRegion extends Rect {
  score: number;
  band: string;
}

/** Anomali hücrelerini bitişik bölgelere birleştirip görüntü koordinatlarına çevirir. */
export function scanAnomalies(src: ImageData): AnomalyRegion[] {
  const { cells, gridW, gridH } = anomalyScan(src, 22);
  if (!cells.length) return [];
  const cw = src.width / gridW;
  const ch = src.height / gridH;
  const map = new Set(cells.map((c) => `${c.gx},${c.gy}`));
  const visited = new Set<string>();
  const regions: AnomalyRegion[] = [];

  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  for (const c of cells) {
    const key = `${c.gx},${c.gy}`;
    if (visited.has(key)) continue;
    // flood fill ile birleşik bölgeyi topla
    const stack = [{ gx: c.gx, gy: c.gy }];
    const members: typeof cells = [];
    visited.add(key);
    while (stack.length) {
      const cur = stack.pop()!;
      const curKey = `${cur.gx},${cur.gy}`;
      const cell = cells.find((x) => x.gx === cur.gx && x.gy === cur.gy);
      if (cell) members.push(cell);
      for (const [dx, dy] of dirs) {
        const nx = cur.gx + dx;
        const ny = cur.gy + dy;
        const nk = `${nx},${ny}`;
        if (map.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          stack.push({ gx: nx, gy: ny });
        }
      }
    }
    const minX = Math.min(...members.map((m) => m.gx));
    const maxX = Math.max(...members.map((m) => m.gx));
    const minY = Math.min(...members.map((m) => m.gy));
    const maxY = Math.max(...members.map((m) => m.gy));
    const maxScore = Math.max(...members.map((m) => m.score));
    const bandCounts = new Map<string, number>();
    for (const m of members) bandCounts.set(m.band, (bandCounts.get(m.band) ?? 0) + 1);
    const dominant = [...bandCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
    regions.push({
      x: minX * cw,
      y: minY * ch,
      w: (maxX - minX + 1) * cw,
      h: (maxY - minY + 1) * ch,
      score: maxScore,
      band: dominant,
    });
  }
  return regions.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** OCR için bölge kırpması. */
export function cropImageData(src: ImageData, rect: Rect): ImageData {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(src.width - x, Math.ceil(rect.w));
  const h = Math.min(src.height - y, Math.ceil(rect.h));
  const safeW = Math.max(1, w);
  const safeH = Math.max(1, h);
  const out = new ImageData(safeW, safeH);
  for (let row = 0; row < safeH; row++) {
    const srcStart = ((y + row) * src.width + x) * 4;
    const dstStart = row * safeW * 4;
    out.data.set(src.data.subarray(srcStart, srcStart + safeW * 4), dstStart);
  }
  return out;
}
