'use client';

/**
 * PDF SAYFA SEÇİCİ — çok sayfalı taranmış PDF'i sayfa sayfa açar;
 * seçilen sayfa tam çözünürlükte çalışma alanına yüklenir.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoaderCircle, FileText } from 'lucide-react';
import { openPdf, type PdfDoc } from '@/lib/forensic/pdf-import';

const FIRST_BATCH = 8;

export function PdfPagePicker({
  file, open, onOpenChange, onPick,
}: {
  file: File | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (dataUrl: string, name: string) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [thumbs, setThumbs] = useState<{ n: number; url: string }[]>([]);
  const [busyPage, setBusyPage] = useState(0);
  const [rendering, setRendering] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open || !file) return;
    cancelled.current = false;
    setDoc(null);
    setThumbs([]);
    setRendering(1);
    (async () => {
      try {
        const d = await openPdf(file);
        if (cancelled.current) return;
        setDoc(d);
        const total = Math.min(d.numPages, 40);
        for (let n = 1; n <= total; n++) {
          if (cancelled.current) return;
          setRendering(n);
          const { dataUrl } = await d.renderPage(n, 420);
          if (cancelled.current) return;
          setThumbs((t) => [...t, { n, url: dataUrl }]);
        }
      } catch {
        /* hata durumunda dialog boş kalır; kullanıcı kapatabilir */
      } finally {
        if (!cancelled.current) setRendering(0);
      }
    })();
    return () => { cancelled.current = true; };
  }, [open, file]);

  const pick = async (n: number) => {
    if (!doc || !file) return;
    setBusyPage(n);
    try {
      const { dataUrl } = await doc.renderPage(n, 1700);
      onPick(dataUrl, `${file.name.replace(/\.pdf$/i, '')}_sayfa${n}.jpg`);
      onOpenChange(false);
    } finally {
      setBusyPage(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <FileText className="size-4 text-amber-500" />
            PDF Sayfa Seç — {file?.name ?? ''}
            {doc && (
              <Badge variant="outline" className="border-border font-mono text-[9px] text-muted-foreground">
                {doc.numPages} sayfa
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {rendering > 0 && thumbs.length === 0 && (
          <p className="flex items-center gap-2 py-6 font-mono text-[12px] text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> PDF açılıyor… sayfa {rendering}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {thumbs.map((t) => (
            <button key={t.n} type="button"
              onClick={() => pick(t.n)}
              disabled={busyPage > 0}
              className="group relative overflow-hidden rounded-md border border-border bg-black/40 transition-colors hover:border-amber-500">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.url} alt={`Sayfa ${t.n}`} className="w-full" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/75 py-1 font-mono text-[10px] text-amber-400">
                {busyPage === t.n ? (
                  <><LoaderCircle className="size-3 animate-spin" /> YÜKLENİYOR</>
                ) : (
                  <>SAYFA {t.n} — AÇ</>
                )}
              </span>
            </button>
          ))}
        </div>
        {rendering > 0 && thumbs.length > 0 && (
          <p className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" /> sayfa {rendering} işleniyor… (kalan sayfalar hazırlanıyor)
          </p>
        )}
        {doc && rendering === 0 && thumbs.length === 0 && (
          <p className="py-6 text-center text-[12px] text-muted-foreground">
            Sayfalar okunamadı. Şifreli veya bozuk PDF olabilir.
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 font-mono text-[11px]">
            VAZGEÇ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
