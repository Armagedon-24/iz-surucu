/**
 * YÖN TARAMASI — çizgi yönlerine göre yapısal tarama kütüphanesi.
 *
 * Belgedeki çizgi yapıları (girinti, karalama, çizik, mürekkep akışı) belli
 * yönlerde yoğunlaşır. Sobel gradyanları bir kez hesaplanır; her θ yönü için
 * gradyanın çizgiye DİK bileşeni |g·n| toplanır — çizgiler gradyanını çizgiye
 * dik üretir. Skor = Σ|g·n|³ / Σ|g·n|² (güçlü ve sürekli çizgiler öne çıkar).
 *
 * Açılar ekran-tekabüllü: 0° = yatay çizgi, 90° = düşey çizgi, saat yönünün
 * tersine artar (kutup diyagramıyla aynı düzen).
 */

export interface DirScore {
  angle: number; // 0..175, 5° adım
  score: number;
}

export interface DirScanResult {
  scores: DirScore[]; // yumuşatılmış 36 yön
  best: number; // en belirgin yön
  top: number[]; // en iyi 3 yön (birbirinden ≥15° uzak)
  width: number;
  height: number;
}

/** Çizgi yönü θ (ekran) için çizgiye dik normalin görüntü koordinatlarındaki bileşenleri. */
function normalFor(angleDeg: number): { nx: number; ny: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { nx: Math.sin(rad), ny: Math.cos(rad) };
}

/** Kaynağı tarama çözünürlüğüne küçült (hız için). */
function shrink(src: ImageData, maxDim: number): ImageData {
  if (Math.max(src.width, src.height) <= maxDim) return src;
  const s = maxDim / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const a = document.createElement('canvas');
  a.width = src.width;
  a.height = src.height;
  a.getContext('2d')!.putImageData(src, 0, 0);
  const b = document.createElement('canvas');
  b.width = w;
  b.height = h;
  const ctx = b.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(a, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function toGray(img: ImageData): Float32Array {
  const n = img.width * img.height;
  const g = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  return g;
}

/** Sobel gradyanları — kenar pikselleri 0. */
function sobel(g: Float32Array, w: number, h: number) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = g[i - w - 1], t = g[i - w], tr = g[i - w + 1];
      const l = g[i - 1], r = g[i + 1];
      const bl = g[i + w - 1], b = g[i + w], br = g[i + w + 1];
      gx[i] = (tr + 2 * r + br) - (tl + 2 * l + bl);
      gy[i] = (bl + 2 * b + br) - (tl + 2 * t + tr);
    }
  }
  return { gx, gy };
}

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

/**
 * Tüm yönleri tarar ve skorlar. Ağır iş `setTimeout` ile panel tarafından
 * çağrılır; ~900px küçültme + 36 yön tek geçiş: birkaç yüz ms.
 */
export function scanDirections(src: ImageData, maxDim = 900): DirScanResult {
  const small = shrink(src, maxDim);
  const w = small.width;
  const h = small.height;
  const { gx, gy } = sobel(toGray(small), w, h);
  const n = w * h;

  const raw: DirScore[] = [];
  for (let a = 0; a < 180; a += 5) {
    const { nx, ny } = normalFor(a);
    let s2 = 0;
    let s3 = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.abs(gx[i] * nx + gy[i] * ny);
      const e2 = e * e;
      s2 += e2;
      s3 += e2 * e;
    }
    raw.push({ angle: a, score: s3 / (s2 + 1e-6) });
  }

  // Dairesel yumuşatma [1 2 3 2 1]/9 — komşu açı gürültüsünü kısar
  const scores = raw.map((s, i) => {
    const g = (k: number) => raw[(i + k + raw.length) % raw.length].score;
    return { angle: s.angle, score: (g(-2) + 2 * g(-1) + 3 * s.score + 2 * g(1) + g(2)) / 9 };
  });

  const sorted = [...scores].sort((x, y) => y.score - x.score);
  const top: number[] = [];
  for (const s of sorted) {
    if (top.every((t) => angularDiff(t, s.angle) >= 15)) top.push(s.angle);
    if (top.length === 3) break;
  }

  return { scores, best: top[0] ?? 0, top, width: w, height: h };
}

/**
 * Seçilen yöndeki çizgi yapılarını vurgular: çizgiye dik gradyan büyüklüğü
 * mürekkep/girinti olarak koyu, zemin açık render edilir (%99,5 yüzdelikle
 * normalleştirilir — tek tük aykırı değerler görüntüyü karartmaz).
 */
export function renderDirectional(src: ImageData, angleDeg: number): ImageData {
  const w = src.width;
  const h = src.height;
  const { gx, gy } = sobel(toGray(src), w, h);
  const { nx, ny } = normalFor(angleDeg);
  const n = w * h;

  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    e[i] = Math.abs(gx[i] * nx + gy[i] * ny);
  }

  // %99,5 yüzdelik — normalleştirme
  const bins = new Uint32Array(1024);
  for (let i = 0; i < n; i++) bins[Math.min(1023, e[i] | 0)]++;
  const target = n * 0.995;
  let p99 = 1;
  let acc = 0;
  for (let b = 0; b < 1024; b++) {
    acc += bins[b];
    if (acc >= target) {
      p99 = Math.max(1, b);
      break;
    }
  }

  const out = new ImageData(w, h);
  const d = out.data;
  for (let i = 0; i < n; i++) {
    const ink = Math.min(1, Math.pow(e[i] / p99, 0.8));
    const v = Math.round(255 - 255 * ink);
    const p = i * 4;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  return out;
}
