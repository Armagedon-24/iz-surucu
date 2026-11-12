'use client';

/**
 * AI ADLİ ANALİZ PANELİ — sunucudaki görme yeteneği olan modelin (vision)
 * orijinal + işlenmiş görüntüyü değerlendirip yapılandırılmış adli bulgu
 * üretmesi. Sonuçlar vaka kaydına eklenebilir.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  BrainCircuit, LoaderCircle, Save, AlertTriangle, FileText,
} from 'lucide-react';
import { imageDataToDataUrl } from '@/lib/forensic/canvas';
import { postJsonSafe } from '@/lib/forensic/api';
import { useCaseStore } from '@/lib/forensic/store';

interface Finding {
  baslik?: string;
  aciklama?: string;
  yer?: string;
  siddet?: string;
}

interface AiResult {
  okunan_metin?: string;
  genel_degerlendirme?: string;
  bulgular?: Finding[];
  murekkep_farkliliklari?: string[];
  silme_tahrip_kusu?: string;
  guven?: number;
  oneriler?: string[];
}

const SEV_COLORS: Record<string, string> = {
  yuksek: 'destructive',
  'yüksek': 'destructive',
  orta: 'default',
  dusuk: 'secondary',
  'düşük': 'secondary',
};

export function AiPanel({
  original,
  processed,
  bandLabel,
  ocrText,
}: {
  original: ImageData | null;
  processed: ImageData | null;
  bandLabel: string;
  ocrText: string;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [raw, setRaw] = useState('');
  const [question, setQuestion] = useState('');
  const addAnalysis = useCaseStore((s) => s.addAnalysis);
  const band = useCaseStore((s) => s.caseNo);

  const analyze = async () => {
    if (!original || !processed) return;
    setLoading(true);
    setResult(null);
    setRaw('');
    try {
      // 1000px / q0.78: model iç çözünürlüğü için yeterli, gecikmeyi ciddi düşürür
      const payload = {
        original: imageDataToDataUrl(original, 1000, 0.78),
        processed: imageDataToDataUrl(processed, 1000, 0.78),
        bandLabel,
        ocrText: ocrText.slice(0, 1500),
        question: question.slice(0, 400),
      };
      const json = await postJsonSafe<{
        ok: boolean;
        result?: AiResult;
        raw?: string;
        error?: string;
      }>('/api/analyze', payload);
      setResult(json.result ?? null);
      setRaw(json.raw ?? '');
      if (json.result) {
        addAnalysis({
          id: `${Date.now()}`,
          ts: Date.now(),
          bandLabel,
          result: json.result as Record<string, unknown>,
          raw: json.raw ?? '',
        });
      }
      toast({ title: 'YZ analizi tamamlandı' });
    } catch (e) {
      toast({
        title: 'YZ analizi hatası',
        description: (e as Error).message ?? 'Bilinmeyen hata',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const sevBadge = (s?: string) => {
    const key = (s ?? '').toLowerCase();
    return SEV_COLORS[key] ?? 'secondary';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card/60 p-3 text-[12px] leading-relaxed text-muted-foreground">
        Yapay zekâ modeli <span className="text-foreground/80">orijinal fotoğrafı</span> ve
        <span className="text-foreground/80"> seçili spektral bantta işlenmiş görüntüyü</span> birlikte
        değerlendirir; metni okur, silme/tahrip şüphesi, mürekkep farklılıkları ve sonradan ekleme
        bulgularını raporlar. İşlem birkaç saniye sürebilir.
      </div>

      <div>
        <Label className="mb-1 block text-xs text-foreground/85">İnceleme sorusu (isteğe bağlı)</Label>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="örn. tutar alanında silme izi var mı?"
          className="h-9"
        />
      </div>

      <Button onClick={analyze} disabled={loading || !original}
        className="h-11 gap-2 bg-emerald-600 font-semibold text-black hover:bg-emerald-500">
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : <BrainCircuit className="size-5" />}
        {loading ? 'ANALİZ EDİLİYOR…' : 'YZ ADLİ ANALİZ BAŞLAT'}
      </Button>

      {loading && (
        <div className="relative overflow-hidden rounded-md border border-emerald-900/60 bg-black/40 p-4">
          <div className="absolute inset-x-0 top-0 h-0.5 animate-[scanline_1.6s_ease-in-out_infinite] bg-emerald-500" />
          <p className="font-mono text-[11px] text-emerald-500">
            Çok bantlı görüntü analizi yürütülüyor — {band} kaydı için…
          </p>
        </div>
      )}

      {result && (
        <section className="flex flex-col gap-3">
          {typeof result.guven === 'number' && (
            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px]">
                <span className="text-muted-foreground">MODEL GÜVENİ</span>
                <span className="text-amber-500">%{result.guven}</span>
              </div>
              <Progress value={Math.min(100, result.guven)} className="h-1.5" />
            </div>
          )}

          {result.okunan_metin && (
            <div className="rounded-md border border-border bg-black/45 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-emerald-500">
                <FileText className="size-3.5" /> MODELİN OKUDUĞU METİN
              </div>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/90">
                {result.okunan_metin}
              </pre>
            </div>
          )}

          {result.genel_degerlendirme && (
            <p className="text-[13px] leading-relaxed text-foreground/90">
              <span className="font-semibold text-amber-500">Değerlendirme: </span>
              {result.genel_degerlendirme}
            </p>
          )}

          {result.silme_tahrip_kusu && (
            <div className="rounded-md border border-red-900/50 bg-red-950/20 p-3">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-red-400">
                <AlertTriangle className="size-3.5" /> SİLME / TAHRİP DEĞERLENDİRMESİ
              </div>
              <p className="text-[13px] leading-relaxed text-foreground/90">{result.silme_tahrip_kusu}</p>
            </div>
          )}

          {result.bulgular?.length ? (
            <div>
              <div className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground">BULGULAR</div>
              <ul className="flex flex-col gap-2">
                {result.bulgular.map((f, i) => (
                  <li key={i} className="rounded-md border border-border bg-card/50 p-2.5 text-[12px] leading-relaxed">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant={sevBadge(f.siddet) as 'destructive' | 'default' | 'secondary'} className="text-[10px]">
                        {(f.siddet ?? 'bilgi').toUpperCase()}
                      </Badge>
                      <span className="font-semibold">{f.baslik}</span>
                      {f.yer && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{f.yer}</span>}
                    </div>
                    <p className="text-muted-foreground">{f.aciklama}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.murekkep_farkliliklari?.length ? (
            <div>
              <div className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground">MÜREKKEP FARKLILIKLARI</div>
              <ul className="list-disc pl-5 text-[12px] leading-relaxed text-muted-foreground">
                {result.murekkep_farkliliklari.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          ) : null}

          {result.oneriler?.length ? (
            <div>
              <div className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground">ÖNERİLER</div>
              <ul className="list-disc pl-5 text-[12px] leading-relaxed text-muted-foreground">
                {result.oneriler.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          ) : null}

          {!result.okunan_metin && raw && (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-black/45 p-3 font-mono text-[12px] text-muted-foreground">
              {raw}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
