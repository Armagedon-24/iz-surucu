/**
 * FOTOĞRAF İYİLEŞTİRME MOTORU — RGB, tahribatsız, tamamen tarayıcı içinde
 *
 * Adli inceleme hatının aksine bu motor fotoğraf/resim estetiği için
 * tasarlandı: pozlama, kontrast, doygunluk, sıcaklık, gölge/ışık dengesi,
 * gürültü azaltma, keskinlik ve netlik. Tümü tek ImageData üzerinde:
 *
 *  1) Ton LUT — pozlama + kontrast + gölge açma + ışık kısma + sıcaklık
 *     kanal başına 256 girişli tek LUT'a katlanır (piksel başına 3 bakış).
 *  2) Doygunluk — luma karışımıyla piksel bazında.
 *  3) Uzamsal kaskad — tek 3×3 kutu bulanıklığı hem gürültü azaltma (x→b1'e
 *     karıştır), keskinlik (x−b1 ince detay) hem netlik (b1−b2 orta detay)
 *     için yeniden kullanılır; ayrı ağır konvolüsyon yok.
 *
 * autoEnhance() kanal ortalamaları + luma histogram yüzdeliklerinden
 * tek tuşluk dengeli bir başlangıç reçetesi üretir (gri dünya beyaz
 * dengesi yaklaşımı).
 */

export interface EnhanceParams {
  /** -100..100 — pozlama çarpanı (2^(v/100)) */
  exposure: number;
  /** -100..100 — kontrast, 0.5 pivotunda eğim */
  contrast: number;
  /** -100..100 — doygunluk (luma karışımı) */
  saturation: number;
  /** -100..100 — sıcaklık (pozitif = sıcak, negatif = soğuk) */
  temperature: number;
  /** 0..100 — gölge açma (karanlık bölgeleri kaldırır) */
  shadows: number;
  /** 0..100 — ışık kısma (parlak bölgeleri yumuşatır) */
  highlights: number;
  /** 0..100 — netlik (orta ölçekli yerel kontrast) */
  clarity: number;
  /** 0..100 — keskinlik (ince ölçekli unsharp) */
  sharpen: number;
  /** 0..100 — gürültü azaltma (yumuşatma karışımı) */
  denoise: number;
}

export const DEFAULT_ENHANCE: EnhanceParams = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0,
  shadows: 0, highlights: 0, clarity: 0, sharpen: 0, denoise: 0,
};

export function isDefaultEnhance(p: EnhanceParams): boolean {
  return p.exposure === 0 && p.contrast === 0 && p.saturation === 0
    && p.temperature === 0 && p.shadows === 0 && p.highlights === 0
    && p.clarity === 0 && p.sharpen === 0 && p.denoise === 0;
}

/** Ton + sıcaklık katlanmış kanal LUT'ları. */
function channelLuts(p: EnhanceParams): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const gain = Math.pow(2, p.exposure / 100);
  const k = 1 + p.contrast / 100;
  const sh = p.shadows / 100;
  const hi = p.highlights / 100;
  const t = p.temperature / 100;
  const mk = (chGain: number) => {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let x = (i / 255) * gain * chGain;
      x = (x - 0.5) * k + 0.5;                        // kontrast
      const lw = Math.pow(1 - Math.min(1, Math.max(0, x)), 2);
      x += sh * 0.55 * lw * (1 - x);                  // gölge açma
      const hw = Math.pow(Math.max(0, Math.min(1, x)), 2);
      x -= hi * 0.5 * hw * x;                         // ışık kısma
      lut[i] = Math.round(Math.min(1, Math.max(0, x)) * 255);
    }
    return lut;
  };
  return [mk(1 + 0.18 * t), mk(1), mk(1 - 0.18 * t)];
}

/** 3×3 kutu bulanıklığı — yatay + dikey ayrılabilir geçiş, yeni tampon döner. */
function boxBlurRGB(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  // yatay
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const c = row + x * 4;
      const l = row + (x > 0 ? x - 1 : 0) * 4;
      const r = row + (x < w - 1 ? x + 1 : x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        tmp[c + ch] = (src[l + ch] + src[c + ch] + src[r + ch]) / 3;
      }
    }
  }
  // dikey
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w * 4;
    const row = y * w * 4;
    const dn = (y < h - 1 ? y + 1 : y) * w * 4;
    for (let x = 0; x < w; x++) {
      const c = row + x * 4;
      const u = up + x * 4;
      const dd = dn + x * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[c + ch] = (tmp[u + ch] + tmp[c + ch] + tmp[dd + ch]) / 3;
      }
    }
  }
  return out;
}

/**
 * İyileştirme reçetesini uygular. out verilirse ve boyutlar uyuyorsa aynı
 * tamponu doldurur (GC baskısı düşer). Kaynak değiştirilmez.
 */
