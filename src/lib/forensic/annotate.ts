/**
 * ÖLÇÜM VE ANOTASYON TİPLERİ + ÇİZİCİ — cetvel/açı ölçümü, ok, daire,
 * dikdörtgen ve metin işaretlemeleri. Koordinatlar GÖRÜNTÜ uzayındadır;
 * panel görüntüyü ölçekleyip gösterir, çizici ölçek oranını kendisi alır.
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
}

function lineWidth(d: DrawCtx, base = 2): number {
  return Math.max(1, base / d.scale);
}

function fontSize(d: DrawCtx, base = 12): number {
  return Math.max(9, base / d.scale);
}

function drawLabel(d: DrawCtx, text: string, x: number, y: number, color: string): void {
  const { ctx } = d;
  ctx.save();
  ctx.font = `bold ${fontSize(d, 13)}px ui-monospace, monospace`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(x - w / 2 - 3 / d.scale, y - fontSize(d, 13) - 2 / d.scale, w + 6 / d.scale, fontSize(d, 13) + 6 / d.scale);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawArrow(d: DrawCtx, a: { x: number; y: number }, b: { x: number; y: number }, color: string): void {
  const { ctx } = d;
  const head = 12 / d.scale;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Tüm anotasyonları (ve canlı seçimi) ekrana çizer. */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  anns: Annotation[],
  d: DrawCtx,
): void {
  for (const a of anns) {
    d.ctx = ctx;
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = lineWidth(d, a.kind === 'text' ? 1.5 : 2);
    ctx.setLineDash(a.kind === 'calib' ? [6 / d.scale, 4 / d.scale] : []);
    const p = a.pts;
    switch (a.kind) {
      case 'ruler':
        if (p.length === 2) {
          ctx.beginPath();
          ctx.moveTo(p[0].x, p[0].y);
          ctx.lineTo(p[1].x, p[1].y);
          ctx.stroke();
          for (const pt of p) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3.5 / d.scale, 0, Math.PI * 2);
            ctx.fill();
          }
          const lab = measureLabel(a, d.pxPerMm);
          if (lab) drawLabel(d, lab, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, a.color);
        }
        break;
      case 'angle':
        if (p.length === 3) {
          ctx.beginPath();
          ctx.moveTo(p[0].x, p[0].y);
          ctx.lineTo(p[1].x, p[1].y);
          ctx.lineTo(p[2].x, p[2].y);
          ctx.stroke();
          const lab = measureLabel(a, d.pxPerMm);
          if (lab) drawLabel(d, lab, p[1].x, p[1].y - 8 / d.scale, a.color);
        }
        break;
      case 'arrow':
        if (p.length === 2) drawArrow(d, p[0], p[1], a.color);
        break;
      case 'circle':
        if (p.length === 2) {
          const r = dist(p[0], p[1]);
          ctx.beginPath();
          ctx.arc(p[0].x, p[0].y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'rect':
        if (p.length === 2) {
          ctx.strokeRect(
            Math.min(p[0].x, p[1].x), Math.min(p[0].y, p[1].y),
            Math.abs(p[1].x - p[0].x), Math.abs(p[1].y - p[0].y),
          );
        }
        break;
      case 'text':
        if (p.length >= 1 && a.text) {
          ctx.save();
          ctx.font = `${fontSize(d, 15)}px ui-monospace, monospace`;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = lineWidth(d, 3);
          ctx.strokeText(a.text, p[0].x, p[0].y);
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, p[0].x, p[0].y);
          ctx.restore();
        }
        break;
      case 'calib':
        if (p.length === 2) {
          ctx.beginPath();
          ctx.moveTo(p[0].x, p[0].y);
          ctx.lineTo(p[1].x, p[1].y);
          ctx.stroke();
          const lab = measureLabel(a, d.pxPerMm);
          if (lab) drawLabel(d, lab, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2 - 10 / d.scale, a.color);
        }
        break;
    }
    ctx.restore();
  }
  // canlı seçim — son noktadan imlece kılavuz çizgisi
  const live = d.livePts;
  if (live && live.length >= 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = lineWidth(d, 1.2);
    ctx.setLineDash([4 / d.scale, 4 / d.scale]);
    ctx.beginPath();
    ctx.moveTo(live[live.length - 1].x, live[live.length - 1].y);
    ctx.lineTo(live[0].x, live[0].y);
    ctx.stroke();
    ctx.restore();
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
