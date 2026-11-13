'use client';

/**
 * VİDEO İYİLEŞTİRME STÜDYOSU
 * İyileştirme Stüdyosu'nun (enhance.ts) reçetesini video karelerine uygular:
 *  - Kare çekiş: <video> → çekiş tuvali (LIVE_MAX'a ölçekli) → ImageData →
 *    applyEnhancement → görünür sahne tuvali. Oynatım sürerken rAF döngüsü
 *    her yeni kareyi canlı işler; duraklatıldığında yalnızca reçete
 *    değişince (dirty) tek kare yeniden hesaplanır.
 *  - OTOMATİK İYİLEŞTİR: geçerli kareden histogram + gri dünya beyaz
 *    dengesi analiziyle dengeli reçete üretir (autoEnhance).
 *  - KAYDET (WEBM): export tuvali EXPORT_MAX boyutunda gerçek zamanlıda
 *    işlenir; canvas.captureStream + MediaRecorder ile kaydedilir, ses
 *    WebAudio dokunuşuyla akışa eklenmeye çalışılır. Kayıt sırasında sahne
 *    tuvaline aynı sonuç aktarılır — kullanıcı iyileştirmeyi canlı izler.
 * Tamamen tarayıcı içinde çalışır — AI anahtarı gerekmez.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import {
  Camera, Clapperboard, Download, Eye, Film, LoaderCircle, Pause, Play,
  RotateCcw, Sparkles, Volume2, VolumeX,
} from 'lucide-react';
import { downloadDataUrl } from '@/lib/forensic/canvas';
import {
  applyEnhancement, autoEnhance, isDefaultEnhance,
  DEFAULT_ENHANCE, ENHANCE_PRESETS, type EnhanceParams,
} from '@/lib/forensic/enhance';
import { EnhSlider, presetBtnCls } from '@/components/forensic/enhancement-panel';

/** Canlı önizleme işleme üst sınırı — akıcılık için kareler buraya ölçeklenir. */
const LIVE_MAX = 960;
/** Kayıt (WEBM) işleme üst sınırı. */
const EXPORT_MAX = 1280;

type ToastFn = ReturnType<typeof useToast>['toast'];

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '--:--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface AudioTap {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  dest: MediaStreamAudioDestinationNode;
}

/**
 * Video stüdyosunun tüm durumu ve motoru. Sahne (VideoStage) ile kontrol
 * paneli (VideoPanel) bu tek API'yi paylaşır.
 */
