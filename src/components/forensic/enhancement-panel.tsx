'use client';

/**
 * İYİLEŞTİRME STÜDYOSU (Photo Enhancement Studio)
 * Fotoğraf/resim estetiği için tahribatsız sekme:
 *  - Kaydırıcılar: pozlama, kontrast, gölge açma, ışık kısma, doygunluk,
 *    sıcaklık, keskinlik, netlik, gürültü azaltma.
 *  - OTOMATİK İYİLEŞTİR: histogram + gri dünya beyaz dengesinden dengeli
 *    başlangıç reçetesi üretir.
 *  - Ön ayarlar: BELGE / PORTRE / MANZARA / LOŞ IŞık tek dokunuş.
 *  - Canlı önizleme sürüklenirken büyük görüntüleyiciye akıtılır;
 *    UYGULA ile tam çözünürlükte ana görüntüye yazılır.
 * Tamamen tarayıcı içinde çalışır — AI anahtarı gerekmez.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, LoaderCircle, RotateCcw, MousePointerClick } from 'lucide-react';
import { resizeImageData } from '@/lib/forensic/filters';
import {
  applyEnhancement, autoEnhance, isDefaultEnhance,
  DEFAULT_ENHANCE, ENHANCE_PRESETS,
  type EnhanceParams,
} from '@/lib/forensic/enhance';

/** İnce ayar kaydırıcısı — etiket + canlı değer. Video stüdyosu da paylaşır. */
export function EnhSlider({
  label, value, min, max, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className={value !== 0 ? 'text-sky-400' : 'text-muted-foreground/60'}>
          {value > 0 ? `+${value}` : `${value}`}
        </span>
      </div>
      <Slider
        min={min} max={max} step={1}
        value={[value]}
        onValueChange={(vals) => onChange(vals[0] ?? min)}
        className="h-1"
      />
    </div>
  );
}

export function presetBtnCls(on: boolean): string {
  return `rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-wider transition-colors ${
    on
      ? 'border-sky-500 bg-sky-600 font-semibold text-black'
      : 'border-border bg-black/40 text-muted-foreground hover:border-sky-800 hover:text-foreground'
  }`;
}

