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
import { cn } from '@/lib/utils';
import {
  Camera, Upload, Fingerprint, ScanText, BrainCircuit,
  FileDown, Radar, RotateCw, Download, SplitSquareHorizontal, Columns2,
  Square, Loader2, ShieldAlert, Contrast, Landmark, Wand2, Eraser, Compass,
  Scissors, Undo2, FlaskConical, Sparkles, Video,
  GitCompareArrows, ShieldCheck, Ruler, FileText, Info,
  type LucideIcon,
} from 'lucide-react';
import { ImageViewer, type CropRect, type OcrBox } from '@/components/forensic/viewer';
import { SpectralPanel, ProcessPanel } from '@/components/forensic/panels';
import { OcrPanel } from '@/components/forensic/ocr-panel';
import { AiPanel } from '@/components/forensic/ai-panel';
import { ReportPanel } from '@/components/forensic/report-panel';
import { RecoveryPanel } from '@/components/forensic/recovery-panel';
import { ErasurePanel } from '@/components/forensic/erasure-panel';
import { LabPanel } from '@/components/forensic/lab-panel';
import { DirectionPanel } from '@/components/forensic/direction-panel';
import { EnhancementPanel } from '@/components/forensic/enhancement-panel';
import { VideoPanel, VideoStage, useVideoStudio } from '@/components/forensic/video-panel';
import { ComparePanel } from '@/components/forensic/compare-panel';
import { EvidencePanel } from '@/components/forensic/evidence-panel';
import { MeasurePanel } from '@/components/forensic/measure-panel';
import { AnnotLiveSync } from '@/components/forensic/annot-live-sync';
import { ExhibitBar } from '@/components/forensic/exhibit-bar';
import { PdfPagePicker } from '@/components/forensic/pdf-page-picker';
import { CameraCapture } from '@/components/forensic/camera-modal';
import {
  DEFAULT_PARAMS, getBand, processPipeline, scanAnomalies,
  type AnomalyRegion, type Params,
} from '@/lib/forensic/pipeline';
import { histogram, mixToGray, type Rect } from '@/lib/forensic/filters';
import { dataUrlToImageData, imageDataToDataUrl, downloadDataUrl } from '@/lib/forensic/canvas';
import { useCaseStore, paramsSummary, LIVE_ANNOT_SNAPSHOT_ID } from '@/lib/forensic/store';
import { sha256OfDataUrl } from '@/lib/forensic/hash';

const WORKING_MAX = 1800;

/** Aktif sekmenin tek satırlık açıklaması — sekme çubuğunun altında gösterilir. */
const TAB_HINTS: Record<string, string> = {
  bant: 'UV/IR sanal ışık bantları ve adli reçeteler — inceleme ışığını seçin.',
  islem: 'Ton, kontrast, eğik ışık ve eşikleme — görüntüyü netleştirin.',
  yon: 'Çizgi yönü taraması — girinti ve karalama yapılarının yönünü bulun.',
  karalama: 'Karalanmış yazının altını 26 teknikle ortaya çıkarır.',
  silme: 'Kimyasal silme kalıntılarını görünür kılar.',
  lab: 'Gerçek laboratuvar teknikleri: UV florisans, IR lüminesans, ESDA girinti, CLAHE, kanal ayrıştırma.',
  iyilestir: 'İyileştirme stüdyosu — fotoğraf/resim estetiği: pozlama, renk, gölge/ışık, detay; OTOMATİK İYİLEŞTİR tek tuşla dengeler.',
  video: 'Video iyileştirme stüdyosu — oynatım sırasında her kare canlı iyileştirilir; KAYDET ile WEBM indirilir.',
  karsilastir: 'Karşılaştırma stüdyosu — iki delili fark haritası, göz kırpma ve süpürmeyle imza/senet/mühür karşılaştırması.',
  delil: 'Delil bütünlüğü (SHA-256), üst veri/EXIF yazılım izleri, barkod/QR okuma ve denetim izi.',
  arac: 'Ölçüm ve işaretleme — cetvel (mm kalibrasyonu), açı, ok/daire işaretleme; rapora gömülür.',
  ocr: 'Metni makineyle okur — bölge seçerek isabeti artırın.',
  ai: 'YZ adli analiz: bulgular, mürekkep farkları, silme şüphesi.',
  rapor: 'Vaka bilgileri, anlık görüntüler ve resmî PDF rapor.',
};

