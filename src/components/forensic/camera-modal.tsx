'use client';

/**
 * KAMERA MODÜLÜ — cihaz kamerasından belge fotoğrafı çekme.
 * Torch (fener), optik zoom (destekleyen cihazlarda), ızgara kaplama,
 * ön/arka kamera geçişi. Çekim, kamera çözünürlüğünde yapılır.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Camera, FlipHorizontal, Flashlight, FlashlightOff, Grid3X3, X,
} from 'lucide-react';

interface CameraCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (dataUrl: string, width: number, height: number) => void;
}

export function CameraCapture({ open, onOpenChange, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [grid, setGrid] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number, number] | null>(null);
  const [flash, setFlash] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchOn(false);
    setTorchSupported(false);
    setZoom(null);
    setZoomRange(null);
  }, []);

  const startStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Bu tarayıcı/ortam kamera erişimini desteklemiyor. Dosya yükleyerek devam edebilirsiniz.');
      return;
    }
    setStarting(true);
    setError(null);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 2560 },
          height: { ideal: 1920 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
        zoom?: { min: number; max: number; step?: number };
      };
      setTorchSupported(Boolean(caps.torch));
      if (caps.zoom) {
        setZoomRange([
          caps.zoom.min,
          caps.zoom.max,
          caps.zoom.step ?? (caps.zoom.max - caps.zoom.min) / 100,
        ]);
        setZoom((caps.zoom.min + caps.zoom.max) / 2);
      }
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Kamera izni reddedildi. Tarayıcı adres çubuğundaki kamera iznini açın veya dosya yükleyin.'
          : 'Kamera başlatılamadı: ' + ((e as Error).message ?? 'bilinmeyen hata')
      );
    } finally {
      setStarting(false);
    }
  }, [facing, stopStream]);

  useEffect(() => {
    if (open) {
      startStream();
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [open, facing]);

  const applyZoom = async (v: number) => {
    setZoom(v);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: v } as unknown as MediaTrackConstraintSet] });
    } catch {
      /* zoom desteklenmiyorsa yoksay */
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    onCapture(c.toDataURL('image/jpeg', 0.95), c.width, c.height);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-border bg-[#0c0f0c] p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
          <DialogTitle className="font-mono text-sm tracking-widest text-amber-500 flex items-center gap-2">
            <Camera className="size-4" /> BELGE ÇEKİM MODÜLÜ
          </DialogTitle>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Kapat">
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <div className="relative bg-black aspect-[4/3] w-full overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          {grid && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
              <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
              <div className="absolute top-1/3 left-0 w-full h-px bg-white/25" />
              <div className="absolute top-2/3 left-0 w-full h-px bg-white/25" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border-2 border-amber-400/70 rounded-lg" />
            </div>
          )}
          {flash && <div className="absolute inset-0 bg-white animate-[flash_0.18s_ease-out]" />}
          {starting && (
            <div className="absolute inset-0 grid place-items-center text-xs font-mono text-amber-500 tracking-widest">
              KAMERA BAŞLATILIYOR…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-red-400 bg-black/85">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div className="flex items-center gap-2">
              <Switch id="grid-sw" checked={grid} onCheckedChange={setGrid} />
              <Label htmlFor="grid-sw" className="flex items-center gap-1 text-muted-foreground">
                <Grid3X3 className="size-3.5" /> Hizalama ızgarası
              </Label>
            </div>
            {torchSupported && (
              <Button size="sm" variant="outline" onClick={toggleTorch} className="h-8 gap-1.5">
                {torchOn ? <FlashlightOff className="size-3.5" /> : <Flashlight className="size-3.5" />}
                Fener
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
              className="h-8 gap-1.5"
            >
              <FlipHorizontal className="size-3.5" /> Kamera çevir
            </Button>
          </div>

          {zoomRange && (
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">YAKINLAŞTIRMA</span>
              <Slider
                min={zoomRange[0]}
                max={zoomRange[1]}
                step={zoomRange[2]}
                value={[zoom ?? zoomRange[0]]}
                onValueChange={(v) => applyZoom(v[0])}
                className="flex-1"
              />
              <span className="font-mono text-[10px] text-amber-500 w-14 text-right">
                ×{(zoom ?? zoomRange[0]).toFixed(1)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Belgeyi düz zemine yerleştirin, gölge bırakmayın ve çerçeveyi metne paralel tutun.
              Mümkünse fenerle kenar aydınlatması sağlayın.
            </p>
            <Button
              onClick={capture}
              disabled={!!error || starting}
              className="min-h-11 shrink-0 gap-2 bg-amber-600 font-semibold text-black hover:bg-amber-500"
            >
              <Camera className="size-4" /> Çek
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
