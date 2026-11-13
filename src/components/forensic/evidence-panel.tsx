'use client';

/**
 * DELİL PANELİ — delil bütünlüğü (SHA-256), üst veri incelemesi (EXIF/PNG/
 * XMP + yazılım izleri), barkod/QR okuma ve denetim izi. Sahtecilik
 * tespitinin dijital ayağı: dosyanın kimliği ve geçmişi burada bellenir.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  ShieldCheck, Copy, LoaderCircle, ScanLine, QrCode, Trash2,
  AlertTriangle, CheckCircle2, MapPin, FileSearch, Fingerprint,
} from 'lucide-react';
import { sha256OfDataUrl, formatHash } from '@/lib/forensic/hash';
import { parseImageMetadata, type MetaResult } from '@/lib/forensic/exif';
import { decodeQr, decodeBarcodeFallback, type DecodeHit } from '@/lib/forensic/qr';
import { useCaseStore, formatAuditEntry, type AuditEntry } from '@/lib/forensic/store';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} bayt`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function EvidencePanel({
  srcDataUrl,
  srcSha,
  srcBytes,
  srcImg,
  imageInfo,
}: {
  srcDataUrl: string;
  srcSha: string;
  srcBytes: number;
  srcImg: ImageData | null;
  imageInfo: string;
}) {
  const { toast } = useToast();
  const { audit, addAudit, clearAudit, metaNotes, setMetaNotes } = useCaseStore();
  const [verifying, setVerifying] = useState(false);
  const [meta, setMeta] = useState<MetaResult | null>(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [qrHits, setQrHits] = useState<DecodeHit[] | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [scanned, setScanned] = useState(false); // QR: QR yok, barkod denenmedi mi

  /* ---------- delil bütünlüğü ---------- */
  const verify = async () => {
    if (!srcDataUrl) return;
    setVerifying(true);
    try {
      const { hex, bytes } = await sha256OfDataUrl(srcDataUrl);
      const ok = !srcSha || hex === srcSha;
      addAudit('DELİL DOĞRULAMA', ok ? `SHA-256 yeniden hesaplandı, eşleşiyor (${hex.slice(0, 16)}…)` : 'SHA-256 UYUŞMADI!');
      toast(
        ok
          ? { title: 'Delil bütünlüğü doğrulandı', description: `SHA-256 eşleşiyor · ${formatBytes(bytes)}` }
          : { title: 'BÜTÜNLÜK UYARISI', description: 'Yeniden hesaplanan özet kayıtla uyuşmuyor — dosya değişmiş olabilir.', variant: 'destructive' },
      );
    } finally {
      setVerifying(false);
    }
  };

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(srcSha);
      toast({ title: 'SHA-256 kopyalandı', description: 'Zincirleme saklama kaydına yapıştırabilirsiniz.' });
    } catch {
      toast({ title: 'Kopyalanamadı', description: 'Tarayıcı pano izni vermedi.', variant: 'destructive' });
    }
  };

  /* ---------- üst veri ---------- */
  const scanMeta = () => {
    if (!srcDataUrl) return;
    setMetaBusy(true);
    setTimeout(() => {
      try {
        const r = parseImageMetadata(srcDataUrl);
        setMeta(r);
        // rapora taşınacak özet notlar
        const notes: string[] = [];
        for (const w of r.warnings) notes.push(w.text);
        const make = r.entries.find((e) => e.tag === 'Make')?.value;
        const model = r.entries.find((e) => e.tag === 'Model')?.value;
        if (make || model) notes.push(`Çekim cihazı: ${[make, model].filter(Boolean).join(' ')}`);
        const dt = r.entries.find((e) => /Çekim Tarihi/.test(e.tag))?.value;
        if (dt) notes.push(`Çekim tarihi (EXIF): ${dt}`);
        if (r.gps) notes.push(`GPS konumu: ${r.gps.lat}, ${r.gps.lon}`);
        setMetaNotes(notes.slice(0, 12));
        addAudit('ÜST VERİ TARAMASI', `${r.entries.length} alan, ${r.warnings.length} uyarı (${r.container.toUpperCase()})`);
      } catch (e) {
        toast({ title: 'Üst veri okunamadı', description: (e as Error).message, variant: 'destructive' });
      } finally {
        setMetaBusy(false);
      }
    }, 30);
  };

  /* ---------- barkod / QR ---------- */
  const scanQr = async () => {
    if (!srcImg) return;
    setQrBusy(true);
    try {
      let hits = decodeQr(srcImg);
      if (!hits.length) hits = await decodeBarcodeFallback(srcDataUrl);
      setQrHits(hits);
      setScanned(true);
      addAudit('BARKOD/QR TARAMASI', hits.length ? `${hits.length} kod okundu` : 'kod bulunamadı');
      if (hits.length) toast({ title: `${hits.length} kod okundu`, description: hits[0].text.slice(0, 80) });
    } finally {
      setQrBusy(false);
    }
  };

  const copyText = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast({ title: 'Kod içeriği kopyalandı' });
    } catch { /* izin yok */ }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- I. DELİL BÜTÜNLÜĞÜ ---------- */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-[11px] tracking-widest text-fuchsia-400">DELİL BÜTÜNLÜĞÜ</h3>
          <Badge variant="outline" className="border-fuchsia-800/60 font-mono text-[9px] text-fuchsia-300">
            SHA-256
          </Badge>
        </div>
        <div className="rounded-md border border-fuchsia-900/50 bg-black/30 p-2.5">
          {srcSha ? (
            <p className="break-all font-mono text-[10px] leading-relaxed text-fuchsia-200">
              {formatHash(srcSha)}
            </p>
          ) : (
            <p className="font-mono text-[10px] text-muted-foreground">Özet hesaplanıyor…</p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={copyHash} disabled={!srcSha}
              className="h-7 gap-1 font-mono text-[10px]">
              <Copy className="size-3" /> KOPYALA
            </Button>
            <Button size="sm" variant="outline" onClick={verify} disabled={verifying || !srcDataUrl}
              className="h-7 gap-1 font-mono text-[10px]">
              {verifying ? <LoaderCircle className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
              DOĞRULA
            </Button>
            <span className="ml-auto font-mono text-[9px] text-muted-foreground">
              {srcBytes ? formatBytes(srcBytes) : ''}
            </span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
            Özet, delilin ham baytları üzerinden yüklenirken hesaplanır; rapora işlenir.
            DOĞRULA aynı hesabı tekrarlayıp değişiklik olmadığını kanıtlar.
          </p>
        </div>
      </section>

      {/* ---------- II. ÜST VERİ ---------- */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-[11px] tracking-widest text-fuchsia-400">ÜST VERİ (EXIF / PNG)</h3>
          <Button size="sm" variant="outline" onClick={scanMeta} disabled={metaBusy || !srcDataUrl}
            className="h-7 gap-1 border-fuchsia-900/60 font-mono text-[10px] text-fuchsia-300 hover:bg-fuchsia-950/40">
            {metaBusy ? <LoaderCircle className="size-3 animate-spin" /> : <FileSearch className="size-3" />}
            {meta ? 'YENİDEN TARA' : 'TARA'}
          </Button>
        </div>

        {meta && (
          <div className="flex flex-col gap-2">
            {meta.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-md border border-amber-800/60 bg-amber-950/25 p-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <p className="text-[11px] leading-snug text-amber-200">{w.text}</p>
              </div>
            ))}
            {meta.gps && (
              <div className="flex items-center gap-1.5 rounded-md border border-emerald-800/50 bg-emerald-950/20 p-2">
                <MapPin className="size-3.5 shrink-0 text-emerald-400" />
                <span className="font-mono text-[11px] text-emerald-200">
                  {meta.gps.lat}, {meta.gps.lon}
                </span>
              </div>
            )}
            <div className="grid gap-x-4 gap-y-1 rounded-md border border-border bg-black/25 p-2.5 sm:grid-cols-2">
              {meta.entries.length ? (
                meta.entries.map((e, i) => (
                  <div key={i} className="min-w-0 font-mono text-[10px]">
                    <span className="text-muted-foreground">{e.tag}:</span>{' '}
                    <span className="text-foreground/90">{e.value}</span>
                  </div>
                ))
              ) : (
                <p className="col-span-2 text-[11px] text-muted-foreground">
                  Okunabilir üst veri alanı yok (temizlenmiş/eksik dosya).
                </p>
              )}
            </div>
            <p className="font-mono text-[9px] text-muted-foreground/70">
              {imageInfo} · {meta.container.toUpperCase()} · {meta.segments.length} segment/chunk
              {meta.xmpHits.length ? ` · XMP: ${meta.xmpHits.slice(0, 3).join(' · ')}` : ''}
            </p>
          </div>
        )}
        {!meta && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            TARA ile çekim cihazı, tarih, konum ve <span className="text-amber-300">yazılım izlerini</span> (Photoshop,
            GIMP, yapay zekâ üreticileri…) arar. Bulunan uyarılar raporun delil bölümüne işlenir.
          </p>
        )}
      </section>

      {/* ---------- III. BARKOD / QR ---------- */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-[11px] tracking-widest text-fuchsia-400">BARKOD / QR OKUMA</h3>
          <Button size="sm" variant="outline" onClick={scanQr} disabled={qrBusy || !srcImg}
            className="h-7 gap-1 border-fuchsia-900/60 font-mono text-[10px] text-fuchsia-300 hover:bg-fuchsia-950/40">
            {qrBusy ? <LoaderCircle className="size-3 animate-spin" /> : <QrCode className="size-3" />}
            {qrHits ? 'YENİDEN TARA' : 'TARA'}
          </Button>
        </div>
        {qrHits ? (
          qrHits.length ? (
            <div className="flex flex-col gap-1.5">
              {qrHits.map((h, i) => (
                <div key={i} className="rounded-md border border-emerald-800/50 bg-emerald-950/20 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <Badge variant="outline" className="border-emerald-700/60 font-mono text-[9px] text-emerald-300">
                      <CheckCircle2 className="size-3" /> {h.format}
                    </Badge>
                    <Button size="sm" variant="ghost" className="h-6 gap-1 font-mono text-[9px]"
                      onClick={() => copyText(h.text)}>
                      <Copy className="size-3" /> KOPYALA
                    </Button>
                  </div>
                  <p className="break-all font-mono text-[11px] leading-snug text-emerald-100">{h.text}</p>
                  {h.corners && (
                    <p className="mt-1 font-mono text-[9px] text-muted-foreground/70">
                      Konum: {h.corners.map((c) => `(${c.x},${c.y})`).join(' ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border bg-black/25 p-2.5 text-[11px] text-muted-foreground">
              {scanned ? 'Belgede okunabilir QR/barkod bulunamadı (QR + ters + 2× ölçek + çok biçimli barkod denendi).' : ''}
            </p>
          )
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Belgedeki QR kodunu veya barkodu (EAN, Code128, DataMatrix…) okur;
            içeriği kopyalanabilir ve denetim izine işlenir.
          </p>
        )}
      </section>

      {/* ---------- IV. DENETİM İZİ ---------- */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-[11px] tracking-widest text-fuchsia-400">
            DENETİM İZİ ({audit.length})
          </h3>
          {audit.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 font-mono text-[10px] text-muted-foreground"
              onClick={() => { clearAudit(); addAudit('DENETİM İZİ TEMİZLENDİ'); }}>
              <Trash2 className="size-3" /> TEMİZLE
            </Button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-black/25 p-2.5">
          {audit.length ? (
            <ol className="flex flex-col gap-0.5">
              {audit.map((e: AuditEntry) => (
                <li key={e.id} className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {formatAuditEntry(e)}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              <Fingerprint className="mr-1 inline size-3.5" />
              Henüz işlem kaydı yok. Yükleme, tarama ve uygulama adımları buraya zaman damgasıyla işlenir.
            </p>
          )}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
          <ScanLine className="mr-1 inline size-3" />
          Denetim izi kronolojiktir ve resmî raporun “Denetim İzi” bölümüne birebir aktarılır.
        </p>
      </section>

      {metaNotes.length > 0 && (
        <p className="rounded-md border border-border bg-card/50 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          RAPORA TAŞINACAK ÖZET: {metaNotes.join(' | ').slice(0, 300)}
        </p>
      )}
    </div>
  );
}