/** Sekme çubuğu grupları — sol mini etiket + ilişkili sekmeler (düzenli, taranabilir düzen). */
const TAB_GROUPS: {
  label: string;
  items: { v: string; name: string; icon: LucideIcon; accent: string }[];
}[] = [
  {
    label: 'İNCELEME',
    items: [
      { v: 'bant', name: 'BANT', icon: Radar, accent: 'text-amber-400' },
      { v: 'islem', name: 'İŞLEM', icon: Contrast, accent: 'text-amber-300' },
      { v: 'yon', name: 'YÖN', icon: Compass, accent: 'text-sky-400' },
    ],
  },
  {
    label: 'TAHRİP İZİ',
    items: [
      { v: 'karalama', name: 'KARALAMA', icon: Wand2, accent: 'text-amber-500' },
      { v: 'silme', name: 'SİLME', icon: Eraser, accent: 'text-violet-400' },
      { v: 'lab', name: 'LAB', icon: FlaskConical, accent: 'text-cyan-400' },
    ],
  },
  {
    label: 'STÜDYO',
    items: [
      { v: 'iyilestir', name: 'İYİLEŞTİR', icon: Sparkles, accent: 'text-sky-400' },
      { v: 'video', name: 'VİDEO', icon: Video, accent: 'text-emerald-400' },
      { v: 'karsilastir', name: 'KARŞILAŞTIR', icon: GitCompareArrows, accent: 'text-rose-400' },
    ],
  },
  {
    label: 'DELİL·ÖLÇÜM',
    items: [
      { v: 'delil', name: 'DELİL', icon: ShieldCheck, accent: 'text-fuchsia-400' },
      { v: 'arac', name: 'ARAÇLAR', icon: Ruler, accent: 'text-indigo-300' },
    ],
  },
  {
    label: 'OKUMA·RAPOR',
    items: [
      { v: 'ocr', name: 'OCR', icon: ScanText, accent: 'text-emerald-300' },
      { v: 'ai', name: 'YZ', icon: BrainCircuit, accent: 'text-amber-400' },
      { v: 'rapor', name: 'RAPOR', icon: FileDown, accent: 'text-sky-300' },
    ],
  },
];

/** Gruplu sekme kapsülü — aktif durum amber kapsül + siyah yazı + amber halka, net ve görünür.
 *  Not: dark: varyantları bilinçli olarak çift yazıldı — shadcn taban sınıfının
 *  dark:data-[state=active]:bg-input/30 ve text-foreground varsayılanlarını tailwind-merge
 *  ile düşürüp amber temayı garantilemek için. */