export function applyEnhancement(src: ImageData, p: EnhanceParams, out?: ImageData): ImageData {
  const w = src.width;
  const h = src.height;
  const res = out && out.width === w && out.height === h ? out : new ImageData(w, h);
  const [lr, lg, lb] = channelLuts(p);
  const s = src.data;
  const d = res.data;
  const sat = p.saturation / 100;
  const needSpatial = p.denoise > 0 || p.sharpen > 0 || p.clarity > 0;
  const px = w * h;

  // 1) LUT + doygunluk
  const base = needSpatial ? new Uint8ClampedArray(px * 4) : d;
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    let r = lr[s[j]];
    let g = lg[s[j + 1]];
    let b = lb[s[j + 2]];
    if (sat !== 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const kk = 1 + sat;
      r = lum + (r - lum) * kk;
      g = lum + (g - lum) * kk;
      b = lum + (b - lum) * kk;
    }
    base[j] = r;
    base[j + 1] = g;
    base[j + 2] = b;
    if (!needSpatial) d[j + 3] = 255;
  }

  // 2) uzamsal kaskad — tek bulanıklık kaskadı üç etkiyi de besler
  if (needSpatial) {
    const b1 = boxBlurRGB(base, w, h);
    const b2 = p.clarity > 0 ? boxBlurRGB(b1, w, h) : null;
    const kD = (p.denoise / 100) * 0.8;
    const kS = (p.sharpen / 100) * 1.1;
    const kC = (p.clarity / 100) * 0.6;
    for (let i = 0; i < px; i++) {
      const j = i * 4;
      for (let ch = 0; ch < 3; ch++) {
        const x = base[j + ch];
        const sm = b1[j + ch];
        let v = x;
        if (kD > 0) v += kD * (sm - x);                   // gürültü azaltma
        if (kS > 0) v += kS * (x - sm);                   // keskinlik
        if (b2 && kC > 0) v += kC * (sm - b2[j + ch]);    // netlik
        d[j + ch] = v;
      }
      d[j + 3] = 255;
    }
  }
  return res;
}

/** Histogram yüzdelik eşiği (0..1 oranından 0..255 değeri). */
function histPercentile(hist: Uint32Array, total: number, q: number): number {
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/**
 * Tek tuşluk otomatik iyileştirme reçetesi — kanal ortalamaları (gri dünya
 * beyaz dengesi), luma histogram yüzdelikleri ve ortalama doygunluktan
 * dengeli başlangıç değerleri üretir. Aşırıya kaçmaz; kullanıcı üstünden
 * ince ayar yapabilir.
 */
export function autoEnhance(src: ImageData): EnhanceParams {
  const d = src.data;
  const px = src.width * src.height;
  const hist = new Uint32Array(256);
  let sr = 0, sg = 0, sb = 0, schroma = 0;
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    const r = d[j], g = d[j + 1], b = d[j + 2];
    sr += r; sg += g; sb += b;
    schroma += Math.max(r, g, b) - Math.min(r, g, b);
    hist[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++;
  }
  const rM = sr / px, gM = sg / px, bM = sb / px;
  const lumaM = 0.299 * rM + 0.587 * gM + 0.114 * bM;
  const chromaM = schroma / px;
  const p1 = histPercentile(hist, px, 0.01) / 255;
  const p99 = histPercentile(hist, px, 0.99) / 255;
  const span = p99 - p1;

  const p: EnhanceParams = { ...DEFAULT_ENHANCE };

  // pozlama — orta tona yaklaş
  if (lumaM < 0.42) p.exposure = Math.round(Math.min(38, (0.46 - lumaM) * 90));
  else if (lumaM > 0.62) p.exposure = Math.round(Math.max(-22, (0.58 - lumaM) * 80));

  // kontrast — dağılımın daralmasına göre
  if (span < 0.5) p.contrast = 34;
  else if (span < 0.72) p.contrast = 22;
  else if (span < 0.86) p.contrast = 10;

  // gölge / ışık
  if (lumaM < 0.4) p.shadows = 26;
  else p.shadows = 10;
  if (lumaM > 0.6) p.highlights = 16;

  // beyaz dengesi — gri dünya: mavi fazlaysa ısıt
  const t = (bM - rM) * 0.45;
  p.temperature = Math.round(Math.max(-28, Math.min(28, t)));

  // doygunluk — soluk görse hafif canlılık
  if (chromaM < 22) p.saturation = 24;
  else if (chromaM < 42) p.saturation = 12;
  else if (chromaM > 82) p.saturation = -10;

  // netlik + keskinlik — mütevazı başlangıç
  p.clarity = span < 0.7 ? 18 : 10;
  p.sharpen = 26;

  return p;
}

/** Ön ayarlar — panel çipleri kullanır. */
export const ENHANCE_PRESETS: ReadonlyArray<{ id: string; label: string; p: EnhanceParams }> = [
  {
    id: 'belge', label: 'BELGE',
    p: { exposure: 8, contrast: 28, saturation: -12, temperature: -6, shadows: 18, highlights: 10, clarity: 22, sharpen: 36, denoise: 12 },
  },
  {
    id: 'portre', label: 'PORTRE',
    p: { exposure: 6, contrast: 10, saturation: 8, temperature: 14, shadows: 24, highlights: 12, clarity: 6, sharpen: 14, denoise: 20 },
  },
  {
    id: 'manzara', label: 'MANZARA',
    p: { exposure: 0, contrast: 16, saturation: 26, temperature: -4, shadows: 12, highlights: 14, clarity: 30, sharpen: 30, denoise: 0 },
  },
  {
    id: 'los', label: 'LOŞ IŞIK',
    p: { exposure: 24, contrast: 8, saturation: 12, temperature: 10, shadows: 34, highlights: 0, clarity: 10, sharpen: 10, denoise: 30 },
  },
];
