'use client';

/**
 * RAPOR & VAKA PANELİ — vaka bilgileri, anlık görüntü kayıtları,
 * resmî PDF rapor indirme, çok bantlı dizi çekim (montaj) ve YZ rapor
 * asistanı (bulguları resmî taslağa dönüştürür).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  Camera, FileDown, Layers3, Trash2, FolderPlus, LoaderCircle,
  BrainCircuit, Copy, Save,
} from 'lucide-react';
import {
  imageDataToDataUrl, downloadDataUrl,
} from '@/lib/forensic/canvas';
import { renderMontage } from '@/lib/forensic/pipeline';
import {
  useCaseStore, paramsSummary, formatAuditEntry,
} from '@/lib/forensic/store';
import { downloadBlob, type ReportData } from '@/lib/forensic/report';
import { buildOfficialPdf } from '@/lib/forensic/pdf';
import type { Params } from '@/lib/forensic/pipeline';
import { getBand } from '@/lib/forensic/pipeline';

export function ReportPanel({
  processed,
  original,
  params,
  imageInfo,
  srcSha,
  srcBytes,
}: {
  processed: ImageData | null;
  original: ImageData | null;
  params: Params;
  imageInfo: string;
  srcSha: string;
  srcBytes: number;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const {
    caseNo, examiner, authority, note, snapshots, aiDraft, setAiDraft,
    setCaseNo, setExaminer, setAuthority, setNote, addSnapshot, removeSnapshot,
    resetCase, addAudit,
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

  /** PDF raporunun ortak veri kaynağı */
  const collectData = (): ReportData => {
    const st = useCaseStore.getState();
    return {
      caseNo,
      examiner,
      authority,
      note,
      date: now(),
      snapshots: st.snapshots,
      analyses: st.analyses,
      ocrs: st.ocrResults,
      currentView: processed
        ? {
            label: `${getBand(params.band).name} · ${getBand(params.band).nm}`,
            image: imageDataToDataUrl(processed, 900, 0.85),
          }
        : undefined,
      imageInfo,
      integrity: srcSha
        ? { sha256: srcSha, bytes: srcBytes, algo: 'SHA-256' }
        : undefined,
      audit: st.audit.length ? st.audit : undefined,
      metaNotes: st.metaNotes.length ? st.metaNotes : undefined,
    };
  };

  const pdfReport = async () => {
    setBusy('pdf');
    try {
      const blob = await buildOfficialPdf(collectData());
      downloadBlob(blob, `ADLI_RAPOR_${caseNo}.pdf`, 'application/pdf');
      addAudit('PDF RAPOR', 'Resmî antetli rapor indirildi');
      toast({ title: 'PDF rapor indirildi', description: 'Resmî antetli kısa düzen — gömülü görüntülerle' });
    } catch (e) {
      toast({ title: 'PDF rapor oluşturulamadı', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  /* ---------------- YZ rapor asistanı ---------------- */
  const draftFromStore = useCaseStore.getState().aiDraft;
  const [draftText, setDraftText] = useState(draftFromStore);

  const aiDraftGenerate = async () => {
    setBusy('ai');
    try {
      const st = useCaseStore.getState();
      const findings = st.analyses
        .map((a) => JSON.stringify(a.result).slice(0, 900))
        .join('\n') || '(YZ analiz kaydı yok)';
      const ocrSummary = st.ocrResults.map((o) => o.text.slice(0, 400)).join(' | ') || '';
      const auditSummary = st.audit.slice(-12).map(formatAuditEntry).join('\n');
      const res = await fetch('/api/ai-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseNo, examiner, authority, note,
          ocrSummary,
          findings,
          auditSummary,
          metaNotes: st.metaNotes.join(' | '),
        }),
      });
      const j = (await res.json()) as { ok: boolean; draft?: string; error?: string };
      if (!j.ok || !j.draft) throw new Error(j.error ?? 'Taslak üretilemedi');
      setDraftText(j.draft);
      setAiDraft(j.draft);
      addAudit('YZ RAPOR TASLAĞI', `${j.draft.split(/\s+/).length} kelimelik taslak üretildi`);
      toast({ title: 'Rapor taslağı hazır', description: 'Metni düzenleyip notlara ekleyebilir veya indirebilirsiniz.' });
    } catch (e) {
      toast({ title: 'YZ asistanı hatası', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  const draftAppendNote = () => {
    if (!draftText.trim()) return;
    setNote(`${note.trim()}${note.trim() ? '\n\n' : ''}${draftText.trim()}`);
    addAudit('TASLAK NOTA EKLENDİ');
    toast({ title: 'Taslak delil notuna eklendi', description: 'Raporun delil bölümüne işlenir.' });
  };

  const draftCopy = async () => {
    if (!draftText.trim()) return;
    try {
      await navigator.clipboard.writeText(draftText);
      toast({ title: 'Taslak kopyalandı' });
    } catch {
      toast({ title: 'Kopyalanamadı', variant: 'destructive' });
    }
  };

  const draftDownload = () => {
    if (!draftText.trim()) return;
    downloadBlob(draftText, `RAPOR_TASLAK_${caseNo}.txt`, 'text/plain;charset=utf-8');
    addAudit('TASLAK İNDİR', 'TXT olarak kaydedildi');
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
        {srcSha && (
          <p className="mt-2 rounded-md border border-fuchsia-900/50 bg-black/25 p-2 font-mono text-[9px] leading-relaxed text-fuchsia-300">
            DELİL BÜTÜNLÜĞÜ · SHA-256: {srcSha.slice(0, 24)}…{srcSha.slice(-12)}
            {srcBytes ? ` · ${(srcBytes / 1024).toFixed(0)} KB` : ''}
          </p>
        )}
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
        <h3 className="mb-1 font-mono text-[11px] tracking-widest text-amber-600">YZ RAPOR ASİSTANI</h3>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          OCR okumaları, YZ bulguları, üst veri notları ve denetim izini resmî
          “Sonuç ve Kanaat” taslağına dönüştürür. Taslağı düzenleyip delil notuna
          ekleyebilirsiniz.
        </p>
        <Button onClick={aiDraftGenerate} disabled={busy === 'ai'}
          className="h-10 gap-2 bg-violet-700 font-semibold text-white hover:bg-violet-600">
          {busy === 'ai' ? <LoaderCircle className="size-4 animate-spin" /> : <BrainCircuit className="size-4" />}
          {busy === 'ai' ? 'TASLAK ÜRETİLİYOR…' : 'YZ İLE RAPOR TASLAĞI ÜRET'}
        </Button>
        {(draftText || aiDraft) && (
          <>
            <Textarea
              value={draftText || aiDraft}
              onChange={(e) => { setDraftText(e.target.value); setAiDraft(e.target.value); }}
              rows={7}
              className="font-mono text-[11px] leading-relaxed"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <Button size="sm" variant="outline" onClick={draftAppendNote} className="h-8 gap-1 text-[10px]">
                <Save className="size-3" /> NOTA EKLE
              </Button>
              <Button size="sm" variant="outline" onClick={draftCopy} className="h-8 gap-1 text-[10px]">
                <Copy className="size-3" /> KOPYALA
              </Button>
              <Button size="sm" variant="outline" onClick={draftDownload} className="h-8 gap-1 text-[10px]">
                <FileDown className="size-3" /> İNDİR (.txt)
              </Button>
            </div>
          </>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="mb-1 font-mono text-[11px] tracking-widest text-amber-600">RAPOR ÇIKTILARI — RESMÎ DÜZEN</h3>
        <Button onClick={pdfReport} disabled={busy === 'pdf'} className="h-11 gap-2 bg-emerald-700 font-semibold text-white hover:bg-emerald-600">
          {busy === 'pdf' ? <LoaderCircle className="size-4 animate-spin" /> : <FileDown className="size-4" />}
          {busy === 'pdf' ? 'PDF HAZIRLANIYOR…' : 'RESMÎ ADLİ RAPOR İNDİR (PDF)'}
        </Button>
        <Button onClick={() => { resetCase(); toast({ title: 'Yeni vaka açıldı', description: 'Kayıtlar temizlendi' }); }}
          variant="ghost" className="h-9 gap-2 text-red-400 hover:text-red-300">
          <FolderPlus className="size-4" /> Yeni vaka aç (kayıtları sıfırla)
        </Button>
      </section>

      <p className="rounded-md border border-border bg-card/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Raporlar <span className="text-foreground/80">yalnızca PDF</span> olarak, Isparta İl Emniyet
        Müdürlüğü Yalvaç İlçe Emniyet Müdürlüğü Olay Yeri İnceleme Grup Amirliği antetiyle kısa resmî
        düzende üretilir; görüntüler, OCR ve YZ bulguları gömülüdür. Delil bütünlüğü (SHA-256),
        üst veri notları ve denetim izi rapora otomatik işlenir. Resmî süreçlerde bulgular
        sertifikalı laboratuvar cihazlarıyla doğrulanmalıdır.
      </p>
    </div>
  );
}
