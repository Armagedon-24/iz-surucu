/**
 * AI İSTEMCİ ÇÖZÜCÜ — sunucusuz dağıtım (Vercel) uyumlu
 *
 * z-ai-web-dev-sdk varsayılan olarak kimlik bilgisini yalnızca DOSYADAN okur:
 *   - <proje kökü>/.z-ai-config
 *   - ~/.z-ai-config
 *   - /etc/.z-ai-config
 * Dosya yoksa SDK "Configuration file not found..." fırlatır ve panelde
 * "AI servis yapılandırması bulunamadı" hatası görünür. Sunucusuz ortamlarda
 * (Vercel vb.) bu dosya yoktur; dosya sistemi salt-okunurdur. Bu yüzden
 * ortam değişkenleri BİRİNCİ öncelikli kaynak olarak çözülür:
 *
 *   ZAI_BASE_URL     zorunlu (Z.ai açık platform: https://api.z.ai/api/paas/v4)
 *                    — Türkçe adlandırma ZAI_TABAN_URL de kabul edilir
 *   ZAI_API_KEY      zorunlu (https://z.ai/manage-apikey/apikey-list)
 *   ZAI_MODEL        opsiyonel — varsayılan: glm-5.3-flash
 *   ZAI_VISION_MODE  opsiyonel — 'classic': OpenAI-uyumlu standart
 *                    /chat/completions yolu (api.z.ai için gerekli);
 *                    'gateway': SDK ağ geçidi yolu (/chat/completions/vision);
 *                    belirtilmezse: env yolu = classic, dosya yolu = gateway
 *   ZAI_TOKEN        opsiyonel — yalnızca ağ geçidi hesapları (X-Token)
 *   ZAI_CHAT_ID / ZAI_USER_ID  opsiyonel — ağ geçidi izleme başlıkları
 *
 * Ortam değişkeni yoksa SDK'nın kendi dosya zinciri denenir; her ikisi de
 * yoksa hata mesajı kurulum adımlarını doğrudan tarif eder.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import ZAI, { type ZAIConfig } from 'z-ai-web-dev-sdk';

/** d.ts kurucuyu private işaretler; JS tarafında kurucu herkese açıktır. */
const ZAICtor = ZAI as unknown as new (config: ZAIConfig) => ZAI;

export interface AiConfigStatus {
  /** ZAI_BASE_URL + ZAI_API_KEY ortam değişkenleri tanımlı mı? */
  env: boolean;
  /** Geçerli bir .z-ai-config dosyası var mı (proje / home / /etc)? */
  file: boolean;
}

function fileConfigValid(): boolean {
  const candidates = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ];
  for (const p of candidates) {
    try {
      // turbopackIgnore: çalışma zamanında çözülen yapılandırma dosyası —
      // statik izleme tüm projeyi standalone çıktıya kopyalatıyordu (build hatası)
      if (!fs.existsSync(/* turbopackIgnore: true */ p)) continue;
      const c = JSON.parse(
        fs.readFileSync(/* turbopackIgnore: true */ p, 'utf8')
      ) as Partial<ZAIConfig>;
      if (c.baseUrl && c.apiKey) return true;
    } catch {
      /* okuma/parse hatası — sonraki adaya geç */
    }
  }
  return false;
}

/**
 * Ortam değişkenlerinden kimlik bilgisi çözer.
 * Taban adres için İKİ ad kabul edilir: ZAI_BASE_URL (uluslararası standart)
 * ve ZAI_TABAN_URL (Türkçe adlandırma — Vercel panosunda öyle kullanılıyor).
 */
