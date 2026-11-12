import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createAiClient, aiModel, classicVisionMode } from '@/lib/forensic/ai-client';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface AnalyzeBody {
  original?: string;
  processed?: string;
  bandLabel?: string;
  ocrText?: string;
  question?: string;
  task?: 'forensic' | 'read' | 'erasure';
  processedList?: string[];
  variantLabels?: string[];
}

const SYSTEM_PROMPT = `Sen bir adli belge inceleme (questioned document examination) uzmanısın.
Görevin: bir belgenin fotoğrafını ve işlenmiş halini inceleyerek metni okumak, silme/tahrip
(kimyasal silme, silgi, üstüne yazma), mürekkep farklılıkları ve sonradan ekleme şüphelerini
tespit etmek. Yalnızca görüntüde gerçekten görünür olanı raporla; emin olmadığında "şüphe" de.
Türkçe, teknik ama kısa yaz.

SIKI UZUNLUK KURALLARI (aşmak yasak — gecikmeyi düşürmek için):
- "genel_degerlendirme": EN FAZLA 2 cümle.
- "bulgular": EN FAZLA 3 madde; her "aciklama" EN FAZLA 2 cümle.
- "murekkep_farkliliklari": EN FAZLA 3 kısa madde (tek satır).
- "oneriler": EN FAZLA 2 kısa madde (tek satır).
- Toplam yanıt 250 kelimeyi geçmesin.

Yanıtın SADECE şu JSON şeması olmalı (başka hiçbir metin, markdown veya kod bloğu olmadan):
{
  "okunan_metin": "görüntüdeki metinlerin birebir okuması",
  "genel_degerlendirme": "en fazla 2 cümle",
  "bulgular": [
    {"baslik": "kısa başlık", "aciklama": "en fazla 2 cümle", "yer": "konum", "siddet": "dusuk|orta|yuksek"}
  ],
  "murekkep_farkliliklari": ["kısa madde"],
  "silme_tahrip_kusu": "1-2 cümle, yoksa net ifade",
  "guven": 0-100 arası tam sayı,
  "oneriler": ["kısa madde"]
}`;

const READ_PROMPT = `Sen adli belge incelemede karalama (obliterasyon) altındaki yazıyı
okuma konusunda uzman bir modelsin. Kalın marker/karalama mürekkebinin ALTINDA kalan ince
tükenmez kalem yazısını okumak için sana bir belgenin ORİJİNAL fotoğrafı ve aynı bölgenin
farklı adli görüntü işleme teknikleriyle (spektral bant, kanal oranı, PCA, morfolojik
top-hat, mürekkep ayrıştırma) açılmış VARYANTLARI gönderiliyor.

Görev kuralları:
1. TÜM görüntüleri birlikte değerlendir; yazı izlerinin en belirgin olduğu varyantı temel al,
   diğerleriyle çapraz kontrol yap. Varyantlar aynı belgenin farklı işlenmiş halleridir;
   her birinde görünmeyen bir kelime diğerinde görünebilir.
2. Harf harf rekonstrüksiyon yap: eğim, çizgi uzunluğu, kelime bağlamı ve Türkçe yazım
   kalıplarını (tarih, tutar, isim, "TL", "tarih", "imza" gibi) kullanarak en olası okumayı kur.
3. Emin olmadığın harf/kelimeleri köşeli parantezle işaretle: [h?] gibi. Hiç iz göremediğin
   kelimeyi [okunamadı] olarak yaz. Tahmin ettiğin kelimeyi (tahmin: ...) diye belirt.
4. ASLA uydurma. Görüntüde hiç yazı izi yoksa bunu açıkça söyle; okunan_metin alanında
   boş bir okuma uydurma — ama tahminler alanını yine de doldur.
5. YAZI TAM OKUNAMASA BİLE görünüme dayalı MANTIKLI TAHMİNLER üret:
   - temel alınacak ipuçları: iz/çizgi sayısı, harf yükseklikleri, kelime uzunlukları,
     satır ve boşluk düzeni, başlangıç/bitiş kalıpları,
   - belge bağlamı: tarih, tutar, "TL", "tarih", "imza", başlık, T.C. kimlik no gibi
     kalıplar ve OCR referansındaki bağlam,
   - her tahmin: en olası içerik hipotezi + gerekçe (hangi izlere dayanıyor) + güven,
   - tahmin görüntüdeki izlerle ÇELİŞMEMELİ; uydurma değil, iz yapısıyla tutarlı
     en olası okuma. En az 1, en fazla 3 tahmin ver.
   - gorunurluk "yok" olsa bile yapısal çıkarım ver (kaç kelime/satır, imza/tablo yapısı).
6. Türkçe yaz.

Yanıtın SADECE şu JSON şeması olmalı (başka hiçbir metin, markdown veya kod bloğu olmadan):
{
  "okunan_metin": "karalama altındaki yazının en olası tam okuması ([?], [okunamadı] işaretleriyle)",
  "kelime_guveni": [
    {"kelime": "kelime", "guven": 0-100, "not": "kısa not veya boş string"}
  ],
  "tahminler": [
    {"tahmin": "en olası içerik hipotezi", "gerekce": "görüntüdeki hangi izlere dayanıyor", "guven": 0-100}
  ],
  "gorunurluk": "yok|iz|kismi|okunur",
  "en_iyi_varyant": 1-4 arası tam sayı (en çok yardımcı olan görselin sırası; 1=orijinal),
  "genel_degerlendirme": "2-4 cümle: hangi teknik neden işe yaradı, yazının durumu",
  "guven": 0-100 arası tam sayı,
  "oneriler": ["okunabilirliği artırmak için somut öneriler (ör. hangi ışıkta yeni çekim)"]
}

SIKI UZUNLUK KURALLARI: kelime_guveni EN FAZLA 12 madde (yalnızca en kritik kelimeler),
tahminler EN FAZLA 3 madde, oneriler EN FAZLA 2 kısa madde; "not" ve "gerekce" alanları
tek cümleyi geçmesin. Toplam yanıt 350 kelimeyi geçmesin.`;

