/**
 * AI BAĞLANTI TESTİ — dağıtım ortamında YZ analizinin neden çalışmadığını
 * tek istekte kesinleştirir (anahtar mı, taban adres mi, model mi, bakiye mi?).
 *
 * Döndürür (anahtar ASLA ifşa edilmez):
 *  - kaynak: 'env' | 'file' | 'none'
 *  - model / visionMode / taban adresin SADECE ana makinesi
 *  - ping: upstream'e 1-token'lık gerçek istek → status + iş kodu + Türkçe tanı
 */
import { NextResponse } from 'next/server';
import {
  createAiClient, aiModel, classicVisionMode, aiConfigStatus,
  classifyUpstreamError, envCredentials,
} from '@/lib/forensic/ai-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const PING_TIMEOUT_MS = 15_000;

/** Aynı IP'de istek taşmasını önleyen cömert pencere (ping ~1 token maliyetlidir). */
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (h.length >= 6) { hits.set(ip, h); return true; }
  h.push(now); hits.set(ip, h);
  return false;
}

export async function GET(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Çok sık test: bir dakika bekleyip tekrar deneyin.' }, { status: 429 });
  }

  const status = aiConfigStatus();
  const source = status.env ? 'env' : status.file ? 'file' : 'none';
  const model = aiModel();
  const mode = classicVisionMode() ? 'classic (/chat/completions)' : 'gateway (/chat/completions/vision)';
  const env = envCredentials();
  const host = env ? new URL(env.baseUrl).host : status.file ? 'yapılandırma dosyası' : null;

  if (source === 'none') {
    return NextResponse.json({
      ok: false, source, model, mode, host,
      hint: 'Kimlik bilgisi yok: Vercel → Settings → Environment Variables bölümüne ZAI_API_KEY ve ZAI_BASE_URL ekleyip Redeploy yapın.',
    }, { status: 200 });
  }

  // 1-token'lık gerçek ping — anahtar/bağlantı/model zincirini uçtan uca sınar
  try {
    const zai = await createAiClient();
    const call = classicVisionMode()
      ? zai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'merhaba' }],
          max_tokens: 1,
          thinking: { type: 'disabled' },
        } as unknown as Parameters<typeof zai.chat.completions.create>[0])
      : zai.chat.completions.createVision({
          model,
          messages: [{ role: 'user', content: 'merhaba' }],
          max_tokens: 1,
          thinking: { type: 'disabled' },
        } as Parameters<typeof zai.chat.completions.createVision>[0]);

    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`ping ${Math.round(PING_TIMEOUT_MS / 1000)} sn içinde yanıt vermedi (timeout)`)), PING_TIMEOUT_MS));
    await Promise.race([call, timeout]);

    return NextResponse.json({
      ok: true, source, model, mode, host,
      hint: 'Bağlantı sağlıklı: anahtar, taban adres ve model geçerli. YZ analizi artık çalışmalı.',
    }, { status: 200 });
  } catch (e) {
    const raw = (e as Error)?.message ?? String(e);
    const tani = classifyUpstreamError(raw);
    const statusMatch = raw.match(/status (\d{3})/i);
    return NextResponse.json({
      ok: false, source, model, mode, host,
      upstreamStatus: statusMatch ? Number(statusMatch[1]) : null,
      upstreamKod: raw.match(/"code"\s*:\s*"?(\d{4})"?/)?.[1] ?? null,
      upstreamDetay: tani ? null : raw.replace(/^.*?status \d+:\s*/, '').slice(0, 160),
      hint: tani?.message
        ?? (/timeout/i.test(raw)
          ? 'Upstream zaman aşımı: servis yoğun veya taban adres erişilemez değil; birkaç saniye sonra tekrar test edin.'
          : 'Upstream isteği reddedildi; yukarıdaki kod/detay z.ai panelindeki anahtar ve planla karşılaştırılmalı.'),
    }, { status: 200 });
  }
}
