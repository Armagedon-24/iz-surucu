'use client';

/**
 * GÖRÜNTÜLEYİCİ — adli inceleme ekranı.
 * Zoom/pan, split & side karşılaştırma, OCR bölge seçimi, anomali kaplamaları,
 * histogram HUD ve cihaz okumaları (mono HUD).
 * REV 9.10 — büyük ekran işaretleme editörü: cetvel/ok/daire/açı/dikdörtgen/
 * metin/kalibrasyon doğrudan büyük ekranda çizilir (EKRANDA İŞARETLE paleti),
 * uçlardaki tutamaçlardan sürüklenerek düzeltilir, ölçü etiketi santimetre +
 * milimetre yazar; araç/renk/kalınlık ARAÇLAR paneliyle ortaktır.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Maximize2, Minus, Plus, SquareDashedMousePointer, ScanSearch, Move, Undo2, X,
} from 'lucide-react';
import type { Rect } from '@/lib/forensic/filters';
import type { AnomalyRegion } from '@/lib/forensic/pipeline';
import {
  ANN_COLORS, ANN_THICKNESS, KIND_LABELS, requiredPoints, dist, mmLabel, angleDeg,
  drawAnnotations, hitAnnotation, moveAnnotationPoint, translateAnnotation,
  type Annotation, type AnnKind,
} from '@/lib/forensic/annotate';
import { useCaseStore } from '@/lib/forensic/store';

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  conf: number;
}

/** Kesme çerçevesi — görüntü pikseli cinsinden. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Çerçeve tutamaç noktaları (8 adet, sırayla: nw n ne e se s sw w). */
function handlePoints(r: CropRect): [number, number][] {
  const { x, y, w, h } = r;
  return [
    [x, y], [x + w / 2, y], [x + w, y],
    [x + w, y + h / 2], [x + w, y + h],
    [x + w / 2, y + h], [x, y + h], [x, y + h / 2],
  ];
}

const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

/** Büyük ekran işaretleme paleti (REV 9.10) — TAŞI + çizim araçları. */
const V_TOOLS = ['move', 'ruler', 'angle', 'arrow', 'circle', 'rect', 'text', 'calib'] as const;
type VTool = (typeof V_TOOLS)[number];

/** Ekran pikseli verilen noktanın tutamaç/taşı/yeni seçim hit-testi. */
function hitHandle(
  r: CropRect | null,
  px: number, py: number,
  tx: number, ty: number, scale: number,
  tol: number,
): string {
  if (!r) return 'new';
  const pts = handlePoints(r);
  for (let i = 0; i < pts.length; i++) {
    const sx = tx + pts[i][0] * scale;
    const sy = ty + pts[i][1] * scale;
    if (Math.abs(px - sx) <= tol && Math.abs(py - sy) <= tol) return HANDLE_NAMES[i];
  }
  const rx = tx + r.x * scale;
  const ry = ty + r.y * scale;
  if (px >= rx && px <= rx + r.w * scale && py >= ry && py <= ry + r.h * scale) return 'move';
  return 'new';
}

interface ViewerProps {
  original: ImageData | null;
  processed: ImageData | null;
  /**
   * Canlı ince ayar önizlemesi — panelde kaydırıcılar sürüklenirken taranan
   * iyileştirilmiş görüntü. Taahhüt edilmiş `processed` boyutlarına ölçeklenerek
   * çizilir: zoom/pan sabit kalır, çözünürlük sıçraması olmaz.
   */
  livePreview?: ImageData | null;
  hist: Uint32Array | null;
  hudLeft: string;
  hudRight: string;
  compareMode: 'single' | 'split' | 'side';
  comparePct: number;
  onComparePct: (p: number) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  region: Rect | null; // normalize 0..1
  onRegionDone: (r: Rect | null) => void;
  boxes: OcrBox[];
  showBoxes: boolean;
  anomalies: AnomalyRegion[];
  showAnomalies: boolean;
  /** Kesme modu — İnceleme Varyantı görüntüsü üzerinde ayarlanabilir çerçeve. */
  cropMode: boolean;
  cropRect: CropRect | null;
  onCropRect: (r: CropRect | null) => void;
  /** İşaretlemeler (ARAÇLAR panelinde çizilen) — büyük ekranda da görünür (REV 9.9). */
  annotations: Annotation[];
  pxPerMm: number | null;
  /** Taşıma modu — işaretleme uçları ekranda sürüklenerek ayarlanır. */
  annotEdit: boolean;
  onAnnotEdit: (on: boolean) => void;
  /** Sürükleme sonucu güncellenmiş işaretleme listesi. */
  onAnnotationsChange: (a: Annotation[]) => void;
}