const ERASURE_PROMPT = `Sen adli belge incelemede silme (eradikasyon) tespiti konusunda uzman bir
modelsin. Yazıldıktan sonra silinen (silgi/mekanik, kimyasal çözücü, kazıma) yazıyı tespit etmek
için sana bir belgenin ORİJİNAL fotoğrafı ve aynı bölgenin farklı adli görüntü işleme
Teknikleriyle (eğik ışık rölyefi, doku bozulması haritası, mürekkep kalıntısı DoG, kanal
oranları, PCA, top-hat) açılmış VARYANTLARI gönderiliyor.

Görev kuralları:
1. TÜM görüntüleri birlikte değerlendir; silme izlerinin (yüzey deformasyonu, lif bozulması,
   mürekkep kalıntısı, renk tonu farkı, bölge sınırları) en belirgin olduğu varyantı temel al.
2. Silme varsa türünü belirle: kimyasal (renk tonu/kalıntı farkı), silgi (yüzey aşınması,
   girinti), kazıma (çizik, kâğıt incelmesi). Bulguları konum ve şiddetle raporla.
3. Kalan izlerden silinen yazının içeriğini TAHMİN ET: görünen harf parçaları, çizgi sayısı,
   kelime uzunlukları, satır düzeni ve belge bağlamı (tarih, tutar, isim, "TL" gibi) kullan.
   Emin olmadığın harfleri [h?] ile işaretle; hiç iz göremediğin kelimeyi [okunamadı] yaz.
4. ASLA uydurma. Silme izi veya yazı izi yoksa bunu net söyle; silinen_yazi alanında
   boş okuma uydurma — ama tahminler alanını doldur.
5. Yazı tam okunamasa bile görünüme dayalı mantıklı tahminler üret (en az 1, en fazla 3):
   her tahmin en olası içerik hipotezi + gerekçe + güven içermeli; izlerle ÇELİŞMEMELİ.
6. Türkçe yaz. Kısa ve teknik ol.

Yanıtın SADECE şu JSON şeması olmalı (başka hiçbir metin, markdown veya kod bloğu olmadan):
{
  "silme_var": "evet|hayir|supheli",
  "silme_turu": "kimyasal|silgi|kazima|belirsiz",
  "silinen_yazi": "silinen yazının en olası okuması ([?], [okunamadı] işaretleriyle)",
  "tahminler": [
    {"tahmin": "en olası içerik hipotezi", "gerekce": "görüntüdeki hangi izlere dayanıyor", "guven": 0-100}
  ],
  "bulgular": [
    {"baslik": "kısa başlık", "aciklama": "en fazla 2 cümle", "yer": "konum", "siddet": "dusuk|orta|yuksek"}
  ],
  "genel_degerlendirme": "2-4 cümle: hangi teknik neden işe yaradı, silmenin durumu",
  "guven": 0-100 arası tam sayı,
  "oneriler": ["kısa madde"]
}

SIKI UZUNLUK KURALLARI: tahminler EN FAZLA 3, bulgular EN FAZLA 3, oneriler EN FAZLA 2
kısa madde; "gerekce" tek cümleyi geçmesin. Toplam yanıt 300 kelimeyi geçmesin.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vision token sayısı megapiksel ile büyür — bu eşiği aşan görüntü küçültülür. */
const MAX_IMAGE_PIXELS = 1_150_000; // ≈ 1024×1123
const MAX_IMAGE_BYTES = 900_000;    // ≈ 0.9 MB ham JPEG — gereksiz büyük yükleri yeniden kodla

function parseDataUrl(url: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(url);
  if (!m) return null;
  try {
    return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

/**
 * Görseli AI çağrısı için normalize eder: megapiksel eşiğini aşan görüntüyü
 * uzun kenardan 1150 piksele indirir, aşırı büyük JPEG'leri yeniden kodlar.
 * Vision token'ı piksele bağlı olduğundan bu, gecikmeyi doğrudan düşürür;
 * yazı izleri 1150 px'de korunur. Hata olursa orijinal geçirilir.
 */
async function normalizeImage(url: string): Promise<{ url: string; resized: boolean }> {
  const parsed = parseDataUrl(url);
  if (!parsed) return { url, resized: false };
  try {
    const img = sharp(parsed.buffer, { failOn: 'none' });
    const meta = await img.metadata();
    const px = (meta.width ?? 0) * (meta.height ?? 0);
    const tooBig = px > MAX_IMAGE_PIXELS || parsed.buffer.length > MAX_IMAGE_BYTES;
    if (!tooBig) return { url, resized: false };
    const out = await img
      .resize({ width: 1150, height: 1150, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { url: `data:image/jpeg;base64,${out.toString('base64')}`, resized: true };
  } catch {
    return { url, resized: false };
  }
}

/**
 * Önündeki ağ geçidi (preview proxy) çok uzun isteklerde zaman aşımına uğrayıp
 * HTML hata sayfası döndürebildiği için istek bu bütçe içinde bitmelidir —
 * bütçe aşılırsa JSON olarak 504 döner (asla HTML değil).
 *
 * Ölçümler (glm-5.3-flash, gateway): 1 görsel ≈ 4-5 sn, 2 görsel ≈ 20 sn,
 * 4 görsel (1000px + 3×760px) prefill + üretim ≈ 25-45 sn sürdüğü için
 * bütçe 19 sn'den 45 sn'ye çıkarıldı; istemci tarafı timeout 90 sn'dir.
 * ANALYZE_TOTAL_BUDGET_MS ile geçersiz kılınabilir.
 */
const TOTAL_BUDGET_MS = Math.max(10_000, Number(process.env.ANALYZE_TOTAL_BUDGET_MS ?? 45_000));
const ATTEMPT_BUDGET_MS = Math.min(
  Math.max(8_000, Number(process.env.ANALYZE_ATTEMPT_BUDGET_MS ?? 40_000)),
  TOTAL_BUDGET_MS - 3_000,
);
/** Yeniden deneme için kalan süre eşiği — vision çağrısı en az ~10 sn ister */
const RETRY_MIN_REMAINING_MS = 22_000;

function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} ${Math.round(ms / 1000)} sn içinde yanıt vermedi (timeout)`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Vision çağrısını geçici hatalara (401/429/5xx/ağ) karşı yeniden dener.
 * Her denemede ZAI örneği tazelenir — böylece kimlik bilgisi rotasyonu
 * (ör. "missing X-Token header" 401'i) otomatik olarak toparlanır.
 * Zaman aşımı TOTAL_BUDGET_MS içinde en fazla bir kez yeniden denenir;
 * bütçe bitince hemen fırlatılır (yanıt yine JSON döner).
 */
async function createVisionWithRetry(
  system: string,
  userText: string,
  images: string[],
  maxTokens: number,
) {
  const maxAttempts = 3;
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - start);
    // deneme için kalan süre yetersizse hiç başlama (kısa süreli deneme
    // yine zaman aşımına uğrar ve ağ geçidi sınırını zorlar)
    if (remaining < 6000) break;
    const budget = Math.min(remaining, ATTEMPT_BUDGET_MS);
    try {
      const zai = await createAiClient(); // ortam değişkeni → dosya zinciri sırasıyla çözülür
      const body = {
        model: aiModel(), // ZAI_MODEL ile geçersiz kılınabilir
        messages: [
          { role: 'system' as const, content: system },
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: userText },
              ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
            ],
          },
        ],
        thinking: { type: 'disabled' as const },
        // yanıt uzunluğu sınırlanır: üretim süresi ve gecikme düşer
        max_tokens: maxTokens,
      };
      // api.z.ai gibi OpenAI-uyumlu uçlar standart /chat/completions yolunu kullanır;
      // SDK ağ geçidi ise /chat/completions/vision yolu ister — ZAI_VISION_MODE seçer.
      const call = classicVisionMode()
        ? zai.chat.completions.create(
            body as unknown as Parameters<typeof zai.chat.completions.create>[0]
          )
        : zai.chat.completions.createVision(
            body as Parameters<typeof zai.chat.completions.createVision>[0]
          );
      return await raceTimeout(call, budget, 'AI servisi');
    } catch (e) {
      lastError = e;
      const msg = (e as Error)?.message ?? '';
      const transient =
        /401|429|500|502|503|504|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed/i.test(msg);
      console.error(`[analyze] vision deneme ${attempt}/${maxAttempts} başarısız: ${msg.slice(0, 200)}`);
      if (!transient || attempt === maxAttempts) break;
      // yalnızca yeniden denemeye değecek süre kaldıysa bekle ve tekrarla;
      // zaman aşımı sonrası kalan süre zaten yetmezse hemen fırlat
      const remainingNow = TOTAL_BUDGET_MS - (Date.now() - start);
      if (remainingNow < RETRY_MIN_REMAINING_MS) break;
      await sleep(Math.min(1200 * attempt, Math.max(0, remainingNow - 8000)));
    }
  }
  throw lastError;
}

