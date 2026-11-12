'use client';

/**
 * SİLME İNCELEME PANELİ (Eradication Studio)
 * Yazıldıktan sonra silinen (silgi, kimyasal çözücü, kazıma) yazıyı tespit
 * etmek için:
 *  1) OTOMATİK OPTİMİZASYON — 25 eradikasyon tekniği taranır (eğik ışık
 *     rölyefi, doku bozulması, mürekkep kalıntısı DoG, kanal oranları,
 *     kimyasal renk sapması, PCA, top-hat); sıralama kalıntı-yapısı
 *     görünürlüğü (scoreErasure) ile yapılır; en iyi 9 varyant gösterilir;
 *     seçilen varyant tam çözünürlükte ana görüntüye uygulanır.
 *  2) İNCE AYAR — otomatik optimizasyonun seçtiği varyant üzerinde gamma,
 *     germe kesmeleri, CLAHE, keskinlik ve negatif canlı olarak elle
 *     kalibre edilir; hızlı ön ayarlar (NETLEŞTİR vb.) tek tık görünüm
 *     netleştirme sağlar; bölge skoru canlı gösterilir.
 *  3) AI SİLME ANALİZİ — orijinal + seçili varyantlar vision modeline
 *     gönderilir; silme izleri, silme türü ve silinen yazının en olası
 *     okuması (mantıklı tahminler dahil) raporlanır.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  Eraser, LoaderCircle, ScanLine, BrainCircuit, Copy, Check,
  MousePointerClick, AlertTriangle, FileText, SlidersHorizontal,
  Lightbulb, Maximize2, Minimize2, Search, Filter,
} from 'lucide-react';
import { grayToImageData, type GrayImage, type Rect } from '@/lib/forensic/filters';
import {
  autoScanErasure, renderErasureFull, scoreErasure, createErasureLiveTuner,
  erasureFamily, DEFAULT_FINE_TUNE, isDefaultTune, TUNE_PRESETS,
  type ErasureCandidate, type FineTune,
} from '@/lib/forensic/erasure';
import { imageDataToDataUrl } from '@/lib/forensic/canvas';
import { postJsonSafe } from '@/lib/forensic/api';

interface TuneGuess {
  tahmin?: string;
  gerekce?: string;
  guven?: number;
}

interface ErasureFinding {
  baslik?: string;
  aciklama?: string;
  yer?: string;
  siddet?: string;
}

interface ErasureResult {
  silme_var?: string; // evet|hayir|supheli
  silme_turu?: string; // kimyasal|silgi|kazima|belirsiz
  silinen_yazi?: string;
  tahminler?: TuneGuess[];
  bulgular?: ErasureFinding[];
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
  }, [img, maxW]);
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
        <span className="text-violet-400">{fmt ? fmt(value) : value.toFixed(2)}</span>
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

/** Ön ayar düğmesi stili. */
function presetBtnCls(on: boolean): string {
  return `rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-wider transition-colors ${
    on
      ? 'border-violet-500 bg-violet-600 font-semibold text-black'
      : 'border-border bg-black/40 text-muted-foreground hover:border-violet-800 hover:text-foreground'
  }`;
}

const SILME_VAR_LABEL: Record<string, string> = {
  evet: 'SİLME TESPİT EDİLDİ',
  hayir: 'SİLME İZİ YOK',
  supheli: 'ŞÜPHELİ / BELİRSİZ',
};

const SILME_TURU_LABEL: Record<string, string> = {
  kimyasal: 'KİMYASAL SİLME',
  silgi: 'SİLGİ / MEKANİK',
  kazima: 'KAZIMA / ÇİZME',
  belirsiz: 'TÜR BELİRSİZ',
};

