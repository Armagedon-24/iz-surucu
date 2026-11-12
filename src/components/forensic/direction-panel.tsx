'use client';

/**
 * YÖN TARAMASI PANELİ — çizgilerin uzandığı yönleri (0–175°, 5° adım) tarar,
 * kutup diyagramıyla skorları gösterir. Seçilen yönde çizgi yapıları vurgulu
 * görüntüleyicide canlı önizlenir; tek tıkla eğik ışık o yöne çevrilebilir.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Compass, LoaderCircle, Lightbulb, ScanLine } from 'lucide-react';
import { renderDirectional, scanDirections, type DirScanResult } from '@/lib/forensic/direction';

interface DirectionPanelProps {
  original: ImageData | null;
  onLivePreview: (img: ImageData | null) => void;
  onApplyLighting: (strokeAngle: number) => void;
}

/** Kutup diyagramı — 36 yön çubuğu, en iyi ve seçili yön vurgulu. */
function RoseDiagram({ result, selected }: { result: DirScanResult; selected: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = 240;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const R = 92;
    const max = Math.max(...result.scores.map((s) => s.score)) || 1;

    ctx.clearRect(0, 0, size, size);

    // eş merkezli halkalar + eksenler
    ctx.strokeStyle = 'rgba(138,147,138,0.35)';
    ctx.setLineDash([3, 4]);
    for (const r of [R / 2, R]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.setLineDash([]);

    // açı etiketleri
    ctx.fillStyle = 'rgba(138,147,138,0.8)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('0°', cx + R + 3, cy + 3);
    ctx.fillText('90°', cx - 9, cy - R - 4);
    ctx.fillText('180°', cx - R - 26, cy + 3);
    ctx.fillText('135°', cx - R - 22, cy - R + 2);
    ctx.fillText('45°', cx + R - 14, cy - R + 2);

    // yön çubukları
    for (const s of result.scores) {
      const isBest = s.angle === result.best;
      const isSelected = s.angle === selected;
      const rad = (s.angle * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = -Math.sin(rad); // ekran y aşağı — ters çevir
      const len = 14 + (R - 20) * (s.score / max);
      ctx.beginPath();
      ctx.lineWidth = isSelected || isBest ? 7 : 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = isSelected
        ? '#ffffff'
        : isBest
          ? '#34d399'
          : 'rgba(240,166,58,0.72)';
      ctx.moveTo(cx + dx * 12, cy + dy * 12);
      ctx.lineTo(cx + dx * len, cy + dy * len);
      ctx.stroke();
    }

    // merkez nokta
    ctx.fillStyle = 'rgba(240,166,58,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }, [result, selected]);

  return <canvas ref={ref} className="mx-auto h-[240px] w-[240px]" aria-label="Yön taraması kutup diyagramı" />;
}

export function DirectionPanel({ original, onLivePreview, onApplyLighting }: DirectionPanelProps) {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<DirScanResult | null>(null);
  const [angle, setAngle] = useState<number>(0);
  const [previewOn, setPreviewOn] = useState(false);

  const scan = useCallback(() => {
    if (!original || scanning) return;
    setScanning(true);
    setTimeout(() => {
      try {
        const r = scanDirections(original);
        setResult(r);
        setAngle(r.best);
        setPreviewOn(true);
        toast({
          title: `En belirgin çizgi yönü: ${r.best}°`,
          description: 'Vurgu görüntüleyicide açık — kutup diyagramından yön seçip inceleyin.',
        });
      } finally {
        setScanning(false);
      }
    }, 30);
  }, [original, scanning, toast]);

  // seçilen yön değişince canlı vurgu önizlemesi
  useEffect(() => {
    if (!previewOn || !original || !result) return;
    const t = setTimeout(() => onLivePreview(renderDirectional(original, angle)), 90);
    return () => clearTimeout(t);
  }, [previewOn, angle, original, result, onLivePreview]);

  // panel kapanınca canlı katmanı geri çek
  useEffect(() => () => onLivePreview(null), [onLivePreview]);

  const togglePreview = (on: boolean) => {
    setPreviewOn(on);
    if (!on) onLivePreview(null);
  };

  const applyLighting = () => {
    if (!original) return;
    onLivePreview(null);
    setPreviewOn(false);
    onApplyLighting(angle);
    toast({
      title: `Eğik ışık ${angle}° çizgi yönüne dik ayarlandı`,
      description: 'İŞLEM sekmesindeki “Işık açısı” ve “Gölgelendirme gücü” ile ince kalibrasyon yapın.',
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-sky-900/50 bg-sky-950/15 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Çizgi yönü taraması:</span> girinti, karalama,
        çizik ve mürekkep akışı gibi çizgi yapılarının uzandığı yönleri 0–175° aralığında otomatik
        tarar; en belirgin yöni bulur. Seçilen yöndeki yapılar görüntüleyicide vurgulanır — üst üste
        binen yazı ve silme izlerinin yönü bu taramayla ayrıştırılır.
      </div>

      <Button onClick={scan} disabled={scanning || !original}
        className="h-11 gap-2 bg-amber-600 font-semibold text-black hover:bg-amber-500">
        {scanning ? <LoaderCircle className="size-4 animate-spin" /> : <Compass className="size-5" />}
        {scanning ? 'YÖNLER TARANIYOR…' : 'YÖN TARAMASINI ÇALIŞTIR'}
      </Button>

      {result && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              YÖN SKORLARI — KUTUP DİYAGRAMI
            </span>
            <Badge variant="outline" className="gap-1 border-emerald-800/60 font-mono text-[9px] text-emerald-400">
              <Compass className="size-3" /> EN BELİRGİN: {result.best}°
            </Badge>
          </div>

          <div className="rounded-md border border-border bg-black/40 py-2">
            <RoseDiagram result={result} selected={angle} />
            <div className="flex items-center justify-center gap-1.5 px-2 pb-1">
              {result.top.map((a, i) => (
                <button key={a}
                  onClick={() => setAngle(a)}
                  className={`rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
                    angle === a
                      ? 'border-white bg-white/10 text-white'
                      : 'border-border bg-card/50 text-muted-foreground hover:border-amber-700 hover:text-amber-400'
                  }`}>
                  {i + 1}. {a}°
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs text-foreground/85">Yön açısı</Label>
              <span className="font-mono text-[11px] text-amber-500">{angle}°</span>
            </div>
            <Slider min={0} max={175} step={1} value={[angle]}
              onValueChange={(v) => setAngle(v[0])} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-card/50 px-3 py-2">
            <div>
              <Label className="text-xs text-foreground/85">Görüntüleyicide vurgula</Label>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Seçilen yöndeki çizgiler koyu, zemin açık gösterilir.
              </p>
            </div>
            <Switch checked={previewOn} onCheckedChange={togglePreview} />
          </div>

          <Button onClick={applyLighting} variant="outline" disabled={!original}
            className="h-10 gap-2">
            <Lightbulb className="size-4 text-amber-500" />
            EĞİK IŞIĞI BU YÖNE AYARLA
          </Button>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <ScanLine className="mr-1 inline size-3 text-sky-500" />
            Skor, çizgiye dik gradyan enerjisidir: çubuğu uzayan yön = o yönde yoğun ve sürekli
            çizgi yapısı. Girintiler için “Eğik ışığı ayarla” ile ışığı çizgilere dik çevirip
            İŞLEM sekmesinden gücü artırın.
          </p>
        </section>
      )}

      {!original && (
        <p className="text-[12px] text-muted-foreground">Önce bir belge görüntüsü yükleyin.</p>
      )}
    </div>
  );
}
