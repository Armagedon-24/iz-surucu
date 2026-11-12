'use client';

/**
 * KARALAMA İNCELEME PANELİ (Obliteration Recovery Studio)
 * Kalın karalama altındaki yazıyı okunabilir kılmak için:
 *  1) OTOMATİK OPTİMİZASYON — 26 adli teknik taranır, bölge skoruyla en iyi
 *     9 varyant sıralanır; seçilen varyant tam çözünürlükte ana görüntüye
 *     uygulanır (sonra OCR/AI doğrudan üzerinde çalışabilir).
 *  2) İNCE AYAR — otomatik optimizasyonun seçtiği varyant üzerinde gamma,
 *     germe kesmeleri, CLAHE, keskinlik ve negatif canlı olarak elle
 *     kalibre edilir; bölge skoru canlı gösterilir, en iyi görüntü
 *     kullanıcı tarafından yakalanır.
 *  3) AI İLE OKU — orijinal + seçili varyantlar vision modeline gönderilir;
 *     karalama altındaki yazının en olası okuması üretilir.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  Wand2, LoaderCircle, ScanLine, BrainCircuit, Copy, Check,
  MousePointerClick, AlertTriangle, FileText, SlidersHorizontal,
  Lightbulb, Maximize2, Minimize2, Search,
} from 'lucide-react';
import { grayToImageData, type GrayImage, type Rect } from '@/lib/forensic/filters';
import {
  autoScan, renderCandidateFull, scoreRegion, createLiveTuner,
  DEFAULT_FINE_TUNE, isDefaultTune, TUNE_PRESETS,
  type Candidate, type FineTune,
} from '@/lib/forensic/recovery';
import { imageDataToDataUrl } from '@/lib/forensic/canvas';
import { postJsonSafe } from '@/lib/forensic/api';

interface WordConf {
  kelime?: string;
  guven?: number;
  not?: string;
}

interface TuneGuess {
  tahmin?: string;
  gerekce?: string;
  guven?: number;
}

interface ReadResult {
  okunan_metin?: string;
  kelime_guveni?: WordConf[];
  tahminler?: TuneGuess[];
  gorunurluk?: string;
  en_iyi_varyant?: number;
  genel_degerlendirme?: string;
  guven?: number;
  oneriler?: string[];
}

/** Küçük önizleme tuvali — ImageData'yı en yakın komşuyla ölçekleyip çizer. */
function VariantThumb({ img, maxW = 250 }: { img: ImageData; maxW?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    c.width = w;
    c.height = h;
    const scaled = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(img.height - 1, Math.floor((y / h) * img.height));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(img.width - 1, Math.floor((x / w) * img.width));
        const sp = (sy * img.width + sx) * 4;
        const op = (y * w + x) * 4;
        scaled.data[op] = img.data[sp];
        scaled.data[op + 1] = img.data[sp + 1];
        scaled.data[op + 2] = img.data[sp + 2];
        scaled.data[op + 3] = 255;
      }
    }
    c.getContext('2d')!.putImageData(scaled, 0, 0);
  }, [img]);
  return <canvas ref={ref} className="w-full rounded-sm" />;
}

/** İnce ayar kaydırıcısı — etiket + canlı değer. */
function TuneSlider({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="text-amber-500">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[value]}
        onValueChange={(vals) => onChange(vals[0] ?? min)}
        className="h-1"
      />
    </div>
  );
}

const GORUNURLUK_LABEL: Record<string, string> = {
  yok: 'İZ YOK',
  iz: 'ZAYIF İZ',
  kismi: 'KISMİ GÖRÜNÜR',
  okunur: 'OKUNABİLİR',
};

/** Ön ayar düğmesi stili. */
function presetBtnCls(on: boolean): string {
  return `rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-wider transition-colors ${
    on
      ? 'border-amber-500 bg-amber-600 font-semibold text-black'
      : 'border-border bg-black/40 text-muted-foreground hover:border-amber-800 hover:text-foreground'
  }`;
}

