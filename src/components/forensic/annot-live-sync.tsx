'use client';

/**
 * CANLI İŞARETLEME KAYDI (REV 9.10) — sayfa düzeyinde, sekmelerden bağımsız çalışır.
 * İşaretleme listesi her değiştiğinde (ARAÇLAR panelinden çizim, büyük ekrandaki
 * paletten çizim, uç taşıma, geri al…) tam çözünürlüklü anotasyonlu kanvas üretilir,
 * 640 px küçük resime indirilir ve depodaki sabit kimlikli CANLI kayda işlenir.
 * Böylece RAPOR → ANLIK GÖRÜNTÜ KAYITLARI ve PDF rapor her zaman güncel işaretli
 * görünümü taşır; 350 ms gecikme sürükleme sırasında her karede yazımı engeller.
 */
import { useEffect } from 'react';
import { useCaseStore, LIVE_ANNOT_SNAPSHOT_ID } from '@/lib/forensic/store';
import { drawAnnotations, annotationsSummary } from '@/lib/forensic/annotate';

export function AnnotLiveSync({ image }: { image: ImageData | null }) {
  const annotations = useCaseStore((s) => s.annotations);
  const pxPerMm = useCaseStore((s) => s.pxPerMm);
  const thickness = useCaseStore((s) => s.annotThickness);
  const upsertSnapshot = useCaseStore((s) => s.upsertSnapshot);
  const removeSnapshot = useCaseStore((s) => s.removeSnapshot);

  useEffect(() => {
    if (!image) return;
    const t = setTimeout(() => {
      if (!annotations.length) {
        // liste boşaldı — bayat canlı kayıt silinsin
        removeSnapshot(LIVE_ANNOT_SNAPSHOT_ID);
        return;
      }
      try {
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        const tmp = document.createElement('canvas');
        tmp.width = image.width;
        tmp.height = image.height;
        tmp.getContext('2d')!.putImageData(image, 0, 0);
        ctx.drawImage(tmp, 0, 0);
        drawAnnotations(ctx, annotations, {
          ctx, scale: 1, pxPerMm,
          imgW: image.width, imgH: image.height, thickness,
        });
        const k = Math.min(1, 640 / Math.max(c.width, c.height));
        const thumbC = document.createElement('canvas');
        thumbC.width = Math.round(c.width * k);
        thumbC.height = Math.round(c.height * k);
        thumbC.getContext('2d')!.drawImage(c, 0, 0, thumbC.width, thumbC.height);
        upsertSnapshot({
          id: LIVE_ANNOT_SNAPSHOT_ID,
          ts: Date.now(),
          label: 'İşaretleme · Canlı',
          thumb: thumbC.toDataURL('image/jpeg', 0.8),
          modeName: 'ARAÇLAR · CANLI KAYIT',
          modeNm: 'CANLI',
          paramsSummary: annotationsSummary(annotations, pxPerMm).slice(0, 120),
        });
      } catch (err) {
        console.error('Canlı kayıt güncellenemedi', err);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [image, annotations, pxPerMm, thickness, upsertSnapshot, removeSnapshot]);

  return null;
}
