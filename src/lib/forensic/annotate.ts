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

/** Anotasyonun görüntü üzerindeki ölçü etiketi. */
export function measureLabel(a: Annotation, pxPerMm: number | null): string | null {
  if (a.kind === 'ruler' && a.pts.length === 2) {
    const px = dist(a.pts[0], a.pts[1]);
    return pxPerMm ? `${(px / pxPerMm).toFixed(1)} mm` : `${px.toFixed(0)} px`;
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
}

/** Çizim birimi (görüntü pikseli cinsinden): panelde ekran-sabit,
 *  tam çözünürlükte belge-sabit taban devreye girer. */
function unit(d: DrawCtx): number {
  const t = d.thickness ?? 1;
  const minDim = Math.min(d.imgW ?? 1200, d.imgH ?? 1600);
  return Math.max(3.5 / d.scale, minDim / 110) * t;
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
        if (p.length === 2) {
          strokeMarked(d, () => {
            ctx.beginPath();
            ctx.moveTo(p[0].x, p[0].y);
            ctx.lineTo(p[1].x, p[1].y);
          }, a.color, u);
          drawTicks(d, p[0], p[1], a.color, u);
          drawDot(d, p[0].x, p[0].y, u, a.color);
          drawDot(d, p[1].x, p[1].y, u, a.color);
          const lab = measureLabel(a, d.pxPerMm);
          if (lab) {
            // etiketi çizginin "üstüne" doğru normal yönünde kaydır
            const len = dist(p[0], p[1]) || 1;
            let nx = -(p[1].y - p[0].y) / len;
            let ny = (p[1].x - p[0].x) / len;
            if (ny > 0) { nx = -nx; ny = -ny; } // etiket her zaman yukarı baksın
            const off = u * 2.4;
            drawLabel(d, lab, (p[0].x + p[1].x) / 2 + nx * off, (p[0].y + p[1].y) / 2 + ny * off, a.color, u);
          }
        }
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
