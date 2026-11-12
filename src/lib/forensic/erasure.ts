/**
 * SİLME (ERADİKASYON) İNCELEME ÇEKİRDEĞİ
 * Yazıldıktan sonra silinen (silgi, kimyasal çözücü, kazıma) yazıyı tespit
 * etmek için gerçek adli laboratuvar tekniklerinin yazılım uygulaması:
 *
 *  - Eğik ışık (raking light) simülasyonu — silgi/kazıma sonrası kâğıt
 *    yüzeyindeki çukur-kabartı deformasyonlarını rölyef olarak görünür kılar
 *  - Doku bozulması haritası — yerel standart sapma ile kâğıt lifi
 *    tahribatını ölçer (silinen alan pürüzsüzleşir / parlaklaşır)
 *  - Mürekkep kalıntısı — çok ölçekli DoG kalıntı haritaları (soluk izler)
 *  - Kanal-oranı kalıntıları — kimyasal silmede mürekkebin renk tonu artığı
 *    (B−R mavi, R−B sıcak renk, doygunluk)
 *  - PCA bileşenleri + morfolojik top-hat — hafif kalıntı ayrıştırma
 *  - Otomatik parametre taraması + bölge bazlı okunabilirlik skorlaması
 *
 * İnce ayar zinciri karalama modülüyle paylaşırlık (applyFineTune):
 * otomatik optimizasyon sonrası aynı kaydırıcılar canlı kalibrasyon sağlar.
 */
import {
  GrayImage,
  Rect,
  RGB,
  clamp01,
  clahe,
  gaussBlur,
  grayToImageData,
  mixToGray,
  percentileStretch,
  rakingLight,
  resizeImageData,
} from './filters';
import {
  blackTopHat,
  pcaVectors,
  scaleToWidth,
  scoreRegion,
  applyFineTune,
  DEFAULT_FINE_TUNE,
  TUNE_PRESETS,
  isDefaultTune,
  type FineTune,
} from './recovery';

/* ------------------------------------------------------------------ */
/* Doku bozulması haritası — yerel std (integral imaj, O(1)/piksel)    */
/* ------------------------------------------------------------------ */

/** Yerel standart sapma haritası: silinen alanlarda kâğıt dokusu bozulur. */
function localStdMap(g: GrayImage, radius: number): GrayImage {
  const { w, h, d } = g;
  const iw = w + 1;
  const S = new Float64Array(iw * (h + 1));
  const Q = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0, rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = d[y * w + x];
      rowSum += v;
      rowSq += v * v;
      S[(y + 1) * iw + (x + 1)] = S[y * iw + (x + 1)] + rowSum;
      Q[(y + 1) * iw + (x + 1)] = Q[y * iw + (x + 1)] + rowSq;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
      const n = (y1 - y0 + 1) * (x1 - x0 + 1);
      const s =
        S[(y1 + 1) * iw + (x1 + 1)] - S[y0 * iw + (x1 + 1)] -
        S[(y1 + 1) * iw + (x0 + 1)] + S[y0 * iw + (x0 + 1)];
      const sq =
        Q[(y1 + 1) * iw + (x1 + 1)] - Q[y0 * iw + (x1 + 1)] -
        Q[(y1 + 1) * iw + (x0 + 1)] + Q[y0 * iw + (x0 + 1)];
      const mean = s / n;
      out[y * w + x] = Math.sqrt(Math.max(0, sq / n - mean * mean));
    }
  }
  return { w, h, d: out };
}

/* ------------------------------------------------------------------ */
/* Mürekkep kalıntısı — çok ölçekli DoG (kaydedici yüksek geçiren)     */
/* ------------------------------------------------------------------ */

function residualGray(src: ImageData, s1: number, s2: number, gain: number): GrayImage {
  const g = mixToGray(src, [0.299, 0.587, 0.114]);
  const a = gaussBlur(g, s1);
  const b = gaussBlur(g, s2);
  for (let i = 0; i < a.d.length; i++) a.d[i] = 0.5 + 0.5 * (a.d[i] - b.d[i]) * gain;
  return a;
}

/* ------------------------------------------------------------------ */
/* Kanal-oranı kalıntıları — kimyasal silme sonrası renk tonu artığı   */
/* ------------------------------------------------------------------ */

type ErasureRatioOp = 'b-r' | 'r-b' | '2g-r-b' | 'sat';

