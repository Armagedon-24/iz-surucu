'use client';

/**
 * RAPOR & VAKA PANELİ — vaka bilgileri, anlık görüntü kayıtları,
 * HTML/metin rapor indirme ve çok bantlı dizi çekim (montaj).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  Camera, FileDown, FileText, Layers3, Trash2, FolderPlus, LoaderCircle,
} from 'lucide-react';
import {
  imageDataToDataUrl, downloadDataUrl,
} from '@/lib/forensic/canvas';
import { renderMontage } from '@/lib/forensic/pipeline';
import {
  useCaseStore, paramsSummary,
} from '@/lib/forensic/store';
import { buildHtmlReport, downloadBlob, type ReportData } from '@/lib/forensic/report';
import { buildOfficialPdf } from '@/lib/forensic/pdf';
import type { Params } from '@/lib/forensic/pipeline';
import { getBand } from '@/lib/forensic/pipeline';

export function ReportPanel({
  processed,
  original,
  params,
  imageInfo,
}: {
  processed: ImageData | null;
  original: ImageData | null;
  params: Params;
  imageInfo: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const {
    caseNo, examiner, authority, note, snapshots,
    setCaseNo, setExaminer, setAuthority, setNote, addSnapshot, removeSnapshot, resetCase,
  } = useCaseStore();

  const now = () =>
    new Date().toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

  const takeSnapshot = () => {
    if (!processed) return;
    const band = getBand(params.band);
    const thumb = imageDataToDataUrl(processed, 640, 0.75);
    addSnapshot({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      label: `${band.name}`,
      thumb,
      modeName: band.name,
      modeNm: band.nm,
      paramsSummary: paramsSummary(params),
    });
    toast({ title: 'Anlık görüntü kaydedildi', description: `${band.name} · ${band.nm}` });
  };

  const montage = () => {
    if (!processed && !original) return;
    setBusy('montage');
    try {
      const canvas = renderMontage(original ?? processed!, params, caseNo, now());
      canvas.toBlob(
        (blob) => {
          if (blob) downloadBlob(blob, `DIZI_CEKIM_${caseNo}.png`, 'image/png');
          toast({ title: 'Dizi çekim indirildi', description: '6 bantlı adli montaj görüntüsü' });
        },
        'image/png'
      );
    } catch (e) {
      toast({ title: 'Montaj oluşturulamadı', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  /** Hem PDF hem HTML raporunun ortak veri kaynağı */
  const collectData = (): ReportData => ({
    caseNo,
    examiner,
    authority,
    note,
    date: now(),
    snapshots: useCaseStore.getState().snapshots,
    analyses: useCaseStore.getState().analyses,
    ocrs: useCaseStore.getState().ocrResults,
    currentView: processed
      ? {
          label: `${getBand(params.band).name} · ${getBand(params.band).nm}`,
          image: imageDataToDataUrl(processed, 900, 0.85),
        }
      : undefined,
    imageInfo,
  });

  const htmlReport = () => {
    setBusy('html');
    try {
      const html = buildHtmlReport(collectData());
      downloadBlob(html, `ADLI_RAPOR_${caseNo}.html`, 'text/html;charset=utf-8');
      toast({ title: 'HTML rapor indirildi', description: 'Resmî antetli kısa düzen — yazdırılabilir A4' });
    } catch (e) {
      toast({ title: 'Rapor oluşturulamadı', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  const pdfReport = async () => {
    setBusy('pdf');
    try {
      const blob = await buildOfficialPdf(collectData());
      downloadBlob(blob, `ADLI_RAPOR_${caseNo}.pdf`, 'application/pdf');
      toast({ title: 'PDF rapor indirildi', description: 'Resmî antetli kısa düzen — gömülü görüntülerle' });
    } catch (e) {
      toast({ title: 'PDF rapor oluşturulamadı', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-widest text-amber-600">VAKA BİLGİLERİ</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-1 block text-xs text-foreground/85">Vaka No</Label>
            <Input value={caseNo} onChange={(e) => setCaseNo(e.target.value)} className="h-9 font-mono text-xs" />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-foreground/85">İnceleyen</Label>
            <Input value={examiner} onChange={(e) => setExaminer(e.target.value)} placeholder="Ad Soyad / Birim" className="h-9 text-xs" />
          </div>
        </div>
        <div className="mt-2">
          <Label className="mb-1 block text-xs text-foreground/85">Talep Eden Makam (rapora işlenir)</Label>
          <Input value={authority} onChange={(e) => setAuthority(e.target.value)}
            placeholder="örn. Yalvaç Cumhuriyet Başsavcılığı" className="h-9 text-xs" />
        </div>
        <div className="mt-2">
          <Label className="mb-1 block text-xs text-foreground/85">Delil / zincirleme saklama notu</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="İnceleme kapsamı, kaynak bilgisi, zincirleme saklama notu…" className="text-xs" />
        </div>
      </section>

      <Separator />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-mono text-[11px] tracking-widest text-amber-600">
            ANLIK GÖRÜNTÜ KAYITLARI ({snapshots.length})
          </h3>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={montage} disabled={!original || busy === 'montage'}
              className="h-8 gap-1.5 text-[11px]">
              <Layers3 className="size-3.5" /> DİZİ ÇEKİM
            </Button>
            <Button size="sm" onClick={takeSnapshot} disabled={!processed}
              className="h-8 gap-1.5 bg-amber-600 text-[11px] font-semibold text-black hover:bg-amber-500">
              <Camera className="size-3.5" /> ANLIK GÖRÜNTÜ AL
            </Button>
          </div>
        </div>
        {snapshots.length ? (
          <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {snapshots.map((s) => (
              <figure key={s.id} className="group relative overflow-hidden rounded-md border border-border bg-black/50">
                <img src={s.thumb} alt={`${s.modeName} anlık görüntü`} className="w-full" />
                <figcaption className="p-1.5 font-mono text-[9px] leading-tight text-muted-foreground">
                  <span className="text-amber-500">{s.modeName}</span> · {s.paramsSummary}
                </figcaption>
                <Button size="icon" variant="destructive"
                  className="absolute right-1 top-1 size-6 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => removeSnapshot(s.id)} aria-label="Anlık görüntüyü sil">
                  <Trash2 className="size-3" />
                </Button>
              </figure>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Farklı bantlarda inceleme yaparken <span className="text-amber-500">Anlık Görüntü Al</span> ile
            kayıt bırakın; kayıtlar rapora gömülür. (Tarayıcı kapanınca da saklanır.)
          </p>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="mb-1 font-mono text-[11px] tracking-widest text-amber-600">RAPOR ÇIKTILARI — RESMÎ DÜZEN</h3>
        <Button onClick={pdfReport} disabled={busy === 'pdf'} className="h-11 gap-2 bg-emerald-700 font-semibold text-white hover:bg-emerald-600">
          {busy === 'pdf' ? <LoaderCircle className="size-4 animate-spin" /> : <FileDown className="size-4" />}
          {busy === 'pdf' ? 'PDF HAZIRLANIYOR…' : 'PDF ADLİ RAPOR İNDİR'}
        </Button>
        <Button onClick={htmlReport} disabled={busy === 'html'} variant="outline" className="h-10 gap-2">
          <FileText className="size-4" /> HTML ADLİ RAPOR İNDİR
        </Button>
        <Button onClick={() => { resetCase(); toast({ title: 'Yeni vaka açıldı', description: 'Kayıtlar temizlendi' }); }}
          variant="ghost" className="h-9 gap-2 text-red-400 hover:text-red-300">
          <FolderPlus className="size-4" /> Yeni vaka aç (kayıtları sıfırla)
        </Button>
      </section>

      <p className="rounded-md border border-border bg-card/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Raporlar <span className="text-foreground/80">yalnızca PDF ve HTML</span> olarak, Isparta İl Emniyet
        Müdürlüğü Yalvaç İlçe Emniyet Müdürlüğü Olay Yeri İnceleme Grup Amirliği antetiyle kısa resmî
        düzende üretilir; görüntüler, OCR ve AI bulguları gömülüdür. Resmî süreçlerde bulgular
        sertifikalı laboratuvar cihazlarıyla doğrulanmalıdır.
      </p>
    </div>
  );
}
