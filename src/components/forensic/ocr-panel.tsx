'use client';

/**
 * OCR PANELİ — Tesseract.js v7 (LSTM) ile Türkçe+İngilizce metin okuma.
 * İşlenmiş veya orijinal görüntü üzerinde; tüm görüntü veya seçili bölge.
 * Kelime güven skorları ve kutu kaplaması görüntüleyiciye aktarılır.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { ScanText, Copy, Save, LoaderCircle } from 'lucide-react';
import type { Rect } from '@/lib/forensic/filters';
import { cropImageData } from '@/lib/forensic/pipeline';
import { useCaseStore } from '@/lib/forensic/store';
import type { OcrBox } from './viewer';

type PsmKey = 'auto' | 'block' | 'line' | 'sparse';

interface WorkerLike {
  recognize: (
    image: string,
    opts?: Record<string, unknown>,
    output?: Record<string, boolean>
  ) => Promise<{
    data: {
      text: string;
      confidence: number;
      blocks?: Array<{
        paragraphs: Array<{
          lines: Array<{
            words: Array<{
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
          }>;
        }>;
      }> | null;
    };
  }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
}

const PSM_MAP: Record<PsmKey, string> = {
  auto: '3',
  block: '6',
  line: '7',
  sparse: '11',
};

const PSM_LABELS: Record<PsmKey, string> = {
  auto: 'Otomatik sayfa',
  block: 'Tek metin bloğu',
  line: 'Tek satır',
  sparse: 'Seyrek metin',
};

// OCR ön işleme: kontrast artırma, eşikleme, noise reduction
const preprocessForOcr = (imgData: ImageData): ImageData => {
  const { width, height, data } = imgData;
  const out = new ImageData(width, height);
  const outData = out.data;

  // Gri tonlamaya çevir + kontrast + eşikleme (Otsu benzeri)
  let r, g, b, gray;
  for (let i = 0; i < data.length; i += 4) {
    r = data[i];
    g = data[i + 1];
    b = data[i + 2];
    gray = (0.299 * r + 0.587 * g + 0.114 * b) | 0;

    // Kontrast artırma (linear stretch)
    const contrasted = Math.min(255, Math.max(0, 255 - Math.abs(128 - gray)));

    // Basit eşikleme: 128 eşik değerini kullan
    const threshold = contrasted > 128 ? 255 : 0;

    outData[i] = threshold;     // R
    outData[i + 1] = threshold; // G
    outData[i + 2] = threshold; // B
    outData[i + 3] = 255;       // A
  }
  return out;
};

export function OcrPanel({
  processed,
  original,
  region,
  onBoxes,
}: {
  processed: ImageData | null;
  original: ImageData | null;
  region: Rect | null;
  onBoxes: (boxes: OcrBox[] | null) => void;
}) {
  const { toast } = useToast();
  const workerRef = useRef<WorkerLike | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [text, setText] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [source, setSource] = useState<'processed' | 'original'>('processed');
  const [psm, setPsm] = useState<PsmKey>('auto');
  const [showBoxes, setShowBoxes] = useState(true);
  const [applyPreprocess, setApplyPreprocess] = useState(false);
  const lastBoxesRef = useRef<OcrBox[] | null>(null);
  const addOcr = useCaseStore((s) => s.addOcr);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate().catch(() => undefined);
      workerRef.current = null;
    };
  }, []);

  const initWorker = useCallback(async (): Promise<WorkerLike> => {
    if (workerRef.current) return workerRef.current;
    setProgressLabel('OCR motoru yükleniyor (tur+eng)…');
    const mod = await import('tesseract.js');
    const w = await mod.createWorker(['tur', 'eng'], 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          setProgress(Math.round(m.progress * 100));
          setProgressLabel('Metin tanınıyor…');
        } else if (m.status) {
          setProgressLabel(
            m.status.includes('loading') ? 'Dil verisi indiriliyor…' :
            m.status.includes('initializ') ? 'Motor başlatılıyor…' : 'Hazırlanıyor…'
          );
        }
      },
    });
    workerRef.current = w as unknown as WorkerLike;
    return workerRef.current;
  }, []);

  const runOcr = async (regionOnly: boolean) => {
    const img = source === 'processed' ? processed : original;
    if (!img) return;
    if (regionOnly && !region) return;
    setLoading(true);
    setProgress(0);
    setText('');
    setShowBoxes(true);
    try {
      const worker = await initWorker();
      await worker.setParameters({ tessedit_pageseg_mode: PSM_MAP[psm] });

      let target = img;
      let offsetX = 0;
      let offsetY = 0;
      if (regionOnly && region) {
        offsetX = Math.floor(region.x * img.width);
        offsetY = Math.floor(region.y * img.height);
        target = cropImageData(img, {
          x: offsetX,
          y: offsetY,
          w: region.w * img.width,
          h: region.h * img.height,
        });
      }

      // OCR ön işleme: kontrast artırma + eşikleme (kalite artışı)
      if (applyPreprocess) {
        target = preprocessForOcr(target);
      }

      // ImageData → dataURL
      const c = document.createElement('canvas');
      c.width = target.width;
      c.height = target.height;
      c.getContext('2d')!.putImageData(target, 0, 0);
      const dataUrl = c.toDataURL('image/png');

      const res = await worker.recognize(dataUrl, {}, { text: true, blocks: true });
      const d = res.data;
      setText((d.text ?? '').trim());
      setConfidence(d.confidence ?? 0);

      const boxes: OcrBox[] = [];
      let words = 0;
      for (const block of d.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const word of line.words) {
              if (!word.text?.trim()) continue;
              words++;
              boxes.push({
                x0: word.bbox.x0 + offsetX,
                y0: word.bbox.y0 + offsetY,
                x1: word.bbox.x1 + offsetX,
                y1: word.bbox.y1 + offsetY,
                text: word.text,
                conf: word.confidence,
              });
            }
          }
        }
      }
      setWordCount(words);
      lastBoxesRef.current = boxes;
      onBoxes(boxes.length ? boxes : null);

      addOcr({
        id: `${Date.now()}`,
        ts: Date.now(),
        text: (d.text ?? '').trim(),
        confidence: d.confidence ?? 0,
        source: `${source === 'processed' ? 'işlenmiş' : 'orijinal'}${regionOnly ? ' + bölge' : ' / tam'}`,
        wordCount: words,
      });
      toast({ title: 'OCR tamamlandı', description: `${words} kelime · güven %${(d.confidence ?? 0).toFixed(1)}` });
    } catch (e) {
      toast({
        title: 'OCR hatası',
        description: (e as Error).message ?? 'Bilinmeyen hata',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setProgressLabel('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-2">
        <div>
          <Label className="mb-1 block text-xs text-foreground/85">Kaynak görüntü</Label>
          <Select value={source} onValueChange={(v) => setSource(v as 'processed' | 'original')}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="processed">İşlenmiş görünüm</SelectItem>
              <SelectItem value="original">Orijinal fotoğraf</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs text-foreground/85">Sayfa segmentasyonu</Label>
          <Select value={psm} onValueChange={(v) => setPsm(v as PsmKey)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PSM_LABELS) as PsmKey[]).map((k) => (
                <SelectItem key={k} value={k}>{PSM_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-2">
          <Switch
            id="ocr-preprocess"
            checked={applyPreprocess}
            onCheckedChange={(v) => setApplyPreprocess(v)}
          />
          <Label htmlFor="ocr-preprocess" className="text-xs text-muted-foreground">
            Ön işleme
          </Label>
        </div>
      </section>

      <div className="rounded-md border border-border bg-card/60 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">İpucu:</span> Okuma doğruluğu için önce
        <span className="mx-1 font-mono text-amber-500">OCR Hazırlık</span> reçetesini (Sauvola
        eşikleme) uygulayın, gerekiyorsa 90° döndürün veya kontrastı artırın, sonra okutun.
        Görüntüleyicideki <span className="text-emerald-400">OCR BÖLGE SEÇ</span> düğmesiyle alan
        işaretleyip yalnızca o bölgeyi okutabilirsiniz.
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => runOcr(false)} disabled={loading || !processed}
          className="h-10 flex-1 gap-2 bg-amber-600 font-semibold text-black hover:bg-amber-500">
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ScanText className="size-4" />}
          TÜM GÖRÜNTÜYÜ OKU
        </Button>
        <Button onClick={() => runOcr(true)} disabled={loading || !region} variant="outline"
          className="h-10 flex-1 gap-2 font-mono text-xs">
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ScanText className="size-4" />}
          BÖLGEYİ OKU
        </Button>
      </div>

      {loading && (
        <div className="rounded-md border border-border bg-card/60 p-3">
          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-amber-500">
            <span>{progressLabel || 'İşleniyor…'}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      {text && !loading && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] tracking-widest text-emerald-500">
              OKUNAN METİN — {wordCount} kelime
            </span>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className={confidence > 80 ? 'text-emerald-500' : confidence > 60 ? 'text-amber-500' : 'text-red-400'}>
                GÜVEN %{confidence.toFixed(1)}
              </span>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            className="w-full resize-y rounded-md border border-border bg-black/50 p-3 font-mono text-[13px] leading-relaxed text-foreground outline-none focus:border-amber-600"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="show-boxes" checked={showBoxes}
                onCheckedChange={(v) => {
                  setShowBoxes(v);
                  onBoxes(v && lastBoxesRef.current?.length ? lastBoxesRef.current : null);
                }} />
              <Label htmlFor="show-boxes" className="text-xs text-muted-foreground">Kelime kutuları</Label>
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
              onClick={() => {
                navigator.clipboard?.writeText(text).then(
                  () => toast({ title: 'Metin kopyalandı' }),
                  () => toast({ title: 'Kopyalama başarısız', variant: 'destructive' })
                );
              }}>
              <Copy className="size-3.5" /> Kopyala
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