/** Ham SDK hatalarını kullanıcı dostu Türkçe mesajlara çevirir. */
function friendlyError(e: unknown): { message: string; status: number } {
  const msg = (e as Error)?.message ?? 'Analiz sunucusunda beklenmeyen hata';
  if (/401|X-Token|unauthorized|kimlik/i.test(msg)) {
    return {
      message:
        'AI servis kimliği doğrulanamadı: ZAI_API_KEY anahtarı geçersiz olabilir veya ' +
        'oturum sorunu yaşanıyor. Anahtarı (z.ai → API Keys) doğrulayıp birkaç saniye ' +
        'sonra tekrar deneyin.',
      status: 502,
    };
  }
  if (/429|rate/i.test(msg)) {
    return { message: 'AI servis sınırı aşıldı. Lütfen kısa bir süre bekleyip tekrar deneyin.', status: 429 };
  }
  if (/timeout|ETIMEDOUT|yanıt vermedi/i.test(msg)) {
    return {
      message: 'AI servisi zaman aşımına uğradı (görüntü çok büyük olabilir veya servis yoğun). Lütfen tekrar deneyin; genellikle ikinci deneme daha hızlı döner.',
      status: 504,
    };
  }
  if (/Configuration file not found|kimlik bilgi/i.test(msg)) {
    return {
      message:
        'AI servis kimlik bilgisi tanımlı değil. Vercel: Project Settings → Environment ' +
        'Variables bölümüne ZAI_API_KEY ve ZAI_BASE_URL (veya ZAI_TABAN_URL) değişkenlerini ' +
        'ekleyin, sonra Redeploy yapın. (Yerel geliştirmede .z-ai-config dosyası kullanılır.)',
      status: 500,
    };
  }
  return { message: msg.slice(0, 200) || 'Analiz sunucusunda beklenmeyen hata', status: 500 };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalyzeBody;
    const { original, processed, bandLabel, ocrText, question, task, processedList, variantLabels } = body;

    if (!original || typeof original !== 'string' || !original.startsWith('data:image')) {
      return NextResponse.json(
        { ok: false, error: 'Analiz için orijinal görüntü gerekli.' },
        { status: 400 }
      );
    }

    // çoklu varyant (karalama okuma) veya tek işlenmiş görüntü
    const extra = Array.isArray(processedList)
      ? processedList.filter((u) => typeof u === 'string' && u.startsWith('data:image')).slice(0, 3)
      : [];
    const rawImages = [original, ...(processed ? [processed] : []), ...extra];

    // boyut koruması (yaklaşık)
    if (rawImages.some((u) => u.length > 4_000_000)) {
      return NextResponse.json(
        { ok: false, error: 'Görüntü verisi çok büyük. Daha düşük çözünürlükle deneyin.' },
        { status: 413 }
      );
    }

    // vision token'ı piksele bağlı: büyük görüntüler küçültülür (gecikme kontrolü)
    const norm = await Promise.all(rawImages.map(normalizeImage));
    const images = norm.map((n) => n.url);
    const resizedCount = norm.filter((n) => n.resized).length;
    if (resizedCount > 0) console.error(`[analyze] ${resizedCount}/${images.length} görüntü küçültüldü`);

    const isRead = task === 'read';
    const isErasure = task === 'erasure';
    const system = isRead ? READ_PROMPT : isErasure ? ERASURE_PROMPT : SYSTEM_PROMPT;
    // üretim süresi bütçenin ana bileşeni: şemalar zaten kısa listeler istiyor;
    // bu limitler yanıt kalitesini korurken gecikmeyi sınırlar
    const maxTokens = isRead ? 1000 : isErasure ? 900 : 700;

    const userText = isRead || isErasure
      ? [
          'Görsel 1: belgenin ORİJİNAL fotoğrafı.',
          ...(variantLabels ?? []).slice(0, extra.length).map(
            (l, i) => `Görsel ${i + 2}: "${l}" tekniğiyle açılmış varyant.`
          ),
          extra.length > (variantLabels?.length ?? 0)
            ? `Ayrıca ${extra.length - (variantLabels?.length ?? 0)} adet işlenmiş varyant daha ekli.`
            : '',
          ocrText ? `OCR motorunun bu görüntülerde okuduğu metin (referans): """${ocrText}"""` : '',
          question ? `İnceleyenin özel sorusu: "${question}"` : '',
          isErasure
            ? 'Görevin: silinen yazıyı tespit etmek; silme türünü ve silinen içeriği görünüme dayalı mantıklı tahminlerle raporlamak. Yanıtı belirtilen JSON şemasıyla ver.'
            : 'Görevin: karalama altındaki yazıyı okumak; okunamıyorsa görünüme dayalı mantıklı tahminler üretmek. Yanıtı belirtilen JSON şemasıyla ver.',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'Görsel 1: belgenin ORİJİNAL fotoğrafı (görünür ışık).',
          `Görsel 2: aynı belgenin "${bandLabel ?? 'bilinmeyen'}" sanal bandında işlenmiş hali.`,
          ocrText ? `OCR motorunun okuduğu metin (referans): """${ocrText}"""` : '',
          question ? `İncelleyenin özel sorusu: "${question}"` : '',
          'Lütfen adli değerlendirmenizi belirtilen JSON şemasıyla yapın.',
        ]
          .filter(Boolean)
          .join('\n');

    const t0 = Date.now();
    const completion = await createVisionWithRetry(system, userText, images, maxTokens);
    console.error(
      `[analyze] vision tamam: ${Math.round((Date.now() - t0) / 1000)} sn, ` +
        `usage: ${JSON.stringify((completion as { usage?: unknown })?.usage ?? {})}`,
    );

    const content: string =
      (completion?.choices?.[0]?.message?.content as string | undefined) ?? '';

    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: 'Model boş yanıt döndürdü.' }, { status: 502 });
    }

    // JSON ayrıştırma: kod bloğu temizleme + en dış { } yakalama
    let result: Record<string, unknown> | null = null;
    const stripped = content.replace(/```(?:json)?/g, '').trim();
    const candidates = [stripped, content];
    for (const c of candidates) {
      const start = c.indexOf('{');
      const end = c.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          result = JSON.parse(c.slice(start, end + 1));
          break;
        } catch {
          /* sonraki aday */
        }
      }
    }

    return NextResponse.json({ ok: true, result, raw: content });
  } catch (e) {
    console.error('[analyze] nihai hata:', (e as Error)?.message ?? e);
    const { message, status } = friendlyError(e);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