/** Kanal-oranı ham değeri (imzalı, ~−1..1) — 'ratio' ve 'chroma' paylaştırır. */
function channelOpValues(src: ImageData, op: ErasureRatioOp): Float32Array {
  const d = src.data;
  const out = new Float32Array(src.width * src.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255;
    switch (op) {
      case 'b-r': out[i] = b - r; break;
      case 'r-b': out[i] = r - b; break;
      case '2g-r-b': out[i] = 2 * gg - r - b; break;
      case 'sat': {
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        out[i] = mx > 0.02 ? (mx - mn) / mx : 0;
        break;
      }
    }
  }
  return out;
}

function ratioGrayE(src: ImageData, op: ErasureRatioOp): GrayImage {
  const g = mixToGray(src, [0.299, 0.587, 0.114]);
  const v = channelOpValues(src, op);
  for (let i = 0; i < g.d.length; i++) g.d[i] = 0.5 + 0.5 * v[i];
  return g;
}

/** Mutlak renk sapması: kanal-oranının medyandan |sapması| — kimyasal
 *  silme artığı herhangi bir renk tonunda nötr kâğıttan ayrışır. */
function chromaDevGray(src: ImageData, op: ErasureRatioOp): GrayImage {
  const v = channelOpValues(src, op);
  const s = Float32Array.from(v).sort();
  const med = s[s.length >> 1];
  const g = mixToGray(src, [0.299, 0.587, 0.114]);
  for (let i = 0; i < g.d.length; i++) g.d[i] = Math.abs(v[i] - med);
  return g;
}

/* ------------------------------------------------------------------ */
/* Tarif (recipe) sistemi                                              */
/* ------------------------------------------------------------------ */

export type ErasureRecipe =
  | { kind: 'raking'; label: string; angle: number; strength: number; mix: RGB }
  | { kind: 'texture'; label: string; radius: number }
  | { kind: 'residual'; label: string; s1: number; s2: number; gain: number }
  | { kind: 'ratio'; label: string; op: ErasureRatioOp }
  | { kind: 'chroma'; label: string; op: ErasureRatioOp }
  | { kind: 'band'; label: string; mix: RGB }
  | { kind: 'pca'; label: string; vec: number[] }
  | { kind: 'tophat'; label: string; mix: RGB; radius: number };

/* ------------------------------------------------------------------ */
/* Tarif-aileleri — galeri süzgeci ve AI seçim önceliği için            */
/* ------------------------------------------------------------------ */

export type ErasureFamily =
  | 'EĞİK IŞIK' | 'DOKU' | 'KALINTI' | 'KİMYASAL' | 'SPEKTRAL' | 'PCA' | 'TOP-HAT';

export function erasureFamily(r: ErasureRecipe): ErasureFamily {
  switch (r.kind) {
    case 'raking': return 'EĞİK IŞIK';
    case 'texture': return 'DOKU';
    case 'residual': return 'KALINTI';
    case 'ratio': case 'chroma': return 'KİMYASAL';
    case 'band': return 'SPEKTRAL';
    case 'pca': return 'PCA';
    case 'tophat': return 'TOP-HAT';
  }
}

/* ------------------------------------------------------------------ */
/* Sinyal-tipine göre normalize etme — kimyasal kalıntı görünürlüğünün  */
/* anahtarı: seyrek/imzalı haritalar yoğun-görüntü zinciriyle SİYAH     */
/* kalıyordu (p96≈0.11). Artık her sinyal tipi kendi aralığına gerilir. */
/* ------------------------------------------------------------------ */

function medianOf(d: Float32Array): number {
  const s = Float32Array.from(d).sort();
  return s[s.length >> 1] ?? 0.5;
}

function percentileOf(d: Float32Array, p: number): number {
  const s = Float32Array.from(d).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))] ?? 0.5;
}

/** İmzalı kalıntı haritası: medyanı 0.5'e alıp mutlak-sapma p99.5'ine gerer;
 *  hem pozitif hem negatif artıklar (mavi kalıntı + sarımsı leke) görünür. */
function stretchSigned(g: GrayImage): void {
  const med = medianOf(g.d);
  const dev = new Float32Array(g.d.length);
  for (let i = 0; i < g.d.length; i++) dev[i] = Math.abs(g.d[i] - med);
  const amp = Math.max(1e-4, percentileOf(dev, 99.5));
  for (let i = 0; i < g.d.length; i++) g.d[i] = clamp01(0.5 + ((g.d[i] - med) / amp) * 0.5);
}

/** Seyrek pozitif sinyal haritası (top-hat, renk sapması): zemin siyaha,
 *  yapı p99.5'e gerilir — kalıntı vuruşları net biçimde parlaklaşır. */
