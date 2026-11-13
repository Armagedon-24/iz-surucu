'use client';

/**
 * KARŞILAŞTIRMA STÜDYOSU — iki ayrı delil belgesinin/fotoğrafın yan yana
 * incelenmesi. İkinci görüntü yüklenir; FARK haritası (difference blend +
 * kazanç), GÖZ KIRPMA (A/B sıralı), SÜPÜRME (kaydırmalı maske) ve YAN YANA
 * modlarıyla imza/senet/mühür karşılaştırması yapılır. Hizalama için
 * ölçek + x/y kaydırma kontrolleri vardır; fark haritası UYGULA ile ana
 * çalışma alanına inceleme varyantı olarak yazılabilir.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import {
  GitCompareArrows, Upload, LoaderCircle, Eye, MoveHorizontal, Columns2,
  Sigma, RotateCcw,
} from 'lucide-react';
import { resizeImageData } from '@/lib/forensic/filters';
import { dataUrlToImageData } from '@/lib/forensic/canvas';
import { useCaseStore } from '@/lib/forensic/store';

type CmpMode = 'diff' | 'blink' | 'wipe' | 'side';

const MODES: { id: CmpMode; label: string; icon: typeof Sigma }[] = [
  { id: 'diff', label: 'FARK', icon: Sigma },
  { id: 'blink', label: 'GÖZ KIRPMA', icon: Eye },
  { id: 'wipe', label: 'SÜPÜRME', icon: MoveHorizontal },
  { id: 'side', label: 'YAN YANA', icon: Columns2 },
];

/** Görüntüyü hedef boyuta transform ile çizer (hizalama için). */
function drawTransformed(
  target: CanvasRenderingContext2D,
  img: ImageData,
  w: number, h: number,
  scalePct: number, dx: number, dy: number,
): void {
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  const s = scalePct / 100;
  target.setTransform(s, 0, 0, s, dx, dy);
  target.drawImage(tmp, 0, 0, w, h);
  target.setTransform(1, 0, 0, 1, 0, 0);
}