export function useVideoStudio(toast: ToastFn) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<{ name: string; width: number; height: number; duration: number } | null>(null);
  const [params, setParams] = useState<EnhanceParams>(DEFAULT_ENHANCE);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showOriginal, setShowOriginalState] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [fps, setFps] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLCanvasElement | null>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioRef = useRef<AudioTap | null>(null);
  const recRef = useRef<{ recorder: MediaRecorder } | null>(null);
  const endedRef = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(true);
  const lastTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const fpsTsRef = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const showOrigRef = useRef(showOriginal);
  showOrigRef.current = showOriginal;

  /* ---------------- kare işleme ---------------- */
  const processFrame = useCallback((out: HTMLCanvasElement, maxDim: number, forceProcessed = false): boolean => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return false;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return false;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    if (!grabRef.current) grabRef.current = document.createElement('canvas');
    const g = grabRef.current;
    if (g.width !== w || g.height !== h) { g.width = w; g.height = h; }
    const gctx = g.getContext('2d', { willReadFrequently: true });
    if (!gctx) return false;
    gctx.drawImage(v, 0, 0, w, h);
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    const octx = out.getContext('2d');
    if (!octx) return false;
    if (showOrigRef.current && !forceProcessed) {
      octx.drawImage(g, 0, 0);
      return true;
    }
    const p = paramsRef.current;
    if (isDefaultEnhance(p)) {
      octx.drawImage(g, 0, 0);
      return true;
    }
    const src = gctx.getImageData(0, 0, w, h);
    const processed = applyEnhancement(src, p);
    octx.putImageData(processed, 0, 0);
    return true;
  }, []);

  /* ---------------- rAF canlı döngü ---------------- */
  const tickRef = useRef<() => void>(() => {});
  tickRef.current = () => {
    const v = videoRef.current;
    const stage = stageRef.current;
    if (!v || !stage) return;
    if (recRef.current) return; // kayıt sırasında sahneyi exportTick besler
    const active = !v.paused && !v.ended;
    if (active || dirtyRef.current) {
      const ok = processFrame(stage, LIVE_MAX);
      if (ok) {
        dirtyRef.current = false;
        if (active) {
          frameCountRef.current++;
          const now = performance.now();
          if (now - fpsTsRef.current > 500) {
            setFps(Math.round((frameCountRef.current * 1000) / (now - fpsTsRef.current)));
            frameCountRef.current = 0;
            fpsTsRef.current = now;
          }
        }
      }
    }
    if (Math.abs(v.currentTime - lastTimeRef.current) > 0.1) {
      lastTimeRef.current = v.currentTime;
      setCurrentTime(v.currentTime);
    }
  };

  useEffect(() => {
    if (!videoUrl) return;
    let id = 0;
    const step = () => { id = requestAnimationFrame(step); tickRef.current(); };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [videoUrl]);

  /* ---------------- kaynak temizliği ---------------- */
  const releaseSource = useCallback(() => {
    const prev = videoRef.current;
    if (prev) {
      prev.pause();
      prev.removeAttribute('src');
      prev.load();
      prev.remove();
      videoRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (audioRef.current) {
      try { audioRef.current.ctx.close(); } catch { /* yoksay */ }
      audioRef.current = null;
    }
    if (recRef.current) {
      try { recRef.current.recorder.stop(); } catch { /* yoksay */ }
      recRef.current = null;
    }
    setExporting(false);
    setPlaying(false);
  }, []);

  useEffect(() => () => releaseSource(), [releaseSource]);

  /* ---------------- yükleme ---------------- */
  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) {
      toast({ title: 'Desteklenmeyen dosya', description: 'Lütfen bir video dosyası seçin.', variant: 'destructive' });
      return;
    }
    releaseSource();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.preload = 'auto';
    // mobil tarayıcılar DOM-dışı videoyu oynatmayabilir — gövdeye görünmez eklenir
    v.setAttribute('playsinline', '');
    v.style.position = 'fixed';
    v.style.width = '1px';
    v.style.height = '1px';
    v.style.opacity = '0.01';
    v.style.pointerEvents = 'none';
    v.style.zIndex = '-1';
    v.addEventListener('loadedmetadata', () => {
      setInfo({
        name: file.name || 'video',
        width: v.videoWidth,
        height: v.videoHeight,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
      });
      dirtyRef.current = true;
      toast({ title: 'Video yüklendi', description: `${v.videoWidth}×${v.videoHeight} — VİDEO sekmesinde canlı iyileştirilir.` });
    });
    v.addEventListener('error', () => {
      toast({ title: 'Video açılamadı', description: 'Tarayıcınız bu video biçimini çözümleyemedi (MP4/WEBM deneyin).', variant: 'destructive' });
    });
    v.addEventListener('ended', () => setPlaying(false));
    document.body.appendChild(v);
    videoRef.current = v;
    setVideoUrl(url);
    setParams(DEFAULT_ENHANCE);
    setCurrentTime(0);
    lastTimeRef.current = 0;
    setFps(0);
    setExportPct(0);
    dirtyRef.current = true;
  }, [releaseSource, toast]);

  /* ---------------- oynatım kontrolleri ---------------- */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      void v.play().then(() => { setPlaying(true); dirtyRef.current = true; }).catch(() => {
        toast({ title: 'Oynatma başlatılamadı', description: 'Tarayıcı otomatik oynatmayı engelledi — düğmeyi yeniden deneyin.', variant: 'destructive' });
      });
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [toast]);

  const pausePlayback = useCallback(() => {
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setPlaying(false);
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : t;
    v.currentTime = Math.max(0, Math.min(max, t));
    setCurrentTime(v.currentTime);
    lastTimeRef.current = v.currentTime;
    dirtyRef.current = true;
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  /* ---------------- reçete kalibrasyonu ---------------- */
  const setParam = useCallback((k: keyof EnhanceParams) => (val: number) => {
    setParams((s) => ({ ...s, [k]: val }));
    dirtyRef.current = true;
  }, []);

  const applyPreset = useCallback((_id: string, p: EnhanceParams) => {
    setParams({ ...p });
    dirtyRef.current = true;
  }, []);

  const reset = useCallback(() => {
    setParams(DEFAULT_ENHANCE);
    dirtyRef.current = true;
  }, []);

  const setShowOriginal = useCallback((on: boolean) => {
    showOrigRef.current = on;
    setShowOriginalState(on);
    dirtyRef.current = true;
  }, []);

  const runAuto = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      toast({ title: 'Kare hazırlanamadı', description: 'Video hazır olmadan otomatik iyileştirme hesaplanamaz.', variant: 'destructive' });
      return;
    }
    const tmp = document.createElement('canvas');
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    tmp.width = Math.max(2, Math.round(v.videoWidth * scale));
    tmp.height = Math.max(2, Math.round(v.videoHeight * scale));
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    if (!tctx) return;
    tctx.drawImage(v, 0, 0, tmp.width, tmp.height);
    const img = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const p = autoEnhance(img);
    setParams(p);
    dirtyRef.current = true;
    toast({ title: 'Otomatik iyileştirme hesaplandı', description: 'Geçerli kareden histogram ve beyaz dengesi analiz edildi. Kaydırıcılarla ince ayar yapabilirsiniz.' });
  }, [toast]);

  /* ---------------- sahne bağlama ---------------- */
  const bindStage = useCallback((c: HTMLCanvasElement | null) => {
    stageRef.current = c;
    if (c) dirtyRef.current = true;
  }, []);

  /* ---------------- kare PNG ---------------- */
  const grabFramePng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !stage.width) return;
    const url = stage.toDataURL('image/png');
    const base = (info?.name ?? 'kare').replace(/\.[^.]+$/, '') || 'kare';
    downloadDataUrl(url, `${base}_kare.png`);
    toast({ title: 'Kare indirildi', description: 'İyileştirilmiş kare PNG olarak kaydedildi.' });
  }, [info, toast]);

  /* ---------------- WEBM kaydı ---------------- */
  const cancelExport = useCallback(() => {
    const v = videoRef.current;
    if (v) v.pause();
    setPlaying(false);
    const rec = recRef.current;
    if (rec && rec.recorder.state !== 'inactive') {
      try { rec.recorder.stop(); } catch { /* yoksay */ }
    }
    recRef.current = null;
    dirtyRef.current = true;
  }, []);

  const exportWebm = useCallback(() => {
    const v = videoRef.current;
    if (!v || !info || exporting || v.readyState < 2 || !v.videoWidth) return;
    const scale = Math.min(1, EXPORT_MAX / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round(v.videoWidth * scale));
    const h = Math.max(2, Math.round(v.videoHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    let stream: MediaStream;
    try {
      stream = c.captureStream(30);
    } catch {
      toast({ title: 'Kayıt başlatılamadı', description: 'Tarayıcınız tuval kaydını desteklemiyor.', variant: 'destructive' });
      return;
    }
    // ses — WebAudio dokunuşuyla akışa eklenir (kullanıcı jesti içinde)
    try {
      if (!audioRef.current) {
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(v);
        const dest = ctx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(ctx.destination);
        audioRef.current = { ctx, source, dest };
      } else if (audioRef.current.ctx.state === 'suspended') {
        void audioRef.current.ctx.resume();
      }
      audioRef.current.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      v.muted = false;
      setMuted(false);
    } catch { /* ses desteklenmiyor — sessiz kayıt */ }
    const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = mimes.find((m) => {
      try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
    }) ?? '';
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    } catch {
      toast({ title: 'Kayıt desteklenmiyor', description: 'Bu tarayıcı video kaydını (MediaRecorder) desteklemiyor.', variant: 'destructive' });
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      recRef.current = null;
      setExporting(false);
      dirtyRef.current = true;
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      if (blob.size === 0) {
        toast({ title: 'Kayıt boş kaldı', description: 'Video çok kısa olmuş olabilir.', variant: 'destructive' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(info.name.replace(/\.[^.]+$/, '') || 'video')}_iyilestirilmis.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExportPct(100);
      toast({ title: 'Video kaydedildi', description: `İyileştirilmiş video (WEBM) indirildi — boyut: ${w}×${h}` });
    };
    if (endedRef.current) v.removeEventListener('ended', endedRef.current);
    const onEnded = () => {
      v.removeEventListener('ended', onEnded);
      endedRef.current = null;
      v.pause();
      setPlaying(false);
      if (recorder.state !== 'inactive') recorder.stop();
    };
    endedRef.current = onEnded;
    v.addEventListener('ended', onEnded);
    recRef.current = { recorder };
    setExporting(true);
    setExportPct(0);
    v.currentTime = 0;
    lastTimeRef.current = 0;
    setCurrentTime(0);
    const tick = () => {
      if (recRef.current?.recorder !== recorder) return;
      const ok = processFrame(c, EXPORT_MAX, true);
      const stage = stageRef.current;
      if (ok && stage) {
        if (stage.width !== c.width || stage.height !== c.height) { stage.width = c.width; stage.height = c.height; }
        const sctx = stage.getContext('2d');
        if (sctx) sctx.drawImage(c, 0, 0);
      }
      setExportPct(Math.min(99, Math.round((v.currentTime / (v.duration || 1)) * 100)));
      requestAnimationFrame(tick);
    };
    void v.play().then(() => {
      setPlaying(true);
      recorder.start(500);
      requestAnimationFrame(tick);
      toast({ title: 'Kayıt başladı', description: 'Video gerçek zamanlıda işleniyor; bitmesini bekleyin veya DURDUR ile kısmi kayıt alın.' });
    }).catch(() => {
      recRef.current = null;
      setExporting(false);
      toast({ title: 'Oynatma başlatılamadı', description: 'Kayıt için oynatma gerekli — düğmeyi yeniden deneyin.', variant: 'destructive' });
    });
  }, [exporting, info, processFrame, toast]);

  return {
    videoUrl, info, params, playing, muted, currentTime, showOriginal,
    exporting, exportPct, fps,
    loadFile, togglePlay, pausePlayback, seek, toggleMute,
    setParam, applyPreset, reset, setShowOriginal, runAuto,
    exportWebm, cancelExport, grabFramePng, bindStage,
  };
}

export type VideoStudioApi = ReturnType<typeof useVideoStudio>;

/* ================= SAHNE — canlı tuval + oynatıcı ================= */

export function VideoStage({ studio }: { studio: VideoStudioApi }) {
  const { videoUrl, info, playing, muted, currentTime, showOriginal, exporting, exportPct, fps, params } = studio;
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!videoUrl || !info) {
    return (
      <div
        className={`relative m-2 flex min-h-[52dvh] flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed text-center transition-colors lg:m-0 lg:min-h-0 lg:rounded-none ${
          dragOver ? 'border-emerald-500 bg-emerald-950/20' : 'border-border bg-card/40'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) studio.loadFile(f);
        }}
      >
        <Clapperboard className="size-10 text-emerald-500" />
        <p className="text-sm text-muted-foreground">
          Video dosyasını buraya <span className="font-semibold text-foreground">sürükleyip bırakın</span> veya seçin
        </p>
        <Button onClick={() => inputRef.current?.click()} variant="outline" className="h-11 gap-2">
          <Film className="size-4" /> Video Yükle
        </Button>
        <p className="font-mono text-[10px] text-muted-foreground/70">
          MP4 / WEBM / MOV — OYNATIM SIRASINDA HER KARE CANLI İYİLEŞTİRİLİR
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) studio.loadFile(f);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col lg:h-full">
      {/* üst bilgi çubuğu */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Badge variant="outline" className="gap-1.5 border-emerald-600/50 font-mono text-[10px] text-emerald-400">
          <Clapperboard className="size-3" /> {info.name.slice(0, 22)} · {info.width}×{info.height} · {fmtTime(info.duration)}
        </Badge>
        {!isDefaultEnhance(params) && !exporting && (
          <Badge variant="outline" className="gap-1 border-emerald-700/50 font-mono text-[10px] text-emerald-400">
            <LoaderCircle className="size-3 animate-spin" /> CANLI {fps > 0 ? `· ${fps} FPS` : ''}
          </Badge>
        )}
        {exporting && (
          <Badge variant="outline" className="gap-1 border-red-700/50 font-mono text-[10px] text-red-400">
            <LoaderCircle className="size-3 animate-spin" /> KAYIT · %{exportPct}
          </Badge>
        )}
        {showOriginal && (
          <Badge variant="outline" className="gap-1 border-amber-700/60 font-mono text-[10px] text-amber-400">
            ORİJİNAL GÖSTERİLİYOR
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={studio.grabFramePng}
            className="h-8 gap-1.5 border-sky-800/60 font-mono text-[10px] text-sky-300 hover:bg-sky-950/40">
            <Camera className="size-3.5" /> KARE PNG
          </Button>
        </div>
      </div>

      {/* tuval alanı + kontroller */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/70 h-[52dvh] lg:h-auto">
        <canvas ref={studio.bindStage} className="max-h-full max-w-full object-contain" />
        {exporting && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/40">
            <div className="h-full bg-red-500 transition-[width]" style={{ width: `${exportPct}%` }} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-black/85 px-3 py-2 backdrop-blur">
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={studio.togglePlay}
            aria-label={playing ? 'Duraklat' : 'Oynat'}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtTime(currentTime)}</span>
          <Slider
            min={0}
            max={Math.max(0.1, info.duration || 0.1)}
            step={0.05}
            value={[Math.min(currentTime, info.duration || 0.1)]}
            onValueChange={(vals) => studio.seek(vals[0] ?? 0)}
            className="min-w-[120px] flex-1"
          />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtTime(info.duration)}</span>
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={studio.toggleMute}
            aria-label={muted ? 'Sesi aç' : 'Sessize al'}>
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 select-none gap-1.5 border-amber-700/60 font-mono text-[10px] text-amber-400 hover:bg-amber-950/40"
            onPointerDown={() => studio.setShowOriginal(true)}
            onPointerUp={() => studio.setShowOriginal(false)}
            onPointerLeave={() => studio.setShowOriginal(false)}
            onPointerCancel={() => studio.setShowOriginal(false)}
            aria-label="Orijinali görmek için basılı tutun"
          >
            <Eye className="size-3.5" /> ORİJİNAL
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ================= PANEL — kontrol sekmesi ================= */

export function VideoPanel({ studio }: { studio: VideoStudioApi }) {
  const { videoUrl, info, params, exporting, exportPct } = studio;
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const set = (k: keyof EnhanceParams) => (v: number) => {
    setActivePreset(null);
    studio.setParam(k)(v);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="gap-1 border-emerald-800/60 font-mono text-[9px] text-emerald-400">
          <Clapperboard className="size-3" /> VİDEO İYİLEŞTİRME STÜDYOSU
        </Badge>
        {!isDefaultEnhance(params) && (
          <Badge variant="outline" className="gap-1 border-sky-800/60 font-mono text-[9px] text-sky-400">
            CANLI AKTİF
          </Badge>
        )}
      </div>

      {!videoUrl || !info ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Henüz video yüklenmedi. Sol taraftaki alana bir video dosyası sürükleyin veya Video Yükle düğmesini
          kullanın. Oynatım başladığında her kare seçtiğiniz reçeteyle canlı iyileştirilir.
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-mono text-[10px] text-foreground">{info.name}</span> · {info.width}×{info.height} ·{' '}
          {fmtTime(info.duration)}. Kaydırıcıları kalibre edin; değişiklikler oynatılan videoda anında görünür.
          <span className="text-foreground"> KAYDET</span>, videoyu baştan sona gerçek zamanlıda işleyip WEBM olarak
          indirir — kayıt sırasında sonuç sahnede canlı izlenir.
        </p>
      )}

      {/* otomatik + ön ayarlar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => { setActivePreset(null); studio.runAuto(); }} disabled={!videoUrl}
          className="h-8 gap-1.5 bg-emerald-600 font-semibold text-black hover:bg-emerald-500">
          <Sparkles className="size-3.5" /> OTOMATİK İYİLEŞTİR
        </Button>
        {ENHANCE_PRESETS.map((pr) => (
          <button key={pr.id} type="button"
            className={presetBtnCls(activePreset === pr.id)}
            onClick={() => { setActivePreset(pr.id); studio.applyPreset(pr.id, pr.p); }}>
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
        {exporting ? (
          <Button onClick={studio.cancelExport} variant="destructive" className="h-10 flex-1 gap-2">
            <LoaderCircle className="size-4 animate-spin" /> DURDUR · %{exportPct}
          </Button>
        ) : (
          <Button onClick={studio.exportWebm} disabled={!videoUrl}
            className="h-10 flex-1 gap-2 bg-emerald-600 font-semibold text-black hover:bg-emerald-500">
            <Download className="size-4" /> KAYDET (WEBM)
          </Button>
        )}
        <Button onClick={() => { setActivePreset(null); studio.reset(); }} variant="outline"
          disabled={isDefaultEnhance(params)} className="h-10 gap-1.5">
          <RotateCcw className="size-3.5" /> SIFIRLA
        </Button>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        Kayıt gerçek zamanlıda ilerler: video süresi kadar sürer, sekmede kalın. DURDUR ile kısmi kaydı
        indirebilirsiniz. Tüm işlem tarayıcınızda yerel olarak yapılır; video hiçbir sunucuya yüklenmez.
      </p>
    </div>
  );
}
