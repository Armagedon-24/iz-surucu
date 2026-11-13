/**
 * ÖLÇÜM VE ANOTASYON TİPLERİ + ÇİZİCİ — cetvel/açı ölçümü, ok, daire,
 * dikdörtgen ve metin işaretlemeleri. Koordinatlar GÖRÜNTÜ uzayındadır;
 * panel görüntüyü ölçekleyip gösterir, çizici ölçek oranını kendisi alır.
 *
 * GÖRÜNÜRLÜK SİSTEMİ (REV 9.7): çizim kalınlığı iki tabandan büyük olanıyla
 * belirlenir — (a) ekran-sabit taban (panelde her zaman 3.5 ekran pikseli),
 * (b) çözünürlük-sabit taban (minDim/110 → rapor/tam çözünürlük çıktısında
 * belgeye oranlı kalınlık). Böylece hem yan panel hem PDF'e gömülen tam
 * çözünürlük karede cetvel/ok net görünür. Tüm vurgular çift konturla çizilir
 * (beyaz/siyah alt çizgi + renkli çekirdek), etiketler koyu kapsül +
 * renkli çerçeve + beyaz yazıyla çizilir; her arka planda okunur.
 *
 * ADLİ CETVEL (REV 9.8): cetvel ölçümü artık düz çizgi değil, olay yeri
 * fotoğraflarında kullanılan gerçek adli cetvel görünümündedir — ölçü
 * çizgisi boyunca siyah/beyaz bloklardan ölçek bandı, dik uç kapamaları,
 * (kalibre edildiyse) bloklarda cm numaraları ve seçilen renkte çerçeve.
 * Böylece ölçü, raporda "adli cetvelle ölçülmüştür" algısı verir.
 *
 * BÜYÜK EKRAN + TAŞIMA (REV 9.9): işaretlemeler ana görüntüleyicide de çizilir
 * (screenBase ile paneldekinden kalın); düzenleme modunda uçlarda ekranda sabit
 * boyutlu taşıma tutamaçları belirir ve hit-test ile uçlar/gövde sürüklenerek
 * ayarlanır. Kalibre ölçüler hem santimetre hem milimetre yazılır.
 */

export type AnnKind = 'ruler' | 'angle' | 'arrow' | 'circle' | 'rect' | 'text' | 'calib';

export interface Annotation {
  id: string;
  kind: AnnKind;
  pts: { x: number; y: number }[];
  text?: string;
  color: string;
  /** cetvel/kalibrasyon sonucu: mm cinsinden ölçüm (gösterimde kullanılır) */
  mm?: number;
}

export const ANN_COLORS = ['#f59e0b', '#38bdf8', '#f43f5e', '#34d399', '#a78bfa', '#ffffff'];

/** Kalınlık seçenekleri — paneldeki İNCE/NORMAL/KALIN düğmeleri. */
export const ANN_THICKNESS: { label: string; value: number }[] = [
  { label: 'İNCE', value: 0.8 },
  { label: 'NORMAL', value: 1 },
  { label: 'KALIN', value: 1.5 },
];

export const KIND_LABELS: Record<AnnKind, string> = {
  ruler: 'CETVEL',
  angle: 'AÇI',
  arrow: 'OK',
  circle: 'DAİRE',
  rect: 'DİKDÖRTGEN',
  text: 'METİN',
  calib: 'KALİBRASYON',
};

/** Bir anotasyon için gereken nokta sayısı. */
export function requiredPoints(kind: AnnKind): number {
  switch (kind) {
    case 'ruler': case 'arrow': case 'rect': case 'calib': return 2;
    case 'angle': return 3;
    case 'circle': return 2;
    case 'text': return 1;
  }
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 3 noktadan açı (a-b arası tepe noktası b). */
export function angleDeg(pts: { x: number; y: number }[]): number {
  if (pts.length < 3) return 0;
  const [a, b, c] = pts;
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!m) return 0;
  return +(Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI).toFixed(1);
}