export function ErasurePanel({
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
  const [candidates, setCandidates] = useState<ErasureCandidate[]>([]);
  const [scanSrc, setScanSrc] = useState<ImageData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<ErasureResult | null>(null);
  const [aiRaw, setAiRaw] = useState('');
  // --- teknik ailesi süzgeci (null = tümü) ---
  const [famFilter, setFamFilter] = useState<string | null>(null);
  // --- ince ayar durumu ---
  const [tune, setTune] = useState<FineTune>(DEFAULT_FINE_TUNE);
  const [tunedPreview, setTunedPreview] = useState<ImageData | null>(null);
  const [tunedScore, setTunedScore] = useState<number | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [bigPreview, setBigPreview] = useState(false);

  const maxScore = candidates.length ? Math.max(...candidates.map((c) => c.score)) : 1;
  const active = candidates.find((c) => c.id === activeId) ?? null;
  const tuning = !isDefaultTune(tune);
  const fams = [...new Set(candidates.map((c) => erasureFamily(c.recipe)))];
  const shown = famFilter
    ? candidates.filter((c) => erasureFamily(c.recipe) === famFilter)
    : candidates;

  const runScan = async () => {
    if (!original || scanning) return;
    setScanning(true);
    setCandidates([]);
    setActiveId(null);
    setSelectedIds([]);
    setAiResult(null);
    setTune(DEFAULT_FINE_TUNE);
    setPresetId(null);
    setFamFilter(null);
    setTunedPreview(null);
    setTunedScore(null);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await autoScanErasure(original, region, 9, (p) => setProgress(p));
      setCandidates(res.candidates);
      setScanSrc(res.scanSrc);
      if (res.candidates.length) {
        setActiveId(res.candidates[0].id);
        // AI varsayılan seçimi: top-3 + en iyi KİMYASAL/TOP-HAT varyantı garantili —
        // kimyasal silme artığı analizde asla gözden kaçmaz
        const ids = res.candidates.slice(0, 3).map((c) => c.id);
        const prefer = res.candidates.find((c) => {
          const f = erasureFamily(c.recipe);
          return f === 'KİMYASAL' || f === 'TOP-HAT';
        });
        if (prefer && !ids.includes(prefer.id)) ids[ids.length - 1] = prefer.id;
        setSelectedIds(ids);
      }
      toast({
        title: `Silme taraması tamamlandı — ${res.candidates.length} varyant`,
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
          liveTunerRef.current = createErasureLiveTuner(scanSrc, active.recipe);
          tunerKeyRef.current = key;
        }
        const g = liveTunerRef.current!(tune);
        const img = grayToImageData(g);
        setTunedPreview(img);
        setTunedScore(scoreErasure(g, region));
        liveCbRef.current?.(tuning ? img : null);
      } catch {
        /* önizleme hatası yoksayılır */
      }
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [active, scanSrc, tune, region, tuning]);

  /* Panel kapanınca (sekme değişimi) görüntüleyicideki canlı katmanı geri çek */
  useEffect(() => () => { liveCbRef.current?.(null); }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast({ title: 'En fazla 3 varyant seçebilirsiniz', description: 'AI analiz için önce bir seçimi kaldırın.' });
        return prev;
      }
      return [...prev, id];
    });
  };

  const applyActive = () => {
    if (!original || !active) return;
    try {
      const out = renderErasureFull(original, active.recipe, tune);
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

  const analyzeWithAi = async () => {
    if (!original || aiLoading) return;
    const chosen = candidates.filter((c) => selectedIds.includes(c.id));
    const use = (chosen.length ? chosen : candidates.slice(0, 2)).slice(0, 3);
    if (!use.length) {
      toast({ title: 'Önce tarama yapın', description: 'Varyant üretmek için otomatik optimizasyonu çalıştırın.' });
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    setAiRaw('');
    try {
      // İnce ayar yapıldıysa seçili varyantın görüntüsü ayarlı haliyle değiştirilir
      const substituteTuned = (c: ErasureCandidate) => {
        if (tuning && c.id === activeId && scanSrc) {
          return imageDataToDataUrl(renderErasureFull(original, c.recipe, tune), 760, 0.75);
        }
        return imageDataToDataUrl(c.preview, 760, 0.75);
      };
      const payload = {
        task: 'erasure' as const,
        original: imageDataToDataUrl(original, 1000, 0.78),
        processedList: use.map(substituteTuned),
        variantLabels: use.map(
          (c) => `${c.recipe.label}${tuning && c.id === activeId ? ' · ince ayarlı' : ''}`,
        ),
        ocrText: ocrText.slice(0, 1200),
      };
      const json = await postJsonSafe<{
        ok: boolean;
        result?: ErasureResult;
        raw?: string;
        error?: string;
      }>('/api/analyze', payload);
      setAiResult(json.result ?? null);
      setAiRaw(json.raw ?? '');
      toast({ title: 'AI silme analizi tamamlandı' });
    } catch (e) {
      toast({
        title: 'AI analiz hatası',
        description: (e as Error).message ?? 'Bilinmeyen hata',
        variant: 'destructive',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const copyReading = () => {
    if (!aiResult?.silinen_yazi) return;
    navigator.clipboard?.writeText(aiResult.silinen_yazi).then(
      () => toast({ title: 'Okuma kopyalandı' }),
      () => toast({ title: 'Kopyalama başarısız', variant: 'destructive' })
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-violet-900/50 bg-violet-950/15 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Silinen yazı tespiti:</span> yazıldıktan
        sonra silinen (silgi, kimyasal çözücü, kazıma) yazı izleri 25 adli teknikle açığa
        çıkarılır — eğik ışık rölyefi (yüzey girinti/aşınma), doku bozulması haritası (kâğıt
        lifi tahribatı), mürekkep kalıntısı, kanal-oranı ve kimyasal renk sapması haritaları.
        Otomatik optimizasyon kalıntıyı en iyi gösteren tekniği en üste sıralar; tarama
        sonrası <span className="font-mono text-amber-500">TEKNİK</span>süzgeciyle
        <span className="mx-1 font-mono text-amber-500">KİMYASAL</span>ailesini doğrudan
        inceleyebilirsiniz. Daha isabetli sonuç için önce görüntüleyicide
        <span className="mx-1 font-mono text-emerald-400">OCR BÖLGE SEÇ</span>ile silme
        bölgesini seçin, sonra taramayı çalıştırın. Sonrasında
        <span className="font-medium text-foreground/85">NETLEŞTİR</span>gibi ön ayarlarla
        görünümü netleştirin veya kaydırıcılarla elle kalibre edin.
      </div>

      <Button onClick={runScan} disabled={scanning || !original}
        className="h-11 gap-2 bg-violet-600 font-semibold text-black hover:bg-violet-500">
        {scanning ? <LoaderCircle className="size-4 animate-spin" /> : <Eraser className="size-4" />}
        {scanning ? 'SİLME TEKNİKLERİ TARANIYOR…' : 'SİLME TESPİTİ — OTOMATİK OPTİMİZASYON'}
      </Button>

      {scanning && progress.total > 0 && (
        <div className="rounded-md border border-border bg-black/40 p-3">
          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-violet-400">
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
              {famFilter ? `${famFilter} VARYANTLARI — SKORA GÖRE` : 'EN İYİ 9 VARYANT — KALINTI GÖRÜNÜRLÜĞÜNE GÖRE'}
            </span>
            <Badge variant="outline" className="gap-1 border-emerald-800/60 font-mono text-[9px] text-emerald-400">
              <MousePointerClick className="size-3" /> SEÇ = AI ANALİZ
            </Badge>
          </div>
          {/* teknik ailesi süzgeci — kimyasal silme artıkları tek tıkla görünür */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="size-3 text-muted-foreground" />
            <span className="mr-1 font-mono text-[9px] tracking-wider text-muted-foreground">TEKNİK:</span>
            <button className={presetBtnCls(famFilter === null)} onClick={() => setFamFilter(null)}>
              TÜMÜ
            </button>
            {fams.map((f) => (
              <button key={f} className={presetBtnCls(famFilter === f)} onClick={() => setFamFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {shown.map((c) => {
              const i = candidates.indexOf(c);
              const isActive = c.id === activeId;
              const isSel = selectedIds.includes(c.id);
              const isChem = erasureFamily(c.recipe) === 'KİMYASAL';
              return (
                <div key={c.id}
                  className={`group relative cursor-pointer overflow-hidden rounded-md border p-1 transition-colors ${
                    isActive ? 'border-violet-500 bg-violet-950/30' : 'border-border bg-card/50 hover:border-violet-800'
                  }`}
                  onClick={() => setActiveId(c.id)}>
                  <VariantThumb img={c.preview} />
                  <div className="mt-1 px-0.5">
                    <div className={`truncate font-mono text-[9px] ${isChem ? 'text-amber-400' : 'text-foreground/85'}`} title={c.recipe.label}>
                      {i + 1}. {c.recipe.label}
                    </div>
                    <div className="font-mono text-[9px] text-emerald-500">
                      SKOR {Math.max(1, Math.round((c.score / maxScore) * 100))}
                    </div>
                  </div>
                  <button
                    aria-label="AI seçimi"
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
            <section className="rounded-md border border-violet-900/40 bg-black/30 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-violet-400">
                  <SlidersHorizontal className="size-3.5" /> İNCE AYAR
                  <span className="truncate text-[9px] font-normal text-muted-foreground">
                    ({active.recipe.label})
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {tunedScore !== null && (
                    <span className={`font-mono text-[10px] ${
                      tunedScore >= active.score ? 'text-emerald-500' : 'text-violet-400'
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
                çıktıkça silme izleri ve kalıntı yapısı belirginleşir. UYGULA ile ayarlar tam
                çözünürlükte ana görüntüye yazılır.
              </p>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={applyActive} disabled={!active}
              className="h-9 flex-1 gap-1.5 bg-violet-600 text-[11px] font-semibold text-black hover:bg-violet-500">
              <ScanLine className="size-3.5" />
              ANA GÖRÜNTÜYE UYGULA{active ? `: ${active.recipe.label.slice(0, 18)}` : ''}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Uygulanan varyant görüntüleyicide açılır; ardından
            <span className="mx-1 font-mono text-violet-400">OCR</span>sekmesinde
            &quot;TÜM GÖRÜNTÜYÜ OKU&quot; ile makine okuması yapabilir veya
            <span className="mx-1 font-mono text-violet-400">AI</span>sekmesinden adli analiz alabilirsiniz.
          </p>
        </section>
      )}

      <div className="border-t border-border pt-3">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-emerald-500">
          <BrainCircuit className="size-3.5" /> AI SİLME ANALİZİ
          {selectedIds.length > 0 && (
            <span className="text-muted-foreground">({selectedIds.length} varyant seçili)</span>
          )}
        </div>
        <Button onClick={analyzeWithAi} disabled={aiLoading || !original || !candidates.length}
          className="h-11 w-full gap-2 bg-emerald-600 font-semibold text-black hover:bg-emerald-500">
          {aiLoading ? <LoaderCircle className="size-4 animate-spin" /> : <BrainCircuit className="size-5" />}
          {aiLoading ? 'SİLME ANALİZİ…' : 'AI İLE SİLME TESPİTİ (SEÇİLİ VARYANTLAR)'}
        </Button>
        {!candidates.length && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Önce otomatik optimizasyonu çalıştırın — AI, üretilen en iyi varyantlarla birlikte
            silme izlerini değerlendirir ve silinen yazıyı tahmin etmeye çalışır.
          </p>
        )}
      </div>

      {aiLoading && (
        <div className="relative overflow-hidden rounded-md border border-emerald-900/60 bg-black/40 p-4">
          <div className="absolute inset-x-0 top-0 h-0.5 animate-[scanline_1.6s_ease-in-out_infinite] bg-emerald-500" />
          <p className="font-mono text-[11px] text-emerald-500">
            Model silme izlerini ve mürekkep kalıntılarını çapraz karşılaştırıyor — silinen
            yazının rekonstrüksiyonu…
          </p>
        </div>
      )}

      {aiResult && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {aiResult.silme_var && (
              <Badge variant={aiResult.silme_var === 'evet' ? 'default' : aiResult.silme_var === 'hayir' ? 'destructive' : 'secondary'}
                className="font-mono text-[10px]">
                {SILME_VAR_LABEL[aiResult.silme_var] ?? aiResult.silme_var.toUpperCase()}
              </Badge>
            )}
            {aiResult.silme_turu && aiResult.silme_turu !== 'belirsiz' && (
              <Badge variant="outline" className="border-violet-800/60 font-mono text-[10px] text-violet-400">
                {SILME_TURU_LABEL[aiResult.silme_turu] ?? aiResult.silme_turu.toUpperCase()}
              </Badge>
            )}
            {typeof aiResult.guven === 'number' && (
              <span className="font-mono text-[11px] text-violet-400">GÜVEN %{aiResult.guven}</span>
            )}
          </div>
          {typeof aiResult.guven === 'number' && (
            <Progress value={Math.min(100, aiResult.guven)} className="h-1.5" />
          )}

          {aiResult.silinen_yazi && (
            <div className="rounded-md border border-emerald-900/50 bg-black/50 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-emerald-500">
                  <FileText className="size-3.5" /> SİLİNEN YAZI — EN OLASI OKUMA
                </span>
                <Button size="icon" variant="ghost" className="size-6" onClick={copyReading} aria-label="Kopyala">
                  <Copy className="size-3" />
                </Button>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[15px] font-semibold leading-relaxed tracking-wide text-emerald-200">
                {aiResult.silinen_yazi}
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
                inceleme raporunda &quot;tahmin&quot; olarak belirtilmelidir.
              </p>
            </div>
          ) : null}

          {aiResult.bulgular?.length ? (
            <div className="rounded-md border border-border bg-card/50 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">
                <AlertTriangle className="size-3" /> SİLME BULGULARI
              </div>
              <ul className="flex flex-col gap-2">
                {aiResult.bulgular.map((b, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-foreground/90">
                    <span className="font-semibold text-violet-400">{b.baslik ?? `Bulgu ${i + 1}`}</span>
                    {b.yer ? <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">[{b.yer}]</span> : null}
                    {b.siddet ? (
                      <Badge variant="outline"
                        className={`ml-1.5 font-mono text-[9px] ${
                          b.siddet === 'yuksek' ? 'border-red-800 text-red-400'
                            : b.siddet === 'orta' ? 'border-amber-800 text-amber-400'
                              : 'border-border text-muted-foreground'
                        }`}>
                        {b.siddet}
                      </Badge>
                    ) : null}
                    {b.aciklama && <p className="mt-0.5 text-muted-foreground">{b.aciklama}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {aiResult.genel_degerlendirme && (
            <p className="text-[13px] leading-relaxed text-foreground/90">
              <span className="font-semibold text-violet-400">Değerlendirme: </span>
              {aiResult.genel_degerlendirme}
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

          {!aiResult.silinen_yazi && aiRaw && (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-black/45 p-3 font-mono text-[12px] text-muted-foreground">
              {aiRaw}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