function stretchSparse(g: GrayImage): void {
  const med = medianOf(g.d);
  const span = Math.max(1e-4, percentileOf(g.d, 99.5) - med);
  for (let i = 0; i < g.d.length; i++) g.d[i] = clamp01((g.d[i] - med) / span);
}

/** Tarif çıkışını sinyal tipine göre normalize eder (base'in parçasıdır;
 *  böylece ince ayar zinciri ve canlı üretici de aynı zemini görür). */
function normalizeByKind(g: GrayImage, kind: ErasureRecipe['kind']): void {
  switch (kind) {
    case 'ratio': case 'residual': case 'pca':
      stretchSigned(g);
      break;
    case 'chroma': case 'tophat':
      stretchSparse(g);
      break;
    case 'raking': case 'texture': case 'band':
      break; // yoğun 0..1 harita — standart zincir yeterli
  }
}

export function renderErasureBase(src: ImageData, r: ErasureRecipe): GrayImage {
  let g: GrayImage;
  switch (r.kind) {
    case 'raking': {
      g = mixToGray(src, r.mix);
      rakingLight(g, r.angle, r.strength);
      break;
    }
    case 'texture':
      g = localStdMap(mixToGray(src, [0.299, 0.587, 0.114]), r.radius);
      break;
    case 'residual':
      g = residualGray(src, r.s1, r.s2, r.gain);
      break;
    case 'ratio':
      g = ratioGrayE(src, r.op);
      break;
    case 'chroma':
      g = chromaDevGray(src, r.op);
      break;
    case 'band':
      g = mixToGray(src, r.mix);
      break;
    case 'pca': {
      g = mixToGray(src, [0.299, 0.587, 0.114]);
      const d = src.data;
      for (let i = 0, p = 0; i < g.d.length; i++, p += 4) {
        g.d[i] = (d[p] * r.vec[0] + d[p + 1] * r.vec[1] + d[p + 2] * r.vec[2]) / 255;
      }
      break;
    }
    case 'tophat':
      g = blackTopHat(mixToGray(src, r.mix), r.radius);
      break;
  }
  normalizeByKind(g, r.kind);
  return g;
}

/** Tarif sonrası görüntüleme zinciri — sinyal tipine göre uyarlanır:
 *  seyrek yapı haritalarında CLAHE atlanır (boş karo gürültüsünü yükseltip
 *  kalıntıyı parçalıyor); imzalı haritalarda hafif CLAHE kalıntıyı güçlendirir. */
function postProcessE(g: GrayImage, kind: ErasureRecipe['kind']): void {
  if (kind === 'tophat' || kind === 'chroma') return;
  if (kind === 'ratio' || kind === 'residual' || kind === 'pca') {
    clahe(g, 8, 8, 1.6);
    return;
  }
  percentileStretch(g, 1, 99);
  clahe(g, 8, 8, 2.6);
}

export function renderErasureRecipe(src: ImageData, r: ErasureRecipe): GrayImage {
  const g = renderErasureBase(src, r);
  postProcessE(g, r.kind);
  return g;
}

/** Tarifi ince ayar zinciriyle işler (canlı önizleme ve tam boy uygulama). */
export function renderErasureTuned(src: ImageData, r: ErasureRecipe, t: FineTune): GrayImage {
  const g = renderErasureBase(src, r);
  applyFineTune(g, t);
  return g;
}

/**
 * Canlı ince ayar üreticisi — karalama modülüyle aynı mimari: tarif tabanını
 * BİR kez hesaplar; her çağrıda yalnızca ince ayar zinciri tabanın kopyası
 * üzerinde çalışır. Kaydırıcı sürüklenirken kare başına düşük maliyetle canlı
 * önizleme sağlar (renderErasureTuned ile birebir aynı çıktıyı üretir).
 */
export function createErasureLiveTuner(src: ImageData, r: ErasureRecipe): (t: FineTune) => GrayImage {
  const base = renderErasureBase(src, r);
  return (t: FineTune) => {
    const g: GrayImage = { w: base.w, h: base.h, d: new Float32Array(base.d) };
    applyFineTune(g, t);
    return g;
  };
}

/* ------------------------------------------------------------------ */
/* Otomatik tarama                                                     */
/* ------------------------------------------------------------------ */

export type { FineTune };
/** Panel ve testlerin tek giriş noktası kullanabilmesi için yeniden ihracat. */
export { scoreRegion, DEFAULT_FINE_TUNE, isDefaultTune, TUNE_PRESETS } from './recovery';

/* ------------------------------------------------------------------ */
/* Silmeye-özel okunabilirlik skoru — kalıntı-yapısı görünürlüğü        */
/* ------------------------------------------------------------------ */