export function envCredentials(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (process.env.ZAI_BASE_URL ?? process.env.ZAI_TABAN_URL)?.trim();
  const apiKey = process.env.ZAI_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export function aiConfigStatus(): AiConfigStatus {
  return {
    env: envCredentials() !== null,
    file: fileConfigValid(),
  };
}

/**
 * Kullanılacak vision modeli — ZAI_MODEL ile geçersiz kılınabilir.
 *
 * Varsayılan glm-4.6v-flash: vision (görüntü) sınıfından ve ücretsiz kademede.
 * glm-5.3-flash gibi salt-metin modelleri vision isteğinde (image_url parçası)
 * platform tarafından reddedilir — analiz istemcisi her zaman görüntü gönderir,
 * bu yüzden varsayılan mutlaka V modelli olmalıdır.
 */
export function aiModel(): string {
  return process.env.ZAI_MODEL?.trim() || 'glm-4.6v-flash';
}

/**
 * Upstream hata gövdesini iş koduna göre Türkçe tanıya çevirir (saf fonksiyon).
 * z.ai hata biçimi: {"error":{"code":"1001","message":"..."}} — SDK mesajı
 * "API request failed with status 401: <gövde>" olarak sarar.
 * Kaynak: docs.z.ai/api-reference/api-code
 */
export function classifyUpstreamError(
  raw: string,
): { message: string; status: number } | null {
  const body = raw.replace(/^.*?status \d+:\s*/, '').slice(0, 2000);
  const codeMatch = body.match(/"code"\s*:\s*"?(\d{4})"?/);
  const code = codeMatch?.[1] ?? '';
  const text = body.replace(/\s+/g, ' ').slice(0, 300);
  switch (code) {
    case '1000':
      return { message: 'Anahtar doğrulanamadı (kod 1000): ZAI_API_KEY yanlış, silinmiş veya bu taban adrese ait değil. z.ai → API Keys sayfasından güncel anahtarı kontrol edin.', status: 502 };
    case '1001':
      return { message: 'Anahtar isteğe ulaşmadı (kod 1001): ZAI_API_KEY değişkeninin adını ve değerini (baş/son boşluk, tırnak) kontrol edin; kaydettikten sonra Redeploy gerekir.', status: 502 };
    case '1003':
      return { message: 'Anahtarın süresi dolmuş (kod 1003): z.ai → API Keys sayfasından yeni anahtar üretip ortam değişkenini güncelleyin ve Redeploy yapın.', status: 502 };
    case '1005':
      return { message: 'Hesap iki aşamalı doğrulama istiyor (kod 1005): z.ai hesabınızda 2FA/telefon doğrulamasını tamamlayın.', status: 502 };
    case '1113':
      return { message: 'Hesap bakiyesi/paketi yetersiz (kod 1113): z.ai → Billing bölümünden bakiye yükleyin veya kaynak paketi ekleyin. (glm-4.6v-flash ücretsiz kademededir.)', status: 429 };
    case '1211':
      return { message: 'Model adı tanımsız (kod 1211): ZAI_MODEL değerini vision sınıfından bir modelle değiştirin (örn. glm-4.6v-flash).', status: 502 };
    case '1311':
      return { message: 'Abonelik planı bu modele erişim vermiyor (kod 1311): ZAI_MODEL olarak ücretsiz glm-4.6v-flash kullanın.', status: 502 };
    case '1220':
      return { message: 'Bu API çağrısına erişim izni yok (kod 1220): anahtarın kapsadığı servisi z.ai panelinden kontrol edin.', status: 503 };
  }
  if (/insufficient balance|bakiye|余额/i.test(text)) {
    return { message: 'Hesap bakiyesi/paketi yetersiz: z.ai → Billing bölümünden bakiye yükleyin veya kaynak paketi ekleyin.', status: 429 };
  }
  if (/api key not found|invalid api key|invalid_api_key|authentication/i.test(text)) {
    return { message: 'Anahtar geçersiz: ZAI_API_KEY değerini z.ai → API Keys sayfasından yeniden kopyalayın (boşluk/tırnak bırakmadan) ve Redeploy yapın.', status: 502 };
  }
  return null;
}

/**
 * true = OpenAI-uyumlu standart /chat/completions yolu (api.z.ai vb.);
 * false = SDK ağ geçidi yolu (/chat/completions/vision).
 *
 * ZAI_VISION_MODE açık seçim ister ('classic' | 'gateway'). Belirtilmemişse:
 * ortam değişkeniyle bağlanıldıysa classic (genel API uçları için doğru yol),
 * dosya zinciriyle bağlanıldıysa gateway varsayılır.
 */
export function classicVisionMode(): boolean {
  const mode = process.env.ZAI_VISION_MODE?.trim().toLowerCase();
  if (mode === 'gateway') return false;
  if (mode === 'classic') return true;
  return envCredentials() !== null;
}

/**
 * AI istemcisini çözer: önce ortam değişkenleri (Vercel), sonra SDK'nın
 * dosya zinciri (yerel geliştirme / ağ geçidi). Hiçbiri yoksa, ne yapılması
 * gerektiğini tarif eden açık bir hata fırlatılır.
 */
export async function createAiClient(): Promise<ZAI> {
  const env = envCredentials();
  if (env) {
    const cfg: ZAIConfig = { baseUrl: env.baseUrl, apiKey: env.apiKey };
    const token = process.env.ZAI_TOKEN?.trim();
    if (token) cfg.token = token;
    const chatId = process.env.ZAI_CHAT_ID?.trim();
    if (chatId) cfg.chatId = chatId;
    const userId = process.env.ZAI_USER_ID?.trim();
    if (userId) cfg.userId = userId;
    return new ZAICtor(cfg);
  }
  if (!fileConfigValid()) {
    throw new Error(
      'AI kimlik bilgisi eksik: ZAI_API_KEY ve ZAI_BASE_URL (veya ZAI_TABAN_URL) ' +
      'ortam değişkenlerini ayarlayın (Vercel: Project Settings → Environment Variables) ' +
      'veya geçerli bir .z-ai-config dosyası sağlayın. Değişken ekledikten sonra ' +
      'yeniden dağıtım (redeploy) gerekir.'
    );
  }
  return ZAI.create();
}
