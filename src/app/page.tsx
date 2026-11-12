'use client';

/**
 * İzSürücü — ADLİ BELGE İNCELEME KONSOLU
 * Kamera/dosya girişi → sanal spektral bantlar (UV/IR/kanal) → adli işlem
 * hattı → OCR (Tesseract) → AI adli analiz → rapor. Gerçek VSC cihazlarının
 * iş akışını taklit eden tek ekranlı konsol.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Camera, Upload, FlaskConical, Fingerprint, ScanText, BrainCircuit,
  FileDown, Radar, RotateCw, Download, SplitSquareHorizontal, Columns2,
  Square, Loader2, ShieldAlert, Contrast, Landmark, Wand2, Eraser,
} from 'lucide-react';
import { ImageViewer, type OcrBox } from '@/components/forensic/viewer';
import { SpectralPanel, ProcessPanel } from '@/components/forensic/panels';
import { OcrPanel } from '@/components/forensic/ocr-panel';
import { AiPanel } from '@/components/forensic/ai-panel';
import { ReportPanel } from '@/components/forensic/report-panel';
import { RecoveryPanel } from '@/components/forensic/recovery-panel';
import { ErasurePanel } from '@/components/forensic/erasure-panel';
import { CameraCapture } from '@/components/forensic/camera-modal';
import {
  DEFAULT_PARAMS, getBand, processPipeline, scanAnomalies,
  type AnomalyRegion, type Params,
} from '@/lib/forensic/pipeline';
import { histogram, mixToGray, type Rect } from '@/lib/forensic/filters';
import { generateDemoCase } from '@/lib/forensic/demo';
import { dataUrlToImageData, imageDataToDataUrl, downloadDataUrl } from '@/lib/forensic/canvas';
import { useCaseStore, paramsSummary } from '@/lib/forensic/store';

const WORKING_MAX = 1800;

type CompareMode = 'single' | 'split' | 'side';

export default function Home() {
  const { toast } = useToast();
  const [srcImg, setSrcImg] = useState<ImageData | null>(null);
  const [imgName, setImgName] = useState('');
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [processed, setProcessed] = useState<{ out: ImageData; hist: Uint32Array; ms: number } | null>(null);
  // İnce ayar canlı önizlemesi — karalama/silme panelindeki kaydırıcılar sürüklenirken
  // büyük görüntüleyiciye akıtılan iyileştirilmiş görüntü (null = canlı kapalı).
  const [livePreview, setLivePreview] = useState<ImageData | null>(null);
  const [processing, setProcessing] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>('single');
  const [comparePct, setComparePct] = useState(50);
  const [region, setRegion] = useState<Rect | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [boxes, setBoxes] = useState<OcrBox[] | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyRegion[]>([]);
  const [showAnomalies, setShowAnomalies] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const caseNo = useCaseStore((s) => s.caseNo);
  const examiner = useCaseStore((s) => s.examiner);
  const ocrResults = useCaseStore((s) => s.ocrResults);
  const band = getBand(params.band);

  /* ---------------- görüntü yükleme ---------------- */
  const loadFromDataUrl = useCallback(
    async (url: string, name: string) => {
      try {
        const img = await dataUrlToImageData(url, WORKING_MAX);
        setSrcImg(img);
        setImgName(name || 'belge.png');
        setRegion(null);
        setBoxes(null);
        setAnomalies([]);
        setCompareMode('single');
        setParams(DEFAULT_PARAMS);
        setRecoveryMode(false);
        setLivePreview(null);
        toast({ title: 'Görüntü yüklendi', description: `${img.width}×${img.height} px — incelemeye hazır` });
      } catch (e) {
        toast({ title: 'Görüntü okunamadı', description: (e as Error).message, variant: 'destructive' });
      }
    },
    [toast]
  );

  const loadFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Desteklenmeyen dosya', description: 'Lütfen bir görsel dosyası seçin.', variant: 'destructive' });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => loadFromDataUrl(reader.result as string, file.name);
      reader.readAsDataURL(file);
    },
    [loadFromDataUrl, toast]
  );

  const loadDemo = useCallback(() => {
    const demo = generateDemoCase();
    setSrcImg(demo.imageData);
    setImgName(demo.name);
    setRegion(null);
    setBoxes(null);
    setAnomalies([]);
    setCompareMode('single');
    setParams(DEFAULT_PARAMS);
    setRecoveryMode(false);
    setLivePreview(null);
    toast({
      title: 'Örnek vaka yüklendi — TF-2024/117',
      description: 'Kimyasal silme, gizli UV metni ve girinti yazısı içerir. Reçetelerle deneyin.',
    });
  }, [toast]);

  /* ---------------- yapıştırma (paste) ---------------- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            loadFile(f);
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  /* ---------------- işlem hattı ---------------- */
  const runRef = useRef(0);
  useEffect(() => {
    if (!srcImg || recoveryMode) return; // karalama inceleme varyantı aktifken pipeline çalışmaz
    const id = ++runRef.current;
    const t = setTimeout(() => {
      setProcessing(true);
      // ağır senkron işlem öncesi bir kare çizime izin ver
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (runRef.current !== id) return;
          const res = processPipeline(srcImg, params);
          if (runRef.current !== id) return;
          setProcessed(res);
          setProcessing(false);
        }, 0);
      });
    }, 40);
    return () => clearTimeout(t);
  }, [srcImg, params, recoveryMode]);

  /* ---------------- karalama inceleme ---------------- */
  const changeParams = useCallback((p: Partial<Params>) => {
    setRecoveryMode(false); // panel ayarı değişince varyant geçersiz
    setParams((s) => ({ ...s, ...p }));
  }, []);

  const handleApplyRecovery = useCallback((out: ImageData, _label: string) => {
    const g = mixToGray(out, [0.299, 0.587, 0.114]);
    setProcessed({ out, hist: histogram(g), ms: 0 });
    setRecoveryMode(true);
    setLivePreview(null); // taahhüt edildi — canlı katmanı kapat, tam çözünürlüğü göster
  }, []);

  /* ---------------- anomali taraması ---------------- */
  const runScan = useCallback(() => {
    if (!srcImg) return;
    setScanning(true);
    setTimeout(() => {
      const regions = scanAnomalies(srcImg);
      setAnomalies(regions);
      setShowAnomalies(true);
      setScanning(false);
      toast({
        title: regions.length ? `${regions.length} şüpheli bölge işaretlendi` : 'Anomali bulunamadı',
        description: regions.length
          ? 'Spektral tutarlılık taraması bantlar arası sapmaları ölçtü. Kırmızı kutuları inceleyin.'
          : 'Bantlar arası tutarlı görünüyor; yine de manuel bant incelemesi önerilir.',
      });
    }, 30);
  }, [srcImg, toast]);

  /* ---------------- yardımcılar ---------------- */
  const rotate = () => {
    if (!srcImg) return;
    const img = srcImg;
    const out = new ImageData(img.height, img.width);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const sp = (y * img.width + x) * 4;
        const nx = img.height - 1 - y;
        const ny = x;
        const dp = (ny * out.width + nx) * 4;
        out.data[dp] = img.data[sp];
        out.data[dp + 1] = img.data[sp + 1];
        out.data[dp + 2] = img.data[sp + 2];
        out.data[dp + 3] = 255;
      }
    }
    setSrcImg(out);
    setRecoveryMode(false);
    setLivePreview(null);
  };

  const exportPng = () => {
    if (!processed) return;
    const url = imageDataToDataUrl(processed.out, 4096, 0.95, 'image/png');
    downloadDataUrl(url, `${imgName.replace(/\.[^.]+$/, '')}_${band.id}.png`);
    toast({ title: 'İşlenmiş görüntü indirildi', description: `${band.name} modu` });
  };

  const onBoxes = (b: OcrBox[] | null | undefined) => {
    if (b === undefined) return; // "kutuları göster" geri açma — mevcut kutuları koru
    setBoxes(b);
  };

  const hudLeft = srcImg
    ? `${imgName} · ${srcImg.width}×${srcImg.height} · VAKA ${caseNo}`
    : '';
  const hudRight = livePreview
    ? 'CANLI İNCE AYAR · İYİLEŞTİRMELER GÖRÜNTÜLEYİCIDE ANLIK GÖRÜNÜR · UYGULA İLE KALICI OLUR'
    : recoveryMode
      ? 'MOD: İNCELEME VARYANTI · RECOVERY STUDIO · TAM ÇÖZÜNÜRLÜK'
      : processed
        ? `MOD: ${band.name.toUpperCase()} (${band.nm}) · ${paramsSummary(params).toUpperCase()} · ${processed.ms.toFixed(0)}MS`
        : '';

  /* ================= BOŞ DURUM (LANDING) ================= */
  if (!srcImg) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
      >
        <Header onCamera={() => setCameraOpen(true)} onUpload={() => fileInputRef.current?.click()}
          onDemo={loadDemo} compact />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
          <div className="text-center">
            <div className="mb-3 flex items-center justify-center gap-2 font-mono text-[11px] tracking-[0.3em] text-amber-600">
              <ShieldAlert className="size-4" /> FORENSIC DOCUMENT EXAMINATION CONSOLE
            </div>
            <img src="/logo.png" alt="İzSürücü logosu"
              className="mx-auto mb-4 size-24 rounded-2xl border border-border object-cover shadow-lg" />
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              İz<span className="text-sky-400">Sürücü</span>
            </h1>
            <p className="mt-2 text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
              Belgenin fotoğrafını çekin; UV ve kızılötesi sanal bantlarla kimyasal silme ve
              tahrip izlerini görünür kılın, yerleşik OCR ile yazıyı okuyun, yapay zekâ adli
              analiz raporu alın — kriminal laboratuvar iş akışı, tarayıcınızda.
            </p>
          </div>

          <div
            className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragOver ? 'border-amber-500 bg-amber-950/20' : 'border-border bg-card/40'
            }`}
          >
            <Fingerprint className="size-10 text-amber-600" />
            <p className="text-sm text-muted-foreground">
              Belge fotoğrafını buraya <span className="text-foreground font-semibold">sürükleyip bırakın</span>,
              dosya seçin veya kamera ile çekin
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => setCameraOpen(true)} className="h-11 gap-2 bg-amber-600 font-semibold text-black hover:bg-amber-500">
                <Camera className="size-4" /> Kamera ile Çek
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="h-11 gap-2">
                <Upload className="size-4" /> Dosya Yükle
              </Button>
              <Button onClick={loadDemo} variant="outline" className="h-11 gap-2">
                <FlaskConical className="size-4" /> Örnek Vaka
              </Button>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground/70">
              PANODAN GÖRSEL YAPIŞTIRMA DA DESTEKLENİR (CTRL+V)
            </p>
          </div>

          <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
            {[
              {
                icon: Radar, title: 'Sanal Spektral Bantlar',
                desc: 'UV-A 365nm, IR 850nm, 6 renkli bant ve özel spektral mikser — VSC cihazı benzeri inceleme.',
              },
              {
                icon: Contrast, title: 'Adli İşlem Hattı',
                desc: 'CLAHE, Sauvola/Otsu eşikleme, eğik ışık girinti taraması, false-color yoğunluk haritaları.',
              },
              {
                icon: BrainCircuit, title: 'OCR + AI Analiz',
                desc: 'Türkçe/İngilizce metin okuma ve görme yeteneği olan modelle yapılandırılmış adli bulgu raporu.',
              },
            ].map((f) => (
              <div key={f.title} className="rounded-lg border border-border bg-card/40 p-4">
                <f.icon className="mb-2 size-5 text-emerald-500" />
                <h3 className="mb-1 text-sm font-semibold">{f.title}</h3>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>

          <p className="max-w-xl text-center text-[11px] leading-relaxed text-muted-foreground/80">
            ⚖ Bu konsol eğitim, araştırma ve ön inceleme amaçlıdır; sanal bantlar fiziksel ışık
            kaynaklarının yazılım simülasyonudur. Resmî adli süreçlerde sertifikalı laboratuvar
            cihazları (VSC/ESDA) ve yetkili uzman görüşü gereklidir.
          </p>
        </main>
        <Footer className="mt-auto" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
        <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen}
          onCapture={(url) => loadFromDataUrl(url, 'kamera_cekim.jpg')} />
      </div>
    );
  }

  /* ================= ÇALIŞMA ALANI ================= */
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header
        onCamera={() => setCameraOpen(true)}
        onUpload={() => fileInputRef.current?.click()}
        onDemo={loadDemo}
      />

      <main className="grid flex-1 grid-cols-1 gap-0 lg:flex-none lg:grid-cols-[minmax(0,1fr)_410px] lg:h-[calc(100vh_-_89px)] lg:overflow-hidden">
        {/* görüntüleyici + araç çubuğu */}
        <section className="flex flex-col border-b border-border lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Badge variant="outline" className="gap-1.5 border-amber-600/50 font-mono text-[10px] text-amber-500">
              <Landmark className="size-3" /> {recoveryMode ? 'İnceleme Varyantı · RECOVERY' : `${band.name} · ${band.nm}`}
            </Badge>
            {processing && (
              <Badge variant="outline" className="gap-1 border-emerald-700/50 font-mono text-[10px] text-emerald-400">
                <Loader2 className="size-3 animate-spin" /> İŞLENİYOR
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {/* karşılaştırma modu */}
              <div className="flex items-center rounded-md border border-border bg-card/60 p-0.5">
                <Button size="icon" variant="ghost"
                  className={`size-7 ${compareMode === 'single' ? 'bg-amber-600 text-black hover:bg-amber-600' : ''}`}
                  onClick={() => setCompareMode('single')} aria-label="Tek görüntü">
                  <Square className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost"
                  className={`size-7 ${compareMode === 'split' ? 'bg-amber-600 text-black hover:bg-amber-600' : ''}`}
                  onClick={() => setCompareMode('split')} aria-label="Bölünmüş karşılaştırma">
                  <SplitSquareHorizontal className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost"
                  className={`size-7 ${compareMode === 'side' ? 'bg-amber-600 text-black hover:bg-amber-600' : ''}`}
                  onClick={() => setCompareMode('side')} aria-label="Yan yana karşılaştırma">
                  <Columns2 className="size-3.5" />
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={runScan} disabled={scanning}
                className="h-8 gap-1.5 border-red-800/60 font-mono text-[10px] text-red-300 hover:bg-red-950/40">
                {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
                ANOMALİ TARAMASI
              </Button>
              {anomalies.length > 0 && (
                <Button size="sm" variant={showAnomalies ? 'default' : 'outline'} onClick={() => setShowAnomalies((v) => !v)}
                  className="h-8 font-mono text-[10px]">
                  {anomalies.length} BÖLGE {showAnomalies ? 'AÇIK' : 'KAPALI'}
                </Button>
              )}
              <Button size="icon" variant="ghost" className="size-8" onClick={rotate} aria-label="90° döndür">
                <RotateCw className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={exportPng} aria-label="PNG indir">
                <Download className="size-4" />
              </Button>
            </div>
          </div>
          {/* mobil: dinamik görünüm yüksekliği (dvh) — adres çubuğu açılırken taşmaz */}
          <div className="h-[56dvh] lg:h-auto lg:min-h-0 lg:flex-1">
            <ImageViewer
              original={srcImg}
              processed={processed?.out ?? null}
              livePreview={livePreview}
              hist={processed?.hist ?? null}
              hudLeft={hudLeft}
              hudRight={hudRight}
              compareMode={compareMode}
              comparePct={comparePct}
              onComparePct={setComparePct}
              selectMode={selectMode}
              onSelectMode={setSelectMode}
              region={region}
              onRegionDone={setRegion}
              boxes={boxes ?? []}
              showBoxes={!!boxes && compareMode !== 'side'}
              anomalies={anomalies}
              showAnomalies={showAnomalies}
            />
          </div>
        </section>

        {/* kontrol paneli */}
        <aside className="flex min-h-0 flex-col">
          <Tabs defaultValue="bant" className="flex h-full min-h-0 flex-col">
            <TabsList className="mx-2 mt-2 grid w-auto shrink-0 grid-cols-7 bg-card/60">
              <TabsTrigger value="bant" className="gap-1 px-1 text-[10px] font-mono"><Radar className="size-3" />BANT</TabsTrigger>
              <TabsTrigger value="islem" className="gap-1 px-1 text-[10px] font-mono"><Contrast className="size-3" />İŞLEM</TabsTrigger>
              <TabsTrigger value="karalama" className="gap-1 px-1 text-[10px] font-mono text-amber-500"><Wand2 className="size-3" />KARALAMA</TabsTrigger>
              <TabsTrigger value="silme" className="gap-1 px-1 text-[10px] font-mono text-violet-400"><Eraser className="size-3" />SİLME</TabsTrigger>
              <TabsTrigger value="ocr" className="gap-1 px-1 text-[10px] font-mono"><ScanText className="size-3" />OCR</TabsTrigger>
              <TabsTrigger value="ai" className="gap-1 px-1 text-[10px] font-mono"><BrainCircuit className="size-3" />AI</TabsTrigger>
              <TabsTrigger value="rapor" className="gap-1 px-1 text-[10px] font-mono"><FileDown className="size-3" />RAPOR</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <TabsContent value="bant" className="mt-0">
                  <SpectralPanel params={params} onChange={changeParams} />
                </TabsContent>
                <TabsContent value="islem" className="mt-0">
                  <ProcessPanel params={params} onChange={changeParams} />
                </TabsContent>
                <TabsContent value="karalama" className="mt-0">
                  <RecoveryPanel original={srcImg} region={region}
                    ocrText={ocrResults[0]?.text ?? ''} onApply={handleApplyRecovery}
                    onLivePreview={setLivePreview} />
                </TabsContent>
                <TabsContent value="silme" className="mt-0">
                  <ErasurePanel original={srcImg} region={region}
                    ocrText={ocrResults[0]?.text ?? ''} onApply={handleApplyRecovery}
                    onLivePreview={setLivePreview} />
                </TabsContent>
                <TabsContent value="ocr" className="mt-0">
                  <OcrPanel processed={processed?.out ?? null} original={srcImg}
                    region={region} onBoxes={onBoxes} />
                </TabsContent>
                <TabsContent value="ai" className="mt-0">
                  <AiPanel original={srcImg} processed={processed?.out ?? null}
                    bandLabel={`${band.name} (${band.nm})`} ocrText={ocrResults[0]?.text ?? ''} />
                </TabsContent>
                <TabsContent value="rapor" className="mt-0">
                  <ReportPanel processed={processed?.out ?? null} original={srcImg} params={params}
                    imageInfo={`${imgName} · ${srcImg.width}×${srcImg.height}`} />
                </TabsContent>
            </div>
          </Tabs>
        </aside>
      </main>

      <Footer
        imageInfo={srcImg ? `${imgName} · ${srcImg.width}×${srcImg.height}px` : ''}
        extra={examiner ? `İNCELEYEN: ${examiner.toUpperCase()}` : 'İNCELEYEN: —'}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />
      <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen}
        onCapture={(url) => loadFromDataUrl(url, 'kamera_cekim.jpg')} />
    </div>
  );
}

/* ---------------- ortak parçalar ---------------- */

function Header({
  onCamera, onUpload, onDemo, compact = false,
}: {
  onCamera: () => void;
  onUpload: () => void;
  onDemo: () => void;
  compact?: boolean;
}) {
  const caseNo = useCaseStore((s) => s.caseNo);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-2.5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="İzSürücü" className="size-9 rounded-md border border-border object-cover" />
          <div>
            <div className="font-mono text-sm font-bold tracking-widest text-foreground">
              İz<span className="text-sky-400">Sürücü</span>
            </div>
            <div className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
              ADLİ BELGE İNCELEME KONSOLU · REV 9.2
            </div>
          </div>
        </div>

        {!compact && (
          <div className="hidden items-center gap-2 md:flex">
            <Badge variant="outline" className="border-border font-mono text-[10px] text-muted-foreground">
              VAKA {caseNo}
            </Badge>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={onCamera} className="h-9 gap-1.5 bg-amber-600 font-semibold text-black hover:bg-amber-500">
            <Camera className="size-4" /> Kamera
          </Button>
          <Button size="sm" variant="outline" onClick={onUpload} className="h-9 gap-1.5">
            <Upload className="size-4" /> Yükle
          </Button>
          <Button size="sm" variant="ghost" onClick={onDemo} className="hidden h-9 gap-1.5 text-muted-foreground sm:inline-flex">
            <FlaskConical className="size-4" /> Örnek Vaka
          </Button>
        </div>
      </div>
    </header>
  );
}

function Footer({ imageInfo, extra, className }: { imageInfo?: string; extra?: string; className?: string }) {
  return (
    <footer className={`border-t border-border bg-black/40 pb-[env(safe-area-inset-bottom)] ${className ?? ''}`}>
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-1 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-2 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
          SİSTEM HAZIR
        </span>
        {imageInfo && <span>GÖRÜNTÜ: {imageInfo.toUpperCase()}</span>}
        {extra && <span>{extra}</span>}
        <span className="ml-auto hidden sm:inline">
          SANAL SPEKTRAL BANTLAR · TESSERACT OCR · AI ADLİ ANALİZ — EĞİTİM/ÖN İNCELEME AMAÇLI
        </span>
      </div>
    </footer>
  );
}