function subRegion(g: GrayImage, region: Rect | null): GrayImage {
  if (!region) return g;
  const x0 = Math.max(0, Math.floor(region.x * g.w));
  const y0 = Math.max(0, Math.floor(region.y * g.h));
  const x1 = Math.min(g.w, Math.ceil((region.x + region.w) * g.w));
  const y1 = Math.min(g.h, Math.ceil((region.y + region.h) * g.h));
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 8) return g;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) d[y * w + x] = g.d[(y0 + y) * g.w + (x0 + x)];
  }
  return { w, h, d };
}

/**
 * Eradikasyon skoru — kalıntı-yapısı görünürlüğü.
 *
 * scoreRegion genel doku enerjisini ödüllendirdiği için eğik ışık gibi
 * KÂĞIT DOKUSUNU parlatan tarifler üst sıraya çıkıyor, silme kalıntısını
 * gösteren tarifler ise sona düşüyordu. Bu skor adli önceliği kodlar:
 * silme kalıntısı İNCE, bütünlüklü vuruş yapısıdır.
 *
 *  1. medyan-çevresi sapma haritası çıkarılır (kalıntı = sapma);
 *  2. vuruş ölçeğinde bant geçiren (blur 1.2 − blur 4) uygulanır — büyük
 *     ölçekli doku kırpışması (eğik ışık rölyefi, doku haritası) ve ince
 *     tane gürültüsü bastırılır, yalnızca vuruş ölçeğindeki yapı kalır;
 *  3. blob kararırlığı (blur 1.6) ile tek piksellik sahte zirveler ölür;
 *  4. en güçlü %3 blob'un ortalaması skoru verir — tek toz zerresi değil,
 *     vuruş popülasyonunun kararlı kontrastı ölçülür.
 *
 * Sentetik kimyasal-silme vakasında bu metrik zemin gerçeğiyle (kalıntı
 * z-ayrışması) birebir uyumlu sıralama üretir: Top-Hat ve kimyasal sapma
 * haritaları en üste çıkar. Panel canlı skorları da bu metrikledir.
 */
export function scoreErasure(g: GrayImage, region: Rect | null): number {
  const sub = subRegion(g, region);
  if (sub.w < 8 || sub.h < 8) return 0;
  const med = medianOf(sub.d);
  const dev = { w: sub.w, h: sub.h, d: new Float32Array(sub.d.length) };
  for (let i = 0; i < sub.d.length; i++) dev.d[i] = Math.abs(sub.d[i] - med);
  const b1 = gaussBlur(dev, 1.2);
  const b2 = gaussBlur(dev, 4);
  const band = new Float32Array(sub.d.length);
  for (let i = 0; i < sub.d.length; i++) band[i] = Math.max(0, b1.d[i] - b2.d[i]);
  const blob = gaussBlur({ w: sub.w, h: sub.h, d: band }, 1.6).d;
  // en güçlü %3 blob ortalaması — vuruş popülasyonunun kararlı kontrastı
  const s = Float32Array.from(blob).sort();
  const k = Math.max(1, Math.floor(s.length * 0.03));
  let sum = 0;
  for (let i = s.length - k; i < s.length; i++) sum += s[i];
  return sum / k;
}

export interface ErasureCandidate {
  id: string;
  recipe: ErasureRecipe;
  score: number;
  /** Tarama çözünürlüğünde görüntü (küçük önizleme için). */
  preview: ImageData;
}

export interface ErasureScanResult {
  candidates: ErasureCandidate[];
  /** Tarama çözünürlüğünde kaynak görüntü — ince ayar önizlemesi bunun üzerinden çalışır. */
  scanSrc: ImageData;
}

export interface ScanProgress {
  done: number;
  total: number;
}

const SCAN_MAX_W = 720;