const TAB_PILL_CLS =
  'flex-none h-7 gap-1.5 rounded-md border border-transparent px-2.5 font-mono text-[11px] font-semibold tracking-wide text-muted-foreground hover:border-border hover:bg-card hover:text-foreground data-[state=active]:border-amber-600/70 dark:data-[state=active]:border-amber-600/70 data-[state=active]:bg-amber-600 dark:data-[state=active]:bg-amber-600 data-[state=active]:text-black dark:data-[state=active]:text-black data-[state=active]:ring-2 data-[state=active]:ring-amber-500/40 dark:data-[state=active]:ring-amber-500/40';

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
  const [appliedMode, setAppliedMode] = useState<'' | 'recovery' | 'enhance' | 'compare'>('');
  const [activeTab, setActiveTab] = useState('bant');
  // delil kimliği — orijinal dosyanın ham baytlarının SHA-256 özeti
  const [srcDataUrl, setSrcDataUrl] = useState('');
  const [srcSha, setSrcSha] = useState('');
  const [srcBytes, setSrcBytes] = useState(0);
  // çok sayfalı PDF içe aktarma
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  // inceleme varyantı kesme modu
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropUndo, setCropUndo] = useState<ImageData | null>(null);
  // işaretleme taşıma modu — büyük ekranda uçlar sürüklenerek ayarlanır (REV 9.9)
  const [annotEdit, setAnnotEdit] = useState(false);

  /** Taşıma modu düğmesi — açılırken OCR bölge seçimini kapat (çakışmasın). */
  const toggleAnnotEdit = useCallback((on: boolean) => {
    setAnnotEdit(on);
    if (on) setSelectMode(false);
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const caseNo = useCaseStore((s) => s.caseNo);
  const examiner = useCaseStore((s) => s.examiner);
  const ocrResults = useCaseStore((s) => s.ocrResults);
  const addAudit = useCaseStore((s) => s.addAudit);
  const annotations = useCaseStore((s) => s.annotations);
  const pxPerMm = useCaseStore((s) => s.pxPerMm);
  const setAnnotations = useCaseStore((s) => s.setAnnotations);
  const setPxPerMm = useCaseStore((s) => s.setPxPerMm);
  const removeSnapshot = useCaseStore((s) => s.removeSnapshot);
  const setMetaNotes = useCaseStore((s) => s.setMetaNotes);
  const band = getBand(params.band);
  const video = useVideoStudio(toast);

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
        setAppliedMode('');
        setLivePreview(null);
        setCropMode(false);
        setCropRect(null);
        setCropUndo(null);
        setAnnotEdit(false);
        setSrcDataUrl(url);
        setAnnotations([]); // yeni delil — eski işaretlemeler geçersiz
        setPxPerMm(null); // kalibrasyon belgeye özgüdür — yeni delilde sıfır
        removeSnapshot(LIVE_ANNOT_SNAPSHOT_ID); // bayat canlı kayıt silinir
        setMetaNotes([]); // eski EXIF notları temiz
        setSrcSha('');
        setSrcBytes(0);
        toast({ title: 'Görüntü yüklendi', description: `${img.width}×${img.height} px — incelemeye hazır` });
        // delil kimliği — ham baytların SHA-256 özeti (denetim izine)
        const { hex, bytes } = await sha256OfDataUrl(url);
        setSrcSha(hex);
        setSrcBytes(bytes);
        addAudit('DELİL YÜKLEME', `${name || 'belge.png'} · ${bytes} bayt · SHA-256 ${hex.slice(0, 16)}…`);
      } catch (e) {
        toast({ title: 'Görüntü okunamadı', description: (e as Error).message, variant: 'destructive' });
      }
    },
    [toast, addAudit, setAnnotations, setPxPerMm, removeSnapshot, setMetaNotes]
  );

  const loadFile = useCallback(
    (file: File) => {
      if (file.type.startsWith('video/')) {
        video.loadFile(file);
        setActiveTab('video');
        return;
      }
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        setPdfFile(file);
        setPdfOpen(true);
        return;
      }
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Desteklenmeyen dosya', description: 'Lütfen bir görsel, video veya PDF dosyası seçin.', variant: 'destructive' });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => loadFromDataUrl(reader.result as string, file.name);
      reader.readAsDataURL(file);
    },
    [loadFromDataUrl, toast, video]
  );

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
    if (!srcImg || appliedMode) return; // uygulanan varyant aktifken (recovery/enhance) pipeline çalışmaz
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
  }, [srcImg, params, appliedMode]);

  /* ---------------- karalama inceleme ---------------- */
  const changeParams = useCallback((p: Partial<Params>) => {
    setAppliedMode(''); // panel ayarı değişince uygulanan varyant geçersiz
    setCropMode(false);
    setCropRect(null);
    setCropUndo(null);
    setParams((s) => ({ ...s, ...p }));
  }, []);

  const handleApplyRecovery = useCallback((out: ImageData, label: string) => {
    const g = mixToGray(out, [0.299, 0.587, 0.114]);
    setProcessed({ out, hist: histogram(g), ms: 0 });
    setAppliedMode('recovery');
    setCropMode(false);
    setCropRect(null);
    setCropUndo(null);
    setLivePreview(null); // taahhüt edildi — canlı katmanı kapat, tam çözünürlüğü göster
    addAudit('VARYANT UYGULA', label || 'karalama/silme/lab tekniği');
  }, [addAudit]);

  /* ---------------- iyileştirme stüdyosu ---------------- */
  const handleApplyEnhance = useCallback((out: ImageData, _label: string) => {
    const g = mixToGray(out, [0.299, 0.587, 0.114]);
    setProcessed({ out, hist: histogram(g), ms: 0 });
    setAppliedMode('enhance');
    setCropMode(false);
    setCropRect(null);
    setCropUndo(null);
    setLivePreview(null);
    addAudit('İYİLEŞTİRME UYGULA', 'İyileştirme stüdyosu reçetesi ana görüntüye yazıldı');
    toast({
      title: 'İyileştirme uygulandı',
      description: 'Sonuç ana görüntüde. Karşılaştırma modlarıyla önce/sonra inceleyebilir, araç çubuğundaki ↓ ile indirebilirsiniz.',
    });
  }, [toast, addAudit]);

  /* ---------------- karşılaştırma stüdyosu ---------------- */
  const handleApplyCompare = useCallback((out: ImageData, label: string) => {
    const g = mixToGray(out, [0.299, 0.587, 0.114]);
    setProcessed({ out, hist: histogram(g), ms: 0 });
    setAppliedMode('compare');
    setCropMode(false);
    setCropRect(null);
    setCropUndo(null);
    setLivePreview(null);
    addAudit('FARK HARİTASI UYGULA', label || 'iki delil karşılaştırması');
  }, [addAudit]);

  /* ---------------- inceleme varyantı kesme ---------------- */
  const enterCrop = useCallback(() => {
    if (!processed) return;
    setSelectMode(false);
    setLivePreview(null);
    // varsayılan çerçeve: görüntünün %80'i, merkezde
    setCropRect({
      x: processed.out.width * 0.1,
      y: processed.out.height * 0.1,
      w: processed.out.width * 0.8,
      h: processed.out.height * 0.8,
    });
    setCropMode(true);
  }, [processed]);

  const exitCrop = useCallback(() => {
    setCropMode(false);
    setCropRect(null);
  }, []);

  const applyCrop = useCallback(() => {
    if (!processed || !cropRect) return;
    const src = processed.out;
    const x0 = Math.max(0, Math.min(src.width - 8, Math.round(cropRect.x)));
    const y0 = Math.max(0, Math.min(src.height - 8, Math.round(cropRect.y)));
    const cw = Math.max(8, Math.min(src.width - x0, Math.round(cropRect.w)));
    const ch = Math.max(8, Math.min(src.height - y0, Math.round(cropRect.h)));
    const out = new ImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      const sp = ((y0 + y) * src.width + x0) * 4;
      out.data.set(src.data.subarray(sp, sp + cw * 4), y * cw * 4);
    }
    setCropUndo(src);
    setProcessed({ out, hist: histogram(mixToGray(out, [0.299, 0.587, 0.114])), ms: 0 });
    setCropMode(false);
    setCropRect(null);
    toast({
      title: `Görüntü kesildi: ${cw}×${ch} px`,
      description: 'İnceleme varyantı güncellendi — GERİ AL ile eski hâline dönebilirsiniz.',
    });
  }, [processed, cropRect, toast]);

  const undoCrop = useCallback(() => {
    if (!cropUndo || !processed) return;
    setProcessed({ out: cropUndo, hist: histogram(mixToGray(cropUndo, [0.299, 0.587, 0.114])), ms: 0 });
    setCropUndo(null);
    toast({
      title: 'Kesme geri alındı',
      description: `${cropUndo.width}×${cropUndo.height} px görüntü restore edildi.`,
    });
  }, [cropUndo, processed, toast]);

  /* ---------------- anomali taraması ---------------- */
  const runScan = useCallback(() => {
    if (!srcImg) return;
    setScanning(true);
    setTimeout(() => {
      const regions = scanAnomalies(srcImg);
      setAnomalies(regions);
      setShowAnomalies(true);
      setScanning(false);
      addAudit('ANOMALİ TARAMASI', regions.length ? `${regions.length} şüpheli bölge` : 'anomali bulunamadı');
      toast({
        title: regions.length ? `${regions.length} şüpheli bölge işaretlendi` : 'Anomali bulunamadı',
        description: regions.length
          ? 'Spektral tutarlılık taraması bantlar arası sapmaları ölçtü. Kırmızı kutuları inceleyin.'
          : 'Bantlar arası tutarlı görünüyor; yine de manuel bant incelemesi önerilir.',
      });
    }, 30);
  }, [srcImg, toast, addAudit]);

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
    setAppliedMode('');
    setLivePreview(null);
    setCropMode(false);
    setCropRect(null);
    setCropUndo(null);
  };

  const exportPng = () => {
    if (!processed) return;
    const url = imageDataToDataUrl(processed.out, 4096, 0.95, 'image/png');
    downloadDataUrl(url, `${imgName.replace(/\.[^.]+$/, '')}_${band.id}.png`);
    addAudit('GÖRÜNTÜ İNDİR', `${band.name} modu PNG`);
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
    : appliedMode === 'recovery'
      ? `MOD: İNCELEME VARYANTI · ${processed ? `${processed.out.width}×${processed.out.height} PX` : 'TAM ÇÖZÜNÜRLÜK'} · KURTARMA ATÖLYESİ`
      : appliedMode === 'compare'
        ? `MOD: İNCELEME VARYANTI · FARK HARİTASI · ${processed ? `${processed.out.width}×${processed.out.height} PX` : ''}`
      : appliedMode === 'enhance'
        ? `MOD: İYİLEŞTİRME STÜDYOSU · UYGULANMIŞ GÖRÜNTÜ · ${processed ? `${processed.out.width}×${processed.out.height} PX` : 'TAM ÇÖZÜNÜRLÜK'}`
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
          onPdf={() => fileInputRef.current?.click()}
          compact />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
          <div className="text-center">
            <div className="mb-3 flex items-center justify-center gap-2 font-mono text-[11px] tracking-[0.3em] text-amber-600">
              <ShieldAlert className="size-4" /> ADLİ BELGE İNCELEME KONSOLU
            </div>
            <img src="/logo.png" alt="İzSürücü logosu"
              className="mx-auto mb-4 size-24 rounded-2xl border border-border object-cover shadow-lg" />
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              İz<span className="text-sky-400">Sürücü</span>
            </h1>
            <p className="mt-2 text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
              Belgenin fotoğrafını çekin; UV ve kızılötesi sanal bantlarla kimyasal silme ve
              tahrip izlerini görünür kılın, yerleşik OCR ile yazıyı okuyun, yapay zekâ adli
              analiz raporu alın — kriminal laboratuvar iş akışı, tarayıcınızda. İyileştirme
              Stüdyosu ile fotoğraflarınızın pozlamasını, renklerini ve netliğini tek tuşla
              düzeltin. Taranmış PDF'leri sayfa sayfa açın; iki delili karşılaştırın; SHA-256 delil
              bütünlüğü, EXIF yazılım izleri, barkod/QR okuma ve ölçüm araçlarıyla resmî raporu
              güçlendirin.
            </p>
          </div>

          <div
            className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragOver ? 'border-amber-500 bg-amber-950/20' : 'border-border bg-card/40'
            }`}
          >
            <Fingerprint className="size-10 text-amber-600" />
            <p className="text-sm text-muted-foreground">
              Belge fotoğrafını veya videoyu buraya <span className="text-foreground font-semibold">sürükleyip bırakın</span>,
              dosya seçin veya kamera ile çekin
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => setCameraOpen(true)} className="h-11 gap-2 bg-amber-600 font-semibold text-black hover:bg-amber-500">
                <Camera className="size-4" /> Kamera ile Çek
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="h-11 gap-2">
                <Upload className="size-4" /> Dosya Yükle
              </Button>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground/70">
              PANODAN GÖRSEL YAPIŞTIRMA (CTRL+V) · VİDEO VE ÇOK SAYFALI PDF DOSYALARI DESTEKLENİR
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
                desc: 'CLAHE, Sauvola/Otsu eşikleme, eğik ışık girinti taraması, sahte renk yoğunluk haritaları.',
              },
              {
                icon: BrainCircuit, title: 'OCR + YZ Analizi',
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
          accept="image/*,video/*,application/pdf,.pdf"
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
        onPdf={() => fileInputRef.current?.click()}
      />

      <ExhibitBar
        activeName={imgName}
        currentDataUrl={srcDataUrl}
        onLoad={(url, name) => loadFromDataUrl(url, name)}
      />

      <main className="grid flex-1 grid-cols-1 gap-0 lg:flex-none lg:grid-cols-[minmax(0,1fr)_410px] lg:h-[calc(100vh_-_125px)] lg:overflow-hidden">
        {/* görüntüleyici + araç çubuğu */}
        <section className="flex flex-col border-b border-border lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r">
          {activeTab === 'video' ? (
            <VideoStage studio={video} />
          ) : (
            <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Badge variant="outline" className="gap-1.5 border-amber-600/50 font-mono text-[10px] text-amber-500">
              <Landmark className="size-3" /> {appliedMode === 'recovery' ? 'İnceleme Varyantı · KURTARMA' : appliedMode === 'compare' ? 'İnceleme Varyantı · FARK HARİTASI' : appliedMode === 'enhance' ? 'İyileştirme Stüdyosu · UYGULANDI' : `${band.name} · ${band.nm}`}
            </Badge>
            {processing && (
              <Badge variant="outline" className="gap-1 border-emerald-700/50 font-mono text-[10px] text-emerald-400">
                <Loader2 className="size-3 animate-spin" /> İŞLENİYOR
              </Badge>
            )}
            {/* sağ buton grubu — mobilde sarmalanabilir (kesme/anomali butonları
                genişleyince 390px'te ekranı taşırıyordu) */}
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
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
              {appliedMode && processed && (
                <Button size="sm" variant={cropMode ? 'default' : 'outline'}
                  onClick={() => (cropMode ? exitCrop() : enterCrop())}
                  className={`h-8 gap-1.5 font-mono text-[10px] ${cropMode ? 'bg-amber-600 text-black hover:bg-amber-500' : 'border-sky-800/60 text-sky-300 hover:bg-sky-950/40'}`}>
                  <Scissors className="size-3.5" />
                  {cropMode ? 'KESME MODU AÇIK' : 'GÖRÜNTÜYÜ KES'}
                </Button>
              )}
              {appliedMode && processed && cropUndo && (
                <Button size="sm" variant="outline" onClick={undoCrop}
                  className="h-8 gap-1.5 border-sky-800/60 font-mono text-[10px] text-sky-300 hover:bg-sky-950/40">
                  <Undo2 className="size-3.5" /> GERİ AL
                </Button>
              )}
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
          <div className="relative h-[56dvh] lg:h-auto lg:min-h-0 lg:flex-1">
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
              onSelectMode={(v) => { setSelectMode(v); if (v) setAnnotEdit(false); }}
              annotations={annotations}
              pxPerMm={pxPerMm}
              annotEdit={annotEdit}
              onAnnotEdit={toggleAnnotEdit}
              onAnnotationsChange={setAnnotations}
              region={region}
              onRegionDone={setRegion}
              boxes={boxes ?? []}
              showBoxes={!!boxes && compareMode !== 'side'}
              anomalies={anomalies}
              showAnomalies={showAnomalies}
              cropMode={cropMode}
              cropRect={cropRect}
              onCropRect={setCropRect}
            />
            {/* canlı işaretleme kaydı — sekmelerden bağımsız her değişimi yakalar (REV 9.10) */}
            <AnnotLiveSync image={processed?.out ?? srcImg} />
            {/* kesme kontrol çubuğu — görüntüleyici üzerinde yüzer */}
            {cropMode && cropRect && (
              <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center px-2">
                <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border border-amber-700/70 bg-black/90 px-2.5 py-2 backdrop-blur-sm">
                  <span className="flex items-center gap-1 font-mono text-[10px] font-semibold tracking-wider text-amber-500">
                    <Scissors className="size-3.5" /> KESME ALANI
                  </span>
                  {([['X', 'x'], ['Y', 'y'], ['G', 'w'], ['E', 'h']] as const).map(([lab, key]) => (
                    <label key={key} className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      {lab}
                      <input
                        type="number"
                        className="h-7 w-16 rounded border border-border bg-card px-1.5 text-[11px] text-foreground"
                        value={Math.round(cropRect[key])}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value) || 0);
                          if (!processed) return;
                          const iw = processed.out.width;
                          const ihh = processed.out.height;
                          const r = { ...cropRect };
                          if (key === 'x') r.x = Math.max(0, Math.min(iw - 8, v));
                          if (key === 'y') r.y = Math.max(0, Math.min(ihh - 8, v));
                          if (key === 'w') r.w = Math.max(8, Math.min(iw - r.x, v));
                          if (key === 'h') r.h = Math.max(8, Math.min(ihh - r.y, v));
                          setCropRect(r);
                        }}
                      />
                    </label>
                  ))}
                  <Button size="sm" onClick={applyCrop}
                    className="h-7 bg-emerald-600 px-2.5 font-mono text-[10px] font-bold text-black hover:bg-emerald-500">
                    KES
                  </Button>
                  <Button size="sm" variant="outline" onClick={undoCrop} disabled={!cropUndo}
                    className="h-7 px-2.5 font-mono text-[10px]">
                    GERİ AL
                  </Button>
                  <Button size="sm" variant="ghost" onClick={exitCrop}
                    className="h-7 px-2.5 font-mono text-[10px] text-red-400 hover:text-red-300">
                    İPTAL
                  </Button>
                </div>
              </div>
            )}
          </div>
            </>
          )}
        </section>

        {/* kontrol paneli */}
        <aside className="flex min-h-0 flex-col">
          <Tabs defaultValue="bant" onValueChange={(v) => { setActiveTab(v); if (v !== 'video') video.pausePlayback(); }} className="flex h-full min-h-0 flex-col">
            <TabsList className="mx-2 mt-2 flex h-auto w-auto shrink-0 flex-col items-stretch gap-1 rounded-lg border border-border/60 bg-card/70 p-1.5 shadow-sm">
              {TAB_GROUPS.map((grp) => (
                <div key={grp.label} className="flex items-center gap-1.5">
                  <span className="w-[74px] shrink-0 select-none text-right font-mono text-[8px] font-bold tracking-[0.14em] text-muted-foreground/60">
                    {grp.label}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {grp.items.map((t) => (
                      <TabsTrigger key={t.v} value={t.v} className={TAB_PILL_CLS}>
                        <t.icon className={cn('size-3.5', t.accent)} />
                        {t.name}
                      </TabsTrigger>
                    ))}
                  </div>
                </div>
              ))}
            </TabsList>
            <div className="mx-2 mt-1.5 flex shrink-0 items-start gap-1.5 rounded-md border border-border/50 bg-card/40 px-2 py-1.5">
              <Info className="mt-0.5 size-3 shrink-0 text-amber-500" />
              <p className="line-clamp-2 font-mono text-[9px] leading-relaxed text-muted-foreground/90">
                {TAB_HINTS[activeTab] ?? ''}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <TabsContent value="bant" className="mt-0">
                  <SpectralPanel params={params} onChange={changeParams} />
                </TabsContent>
                <TabsContent value="islem" className="mt-0">
                  <ProcessPanel params={params} onChange={changeParams} />
                </TabsContent>
                <TabsContent value="yon" className="mt-0">
                  <DirectionPanel original={srcImg} onLivePreview={setLivePreview}
                    onApplyLighting={(a) => changeParams({ rakeOn: true, rakeAngle: (90 - a + 360) % 360 })} />
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
                <TabsContent value="lab" className="mt-0">
                  <LabPanel original={srcImg} onApply={handleApplyRecovery}
                    onLivePreview={setLivePreview} />
                </TabsContent>
                <TabsContent value="iyilestir" className="mt-0">
                  <EnhancementPanel original={srcImg} onApply={handleApplyEnhance}
                    onLivePreview={setLivePreview} />
                </TabsContent>
                <TabsContent value="video" className="mt-0">
                  <VideoPanel studio={video} />
                </TabsContent>
                <TabsContent value="karsilastir" className="mt-0">
                  <ComparePanel original={srcImg} onApply={handleApplyCompare} />
                </TabsContent>
                <TabsContent value="delil" className="mt-0">
                  <EvidencePanel srcDataUrl={srcDataUrl} srcSha={srcSha}
                    srcBytes={srcBytes} srcImg={srcImg}
                    imageInfo={`${imgName} · ${srcImg.width}×${srcImg.height}`} />
                </TabsContent>
                <TabsContent value="arac" className="mt-0">
                  <MeasurePanel image={processed?.out ?? srcImg} />
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
                    imageInfo={`${imgName} · ${srcImg.width}×${srcImg.height}`}
                    srcSha={srcSha} srcBytes={srcBytes} />
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
        accept="image/*,application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />
      <PdfPagePicker file={pdfFile} open={pdfOpen} onOpenChange={setPdfOpen}
        onPick={(url, name) => loadFromDataUrl(url, name)} />
      <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen}
        onCapture={(url) => loadFromDataUrl(url, 'kamera_cekim.jpg')} />
    </div>
  );
}

/* ---------------- ortak parçalar ---------------- */

function Header({
  onCamera, onUpload, onPdf, compact = false,
}: {
  onCamera: () => void;
  onUpload: () => void;
  onPdf: () => void;
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
              ADLİ BELGE İNCELEME KONSOLU · REV 9.9
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
          <Button size="sm" variant="outline" onClick={onPdf} className="h-9 gap-1.5">
            <FileText className="size-4" /> PDF
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
          SANAL SPEKTRAL BANTLAR · TESSERACT OCR · YZ ADLİ ANALİZ — EĞİTİM/ÖN İNCELEME AMAÇLI
        </span>
      </div>
    </footer>
  );
}