/** Mesafeyi hem santimetre hem milimetre olarak biçimler — Türkçe ondalık virgülle.
 *  Örn. 125.4 mm → "12,54 cm (125,4 mm)". */
export function mmLabel(mm: number): string {
  return `${(mm / 10).toFixed(2).replace('.', ',')} cm (${mm.toFixed(1).replace('.', ',')} mm)`;
}

/** Anotasyonun görüntü üzerindeki ölçü etiketi. */
export function measureLabel(a: Annotation, pxPerMm: number | null): string | null {
  if (a.kind === 'ruler' && a.pts.length === 2) {
    const px = dist(a.pts[0], a.pts[1]);
    return pxPerMm ? mmLabel(px / pxPerMm) : `${px.toFixed(0)} px`;
  }
  if (a.kind === 'angle' && a.pts.length === 3) return `${angleDeg(a.pts)}°`;
  if (a.kind === 'calib' && a.pts.length === 2 && a.mm) {
    return `${a.mm} mm = ${dist(a.pts[0], a.pts[1]).toFixed(0)} px`;
  }
  return null;
}

interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  /** görüntü → ekran ölçek çarpanı */
  scale: number;
  pxPerMm: number | null;
  /** son noktadan imlece canlı çizgi (kullanıcı seçim yapıyorken) */
  livePts?: { x: number; y: number }[];
  /** görüntü boyutları — tam çözünürlük çıktıda çizim belgeye oranlı kalın olur */
  imgW?: number;
  imgH?: number;
  /** kalınlık çarpanı — İNCE 0.8 / NORMAL 1 / KALIN 1.5 */
  thickness?: number;
  /** ekran-sabit çizgi tabanı (px) — panelde 4, büyük görüntüleyicide 5 */
  screenBase?: number;
  /** düzenleme modu — uçlarda taşıma tutamaçları çizilir */
  handles?: boolean;
}

/** Çizim birimi (görüntü pikseli cinsinden): panelde ekran-sabit,
 *  tam çözünürlükte belge-sabit taban devreye girer. */
function unit(d: DrawCtx): number {
  const t = d.thickness ?? 1;
  const minDim = Math.min(d.imgW ?? 1200, d.imgH ?? 1600);
  return Math.max((d.screenBase ?? 3.5) / d.scale, minDim / 110) * t;
}

/** Renkli çekirdeğin altındaki kontrast kontur rengi — her zeminde görünür. */
function underlayFor(color: string): string {
  return color.toLowerCase() === '#ffffff' ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.92)';
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Yolu önce kalın kontrast konturla, sonra renkli çekirdekle çizer. */
function strokeMarked(d: DrawCtx, path: () => void, color: string, u: number, dash: number[] = []): void {
  const { ctx } = d;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = u * 2.1;
  ctx.strokeStyle = underlayFor(color);
  path();
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = u;
  ctx.strokeStyle = color;
  path();
  ctx.stroke();
  ctx.restore();
}

/** Uç nokta — renkli dolu daire + kontrast halka. */
function drawDot(d: DrawCtx, x: number, y: number, u: number, color: string): void {
  const { ctx } = d;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, u * 1.55, 0, Math.PI * 2);
  ctx.fillStyle = underlayFor(color);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, u * 1.05, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Düzenleme tutamacı (REV 9.9) — ekranda sabit boyutlu beyaz daire + renkli
 *  halka + merkez nokta; her zeminde görünür, taşıma alanını gösterir. */
function drawHandle(d: DrawCtx, x: number, y: number, color: string, u: number): void {
  const { ctx, scale } = d;
  const r = Math.max(u * 1.2, 5.5 / scale);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.35);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Ölçü etiketi — koyu kapsül + renkli çerçeve + beyaz kalın yazı. */