function buildErasureRecipes(src: ImageData): ErasureRecipe[] {
  const pca = pcaVectors(src);
  const list: ErasureRecipe[] = [
    // eğik ışık ailesi — silgi/kazıma yüzey deformasyonları
    { kind: 'raking', label: 'Eğik Işık 0° · Yatay', angle: 0, strength: 0.55, mix: [0.299, 0.587, 0.114] },
    { kind: 'raking', label: 'Eğik Işık 45° · Çapraz', angle: 45, strength: 0.55, mix: [0.299, 0.587, 0.114] },
    { kind: 'raking', label: 'Eğik Işık 90° · Dikey', angle: 90, strength: 0.55, mix: [0.299, 0.587, 0.114] },
    { kind: 'raking', label: 'Eğik Işık 135° · Ters Çapraz', angle: 135, strength: 0.55, mix: [0.299, 0.587, 0.114] },
    { kind: 'raking', label: 'Eğik Işık 180° · Ters Yatay', angle: 180, strength: 0.55, mix: [0.299, 0.587, 0.114] },
    { kind: 'raking', label: 'Eğik Işık 45° · IR', angle: 45, strength: 0.6, mix: [0.68, 0.32, 0.0] },
    // doku bozulması — kâğıt lifi tahribatı
    { kind: 'texture', label: 'Doku Bozulması r=3', radius: 3 },
    { kind: 'texture', label: 'Doku Bozulması r=6', radius: 6 },
    { kind: 'texture', label: 'Doku Bozulması r=10', radius: 10 },
    // mürekkep kalıntısı — soluk izler
    { kind: 'residual', label: 'Kalıntı DoG 1.5/8', s1: 1.5, s2: 8, gain: 3.2 },
    { kind: 'residual', label: 'Kalıntı DoG 2.5/14', s1: 2.5, s2: 14, gain: 3.2 },
    { kind: 'residual', label: 'Kalıntı DoG 4/22', s1: 4, s2: 22, gain: 2.6 },
    // kanal-oranı — kimyasal silme renk artıkları
    { kind: 'ratio', label: 'Oran B−R (Mavi Kalıntı)', op: 'b-r' },
    { kind: 'ratio', label: 'Oran R−B (Sıcak Kalıntı)', op: 'r-b' },
    { kind: 'ratio', label: 'Aşırı Yeşil 2G−R−B', op: '2g-r-b' },
    { kind: 'ratio', label: 'Doygunluk', op: 'sat' },
    // kimyasal sapma haritaları — çözücü artığının renginden bağımsız tespit
    { kind: 'chroma', label: 'Kimyasal Renk Sapması (B−R)', op: 'b-r' },
    { kind: 'chroma', label: 'Kimyasal Leke Sapması (Doygunluk)', op: 'sat' },
    // spektral bantlar
    { kind: 'band', label: 'UV-A 365nm', mix: [0.16, 0.36, 0.62] },
    { kind: 'band', label: 'Mavi 470nm', mix: [0.08, 0.3, 0.72] },
    { kind: 'band', label: 'Kırmızı 630nm', mix: [0.93, 0.14, 0.02] },
    // PCA + top-hat
    { kind: 'pca', label: 'PCA B1 (luminans)', vec: pca.e1 },
    { kind: 'pca', label: 'PCA B2 (renk-farkı)', vec: pca.e2 },
    { kind: 'tophat', label: 'Top-Hat r=4 · Beyaz', mix: [0.299, 0.587, 0.114], radius: 4 },
    { kind: 'tophat', label: 'Top-Hat r=8 · Beyaz', mix: [0.299, 0.587, 0.114], radius: 8 },
  ];
  return list;
}

/** Aile bazlı çeşitlilik — her tekniğin en iyi adayı galereye düşmesin. */
function diverseTopE(scored: ErasureCandidate[], k: number): ErasureCandidate[] {
  const byFam = new Map<string, ErasureCandidate[]>();
  for (const c of scored) {
    const f = c.recipe.kind;
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f)!.push(c);
  }
  const fams = [...byFam.entries()].sort(
    (a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0)
  );
  const out: ErasureCandidate[] = [];
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

/**
 * Otomatik silme taraması: görüntüyü tarama çözünürlüğüne indirir, tüm
 * eradikasyon tariflerini üretip skorlar; en iyi `top` adet döndürür.
 * `region` (0..1 normalize) verildiyse skorlama yalnızca o bölgede yapılır.
 */
export async function autoScanErasure(
  srcFull: ImageData,
  region: Rect | null,
  top = 9,
  onProgress?: (p: ScanProgress) => void
): Promise<ErasureScanResult> {
  const scan = scaleToWidth(resizeImageData(srcFull, 1400), SCAN_MAX_W);
  const recipes = buildErasureRecipes(scan);
  const scored: ErasureCandidate[] = [];
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    const g = renderErasureRecipe(scan, r);
    const score = scoreErasure(g, region);
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
  return { candidates: diverseTopE(scored, top), scanSrc: scan };
}

/** Seçilen tarifi TAM çözünürlükte işleyip görüntüleyiciye uygulanacak hale getirir. */
export function renderErasureFull(srcFull: ImageData, recipe: ErasureRecipe, tune?: FineTune): ImageData {
  const g = tune ? renderErasureTuned(srcFull, recipe, tune) : renderErasureRecipe(srcFull, recipe);
  return grayToImageData(g);
}