export function ComparePanel({
  original,
  onApply,
}: {
  original: ImageData | null;
  onApply: (out: ImageData, label: string) => void;
}) {
  const { toast } = useToast();
  const addAudit = useCaseStore((s) => s.addAudit);
  const [second, setSecond] = useState<{ img: ImageData; name: string } | null>(null);
  const [mode, setMode] = useState<CmpMode>('diff');
  const [gain, setGain] = useState(3);
  const [scaleB, setScaleB] = useState(100);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [wipePct, setWipePct] = useState(50);
  const [blinkA, setBlinkA] = useState(true);
  const [blinkOn, setBlinkOn] = useState(true);
  const [diffPct, setDiffPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // çalışma kopyaları — panel performansı için 900 px
  const A = useMemo(() => (original ? resizeImageData(original, 900) : null), [original]);
  const B = useMemo(() => (second ? resizeImageData(second.img, 900) : null), [second]);

  /* göz kırpma sayacı */
  useEffect(() => {
    if (mode !== 'blink' || !blinkOn || !B) return;
    const t = setInterval(() => setBlinkA((v) => !v), 850);
    return () => clearInterval(t);
  }, [mode, blinkOn, B]);

  /* ana çizim — mod/parametre değişince */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !A || !B) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let diffMean = 0;

    const drawA = () => {
      const tmp = document.createElement('canvas');
      tmp.width = A.width; tmp.height = A.height;
      tmp.getContext('2d')!.putImageData(A, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    };
    const drawBTransformed = (op: GlobalCompositeOperation = 'source-over') => {
      ctx.globalCompositeOperation = op;
      drawTransformed(ctx, B, A.width, A.height, scaleB, dx, dy);
      ctx.globalCompositeOperation = 'source-over';
    };

    if (mode === 'diff') {
      canvas.width = A.width; canvas.height = A.height;
      drawA();
      drawBTransformed('difference');
      // kazanç: farkı yükselt (karanlık farkları görünür kılar)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) {
        d[i] = Math.min(255, d[i] * gain);
        d[i + 1] = Math.min(255, d[i + 1] * gain);
        d[i + 2] = Math.min(255, d[i + 2] * gain);
        d[i + 3] = 255;
        sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        n++;
      }
      ctx.putImageData(img, 0, 0);
      diffMean = sum / Math.max(1, n) / 255;
    } else if (mode === 'blink') {
      canvas.width = A.width; canvas.height = A.height;
      if (blinkA) drawA(); else drawBTransformed();
    } else if (mode === 'wipe') {
      canvas.width = A.width; canvas.height = A.height;
      drawA();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, (canvas.width * wipePct) / 100, canvas.height);
      ctx.clip();
      drawBTransformed();
      ctx.restore();
      ctx.strokeStyle = 'rgba(244,63,94,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo((canvas.width * wipePct) / 100, 0);
      ctx.lineTo((canvas.width * wipePct) / 100, canvas.height);
      ctx.stroke();
    } else {
      canvas.width = A.width; canvas.height = A.height * 2;
      const tmp = document.createElement('canvas');
      tmp.width = A.width; tmp.height = A.height;
      tmp.getContext('2d')!.putImageData(A, 0, 0);
      ctx.drawImage(tmp, 0, 0);
      drawTransformed(ctx, B, A.width, A.height, scaleB, dx, A.height);
      ctx.font = 'bold 20px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, 96, 30);
      ctx.fillRect(0, A.height, 96, 30);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('A — DELİL 1', 8, 21);
      ctx.fillText('B — DELİL 2', 8, A.height + 21);
    }
    setDiffPct(mode === 'diff' ? diffMean : null);
  }, [A, B, mode, gain, scaleB, dx, dy, wipePct, blinkA]);

  const loadSecond = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Desteklenmeyen dosya', description: 'İkinci delil bir görsel olmalı.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const img = await dataUrlToImageData(url, 1800);
      setSecond({ img, name: file.name });
      setScaleB(100); setDx(0); setDy(0);
      addAudit('KARŞILAŞTIRMA', `ikinci delil yüklendi: ${file.name}`);
      toast({ title: 'İkinci delil yüklendi', description: `${img.width}×${img.height} px — ${file.name}` });
    } catch (e) {
      toast({ title: 'Görüntü okunamadı', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  /** Fark haritasını tam çözünürlükte üretip ana çalışma alanına yazar. */
  const applyDiff = () => {
    if (!original || !second || mode !== 'diff') return;
    setBusy(true);
    setTimeout(() => {
      try {
        const f = original.width / (A?.width ?? original.width);
        const c = document.createElement('canvas');
        c.width = original.width; c.height = original.height;
        const ctx = c.getContext('2d')!;
        const tmpA = document.createElement('canvas');
        tmpA.width = original.width; tmpA.height = original.height;
        tmpA.getContext('2d')!.putImageData(original, 0, 0);
        ctx.drawImage(tmpA, 0, 0);
        ctx.globalCompositeOperation = 'difference';
        drawTransformed(ctx, second.img, original.width, original.height, scaleB, dx * f, dy * f);
        ctx.globalCompositeOperation = 'source-over';
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.min(255, d[i] * gain);
          d[i + 1] = Math.min(255, d[i + 1] * gain);
          d[i + 2] = Math.min(255, d[i + 2] * gain);
          d[i + 3] = 255;
        }
        onApply(new ImageData(d, c.width, c.height), 'Fark Haritası');
        addAudit('FARK HARİTASI', `${second.name} ile fark haritası üretildi (kazanç ${gain}×)`);
        toast({ title: 'Fark haritası uygulandı', description: 'Sonuç inceleme varyantı olarak görüntüleyicide.' });
      } catch (e) {
        toast({ title: 'Fark haritası oluşturulamadı', description: (e as Error).message, variant: 'destructive' });
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const reset = () => { setScaleB(100); setDx(0); setDy(0); setGain(3); setWipePct(50); };

  return (
    <div className="flex flex-col gap-3">
      <Badge variant="outline" className="w-fit gap-1 border-rose-800/60 font-mono text-[9px] text-rose-400">
        <GitCompareArrows className="size-3" /> KARŞILAŞTIRMA STÜDYOSU
      </Badge>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        İki delili karşılaştır: imza, senet, mühür veya fotoğraf. Fark haritası örtüşmeyen
        bölgeleri aydınlatır; göz kırpma gözün farkı anında yakalamasını sağlar.
        Hizalama için ölçek ve kaydırma kontrollerini kullanın.
      </p>

      {/* ikinci delil yükleme */}
      {!second ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) loadSecond(f); }}
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
            drag ? 'border-rose-500 bg-rose-950/20' : 'border-border bg-black/20 hover:border-rose-800'
          }`}
        >
          {busy ? <LoaderCircle className="size-6 animate-spin text-rose-400" /> : <Upload className="size-6 text-rose-400" />}
          <span className="text-[12px] text-muted-foreground">
            İkinci delili <span className="font-semibold text-foreground">buraya sürükleyin</span> veya seçin
          </span>
        </button>
      ) : (
        <div className="flex items-center justify-between rounded-md border border-rose-900/50 bg-black/30 px-2.5 py-2">
          <div className="min-w-0 font-mono text-[10px] text-rose-300">
            <span className="text-muted-foreground">B:</span> {second.name}
          </div>
          <Button size="sm" variant="ghost" className="h-7 font-mono text-[10px] text-muted-foreground"
            onClick={() => { setSecond(null); setDiffPct(null); }}>
            DEĞİŞTİR
          </Button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadSecond(f); e.target.value = ''; }} />

      {second && (
        <>
          {/* mod seçici */}
          <div className="flex flex-wrap items-center gap-1">
            {MODES.map((m) => (
              <Button key={m.id} size="sm" variant={mode === m.id ? 'default' : 'outline'}
                onClick={() => setMode(m.id)}
                className={`h-7 gap-1 font-mono text-[9px] ${mode === m.id ? 'bg-rose-600 text-black hover:bg-rose-500' : 'border-rose-900/60 text-rose-300 hover:bg-rose-950/40'}`}>
                <m.icon className="size-3" /> {m.label}
              </Button>
            ))}
          </div>

          {/* karşılaştırma kanvası */}
          <div className="relative overflow-hidden rounded-md border border-border bg-black/60">
            <canvas ref={canvasRef} className="block h-auto w-full" />
            {mode === 'blink' && (
              <Badge className="absolute left-2 top-2 bg-black/70 font-mono text-[10px] text-amber-400">
                {blinkA ? 'A — DELİL 1' : 'B — DELİL 2'}
              </Badge>
            )}
          </div>

          {mode === 'diff' && diffPct !== null && (
            <p className="font-mono text-[10px] text-muted-foreground">
              Ortalama fark yoğunluğu: <span className="text-rose-400">{(diffPct * 100).toFixed(2)}%</span>
              {' — '}değer düştükçe deliller örtüşüyor demektir.
            </p>
          )}

          {/* ayarlar */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-black/20 p-3">
            {mode === 'diff' && (
              <div className="col-span-2">
                <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                  <span>FARK KAZANCI</span><span className="text-rose-400">{gain}×</span>
                </div>
                <Slider min={1} max={10} step={1} value={[gain]} onValueChange={(v) => setGain(v[0] ?? 1)} className="h-1" />
              </div>
            )}
            {mode === 'wipe' && (
              <div className="col-span-2">
                <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                  <span>SÜPÜRME ÇİZGİSİ</span><span className="text-rose-400">%{wipePct}</span>
                </div>
                <Slider min={0} max={100} step={1} value={[wipePct]} onValueChange={(v) => setWipePct(v[0] ?? 50)} className="h-1" />
              </div>
            )}
            {mode === 'blink' && (
              <Button size="sm" variant={blinkOn ? 'default' : 'outline'} onClick={() => setBlinkOn((v) => !v)}
                className={`col-span-2 h-7 font-mono text-[10px] ${blinkOn ? 'bg-rose-600 text-black' : ''}`}>
                {blinkOn ? 'GÖZ KIRPMA AÇIK' : 'GÖZ KIRPMA DURDU'}
              </Button>
            )}
            <div>
              <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                <span>B ÖLÇEK</span><span className="text-rose-400">%{scaleB}</span>
              </div>
              <Slider min={50} max={200} step={1} value={[scaleB]} onValueChange={(v) => setScaleB(v[0] ?? 100)} className="h-1" />
            </div>
            <div>
              <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                <span>X KAYDIRMA</span><span className="text-rose-400">{dx}</span>
              </div>
              <Slider min={-200} max={200} step={1} value={[dx]} onValueChange={(v) => setDx(v[0] ?? 0)} className="h-1" />
            </div>
            <div>
              <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                <span>Y KAYDIRMA</span><span className="text-rose-400">{dy}</span>
              </div>
              <Slider min={-200} max={200} step={1} value={[dy]} onValueChange={(v) => setDy(v[0] ?? 0)} className="h-1" />
            </div>
            <div className="flex items-end">
              <Button size="sm" variant="outline" onClick={reset} className="h-8 w-full gap-1 font-mono text-[10px]">
                <RotateCcw className="size-3" /> HİZALAMAYI SIFIRLA
              </Button>
            </div>
          </div>

          {mode === 'diff' && (
            <Button onClick={applyDiff} disabled={busy}
              className="h-10 gap-2 bg-rose-700 font-semibold text-white hover:bg-rose-600">
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sigma className="size-4" />}
              FARK HARİTASINI ÇALIŞMA ALANINA UYGULA
            </Button>
          )}
        </>
      )}

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        İpucu: İmza karşılaştırmada önce B ölçek + kaydırma ile A üzerine oturtun,
        sonra FARK moduna geçin. Ortak yapı kararır, farklı çizgiler parlar.
      </p>
    </div>
  );
}