function drawLabel(d: DrawCtx, text: string, x: number, y: number, color: string, u: number): void {
  const { ctx } = d;
  ctx.save();
  const fs = Math.max(11, u * 2.3);
  ctx.font = `bold ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const w = ctx.measureText(text).width;
  const padX = u * 1.2;
  const padY = u * 0.75;
  const bx = x - w / 2 - padX;
  const by = y - fs - padY;
  const bw = w + padX * 2;
  const bh = fs + padY * 2;
  ctx.fillStyle = 'rgba(8,10,14,0.84)';
  roundRectPath(ctx, bx, by, bw, bh, Math.min(8, u * 0.9));
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.38);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawArrow(d: DrawCtx, a: { x: number; y: number }, b: { x: number; y: number }, color: string, u: number): void {
  const { ctx } = d;
  const head = u * 2.6;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  // gövde — uçtan hafif geri çekik (ok ucu temiz otursun)
  strokeMarked(d, () => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x - head * 0.55 * Math.cos(ang), b.y - head * 0.55 * Math.sin(ang));
  }, color, u);
  // uç — dolu üçgen + kontrast kontur
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6.5), b.y - head * Math.sin(ang - Math.PI / 6.5));
  ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6.5), b.y - head * Math.sin(ang + Math.PI / 6.5));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.32);
  ctx.strokeStyle = underlayFor(color);
  ctx.stroke();
  ctx.restore();
}

/** ADLİ CETVEL (REV 9.8) — ölçü çizgisini gerçek adli cetvel bandına çevirir:
 *  iki nokta arasında siyah/beyaz bloklardan ölçek şeridi (kalibre ise bloklar
 *  tam 1 cm = 10 mm ve cm numaralı), dik uç kapamaları, seçilen renkte çerçeve,
 *  uçlarda tutamaç noktaları ve bant üstünde ölçü etiketi. */
function drawForensicRuler(d: DrawCtx, a: Annotation, u: number): void {
  const { ctx } = d;
  const [p0, p1] = a.pts;
  const len = dist(p0, p1) || 1;
  const ux = (p1.x - p0.x) / len;
  const uy = (p1.y - p0.y) / len;
  const nx = -uy;
  const ny = ux;
  const half = Math.max(u * 1.2, 3 / d.scale); // bant yarı kalınlığı
  const bandQuad = (from: number, to: number) => () => {
    ctx.beginPath();
    ctx.moveTo(p0.x + ux * from + nx * half, p0.y + uy * from + ny * half);
    ctx.lineTo(p0.x + ux * to + nx * half, p0.y + uy * to + ny * half);
    ctx.lineTo(p0.x + ux * to - nx * half, p0.y + uy * to - ny * half);
    ctx.lineTo(p0.x + ux * from - nx * half, p0.y + uy * from - ny * half);
    ctx.closePath();
  };
  // 1) ölçek blokları — kalibre ise tam 1 cm, değilse çizgiye oranlı bölüm
  const cmPx = d.pxPerMm ? d.pxPerMm * 10 : 0;
  let seg = cmPx || Math.max(u * 3.2, len / 12);
  const n = Math.max(1, Math.min(40, Math.round(len / seg)));
  seg = len / n;
  ctx.save();
  bandQuad(0, len)();
  ctx.clip();
  for (let i = 0; i < n; i++) {
    const s0 = i * seg;
    const s1 = Math.min((i + 1) * seg, len);
    ctx.fillStyle = i % 2 === 0 ? '#0b0b0d' : '#f5f5f2';
    bandQuad(s0, s1)();
    ctx.fill();
  }
  ctx.restore();
  // 2) renkli çerçeve — kullanıcının seçtiği renk, kontrast alt konturla
  strokeMarked(d, bandQuad(0, len), a.color, Math.max(1, u * 0.5));
  // 3) cm numaraları — yalnız kalibre edildiyse ve bloklar yeterince genişse
  if (cmPx && seg >= half * 1.8) {
    const fs = Math.min(half * 1.15, seg * 0.42);
    if (fs >= 6 / d.scale) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.font = `bold ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < n; i++) {
        const sMid = (i + 0.5) * seg;
        const cx = p0.x + ux * sMid;
        const cy = p0.y + uy * sMid;
        const onDark = i % 2 === 0;
        ctx.lineWidth = Math.max(1, fs * 0.3);
        ctx.strokeStyle = onDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)';
        ctx.strokeText(String(i), cx, cy);
        ctx.fillStyle = onDark ? '#ffffff' : '#0b0b0d';
        ctx.fillText(String(i), cx, cy);
      }
      ctx.restore();
    }
  }
  // 4) dik uç kapamaları — cetvelin sıfır ve son çizgisi
  for (const s of [0, len]) {
    const cx = p0.x + ux * s;
    const cy = p0.y + uy * s;
    strokeMarked(d, () => {
      ctx.beginPath();
      ctx.moveTo(cx - nx * (half + u * 0.9), cy - ny * (half + u * 0.9));
      ctx.lineTo(cx + nx * (half + u * 0.9), cy + ny * (half + u * 0.9));
    }, a.color, Math.max(1, u * 0.7));
  }
  // 5) tutamaç noktaları
  drawDot(d, p0.x, p0.y, u * 0.9, a.color);
  drawDot(d, p1.x, p1.y, u * 0.9, a.color);
  // 6) ölçü etiketi — bant üstünde kapsül
  const lab = measureLabel(a, d.pxPerMm);
  if (lab) {
    let lx = nx;
    let ly = ny;
    if (ly > 0) { lx = -lx; ly = -ly; } // etiket her zaman yukarı baksın
    const off = half + u * 1.7;
    drawLabel(d, lab, (p0.x + p1.x) / 2 + lx * off, (p0.y + p1.y) / 2 + ly * off, a.color, u);
  }
}