export function EnhancementPanel({
  original,
  onApply,
  onLivePreview,
}: {
  original: ImageData | null;
  onApply: (out: ImageData, label: string) => void;
  /** Canlı önizleme — büyük görüntüleyiciye akıtılır; null = geri çek. */
  onLivePreview?: (img: ImageData | null) => void;
}) {
  const { toast } = useToast();
  const [params, setParams] = useState<EnhanceParams>(DEFAULT_ENHANCE);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Hızlı önizleme kopyası — sürükleme akıcılığı için ölçeklenmiş kaynak
  const fastSrc = useMemo(
    () => (original ? resizeImageData(original, 1000) : null),
    [original]
  );

  const liveCbRef = useRef(onLivePreview);
  liveCbRef.current = onLivePreview;

  /* Kaydırıcı değişince canlı önizleme — rAF ile birleştirilir */
  useEffect(() => {
    if (!fastSrc || isDefaultEnhance(params)) {
      setPreviewing(false);
      liveCbRef.current?.(null);
      return;
    }
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        const img = applyEnhancement(fastSrc, params);
        setPreviewing(true);
        liveCbRef.current?.(img);
      } catch {
        /* önizleme hatası yoksayılır */
      }
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [fastSrc, params]);

  /* Panel kapanınca (sekme değişimi) canlı katmanı geri çek */
  useEffect(() => () => { liveCbRef.current?.(null); }, []);

  const set = (k: keyof EnhanceParams) => (v: number) => {
    setActivePreset(null);
    setParams((s) => ({ ...s, [k]: v }));
  };

  const runAuto = () => {
    if (!fastSrc) return;
    const p = autoEnhance(fastSrc);
    setParams(p);
    setActivePreset(null);
    toast({
      title: 'Otomatik iyileştirme hesaplandı',
      description: 'Histogram ve beyaz dengesi analiz edildi. Kaydırıcılarla ince ayar yapabilirsiniz.',
    });
  };

  const applyPreset = (id: string, p: EnhanceParams) => {
    setParams({ ...p });
    setActivePreset(id);
  };

  const reset = () => {
    setParams(DEFAULT_ENHANCE);
    setActivePreset(null);
    setPreviewing(false);
    liveCbRef.current?.(null);
  };

  const apply = () => {
    if (!original || busy || isDefaultEnhance(params)) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const out = applyEnhancement(original, params);
        onApply(out, 'İyileştirme');
        liveCbRef.current?.(null); // uygulandı — tam çözünürlük görünsün
        toast({
          title: 'İyileştirme ana görüntüye uygulandı',
          description: 'Araç çubuğundaki ↓ tuşuyla PNG olarak indirebilirsiniz.',
        });
      } catch (e) {
        toast({ title: 'Uygulama hatası', description: (e as Error).message, variant: 'destructive' });
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const touched = !isDefaultEnhance(params);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="gap-1 border-sky-800/60 font-mono text-[9px] text-sky-400">
          <Sparkles className="size-3" /> İYİLEŞTİRME STÜDYOSU
        </Badge>
        {previewing && (
          <Badge variant="outline" className="gap-1 border-amber-700/60 font-mono text-[9px] text-amber-400">
            <MousePointerClick className="size-3" /> CANLI ÖNİZLEME
          </Badge>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Fotoğrafı tek tuşla otomatik düzelt veya kaydırıcılarla elle kalibre et.
        Değişiklikler görüntüleyicide anlık görünür; <span className="text-foreground">Uygula</span> ile
        kalıcı olur. Tamamen tarayıcı içinde çalışır — anahtar gerekmez.
      </p>

      {/* otomatik + ön ayarlar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={runAuto} disabled={!fastSrc}
          className="h-8 gap-1.5 bg-sky-600 font-semibold text-black hover:bg-sky-500">
          <Sparkles className="size-3.5" /> OTOMATİK İYİLEŞTİR
        </Button>
        {ENHANCE_PRESETS.map((pr) => (
          <button key={pr.id} type="button"
            className={presetBtnCls(activePreset === pr.id)}
            onClick={() => applyPreset(pr.id, pr.p)}>
            {pr.label}
          </button>
        ))}
      </div>

      {/* ton grubu */}
      <div className="rounded-md border border-border bg-black/20 p-3">
        <div className="mb-2 font-mono text-[9px] tracking-[0.2em] text-muted-foreground/70">TON</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <EnhSlider label="POZLAMA" value={params.exposure} min={-100} max={100} onChange={set('exposure')} />
          <EnhSlider label="KONTRAST" value={params.contrast} min={-100} max={100} onChange={set('contrast')} />
          <EnhSlider label="GÖLGE AÇMA" value={params.shadows} min={0} max={100} onChange={set('shadows')} />
          <EnhSlider label="IŞIK KISMA" value={params.highlights} min={0} max={100} onChange={set('highlights')} />
        </div>
      </div>

      {/* renk grubu */}
      <div className="rounded-md border border-border bg-black/20 p-3">
        <div className="mb-2 font-mono text-[9px] tracking-[0.2em] text-muted-foreground/70">RENK</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <EnhSlider label="DOYGUNLUK" value={params.saturation} min={-100} max={100} onChange={set('saturation')} />
          <EnhSlider label="SICAKLIK" value={params.temperature} min={-100} max={100} onChange={set('temperature')} />
        </div>
      </div>

      {/* detay grubu */}
      <div className="rounded-md border border-border bg-black/20 p-3">
        <div className="mb-2 font-mono text-[9px] tracking-[0.2em] text-muted-foreground/70">DETAY</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <EnhSlider label="KESKİNLİK" value={params.sharpen} min={0} max={100} onChange={set('sharpen')} />
          <EnhSlider label="NETLİK" value={params.clarity} min={0} max={100} onChange={set('clarity')} />
          <EnhSlider label="GÜRÜLTÜ AZALTMA" value={params.denoise} min={0} max={100} onChange={set('denoise')} />
        </div>
      </div>

      {/* eylem düğmeleri */}
      <div className="flex items-center gap-2 pt-1">
        <Button onClick={apply} disabled={!fastSrc || !touched || busy}
          className="h-10 flex-1 gap-2 bg-sky-600 font-semibold text-black hover:bg-sky-500">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          UYGULA
        </Button>
        <Button onClick={reset} variant="outline" disabled={!touched && !previewing}
          className="h-10 gap-1.5">
          <RotateCcw className="size-3.5" /> SIFIRLA
        </Button>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        Temel: yüklenen orijinal görüntü. Uygulama sonrası sonuç araç çubuğundaki
        indirme tuşuyla PNG olarak kaydedilir; karşılaştırma modlarıyla
        önce/sonra yan yana incelenebilir.
      </p>
    </div>
  );
}