export function RecoveryPanel({
  original,
  region,
  ocrText,
  onApply,
  onLivePreview,
}: {
  original: ImageData | null;
  region: Rect | null;
  ocrText: string;
  onApply: (out: ImageData, label: string) => void;
  /** İnce ayar canlı önizlemesi — büyük görüntüleyiciye akıtılır; null = geri çek. */
  onLivePreview?: (img: ImageData | null) => void;
}) {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [scanSrc, setScanSrc] = useState<ImageData | null>(null);
  const [obscureMask, setObscureMask] = useState<Uint8Array | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<ReadResult | null>(null);
  const [aiRaw, setAiRaw] = useState('');
  // --- ince ayar durumu ---
  const [tune, setTune] = useState<FineTune>(DEFAULT_FINE_TUNE);
  const [tunedPreview, setTunedPreview] = useState<ImageData | null>(null);
  const [tunedScore, setTunedScore] = useState<number | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [bigPreview, setBigPreview] = useState(false);

  const maxScore = candidates.length ? Math.max(...candidates.map((c) => c.score)) : 1;
  const active = candidates.find((c) => c.id === activeId) ?? null;
  const tuning = !isDefaultTune(tune);

  const runScan = async () => {
    if (!original || scanning) return;
    setScanning(true);
    setCandidates([]);
    setActiveId(null);
    setSelectedIds([]);
    setAiResult(null);
    setTune(DEFAULT_FINE_TUNE);
    setPresetId(null);
    setTunedPreview(null);
    setTunedScore(null);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await autoScan(original, region, 9, (p) => setProgress(p));
      setCandidates(res.candidates);
      setScanSrc(res.scanSrc);
      setObscureMask(res.obscureMask);
      if (res.candidates.length) {
        setActiveId(res.candidates[0].id);
        setSelectedIds(res.candidates.slice(0, 3).map((c) => c.id));
      }
      toast({
        title: `Tarama tamamlandı — ${res.candidates.length} varyant`,
        description: res.candidates.length
          ? `En iyi teknik: ${res.candidates[0].recipe.label}. İnce ayarla kalibre edip uygulayın.`
          : 'Uygun varyant bulunamadı.',
      });
    } catch (e) {
      toast({ title: 'Tarama hatası', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  /* İnce ayar canlı önizleme + bölge skoru — rAF ile birleştirilir; tarif
     tabanı varyant başına bir kez hesaplanıp önbelleklenir (akıcı sürükleme).
     İnce ayar aktifken sonuç ana görüntüleyiciye canlı akıtılır. */
  const liveTunerRef = useRef<((t: FineTune) => GrayImage) | null>(null);
  const tunerKeyRef = useRef('');
  const liveCbRef = useRef(onLivePreview);
  liveCbRef.current = onLivePreview;

  useEffect(() => {
    if (!active || !scanSrc) {
      setTunedPreview(null);
      setTunedScore(null);
      liveCbRef.current?.(null);
      return;
    }
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        const key = `${active.id}:${scanSrc.width}x${scanSrc.height}`;
        if (!liveTunerRef.current || tunerKeyRef.current !== key) {
          liveTunerRef.current = createLiveTuner(scanSrc, active.recipe);
          tunerKeyRef.current = key;
        }
        const g = liveTunerRef.current!(tune);
        const img = grayToImageData(g);
        setTunedPreview(img);
        setTunedScore(scoreRegion(g, region, obscureMask ?? undefined));
        liveCbRef.current?.(tuning ? img : null);
      } catch {
        /* önizleme hatası yoksayılır */
      }
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [active, scanSrc, tune, region, obscureMask, tuning]);

  /* Panel kapanınca (sekme değişimi) görüntüleyicideki canlı katmanı geri çek */
  useEffect(() => () => { liveCbRef.current?.(null); }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast({ title: 'En fazla 3 varyant seçebilirsiniz', description: 'YZ okuma için önce bir seçimi kaldırın.' });
        return prev;
      }
      return [...prev, id];
    });
  };

  const applyActive = () => {
    if (!original || !active) return;
    try {
      const out = renderCandidateFull(original, active.recipe, tune);
      onApply(out, active.recipe.label);
      liveCbRef.current?.(null); // uygulandı — canlı katmanı geri çek, tam çözünürlük görünsün
      toast({
        title: 'Varyant ana görüntüye uygulandı',
        description: `${active.recipe.label}${tuning ? ' · ince ayarlı' : ''} — şimdi OCR sekmesinden okutabilirsiniz.`,
      });
    } catch (e) {
      toast({ title: 'Uygulama hatası', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const readWithAi = async () => {
    if (!original || aiLoading) return;
    const chosen = candidates.filter((c) => selectedIds.includes(c.id));
    const use = (chosen.length ? chosen : candidates.slice(0, 2)).slice(0, 3); // en fazla 3 varyant — gecikme kontrolü
    if (!use.length) {
      toast({ title: 'Önce tarama yapın', description: 'Varyant üretmek için otomatik optimizasyonu çalıştırın.' });
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    setAiRaw('');
    try {
      // İnce ayar yapıldıysa seçili varyantın görüntüsü ayarlı haliyle değiştirilir
      const substituteTuned = (c: Candidate) => {
        if (tuning && c.id === activeId && scanSrc) {
          return imageDataToDataUrl(renderCandidateFull(original, c.recipe, tune), 760, 0.75);
        }
        return imageDataToDataUrl(c.preview, 760, 0.75);
      };
      // orijinal 1000px, varyantlar 760px: toplam yük düşer, AI gecikmesi kısalır
      const payload = {
        task: 'read' as const,
        original: imageDataToDataUrl(original, 1000, 0.78),
        processedList: use.map(substituteTuned),
        variantLabels: use.map(
          (c) => `${c.recipe.label}${tuning && c.id === activeId ? ' · ince ayarlı' : ''}`,
        ),
        ocrText: ocrText.slice(0, 1200),
      };
      const json = await postJsonSafe<{
        ok: boolean;
        result?: ReadResult;
        raw?: string;
        error?: string;
      }>('/api/analyze', payload);
      setAiResult(json.result ?? null);
      setAiRaw(json.raw ?? '');
      toast({ title: 'YZ okuma tamamlandı' });
    } catch (e) {
      toast({
        title: 'YZ okuma hatası',
        description: (e as Error).message ?? 'Bilinmeyen hata',
        variant: 'destructive',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const copyReading = () => {
    if (!aiResult?.okunan_metin) return;
    navigator.clipboard?.writeText(aiResult.okunan_metin).then(
      () => toast({ title: 'Okuma kopyalandı' }),
      () => toast({ title: 'Kopyalama başarısız', variant: 'destructive' })
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-amber-900/50 bg-amber-950/15 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Karalama altı okuma:</span> 26 adli teknik
        (spektral bantlar, kanal oranları, PCA, mürekkep ayrıştırma, morfolojik top-hat) otomatik
        taranır; en okunabilir varyantlar sıralanır. Daha isabetli sonuç için önce görüntüleyicide
        <span className="mx-1 font-mono text-emerald-400">OCR BÖLGE SEÇ</span> ile karalamayı
        seçin, sonra taramayı çalıştırın. Sonrasında <span className="font-medium text-foreground/85">NETLEŞTİR</span> gibi
        hızlı ön ayarlarla görünümü netleştirin veya kaydırıcılarla elle kalibre edin. YZ okuma,
        yazı tam okunamasa bile görünüme dayalı <span className="font-medium text-foreground/85">mantıklı tahminler</span> de üretir.
      </div>

      <Button onClick={runScan} disabled={scanning || !original}
        className="h-11 gap-2 bg-amber-600 font-semibold text-black hover:bg-amber-500">
        {scanning ? <LoaderCircle className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        {scanning ? 'VARYANTLAR TARANIYOR…' : 'OTOMATİK OPTİMİZASYON BAŞLAT'}
      </Button>

      {scanning && progress.total > 0 && (
        <div className="rounded-md border border-border bg-black/40 p-3">
          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-amber-500">
            <span>Teknik {progress.done}/{progress.total} işleniyor…</span>
            <span>{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          <Progress value={Math.round((progress.done / progress.total) * 100)} className="h-1.5" />
        </div>
      )}

      {candidates.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              EN İYİ 9 VARYANT — SKORA GÖRE
            </span>
            <Badge variant="outline" className="gap-1 border-emerald-800/60 font-mono text-[9px] text-emerald-400">
              <MousePointerClick className="size-3" /> SEÇ = YZ OKUMA
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {candidates.map((c, i) => {
              const isActive = c.id === activeId;
              const isSel = selectedIds.includes(c.id);
              return (
                <div key={c.id}
                  className={`group relative cursor-pointer overflow-hidden rounded-md border p-1 transition-colors ${
                    isActive ? 'border-amber-500 bg-amber-950/30' : 'border-border bg-card/50 hover:border-amber-800'
                  }`}
                  onClick={() => setActiveId(c.id)}>
                  <VariantThumb img={c.preview} />
                  <div className="mt-1 px-0.5">
                    <div className="truncate font-mono text-[9px] text-foreground/85" title={c.recipe.label}>
                      {i + 1}. {c.recipe.label}
                    </div>
                    <div className="font-mono text-[9px] text-emerald-500">
                      SKOR {Math.max(1, Math.round((c.score / maxScore) * 100))}
                    </div>
                  </div>
                  <button
                    aria-label="YZ seçimi"
                    onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}
                    className={`absolute right-1 top-1 grid size-5 place-items-center rounded-sm border font-mono text-[9px] ${
                      isSel
                        ? 'border-emerald-500 bg-emerald-600 text-black'
                        : 'border-border bg-black/60 text-muted-foreground opacity-70 hover:opacity-100'
                    }`}>
                    {isSel ? <Check className="size-3" /> : i + 1}
                  </button>
                </div>
              );
            })}
          </div>

          {/* ---------------- İNCE AYAR ---------------- */}
          {active && scanSrc && (
            <section className="rounded-md border border-amber-900/40 bg-black/30 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-amber-500">
                  <SlidersHorizontal className="size-3.5" /> İNCE AYAR
                  <span className="truncate text-[9px] font-normal text-muted-foreground">
                    ({active.recipe.label})
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {tunedScore !== null && (
                    <span className={`font-mono text-[10px] ${
                      tunedScore >= active.score ? 'text-emerald-500' : 'text-amber-500'
                    }`}>
                      SKOR {Math.max(1, Math.round((tunedScore / (active.score || 1)) * 100))}%
                    </span>
                  )}
                  <Button size="icon" variant="ghost"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    aria-label={bigPreview ? 'Önizlemeyi küçült' : 'Önizlemeyi büyüt'}
                    onClick={() => setBigPreview((v) => !v)}>
                    {bigPreview ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  </Button>
                </div>
              </div>

              {/* Hızlı görünüm ön ayarları — tek tık netleştirme */}
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                <Search className="size-3 text-muted-foreground" />
                <span className="mr-1 font-mono text-[9px] tracking-wider text-muted-foreground">GÖRÜNÜM:</span>
                <button className={presetBtnCls(presetId === null)}
                  onClick={() => { setTune(DEFAULT_FINE_TUNE); setPresetId(null); }}>
                  VARSAYILAN
                </button>
                {TUNE_PRESETS.map((p) => (
                  <button key={p.id} className={presetBtnCls(presetId === p.id)}
                    onClick={() => { setTune(p.tune); setPresetId(p.id); }}>
                    {p.label}
                  </button>
                ))}
              </div>

              <div className={bigPreview ? 'flex flex-col gap-3' : 'grid grid-cols-[120px_1fr] gap-3'}>
                <div className={`overflow-hidden rounded-md border border-border bg-black/50 ${bigPreview ? 'w-full' : 'self-start'}`}>
                  <VariantThumb img={tunedPreview ?? active.preview} maxW={bigPreview ? 760 : 250} />
                </div>
                <div className="flex flex-col gap-2">
                  <TuneSlider label="GAMMA (AYDINLATMA)" min={0.4} max={2.6} step={0.05}
                    value={tune.gamma}
                    onChange={(v) => { setPresetId(null); setTune({ ...tune, gamma: v }); }} />
                  <TuneSlider label="GÖLGE KESME" min={0} max={8} step={0.5}
                    value={tune.lowPct}
                    onChange={(v) => { setPresetId(null); setTune({ ...tune, lowPct: v }); }}
                    fmt={(v) => `%${v.toFixed(1)}`} />
                  <TuneSlider label="PARLAK KESME" min={92} max={100} step={0.5}
                    value={tune.highPct}
                    onChange={(v) => { setPresetId(null); setTune({ ...tune, highPct: v }); }}
                    fmt={(v) => `%${v.toFixed(1)}`} />
                  <TuneSlider label="CLAHE (YEREL KONTRAST)" min={0} max={6} step={0.1}
                    value={tune.claheClip}
                    onChange={(v) => { setPresetId(null); setTune({ ...tune, claheClip: v }); }}
                    fmt={(v) => (v < 0.05 ? 'KAPALI' : v.toFixed(1))} />
                  <TuneSlider label="KESKİNLİK" min={0} max={2} step={0.05}
                    value={tune.sharpen}
                    onChange={(v) => { setPresetId(null); setTune({ ...tune, sharpen: v }); }} />
                  <label className="flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
                    NEGATİF (TERS)
                    <Switch checked={tune.invert} onCheckedChange={(v) => { setPresetId(null); setTune({ ...tune, invert: v }); }} />
                  </label>
                </div>
              </div>

              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                NETLEŞTİR gibi ön ayarlar tek tıkla görünümü netleştirir; kaydırıcılarla elle
                kalibre edebilirsiniz (değer değişince ön ayar bozulur). Skor 100%'ün üzerine
                çıktıkça karalama altındaki yazı yapısı belirginleşir. UYGULA ile ayarlar tam
                çözünürlükte ana görüntüye yazılır.
              </p>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={applyActive} disabled={!active}
              className="h-9 flex-1 gap-1.5 bg-amber-600 text-[11px] font-semibold text-black hover:bg-amber-500">
              <ScanLine className="size-3.5" />
              ANA GÖRÜNTÜYE UYGULA{active ? `: ${active.recipe.label.slice(0, 18)}` : ''}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Uygulanan varyant görüntüleyicide açılır; ardından
            <span className="mx-1 font-mono text-amber-500">OCR</span>sekmesinde
            &quot;TÜM GÖRÜNTÜYÜ OKU&quot; ile makine okuması yapabilir veya
            <span className="mx-1 font-mono text-amber-500">YZ</span>sekmesinden adli analiz alabilirsiniz.
          </p>
        </section>
      )}

      <div className="border-t border-border pt-3">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-emerald-500">
          <BrainCircuit className="size-3.5" /> YZ KARALAMA OKUMA
          {selectedIds.length > 0 && (
            <span className="text-muted-foreground">({selectedIds.length} varyant seçili)</span>
          )}
        </div>
        <Button onClick={readWithAi} disabled={aiLoading || !original || (!candidates.length && true)}
          className="h-11 w-full gap-2 bg-emerald-600 font-semibold text-black hover:bg-emerald-500">
          {aiLoading ? <LoaderCircle className="size-4 animate-spin" /> : <BrainCircuit className="size-5" />}
          {aiLoading ? 'OKUMA REKONSTRÜKSİYONU…' : 'YZ İLE OKU (SEÇİLİ VARYANTLAR)'}
        </Button>
        {!candidates.length && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Önce otomatik optimizasyonu çalıştırın — YZ, üretilen en iyi varyantlarla birlikte okur.
          </p>
        )}
      </div>

      {aiLoading && (
        <div className="relative overflow-hidden rounded-md border border-emerald-900/60 bg-black/40 p-4">
          <div className="absolute inset-x-0 top-0 h-0.5 animate-[scanline_1.6s_ease-in-out_infinite] bg-emerald-500" />
          <p className="font-mono text-[11px] text-emerald-500">
            Model orijinal + varyantları çapraz karşılaştırıyor — harf harf rekonstrüksiyon ve
            görünüme dayalı mantıklı tahmin…
          </p>
        </div>
      )}

      {aiResult && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            {aiResult.gorunurluk && (
              <Badge variant={aiResult.gorunurluk === 'okunur' ? 'default' : aiResult.gorunurluk === 'yok' ? 'destructive' : 'secondary'}
                className="font-mono text-[10px]">
                {GORUNURLUK_LABEL[aiResult.gorunurluk] ?? aiResult.gorunurluk.toUpperCase()}
              </Badge>
            )}
            {typeof aiResult.guven === 'number' && (
              <span className="font-mono text-[11px] text-amber-500">GÜVEN %{aiResult.guven}</span>
            )}
          </div>
          {typeof aiResult.guven === 'number' && (
            <Progress value={Math.min(100, aiResult.guven)} className="h-1.5" />
          )}

          {aiResult.okunan_metin && (
            <div className="rounded-md border border-emerald-900/50 bg-black/50 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-emerald-500">
                  <FileText className="size-3.5" /> OKUNAN METİN
                </span>
                <Button size="icon" variant="ghost" className="size-6" onClick={copyReading} aria-label="Kopyala">
                  <Copy className="size-3" />
                </Button>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[15px] font-semibold leading-relaxed tracking-wide text-emerald-200">
                {aiResult.okunan_metin}
              </pre>
            </div>
          )}

          {aiResult.tahminler?.length ? (
            <div className="rounded-md border border-amber-900/50 bg-amber-950/15 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-amber-500">
                <Lightbulb className="size-3.5" /> MANTIKLI TAHMİNLER — GÖRÜNÜME DAYALI
              </div>
              <ul className="flex flex-col gap-2">
                {aiResult.tahminler.map((t, i) => (
                  <li key={i} className="text-[12px] leading-relaxed">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-foreground/90">
                        <span className="font-semibold text-amber-500">Hipotez {i + 1}:</span> {t.tahmin}
                      </span>
                      {typeof t.guven === 'number' && (
                        <span className="shrink-0 font-mono text-[10px] text-amber-500">%{t.guven}</span>
                      )}
                    </div>
                    {t.gerekce && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Gerekçe: {t.gerekce}</p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Tahminler görüntüdeki iz yapısına dayalı hipotezlerdir; resmî okuma yerine geçmez,
                inceleme raporunda "tahmin" olarak belirtilmelidir.
              </p>
            </div>
          ) : null}

          {aiResult.kelime_guveni?.length ? (
            <div>
              <div className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">KELİME GÜVENLERİ</div>
              <div className="flex flex-wrap gap-1.5">
                {aiResult.kelime_guveni.map((w, i) => (
                  <Badge key={i} variant={((w.guven ?? 0) >= 70 ? 'default' : (w.guven ?? 0) >= 40 ? 'secondary' : 'destructive') as 'default' | 'secondary' | 'destructive'}
                    className="font-mono text-[10px]">
                    {w.kelime} %{w.guven ?? '?'}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {aiResult.genel_degerlendirme && (
            <p className="text-[13px] leading-relaxed text-foreground/90">
              <span className="font-semibold text-amber-500">Değerlendirme: </span>
              {aiResult.genel_degerlendirme}
            </p>
          )}

          {typeof aiResult.en_iyi_varyant === 'number' && (
            <p className="font-mono text-[11px] text-muted-foreground">
              EN İYİ VARYANT: #{aiResult.en_iyi_varyant}
              {candidates[aiResult.en_iyi_varyant - 1] ? ` — ${candidates[aiResult.en_iyi_varyant - 1].recipe.label}` : ''}
            </p>
          )}

          {aiResult.oneriler?.length ? (
            <div className="rounded-md border border-border bg-card/50 p-2.5">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">
                <AlertTriangle className="size-3" /> SONRAKİ ADIM ÖNERİLERİ
              </div>
              <ul className="list-disc pl-4 text-[12px] leading-relaxed text-muted-foreground">
                {aiResult.oneriler.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          ) : null}

          {!aiResult.okunan_metin && aiRaw && (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-black/45 p-3 font-mono text-[12px] text-muted-foreground">
              {aiRaw}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