/** Cetvel/kalibrasyon uçlarına dik kısa tik işaretleri — ölçü çizgisi algısını güçlendirir. */
function drawTicks(d: DrawCtx, a: { x: number; y: number }, b: { x: number; y: number }, color: string, u: number): void {
  const { ctx } = d;
  const len = dist(a, b) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const tick = u * 1.5;
  for (const p of [a, b]) {
    strokeMarked(d, () => {
      ctx.beginPath();
      ctx.moveTo(p.x - nx * tick, p.y - ny * tick);
      ctx.lineTo(p.x + nx * tick, p.y + ny * tick);
    }, color, u * 0.8);
  }
}

/** Nokta-kesit mesafesi — gövde hit-testi için. */
function segDist(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const L2 = vx * vx + vy * vy;
  if (!L2) return Math.hypot(wx, wy);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export interface AnnotationHit {
  ann: Annotation;
  /** sürüklenecek nokta indeksi; -1 = tüm işaretleme taşınır */
  index: number;
}

/** İşaretleme hit-testi (görüntü uzayı) — önce uçlar, sonra gövde; üstteki
 *  (son çizilen) işaretlemeler önceliklidir. Tol: görüntü pikseli cinsinden. */
export function hitAnnotation(
  anns: Annotation[],
  p: { x: number; y: number },
  tol: number,
): AnnotationHit | null {
  for (let i = anns.length - 1; i >= 0; i--) {
    const a = anns[i];
    for (let k = 0; k < a.pts.length; k++) {
      if (dist(a.pts[k], p) <= tol) return { ann: a, index: k };
    }
  }
  for (let i = anns.length - 1; i >= 0; i--) {
    const a = anns[i];
    const q = a.pts;
    let hit = false;
    if (a.kind === 'ruler' || a.kind === 'arrow' || a.kind === 'calib') {
      hit = q.length === 2 && segDist(q[0], q[1], p) <= tol * 1.6;
    } else if (a.kind === 'angle') {
      hit = q.length === 3 && (segDist(q[0], q[1], p) <= tol * 1.6 || segDist(q[1], q[2], p) <= tol * 1.6);
    } else if (a.kind === 'circle') {
      hit = q.length === 2 && Math.abs(dist(q[0], p) - dist(q[0], q[1])) <= tol * 1.6;
    } else if (a.kind === 'rect') {
      if (q.length === 2) {
        const x0 = Math.min(q[0].x, q[1].x);
        const x1 = Math.max(q[0].x, q[1].x);
        const y0 = Math.min(q[0].y, q[1].y);
        const y1 = Math.max(q[0].y, q[1].y);
        hit = p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol;
      }
    } else if (a.kind === 'text') {
      hit = q.length >= 1 && dist(q[0], p) <= tol * 3;
    }
    if (hit) return { ann: a, index: -1 };
  }
  return null;
}

/** İşaretlemenin bir noktasını taşır (yeni kayıt döner, orijinal değişmez). */
export function moveAnnotationPoint(
  a: Annotation,
  index: number,
  p: { x: number; y: number },
): Annotation {
  return { ...a, pts: a.pts.map((q, i) => (i === index ? p : q)) };
}

/** Tüm işaretlemeyi (dx, dy) kadar kaydırır. */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  return { ...a, pts: a.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
}

/** Tüm anotasyonları (ve canlı seçimi) ekrana çizer. */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  anns: Annotation[],
  d: DrawCtx,
): void {
  for (const a of anns) {
    d.ctx = ctx;
    const u = unit(d);
    const p = a.pts;
    ctx.save();
    switch (a.kind) {
      case 'ruler': {
        if (p.length === 2) drawForensicRuler(d, a, u);
        break;
      }
      case 'angle': {
        if (p.length === 3) {
          strokeMarked(d, () => {
            ctx.beginPath();
            ctx.moveTo(p[0].x, p[0].y);
            ctx.lineTo(p[1].x, p[1].y);
            ctx.lineTo(p[2].x, p[2].y);
          }, a.color, u);
          // tepe noktada iç açı yayı
          const a1 = Math.atan2(p[0].y - p[1].y, p[0].x - p[1].x);
          const a2 = Math.atan2(p[2].y - p[1].y, p[2].x - p[1].x);
          const r = u * 2.2;
          ctx.save();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(p[1].x, p[1].y, r, Math.min(a1, a2), Math.max(a1, a2));
          ctx.lineWidth = Math.max(1, u * 0.45);
          ctx.strokeStyle = underlayFor(a.color);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p[1].x, p[1].y, r, Math.min(a1, a2), Math.max(a1, a2));
          ctx.lineWidth = u * 0.45;
          ctx.strokeStyle = a.color;
          ctx.stroke();
          ctx.restore();
          for (const pt of p) drawDot(d, pt.x, pt.y, u * 0.9, a.color);
          const lab = measureLabel(a, d.pxPerMm);
          if (lab) {
            const mid = Math.min(a1, a2) + (Math.max(a1, a2) - Math.min(a1, a2)) / 2;
            drawLabel(d, lab, p[1].x + Math.cos(mid) * u * 4.2, p[1].y + Math.sin(mid) * u * 4.2, a.color, u);
          }
        }
        break;
      }
      case 'arrow': {
        if (p.length === 2) drawArrow(d, p[0], p[1], a.color, u);
        break;
      }
      case 'circle': {
        if (p.length === 2) {
          const r = dist(p[0], p[1]);
          strokeMarked(d, () => {
            ctx.beginPath();
            ctx.arc(p[0].x, p[0].y, r, 0, Math.PI * 2);
          }, a.color, u);
          drawDot(d, p[0].x, p[0].y, u * 0.85, a.color);
        }
        break;
      }
      case 'rect': {
        if (p.length === 2) {
          strokeMarked(d, () => {
            ctx.beginPath();
            ctx.rect(
              Math.min(p[0].x, p[1].x), Math.min(p[0].y, p[1].y),
              Math.abs(p[1].x - p[0].x), Math.abs(p[1].y - p[0].y),
            );
          }, a.color, u);
        }
        break;
      }
      case 'text': {
        if (p.length >= 1 && a.text) {
          const fs = Math.max(11, u * 2.4);
          ctx.save();
          ctx.font = `bold ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textBaseline = 'alphabetic';
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.lineWidth = fs * 0.45;
          ctx.strokeStyle = underlayFor(a.color);
          ctx.setLineDash([]);
          ctx.strokeText(a.text, p[0].x, p[0].y);
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, p[0].x, p[0].y);
          ctx.restore();
        }
        break;
      }
      case 'calib': {
        if (p.length === 2) {
          const dash = [u * 1.6, u * 1.1];
          strokeMarked(d, () => {
            ctx.beginPath();
            ctx.moveTo(p[0].x, p[0].y);
            ctx.lineTo(p[1].x, p[1].y);
          }, a.color, u, dash);
          // kalibrasyon bandı — adli cetvelin referans parçası gibi renkli ince şerit
          strokeMarked(d, () => {
            const len = dist(p[0], p[1]) || 1;
            const nx = -((p[1].y - p[0].y) / len);
            const ny = (p[1].x - p[0].x) / len;
            const h = Math.max(u * 0.8, 2 / d.scale);
            ctx.beginPath();
            ctx.moveTo(p[0].x + nx * h, p[0].y + ny * h);
            ctx.lineTo(p[1].x + nx * h, p[1].y + ny * h);
            ctx.lineTo(p[1].x - nx * h, p[1].y - ny * h);
            ctx.lineTo(p[0].x - nx * h, p[0].y - ny * h);
            ctx.closePath();
          }, a.color, Math.max(1, u * 0.35));
          drawTicks(d, p[0], p[1], a.color, u);
          for (const pt of p) drawDot(d, pt.x, pt.y, u * 0.9, a.color);
          const lab = measureLabel(a, d.pxPerMm);
          if (lab) drawLabel(d, `KALİBRASYON · ${lab}`, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2 - u * 2.4, a.color, u);
        }
        break;
      }
    }
    ctx.restore();
  }
  // canlı seçim — son noktadan imlece kılavuz çizgisi + konulmuş noktalar
  const live = d.livePts;
  if (live && live.length >= 1) {
    const u = unit(d);
    ctx.save();
    ctx.setLineDash([u * 0.9, u * 0.9]);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, u * 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(live[live.length - 1].x, live[live.length - 1].y);
    ctx.lineTo(live[0].x, live[0].y);
    ctx.stroke();
    ctx.restore();
    for (const pt of live) drawDot(d, pt.x, pt.y, u * 0.75, '#f59e0b');
  }
  // düzenleme tutamaçları (REV 9.9) — taşıma modunda her uçta ekranda sabit daire
  if (d.handles) {
    const uh = unit({ ...d, thickness: 1 });
    for (const a of anns) {
      if (a.kind === 'text') continue;
      for (const pt of a.pts) drawHandle(d, pt.x, pt.y, a.color, uh);
    }
  }
}

/** Rapor/denetim özeti — tüm ölçüm ve işaretlemelerin tek satırlık dökümü. */
export function annotationsSummary(anns: Annotation[], pxPerMm: number | null): string {
  const parts: string[] = [];
  let ruler = 0, angle = 0, marks = 0;
  for (const a of anns) {
    if (a.kind === 'ruler') {
      ruler += 1;
      const lab = measureLabel(a, pxPerMm);
      if (lab) parts.push(`Cetvel ${ruler}: ${lab}`);
    } else if (a.kind === 'angle') {
      angle += 1;
      const lab = measureLabel(a, pxPerMm);
      if (lab) parts.push(`Açı ${angle}: ${lab}`);
    } else if (a.kind !== 'calib') {
      marks += 1;
    }
  }
  if (marks) parts.push(`${marks} işaretleme (ok/daire/dikdörtgen/metin)`);
  const calib = anns.find((a) => a.kind === 'calib');
  if (calib?.mm && calib.pts.length === 2) {
    parts.push(`Ölçek: ${dist(calib.pts[0], calib.pts[1]).toFixed(0)} px = ${calib.mm} mm`);
  }
  return parts.join(' · ') || 'işaretleme yok';
}
