'use client';

/**
 * SAĞLAM POST YARDIMCISI
 *
 * Uzun süren AI isteklerinde önündeki ağ geçidi (preview proxy) zaman aşımına
 * uğrayıp JSON yerine HTML hata sayfası döndürebilir. Bu durumda eski kodun
 * `res.json()` çağrısı "Unexpected token '<'" hatası fırlatıyordu.
 *
 * Bu yardımcı:
 *  - yanıtı ÖNCE metin olarak okur ve JSON.parse ile güvenle ayrıştırır;
 *  - HTML/boş/bozuk yanıt gelirse anlaşılır Türkçe hata üretir ve bir kez
 *    otomatik olarak yeniden dener;
 *  - AbortController ile istemci tarafı zaman aşımı uygular;
 *  - sunucunun { ok:false, error } gövdesini yakalayıp mesajı geçirir.
 */
export async function postJsonSafe<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 90_000, retries = 1 } = opts;
  let lastErr: Error = new Error('Bilinmeyen hata');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let retryable = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: (Record<string, unknown> & { ok?: boolean; error?: string }) | undefined;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
      } catch {
        json = undefined; // HTML hata sayfası vb.
      }

      if (json === undefined || json === null) {
        retryable = attempt < retries;
        lastErr = new Error(
          'Sunucudan geçersiz yanıt alındı (ağ geçidi zaman aşımı olabilir).' +
            (retryable ? ' Otomatik olarak tekrar deneniyor…' : ' Lütfen tekrar deneyin.'),
        );
      } else if (!res.ok || json.ok === false) {
        const serverMsg = (json.error as string) ?? `Sunucu hatası (${res.status})`;
        // geçici durumlar (sınır / zaman aşımı / köprü hatası) için bir kez otomatik dene
        if (attempt < retries && [429, 502, 504].includes(res.status)) {
          retryable = true;
          lastErr = new Error(`${serverMsg} Tekrar deneniyor…`);
        } else {
          lastErr = new Error(serverMsg);
        }
      } else {
        return json as T;
      }
    } catch (e) {
      lastErr =
        (e as Error)?.name === 'AbortError'
          ? new Error(
              `İstek ${Math.round(timeoutMs / 1000)} sn içinde tamamlanmadı ve iptal edildi. Lütfen tekrar deneyin.`,
            )
          : (e as Error);
    } finally {
      clearTimeout(timer);
    }
    if (!retryable) break;
  }
  throw lastErr;
}
