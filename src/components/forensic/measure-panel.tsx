'use client';

/**
 * ÖLÇÜM VE İŞARETLEME PANELİ — adli raporların klasik araçları:
 * cetvel (uzunluk), açı, ok, daire, dikdörtgen ve metin işaretleme.
 * Cetvel cetvel kalibrasyonu ile piksel→mm dönüşümü yapar (belge üzerindeki
 * bilinen bir uzunluğa 2 nokta + mm değeri). İşaretlemeler depoda saklanır;
 * anotasyonlu PNG indirilir veya rapora anlık görüntü olarak eklenir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Ruler, Undo2, Trash2, Download, Camera, CheckCircle2, Crosshair, MousePointerClick, X,
} from 'lucide-react';
import {
  ANN_COLORS, KIND_LABELS, requiredPoints, dist, drawAnnotations,
  annotationsSummary, measureLabel, angleDeg,
  type Annotation, type AnnKind,
} from '@/lib/forensic/annotate';
import { useCaseStore } from '@/lib/forensic/store';

const TOOLS: AnnKind[] = ['ruler', 'angle', 'arrow', 'circle', 'rect', 'text', 'calib'];

export function MeasurePanel({ image }: { image: ImageData | null }) {
  const { toast } = useToast();
  const addAudit = useCaseStore((s) => s.addAudit);
  const annotations = useCaseStore((s) => s.annotations);
  const setAnnotations = useCaseStore((s) => s.setAnnotations);
  const addSnapshot = useCaseStore((s) => s.addSnapshot);

  const [tool, setTool] = useState<AnnKind>('ruler');
  const [color, setColor] = useState(ANN_COLORS[0]);
  const [pending, setPending] = useState<{ x: number; y: number }[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [pxPerMm, setPxPerMm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wrapW, setWrapW] = useState(0);

  /* genişlik ölçümü — kanvası konteynere sığdır */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!image || !wrapW) return 1;
    return Math.min(1, wrapW / image.width);
  }, [image, wrapW]);

  /** Tam çözünürlükte anotasyonlu kanvas üretir (indirme/rapor için). */
  const renderFull = useCallback((): HTMLCanvasElement | null => {
    if (!image) return null;
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d')!;
    const tmp = document.createElement('canvas');
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext('2d')!.putImageData(image, 0, 0);
    ctx.drawImage(tmp, 0, 0);
    drawAnnotations(ctx, annotations, { ctx, scale: 1, pxPerMm });
    return c;
  }, [image, annotations, pxPerMm]);

  /* ana çizim — görüntü + anotasyonlar + canlı seçim */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !wrapW) return;
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d')!;
    const tmp = document.createElement('canvas');
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext('2d')!.putImageData(image, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    const live = pending.length ? [...pending, hover ?? pending[pending.length - 1]] : undefined;
    try {
      drawAnnotations(ctx, annotations, { ctx, scale, pxPerMm, livePts: live });
    } catch (err) {
      // tek bir bozuk kayıt paneli boşaltmasın — kanvas görüntüsü yerinde kalır
      console.error('Anotasyon çizimi hatası', err);
    }
  }, [image, annotations, pending, hover, scale, pxPerMm, wrapW]);

  const toImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * image!.width;
    const y = ((e.clientY - r.top) / r.height) * image!.height;
    return { x: Math.round(x), y: Math.round(y) };
  };

  const commit = (pts: { x: number; y: number }[]) => {
    let ann: Annotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: tool, pts, color,
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
        toast({ title: 'Ölçek kalibre edildi', description: `${d.toFixed(0)} px = ${v} mm → ${(d / v).toFixed(2)} px/mm. Cetvel artık mm gösterir.` });
      }
    }
    setAnnotations([...annotations, ann]);
    setPending([]);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
    const p = toImageCoords(e);
    const need = requiredPoints(tool);
    const next = [...pending, p];
    if (next.length >= need) commit(next);
    else setPending(next);
  };

  const undo = () => {
    if (pending.length) { setPending((p) => p.slice(0, -1)); return; }
    setAnnotations(annotations.slice(0, -1));
  };

  const clearAll = () => { setPending([]); setAnnotations([]); };

  const download = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        const c = renderFull();
        if (!c) return;
        c.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `ISARETLEME_${Date.now()}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }, 'image/png');
        addAudit('İŞARETLEME İNDİR', annotationsSummary(annotations, pxPerMm));
        toast({ title: 'Anotasyonlu PNG indirildi' });
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const toReport = () => {
    if (!annotations.length) {
      toast({ title: 'Önce işaretleme ekleyin', description: 'Cetvel, ok veya daire ile en az bir işaretleme yapın.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const c = renderFull();
        if (!c) return;
        // küçük kapak için ayrı render
        const thumbC = document.createElement('canvas');
        const k = Math.min(1, 640 / Math.max(c.width, c.height));
        thumbC.width = Math.round(c.width * k);
        thumbC.height = Math.round(c.height * k);
        thumbC.getContext('2d')!.drawImage(c, 0, 0, thumbC.width, thumbC.height);
        addSnapshot({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          label: 'Ölçüm · İşaretleme',
          thumb: thumbC.toDataURL('image/jpeg', 0.8),
          modeName: 'Araçlar · Ölçüm/işaretleme',
          modeNm: '—',
          paramsSummary: annotationsSummary(annotations, pxPerMm).slice(0, 120),
        });
        addAudit('RAPORA İŞARETLEME', annotationsSummary(annotations, pxPerMm));
        toast({ title: 'Rapora anlık görüntü eklendi', description: 'RAPOR sekmesinden resmî PDF’e gömülür.' });
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const need = requiredPoints(tool);
  const toolHint =
    tool === 'calib'
      ? 'Belge üzerinde bilinen bir uzunluğun iki ucuna tıklayın; mm değeri sorulacak.'
      : tool === 'ruler'
        ? 'Uzunluğu ölçülecek iki noktaya tıklayın.'
        : tool === 'angle'
          ? 'Açının üç noktasına tıklayın (orta nokta tepe).'
          : tool === 'text'
            ? 'Metnin konumuna tıklayın; metin sorulacak.'
            : `${need} noktaya tıklayın.`;

  const liveMeasure = (() => {
    const pts = hover && pending.length ? [...pending, hover] : pending;
    if (tool === 'ruler' && pts.length === 2) {
      const px = dist(pts[0], pts[1]);
      return pxPerMm ? `${(px / pxPerMm).toFixed(1)} mm` : `${px.toFixed(0)} px`;
    }
    if (tool === 'angle' && pts.length === 3) return `${angleDeg(pts)}°`;
    return null;
  })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="gap-1 border-indigo-800/60 font-mono text-[9px] text-indigo-300">
          <Ruler className="size-3" /> ÖLÇÜM & İŞARETLEME
        </Badge>
        {pxPerMm ? (
          <Badge variant="outline" className="gap-1 border-emerald-700/60 font-mono text-[9px] text-emerald-400">
            <CheckCircle2 className="size-3" /> {pxPerMm.toFixed(2)} px/mm
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-border font-mono text-[9px] text-muted-foreground">
            ölçek: piksel
          </Badge>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Bulguyu belge üzerine işaretleyin ve ölçün. Cetvel kalibrasyonu ile ölçümler milimetre
        cinsinden rapora işlenir. İşaretlemeler sekme değişiminde korunur.
      </p>

      {/* araç seçimi */}
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map((t) => (
          <Button key={t} size="sm" variant={tool === t ? 'default' : 'outline'}
            onClick={() => { setTool(t); setPending([]); }}
            className={`h-7 font-mono text-[9px] ${tool === t ? 'bg-indigo-500 text-black hover:bg-indigo-400' : 'border-indigo-900/60 text-indigo-200 hover:bg-indigo-950/40'}`}>
            {KIND_LABELS[t]}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] tracking-wider text-muted-foreground">RENK:</span>
        {ANN_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`renk ${c}`}
            onClick={() => setColor(c)}
            className={`size-5 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
        {liveMeasure && (
          <span className="ml-auto font-mono text-[10px] text-indigo-300">CANLI: {liveMeasure}</span>
        )}
      </div>

      {/* kanvas — işaretleme yüzeyi (yükseklik sınırlı: kontroller ilk ekranda kalır) */}
      <div ref={wrapRef} className="grid place-items-center overflow-hidden rounded-md border border-border bg-black/60 p-1">
        {image ? (
          <canvas
            ref={canvasRef}
            className="mx-auto block h-auto w-auto max-h-[340px] max-w-full cursor-crosshair touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={(e) => setHover(toImageCoords(e))}
            onPointerLeave={() => setHover(null)}
          />
        ) : (
          <p className="px-3 py-10 text-center text-[12px] text-muted-foreground">
            Önce bir görüntü yükleyin.
          </p>
        )}
      </div>

      <p className="flex items-start gap-1.5 font-mono text-[9px] leading-relaxed text-muted-foreground/80">
        <MousePointerClick className="mt-0.5 size-3 shrink-0" />
        {toolHint}
        {pending.length > 0 && ` (${pending.length}/${need} nokta)`}
      </p>

      {/* eylemler */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={undo} disabled={!annotations.length && !pending.length}
          className="h-9 gap-1.5 text-[11px]">
          <Undo2 className="size-3.5" /> GERİ AL
        </Button>
        <Button variant="outline" onClick={clearAll} disabled={!annotations.length}
          className="h-9 gap-1.5 text-[11px] text-red-400 hover:text-red-300">
          <Trash2 className="size-3.5" /> TEMİZLE
        </Button>
        <Button variant="outline" onClick={download} disabled={!image || busy}
          className="h-9 gap-1.5 text-[11px]">
          <Download className="size-3.5" /> PNG İNDİR
        </Button>
        <Button onClick={toReport} disabled={!image || busy}
          className="h-9 gap-1.5 bg-indigo-600 text-[11px] font-semibold text-black hover:bg-indigo-500">
          <Camera className="size-3.5" /> RAPORA EKLE
        </Button>
      </div>

      {/* ölçüm kayıtları — her işaretleme bir satır, tek tek silinebilir */}
      <div className="rounded-md border border-border bg-card/50">
        <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5">
          <span className="font-mono text-[9px] font-bold tracking-widest text-indigo-300">
            ÖLÇÜM KAYITLARI ({annotations.length})
          </span>
          {pxPerMm && (
            <span className="font-mono text-[9px] text-emerald-400">{pxPerMm.toFixed(2)} px/mm</span>
          )}
        </div>
        {annotations.length ? (
          <ul className="max-h-28 divide-y divide-border/40 overflow-y-auto">
            {annotations.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="font-mono text-[10px] text-muted-foreground">{KIND_LABELS[a.kind]}</span>
                <span className="ml-auto truncate font-mono text-[10px] text-foreground">
                  {measureLabel(a, pxPerMm) ?? a.text ?? 'işaret'}
                </span>
                <button
                  type="button"
                  aria-label="kaydı sil"
                  onClick={() => setAnnotations(annotations.filter((x) => x.id !== a.id))}
                  className="shrink-0 text-muted-foreground/60 transition-colors hover:text-red-400"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2.5 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground/80">
            Henüz işaretleme yok — yukarıdan bir araç seçin ve belge üzerine tıklayın.
          </p>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        <Crosshair className="mr-1 inline size-3" />
        Kalibrasyon ipucu: A4 belgenin kısa kenarı 210 mm’dir — kenar boyunca iki nokta koyup
        210 mm girin; tüm cetvel ölçümleri milimetreye döner.
      </p>
    </div>
  );
}