export function ImageViewer(props: ViewerProps) {
  const {
    original, processed, livePreview, hist, hudLeft, hudRight, compareMode,
    comparePct, onComparePct, selectMode, onSelectMode, region, onRegionDone,
    boxes, showBoxes, anomalies, showAnomalies, cropMode, cropRect, onCropRect,
    annotations, pxPerMm, annotEdit, onAnnotEdit, onAnnotationsChange,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const procCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [scale, setScale] = useState(0.4);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panning, setPanning] = useState(false);
  /** Dokunmatik cihaz (coarse pointer) — parmak toleransları büyütülür. */
  const coarseRef = useRef(false);
  useEffect(() => {
    coarseRef.current =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(pointer: coarse)').matches;
  }, []);
  /** Aktif işaretçiler — iki parmak pinch-zoom için izlenir. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number; scale: number; cx: number; cy: number; tx: number; ty: number;
  } | null>(null);
  const dragState = useRef<{
    mode: 'pan' | 'region' | 'divider' | 'crop' | 'annot' | null;
    sx: number; sy: number; stx: number; sty: number;
    rx0: number; ry0: number;
    handle?: string;
    cr?: CropRect;
    /** taşıma sürüklemesi — hedef işaretleme ve başlangıç durumu */
    annot?: {
      annId: string;
      index: number; // -1 = tümünü taşı
      kind: AnnKind;
      origPts: { x: number; y: number }[];
      start: { x: number; y: number };
    };
  }>({ mode: null, sx: 0, sy: 0, stx: 0, sty: 0, rx0: 0, ry0: 0 });

  const { toast } = useToast();
  // Depoda paylaşılan araç/renk/kalınlık — ARAÇLAR paneliyle aynı ayar (REV 9.10)
  const annotTool = useCaseStore((s) => s.annotTool);
  const setAnnotTool = useCaseStore((s) => s.setAnnotTool);
  const annotColor = useCaseStore((s) => s.annotColor);
  const setAnnotColor = useCaseStore((s) => s.setAnnotColor);
  const annotThickness = useCaseStore((s) => s.annotThickness);
  const setAnnotThickness = useCaseStore((s) => s.setAnnotThickness);
  const addAudit = useCaseStore((s) => s.addAudit);
  const setPxPerMm = useCaseStore((s) => s.setPxPerMm);

  // Büyük ekran paleti — çizim aracı seçiliyken boş tıklamalar nokta koyar
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [vTool, setVTool] = useState<VTool>('move');
  const [pending, setPending] = useState<{ x: number; y: number }[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drawing = paletteOpen && vTool !== 'move';

  const iw = processed?.width ?? original?.width ?? 1;
  const ih = processed?.height ?? original?.height ?? 1;
  const gap = 28;

  /* ESC — büyük ekranda yarım kalan çizimi iptal eder */
  useEffect(() => {
    if (!pending.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPending([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending.length]);

  /* yeni görüntüde yarım kalan çizimi bırak */
  useEffect(() => { setPending([]); }, [iw, ih]);

  /* palet açılınca depodaki aktif aracı öner (taşıma modundaysa TAŞI) */
  useEffect(() => {
    if (paletteOpen) setVTool(annotEdit ? 'move' : annotTool);
  }, [paletteOpen, annotEdit, annotTool]);

  /* ---------- resimleri kanvaslara yaz ---------- */
  useEffect(() => {
    const c = procCanvasRef.current;
    if (!c) return;
    // Yalnızca canlı önizleme varsa (henüz taahhüt edilmiş görüntü yokken)
    if (livePreview && !processed) {
      if (c.width !== livePreview.width || c.height !== livePreview.height) {
        c.width = livePreview.width;
        c.height = livePreview.height;
      }
      c.getContext('2d')!.putImageData(livePreview, 0, 0);
      return;
    }
    if (!processed) return;
    if (c.width !== processed.width || c.height !== processed.height) {
      c.width = processed.width;
      c.height = processed.height;
    }
    const ctx = c.getContext('2d')!;
    if (livePreview) {
      // Canlı ince ayar: taahhüt edilmiş boyutlara yumuşak ölçekleme — zoom/pan
      // ve kanvas çözünürlüğü değişmez, iyileştirme kare kare akar.
      const tmp = document.createElement('canvas');
      tmp.width = livePreview.width;
      tmp.height = livePreview.height;
      tmp.getContext('2d')!.putImageData(livePreview, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, c.width, c.height);
    } else {
      ctx.putImageData(processed, 0, 0);
    }
  }, [processed, livePreview]);

  useEffect(() => {
    const c = origCanvasRef.current;
    if (c && original) {
      if (c.width !== original.width || c.height !== original.height) {
        c.width = original.width;
        c.height = original.height;
      }
      c.getContext('2d')!.putImageData(original, 0, 0);
    }
  }, [original]);

  /* ---------- kaplama katmanı ---------- */
  useEffect(() => {
    const c = overlayRef.current;
    if (!c) return;
    if (c.width !== iw || c.height !== ih) {
      c.width = iw;
      c.height = ih;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, iw, ih);
    ctx.lineWidth = Math.max(2, iw / 700);

    if (showAnomalies) {
      for (const a of anomalies) {
        ctx.strokeStyle = 'rgba(239,68,68,0.9)';
        ctx.setLineDash([]);
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        ctx.fillStyle = 'rgba(239,68,68,0.10)';
        ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.fillStyle = 'rgba(239,68,68,0.95)';
        const fs = Math.max(16, iw / 55);
        ctx.font = `bold ${fs}px ui-monospace, monospace`;
        ctx.fillText(`⚠ ${(a.score * 100).toFixed(0)}% ${a.band}`, a.x + 6, a.y - 6 < fs ? a.y + fs + 4 : a.y - 6);
      }
    }

    if (showBoxes) {
      ctx.strokeStyle = 'rgba(240,166,58,0.85)';
      ctx.setLineDash([]);
      for (const b of boxes) {
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        ctx.fillStyle = 'rgba(240,166,58,0.28)';
        ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
    }

    if (region) {
      const rx = region.x * iw, ry = region.y * ih;
      const rw = region.w * iw, rh = region.h * ih;
      ctx.strokeStyle = '#34d399';
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(52,211,153,0.9)';
      const fs = Math.max(14, iw / 60);
      ctx.font = `bold ${fs}px ui-monospace, monospace`;
      ctx.fillText('OCR BÖLGESİ', rx + 6, ry - 8 < fs ? ry + fs + 2 : ry - 8);
    }

    /* ---------- kesme çerçevesi ---------- */
    if (cropMode && cropRect) {
      const { x, y, w, h } = cropRect;
      // çerçeve dışını karart
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, iw, Math.max(0, y));
      ctx.fillRect(0, y + h, iw, Math.max(0, ih - y - h));
      ctx.fillRect(0, y, Math.max(0, x), h);
      ctx.fillRect(x + w, y, Math.max(0, iw - x - w), h);
      // üçler kuralı
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(1, 1 / scale);
      ctx.beginPath();
      for (let i = 1; i <= 2; i++) {
        ctx.moveTo(x + (w * i) / 3, y);
        ctx.lineTo(x + (w * i) / 3, y + h);
        ctx.moveTo(x, y + (h * i) / 3);
        ctx.lineTo(x + w, y + (h * i) / 3);
      }
      ctx.stroke();
      // kenar
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(2, 2 / scale);
      ctx.strokeRect(x, y, w, h);
      // tutamaçlar — ekranda sabit boyut: dokunmatikte parmak boyutu (26px),
      // farede hassas boyut (12px)
      const hs = Math.min(72, Math.max(8, (coarseRef.current ? 26 : 12) / scale));
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = Math.max(1, 1 / scale);
      for (const [hx, hy] of handlePoints(cropRect)) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      // boyut etiketi — çerçeve içinde üst-sol (HUD ile çakışmasın); çerçeve çok
      // alçaksa çerçevenin altına taşır
      const fs = Math.min(48, Math.max(13, 14 / scale));
      ctx.font = `bold ${fs}px ui-monospace, monospace`;
      const label = `${Math.round(w)}×${Math.round(h)} px`;
      const tw = ctx.measureText(label).width + fs * 0.8;
      const ly = h > fs * 2.6 ? y + fs * 1.9 : y + h + fs * 1.9;
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillRect(x + 2, ly - fs, tw, fs * 1.45);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(label, x + 2 + fs * 0.4, ly);
    }

    /* ---------- işaretlemeler (REV 9.9/9.10) — çizilenler + canlı çizim önizlemesi ---------- */
    if (annotations.length || pending.length) {
      try {
        const live = pending.length ? [...pending, hover ?? pending[pending.length - 1]] : undefined;
        drawAnnotations(ctx, annotations, {
          ctx, scale, pxPerMm, livePts: live,
          imgW: iw, imgH: ih, screenBase: 5,
          thickness: annotThickness, handles: annotEdit || drawing,
        });
      } catch (err) {
        // bozuk kayıt büyük ekranı boşaltmasın
        console.error('İşaretleme çizimi hatası', err);
      }
    }
  }, [boxes, showBoxes, anomalies, showAnomalies, region, cropMode, cropRect, scale, iw, ih, annotations, pxPerMm, annotEdit, pending, hover, annotThickness, paletteOpen, vTool]);

  /* ---------- histogram HUD ---------- */
  useEffect(() => {
    const c = histCanvasRef.current;
    if (!c || !hist) return;
    const ctx = c.getContext('2d')!;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,12,10,0.75)';
    ctx.fillRect(0, 0, w, h);
    const max = Math.max(...hist);
    if (max > 0) {
      ctx.fillStyle = 'rgba(240,166,58,0.85)';
      for (let i = 0; i < 256; i++) {
        const bh = Math.min(h, (hist[i] / max) * h);
        if (bh > 0.5) ctx.fillRect((i / 256) * w, h - bh, w / 256 + 0.5, bh);
      }
    }
    ctx.strokeStyle = 'rgba(138,147,138,0.4)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [hist]);

  /* ---------- sığdırma ---------- */
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const contentW = compareMode === 'side' ? iw * 2 + gap : iw;
    const s = Math.min((cw - 24) / contentW, (ch - 24) / ih);
    const ns = Math.max(0.03, s);
    setScale(ns);
    setTx((cw - contentW * ns) / 2);
    setTy((ch - ih * ns) / 2);
  }, [compareMode, iw, ih, gap]);

  // görüntü veya mod değişince sığdır
  useEffect(() => {
    fit();
  }, [fit]);

  // kapsayıcı boyutu değişirse yeniden sığdır (döndürme, yeniden boyutlandırma)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - lastW) > 6 || Math.abs(el.clientHeight - lastH) > 6) {
        lastW = el.clientWidth;
        lastH = el.clientHeight;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setScale((s) => {
      const ns = Math.min(8, Math.max(0.03, s * factor));
      setTx((x) => cx - ((cx - x) / s) * ns);
      setTy((y) => cy - ((cy - y) / s) * ns);
      return ns;
    });
  }, []);

  // wheel zoom (passive olmayan)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /* ---------- fare/dokunma etkileşimleri ---------- */
  const toImage = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    };
  };

  /** İşaretçi yakalama — sentetik/serbest bırakılmış işaretçilerde patlamasın. */
  const capturePointer = (e: React.PointerEvent, target?: Element | null) => {
    try {
      (target ?? containerRef.current)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* işaretçi artık aktif değil — sürükleme yine de aynı hedefe akar */
    }
  };

  /** Palet araç seçimi — taşıma/çizim geçişi ve panelle eşzamanlama. */
  const pickTool = (t: VTool) => {
    setVTool(t);
    setPending([]);
    onSelectMode(false);
    if (t === 'move') onAnnotEdit(true);
    else {
      onAnnotEdit(false);
      setAnnotTool(t); // ARAÇLAR paneli aynı araca geçer
    }
  };

  /** Büyük ekranda çizimi tamamlar — sorular ARAÇLAR panelindekiyle aynı. */
  const commitAnnotation = (pts: { x: number; y: number }[], tool: AnnKind) => {
    let ann: Annotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: tool, pts, color: annotColor,
    };
    if (tool === 'text') {
      const t = window.prompt('İşaretleme metni:', 'BULGU 1');
      if (!t) return;
      ann = { ...ann, text: t.slice(0, 120) };
    }
    if (tool === 'calib') {
      const mm = window.prompt('Bu uzunluğun gerçek değeri kaç mm?', '100');
      const v = Number(mm);
      if (!mm || !v || v <= 0) return;
      ann = { ...ann, mm: +v.toFixed(2) };
      const d = dist(pts[0], pts[1]);
      if (d > 0) {
        setPxPerMm(d / v);
        toast({ title: 'Ölçek kalibre edildi', description: `${d.toFixed(0)} px = ${v} mm → ${(d / v).toFixed(2)} px/mm. Cetvel artık santimetre + milimetre gösterir.` });
      }
    }
    onAnnotationsChange([...annotations, ann]);
    addAudit('İŞARETLEME', `${KIND_LABELS[tool]} büyük ekranda çizildi`);
    setPending([]);
  };

  /** Büyük ekran GERİ AL — yarım noktayı ya da son işaretlemeyi siler. */
  const undoBig = () => {
    if (pending.length) { setPending((p) => p.slice(0, -1)); return; }
    onAnnotationsChange(annotations.slice(0, -1));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // UI kontrolleri (palet, zoom, düğmeler) görüntü altına nokta/pan başlatmasın
    if ((e.target as HTMLElement).closest?.('button, input, [data-ui="1"]')) return;
    // pinch-zoom: ikinci parmak inince sürükleme iptal, pinch tabanı kaydet
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const rect = containerRef.current!.getBoundingClientRect();
      const [a, b] = pts;
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale,
        cx: (a.x + b.x) / 2 - rect.left,
        cy: (a.y + b.y) / 2 - rect.top,
        tx, ty,
      };
      dragState.current.mode = null;
      setPanning(false);
      return;
    }

    const rect = containerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // dokunmatikte parmak ucuna yumuşak tolerans, farede hassas tolerans
    const hitTol = coarseRef.current ? 30 : 16;

    // İŞARETLEME ETKİLEŞİMİ (REV 9.9/9.10) — taşıma modunda veya çizim aracı
    // açıkken varolan işaretlemenin ucuna/gövdesine yakın tık sürüklemeye dönüşür
    // (uç: uzunluk/açı ayarı, gövde: kaydırma); çizim modunda boş alan nokta koyar,
    // taşıma modunda boş alan normal pan olarak sürer
    if (annotEdit || drawing) {
      const p = toImage(e.clientX, e.clientY);
      const hit = hitAnnotation(annotations, p, hitTol / scale);
      if (hit) {
        dragState.current = {
          mode: 'annot', sx: 0, sy: 0, stx: 0, sty: 0, rx0: 0, ry0: 0,
          annot: { annId: hit.ann.id, index: hit.index, kind: hit.ann.kind, origPts: hit.ann.pts, start: p },
        };
        capturePointer(e);
        return;
      }
      if (paletteOpen && vTool !== 'move') {
        // BÜYÜK EKRANDA ÇİZİM (REV 9.10) — noktalar doğrudan belgeye konur
        const tool: AnnKind = vTool;
        const clamped = {
          x: Math.max(0, Math.min(iw, Math.round(p.x))),
          y: Math.max(0, Math.min(ih, Math.round(p.y))),
        };
        const next = [...pending, clamped];
        if (next.length >= requiredPoints(tool)) commitAnnotation(next, tool);
        else setPending(next);
        return;
      }
    }

    if (cropMode) {
      const handle = hitHandle(cropRect, px, py, tx, ty, scale, hitTol);
      const p = toImage(e.clientX, e.clientY);
      dragState.current = {
        mode: 'crop', handle,
        sx: px, sy: py, stx: tx, sty: ty,
        rx0: p.x, ry0: p.y,
        cr: cropRect ? { ...cropRect } : undefined,
      };
      if (handle === 'new') {
        onCropRect({ x: Math.max(0, p.x), y: Math.max(0, p.y), w: 0, h: 0 });
      }
      capturePointer(e);
      return;
    }

    if (selectMode) {
      const p = toImage(e.clientX, e.clientY);
      dragState.current = { mode: 'region', sx: e.clientX, sy: e.clientY, stx: tx, sty: ty, rx0: p.x, ry0: p.y };
      capturePointer(e, e.target as Element);
      return;
    }
    dragState.current = { mode: 'pan', sx: px, sy: py, stx: tx, sty: ty, rx0: 0, ry0: 0 };
    capturePointer(e);
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // işaretçi konumunu güncelle; pinch aktifse zoom'u sür
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch.current && pointers.current.size >= 2) {
      const base = pinch.current;
      const pts = [...pointers.current.values()];
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ns = Math.min(8, Math.max(0.03, base.scale * (d / base.dist)));
      const f = ns / base.scale;
      setTx(base.cx - (base.cx - base.tx) * f);
      setTy(base.cy - (base.cy - base.ty) * f);
      setScale(ns);
      return;
    }
    const ds = dragState.current;
    if (!ds.mode) {
      // çizim önizlemesi — imleç son konulan noktaya canlı çizgi çeker
      if (paletteOpen && vTool !== 'move') setHover(toImage(e.clientX, e.clientY));
      return;
    }
    const rect = containerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (ds.mode === 'pan') {
      setTx(ds.stx + (px - ds.sx));
      setTy(ds.sty + (py - ds.sy));
    } else if (ds.mode === 'region') {
      const p = toImage(e.clientX, e.clientY);
      const x = Math.min(ds.rx0, p.x);
      const y = Math.min(ds.ry0, p.y);
      const w = Math.abs(p.x - ds.rx0);
      const h = Math.abs(p.y - ds.ry0);
      onRegionDone({
        x: Math.max(0, Math.min(1, x / iw)),
        y: Math.max(0, Math.min(1, y / ih)),
        w: Math.min(1, w / iw),
        h: Math.min(1, h / ih),
      });
    } else if (ds.mode === 'divider') {
      const pct = Math.max(0, Math.min(100, ((px - tx) / (iw * scale)) * 100));
      onComparePct(pct);
    } else if (ds.mode === 'annot' && ds.annot) {
      // işaretleme taşıma — uç (uzunluk/açı ayarı) veya tüm kayıt
      const p = toImage(e.clientX, e.clientY);
      const { annId, index, origPts, start } = ds.annot;
      const ann = annotations.find((x) => x.id === annId);
      if (!ann) return;
      let updated: Annotation;
      if (index >= 0) {
        updated = moveAnnotationPoint(ann, index, {
          x: Math.max(0, Math.min(iw, p.x)),
          y: Math.max(0, Math.min(ih, p.y)),
        });
      } else {
        updated = translateAnnotation(ann, p.x - start.x, p.y - start.y);
      }
      onAnnotationsChange(annotations.map((x) => (x.id === annId ? updated : x)));
    } else if (ds.mode === 'crop') {
      const p = toImage(e.clientX, e.clientY);
      const ux = p.x;
      const uy = p.y;
      const MIN = 8; // en küçük kesme alanı (görüntü pikseli)
      if (ds.handle === 'new' || !ds.cr) {
        // boş alanda sürükle → yeni çerçeve
        const x = Math.max(0, Math.min(iw, Math.min(ds.rx0, ux)));
        const y = Math.max(0, Math.min(ih, Math.min(ds.ry0, uy)));
        onCropRect({
          x, y,
          w: Math.min(iw - x, Math.abs(ux - ds.rx0)),
          h: Math.min(ih - y, Math.abs(uy - ds.ry0)),
        });
      } else {
        const b = ds.cr;
        const dx = ux - ds.rx0;
        const dy = uy - ds.ry0;
        const hnd = ds.handle ?? '';
        let nx = b.x, ny = b.y, nw = b.w, nh = b.h;
        if (hnd === 'move') {
          nx = Math.max(0, Math.min(iw - b.w, b.x + dx));
          ny = Math.max(0, Math.min(ih - b.h, b.y + dy));
        } else {
          if (hnd.includes('w')) {
            nx = Math.max(0, Math.min(b.x + b.w - MIN, b.x + dx));
            nw = b.w - (nx - b.x);
          }
          if (hnd.includes('e')) nw = Math.max(MIN, Math.min(iw - b.x, b.w + dx));
          if (hnd.includes('n')) {
            ny = Math.max(0, Math.min(b.y + b.h - MIN, b.y + dy));
            nh = b.h - (ny - b.y);
          }
          if (hnd.includes('s')) nh = Math.max(MIN, Math.min(ih - b.y, b.h + dy));
        }
        onCropRect({ x: nx, y: ny, w: nw, h: nh });
      }
    }
  };

  const onPointerUp = (e?: React.PointerEvent) => {
    pointers.current.delete(e?.pointerId ?? -1);
    if (pointers.current.size < 2) pinch.current = null;
    const ds = dragState.current;
    if (ds.mode === 'region') {
      onSelectMode(false);
    }
    if (ds.mode === 'annot' && ds.annot) {
      // büyük ekrandan taşıma denetim izi — ölçü etiketi sürükleme boyunca canlı aktı
      addAudit('İŞARETLEME DÜZENLE', `${KIND_LABELS[ds.annot.kind]} ${ds.annot.index >= 0 ? 'ucu sürüklenerek' : 'gövdesinden kaydırılarak'} ayarlandı (büyük ekran)`);
    }
    dragState.current.mode = null;
    setPanning(false);
    setHover(null);
  };

  const onDoubleClick = () => {
    if (pending.length || drawing) return; // çizim sırasında iki hızlı tık zoom atlamasın
    if (Math.abs(scale - 1) < 0.05) fit();
    else {
      setScale(1);
      setTx(containerRef.current ? (containerRef.current.clientWidth - iw) / 2 : 0);
      setTy(containerRef.current ? (containerRef.current.clientHeight - ih) / 2 : 0);
    }
  };

  /* ---------- kanvas konumları ---------- */
  const procStyle: React.CSSProperties = { position: 'absolute', left: 0, top: 0 };
  const origStyle: React.CSSProperties = {
    position: 'absolute',
    left: compareMode === 'side' ? -(iw + gap) : 0,
    top: 0,
  };
  if (compareMode === 'split') {
    origStyle.clipPath = `inset(0 ${100 - comparePct}% 0 0)`;
  }
  const showOrig = compareMode !== 'single';

  const dividerX = compareMode === 'split' ? tx + (comparePct / 100) * iw * scale : 0;

  // Palet canlı ölçü okuması — cetvel/açı yarım çizimde cm+mm değerini gösterir
  const liveMeasure = (() => {
    const pts = hover && pending.length ? [...pending, hover] : pending;
    if (vTool === 'ruler' && pts.length === 2) {
      const px = dist(pts[0], pts[1]);
      return pxPerMm ? mmLabel(px / pxPerMm) : `${px.toFixed(0)} px`;
    }
    if (vTool === 'angle' && pts.length === 3) return `${angleDeg(pts)}°`;
    return null;
  })();

  return (
    <div className="relative h-full w-full overflow-hidden bg-black" ref={containerRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp} onDoubleClick={onDoubleClick}
      // touch-action: none — mobil tarayıcı dokunma sürüklemeyi sayfa kaydırması
      // sanıp pointercancel göndermesin (yoksa crop/pan/OCR bölgesi ölüyordu);
      // sayfa kaydırma görüntüleyici dışındaki alanlardan yapılır
      style={{
        cursor: cropMode ? 'crosshair' : selectMode || annotEdit || drawing ? 'crosshair' : panning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      role="application" aria-label="Adli görüntü görüntüleyicisi"
    >
      {/* sahne */}
      <div
        style={{
          position: 'absolute', left: 0, top: 0,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: iw, height: ih,
        }}
      >
        {showOrig && original && (
          <canvas
            ref={origCanvasRef}
            style={{ ...origStyle, imageRendering: scale > 1.6 ? 'pixelated' : 'auto' }}
            aria-label="Orijinal görüntü"
          />
        )}
        {(processed || livePreview) && (
          <canvas
            ref={procCanvasRef}
            style={{ ...procStyle, imageRendering: scale > 1.6 ? 'pixelated' : 'auto' }}
            aria-label="İşlenmiş adli görüntü"
          />
        )}
        <canvas ref={overlayRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
      </div>

      {/* split bölücü */}
      {compareMode === 'split' && (
        <div
          className="absolute top-0 z-20 h-full cursor-ew-resize"
          style={{ left: dividerX, transform: 'translateX(-50%)', width: 28 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragState.current = { mode: 'divider', sx: 0, sy: 0, stx: 0, sty: 0, rx0: 0, ry0: 0 };
          }}
        >
          <div className="mx-auto h-full w-0.5 bg-amber-500/90" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-amber-600 px-1.5 py-1 font-mono text-[10px] font-bold text-black shadow">
            ⇔ {comparePct.toFixed(0)}%
          </div>
        </div>
      )}

      {/* HUD üst — uzun dosya adları mobilde kutudan taşmasın */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] font-mono text-[10px] leading-relaxed text-emerald-400/90">
        <div className="break-words rounded border border-emerald-900/60 bg-black/70 px-2.5 py-1.5 backdrop-blur-sm">
          <div>{hudLeft}</div>
          {hudRight && <div className="text-amber-500/90">{hudRight}</div>}
        </div>
      </div>

      {/* canlı ince ayar rozeti */}
      {livePreview && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md border border-emerald-700 bg-black/80 px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-wider text-emerald-400 backdrop-blur-sm">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          CANLI İNCE AYAR
        </div>
      )}

      {/* histogram HUD — mobilde küçük alanda kalabalık yapmasın */}
      <canvas
        ref={histCanvasRef}
        width={190}
        height={54}
        className="pointer-events-none absolute bottom-3 left-3 z-10 hidden rounded border border-emerald-900/50 sm:block"
        aria-label="Yoğunluk histogramı"
      />

      {/* zoom kontrolleri — kesme modunda gereksiz, gizle (mobilde yığılmayı önler) */}
      {!cropMode && (
        <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-black/75 p-1.5 backdrop-blur-sm">
          <Button size="icon" variant="ghost" className="size-8" onClick={() => { const r = containerRef.current!.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); }} aria-label="Uzaklaş">
            <Minus className="size-4" />
          </Button>
          <span className="min-w-12 text-center font-mono text-xs text-amber-500">{(scale * 100).toFixed(0)}%</span>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => { const r = containerRef.current!.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); }} aria-label="Yakınlaş">
            <Plus className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" onClick={fit} aria-label="Ekrana sığdır">
            <Maximize2 className="size-4" />
          </Button>
        </div>
        {/* BÜYÜK EKRAN İŞARETLEME EDİTÖRÜ (REV 9.10) — cetvel/ok/daire… doğrudan
            büyük ekranda çizilir, uçlardan sürüklenerek düzeltilir; ölçü etiketi
            cm + mm yazar. Panel ile araç/renk/kalınlık ortaktır. */}
        <Button
          size="sm"
          variant={paletteOpen ? 'default' : 'outline'}
          className={`h-9 gap-2 font-mono text-[11px] ${paletteOpen ? 'bg-amber-600 text-black hover:bg-amber-500' : 'bg-black/75 backdrop-blur-sm'}`}
          onClick={() => { setPaletteOpen((v) => !v); setPending([]); }}
        >
          <Plus className="size-4" />
          {paletteOpen ? 'ARAÇLARI KAPAT' : 'EKRANDA İŞARETLE'}
        </Button>
        {paletteOpen && (
          <div data-ui="1" className="w-64 rounded-md border border-amber-700/70 bg-black/90 p-2 shadow-lg backdrop-blur-sm">
            <div className="grid grid-cols-4 gap-1">
              {V_TOOLS.map((t) => (
                <button key={t} type="button" onClick={() => pickTool(t)}
                  className={`h-7 rounded border font-mono text-[9px] font-semibold transition-colors ${
                    vTool === t
                      ? 'border-amber-500 bg-amber-600 text-black'
                      : 'border-border bg-black/60 text-muted-foreground hover:text-foreground'
                  }`}>
                  {t === 'move' ? 'TAŞI' : KIND_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {ANN_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`renk ${c}`} onClick={() => setAnnotColor(c)}
                  className={`size-4 rounded-full border-2 transition-transform ${annotColor === c ? 'scale-110 border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
              <span className="ml-auto flex items-center gap-0.5">
                {ANN_THICKNESS.map((t) => (
                  <button key={t.label} type="button" onClick={() => setAnnotThickness(t.value)}
                    className={`rounded px-1 py-0.5 font-mono text-[8px] font-semibold transition-colors ${
                      annotThickness === t.value
                        ? 'bg-amber-600 text-black'
                        : 'border border-border text-muted-foreground hover:text-foreground'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </span>
            </div>
            {vTool !== 'move' ? (
              <p className="mt-2 font-mono text-[9px] leading-relaxed text-amber-400">
                {vTool === 'calib'
                  ? 'Bilinen uzunluğun iki ucuna tıklayın; mm değeri sorulacak.'
                  : `${pending.length}/${requiredPoints(vTool)} nokta — belge üzerine tıklayın.`}
                {liveMeasure && ` CANLI: ${liveMeasure}`}
              </p>
            ) : (
              <p className="mt-2 font-mono text-[9px] leading-relaxed text-amber-400">
                TAŞI: beyaz tutamaçlardan ucu sürükleyin, gövdeden kaydırın.
              </p>
            )}
            <div className="mt-2 flex items-center gap-1">
              <button type="button" onClick={undoBig} disabled={!pending.length && !annotations.length}
                className="flex h-6 flex-1 items-center justify-center gap-1 rounded border border-border bg-black/60 font-mono text-[9px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40">
                <Undo2 className="size-3" /> GERİ AL
              </button>
              {pending.length > 0 && (
                <button type="button" onClick={() => setPending([])}
                  className="flex h-6 items-center justify-center gap-1 rounded border border-red-900/60 bg-black/60 px-2 font-mono text-[9px] text-red-400 transition-colors hover:text-red-300">
                  <X className="size-3" /> VAZGEÇ
                </button>
              )}
            </div>
          </div>
        )}
        {annotations.length > 0 && (
          <Button
            size="sm"
            variant={annotEdit ? 'default' : 'outline'}
            className={`h-9 gap-2 font-mono text-[11px] ${annotEdit ? 'bg-amber-600 text-black hover:bg-amber-500' : 'bg-black/75 backdrop-blur-sm'}`}
            onClick={() => { setVTool('move'); setPending([]); onAnnotEdit(!annotEdit); }}
          >
            <Move className="size-4" />
            {annotEdit ? 'TAŞIMA MODU AÇIK' : 'İŞARETLEMELERİ DÜZENLE'}
          </Button>
        )}
        {annotEdit && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-700 bg-black/85 px-2.5 py-1.5 font-mono text-[10px] text-amber-400">
            <Move className="size-3.5" /> Beyaz tutamaçları sürükleyerek ayarlayın
          </div>
        )}
        <Button
          size="sm"
          variant={selectMode ? 'default' : 'outline'}
          className={`h-9 gap-2 font-mono text-[11px] ${selectMode ? 'bg-emerald-600 text-black hover:bg-emerald-500' : 'bg-black/75 backdrop-blur-sm'}`}
          onClick={() => onSelectMode(!selectMode)}
        >
          <SquareDashedMousePointer className="size-4" />
          {selectMode ? 'BÖLGE SEÇİLİYOR' : 'OCR BÖLGE SEÇ'}
        </Button>
        {selectMode && (
          <div className="flex items-center gap-1.5 rounded-md border border-emerald-800 bg-black/85 px-2.5 py-1.5 font-mono text-[10px] text-emerald-400">
            <ScanSearch className="size-3.5" /> Görüntü üzerinde sürükleyin
          </div>
        )}
        </div>
      )}
    </div>
  );
}
