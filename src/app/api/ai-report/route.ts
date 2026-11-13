/**
 * YZ RAPOR ASISTANI — bulguları resmî Türkçe adli rapor taslağına
 * dönüştürür (salt metin; görüntü gönderilmez, hızlıdır). /api/analyze
 * ile aynı kimlik ve hata çözümleme zincirini paylaşır.
 */
import { NextResponse } from 'next/server';
import {
  createAiClient, aiModel, classicVisionMode, classifyUpstreamError,
} from '@/lib/forensic/ai-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ReportBody {
  caseNo?: string;
  examiner?: string;
  authority?: string;
  note?: string;
  ocrSummary?: string;
  findings?: string;
  auditSummary?: string;
  metaNotes?: string;
}

const SYSTEM_PROMPT = `Sen bir adli belge inceleme rapor yazarısın. Sana inceleyenin
kayıtları (vaka bilgisi, OCR okumaları, yapay zekâ bulguları, üst veri notları, denetim izi)
verilecek; bunları resmî Türkçe adli belge inceleme raporunun "SONUÇ VE KANAAT" bölümüne
dönüştüreceksin.

KURALLAR:
1. Yalnızca verilen kayıtlardaki bulguları kullan; ASLA yeni bulgu uydurma.
2. Emin olunmayan noktaları "şüphe" ve "doğrulama önerisi" diliyle yaz.
3. Resmî dil: kısa, teknik, nesnel; "delil", "inceleme", "tespit edilmiştir" kalıpları.
4. Yapı: 3-5 paragraf; her paragraf 2-4 cümle. Başlıklar şu sırayla:
   GENEL DEĞERLENDİRME / TESPİT EDİLEN BULGULAR / SONUÇ VE KANAAT / ÖNERİLER
5. Sertifika uyarısı: son paragrafta bulguların sertifikalı laboratuvar cihazlarıyla
   (VSC/ESDA) doğrulanması gerektiğini belirt.
6. Markdown yok; düz paragraflar. Toplam 300 kelimeyi geçmesin.`;

function friendlyError(e: unknown): { message: string; status: number } {
  const msg = (e as Error)?.message ?? 'Rapor asistanında beklenmeyen hata';
  if (/status \d{3}:/i.test(msg)) {
    const tani = classifyUpstreamError(msg);
    if (tani) return tani;
  }
  if (/Configuration file not found|kimlik bilgi/i.test(msg)) {
    return {
      message:
        'AI servis kimlik bilgisi tanımlı değil: ZAI_API_KEY ve ZAI_BASE_URL (veya ZAI_TABAN_URL) ' +
        'ortam değişkenlerini ekleyip yeniden dağıtım yapın.',
      status: 500,
    };
  }
  if (/401|X-Token|unauthorized/i.test(msg)) {
    return { message: 'AI anahtarı reddedildi: ZAI_API_KEY geçersiz veya süresi dolmuş.', status: 502 };
  }
  if (/429|rate/i.test(msg)) {
    return { message: 'AI servis sınırı aşıldı; kısa bir süre sonra tekrar deneyin.', status: 429 };
  }
  if (/timeout|ETIMEDOUT|yanıt vermedi/i.test(msg)) {
    return { message: 'AI servisi zaman aşımına uğradı; lütfen tekrar deneyin.', status: 504 };
  }
  return { message: msg.slice(0, 200), status: 500 };
}

const RATE_LIMIT_REQUESTS = 12;
const RATE_WINDOW_MS = 180_000;
const rateMap = new Map<string, number[]>();

function rateLimit(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (rateMap.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_REQUESTS) {
    rateMap.set(ip, hits);
    return { ok: false, retryAfterSec: Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  rateMap.set(ip, hits);
  return { ok: true, retryAfterSec: 0 };
}

const clip = (s: string | undefined, max: number) =>
  typeof s === 'string' ? s.trim().slice(0, max) : '';

export async function POST(req: Request) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
    const rl = rateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: `Çok fazla istek: ${rl.retryAfterSec} sn sonra tekrar deneyin.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const body = (await req.json()) as ReportBody;
    const userText = [
      `Vaka No: ${clip(body.caseNo, 60) || '—'}`,
      `İnceleyen: ${clip(body.examiner, 80) || '—'}`,
      `Talep Eden Makam: ${clip(body.authority, 120) || '—'}`,
      body.note ? `Delil/saklama notu: ${clip(body.note, 600)}` : '',
      body.ocrSummary ? `OCR okumaları: ${clip(body.ocrSummary, 1500)}` : '',
      body.findings ? `YZ analiz bulguları: ${clip(body.findings, 3000)}` : '',
      body.metaNotes ? `Üst veri (EXIF) notları: ${clip(body.metaNotes, 800)}` : '',
      body.auditSummary ? `İşlem denetim izi özeti: ${clip(body.auditSummary, 1200)}` : '',
      'Görev: Bu kayıtları resmî "SONUÇ VE KANAAT" bölümü taslağına dönüştür (belirtilen başlıklarla).',
    ].filter(Boolean).join('\n');

    const zai = await createAiClient();
    const reqBody = {
      model: aiModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      thinking: { type: 'disabled' as const },
      max_tokens: 800,
    };
    const call = classicVisionMode()
      ? zai.chat.completions.create(reqBody as unknown as Parameters<typeof zai.chat.completions.create>[0])
      : zai.chat.completions.createVision(reqBody as Parameters<typeof zai.chat.completions.createVision>[0]);

    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('AI servisi 45 sn içinde yanıt vermedi (timeout)')), 45_000),
    );
    const completion = await Promise.race([call, timeout]);
    const draft: string = (completion?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';

    if (!draft) {
      return NextResponse.json({ ok: false, error: 'Model boş yanıt döndürdü.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    console.error('[ai-report] hata:', (e as Error)?.message ?? e);
    const { message, status } = friendlyError(e);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
