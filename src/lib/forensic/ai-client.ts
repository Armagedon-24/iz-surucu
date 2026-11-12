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

/** Kullanılacak vision modeli — ZAI_MODEL ile geçersiz kılınabilir. */
export function aiModel(): string {
  return process.env.ZAI_MODEL?.trim() || 'glm-5.3-flash';
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
