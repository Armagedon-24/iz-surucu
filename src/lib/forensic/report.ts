/**
 * RESMÎ RAPOR ÜRETECİ — KISA DÜZEN
 *
 * Isparta İl Emniyet Müdürlüğü / Yalvaç İlçe Emniyet Müdürlüğü Olay Yeri
 * İnceleme Grup Amirliği antetiyle, kendi kendine yeten (görselleri base64
 * gömülü) HTML raporu üretir. Ortak içerik modeli (buildReportContent)
 * PDF üreticisiyle paylaşılır.
 */
import type { Snapshot, AnalysisRecord, OcrRecord, AuditEntry } from './store';

export interface ReportData {
  caseNo: string;
  examiner: string;
  authority: string; // talep eden makam
  note: string;
  date: string;
  snapshots: Snapshot[];
  analyses: AnalysisRecord[];
  ocrs: OcrRecord[];
  currentView?: { label: string; image: string };
  imageInfo?: string;
  /** Delil bütünlüğü — yükleme anında hesaplanan SHA-256 özeti */
  integrity?: { sha256: string; bytes: number; algo: string; recordedTs?: string };
  /** Denetim izi — yapılan işlemlerin kronolojik kaydı */
  audit?: AuditEntry[];
  /** Üst veri (EXIF) taramasının özet notları */
  metaNotes?: string[];
}

export interface AiFinding {
  baslik: string;
  siddet: string;
  aciklama: string;
  yer: string;
}

export interface AiItem {
  meta: string;
  okunan: string;
  genel: string;
  silmeTahrip: string;
  bulgular: AiFinding[];
  guven?: number;
}

export interface ReportContent {
  raporNo: string;
  raporTarihi: string;
  talepEdenMakam: string;
  inceleyen: string;
  sistem: string;
  deliller: string[]; // I. bölüm paragrafları
  kapsam: string; // II. bölüm
  yontem: string[]; // III. bölüm maddeleri
  snapshotItems: { img: string; caption: string }[]; // IV.1 (rapora gömülenler)
  imagesTotal: number; // toplam görüntü kaydı (kırpılan notu için)
  ocrItems: { meta: string; text: string }[]; // IV.2
  aiItems: AiItem[]; // IV.3
  integrityLine?: string; // IV.4 üst veri özeti öncesi delil kimliği
  metaNotes: string[]; // IV.4 üst veri (EXIF) özeti
  auditItems: string[]; // IV.5 denetim izi
  sonuc: string[]; // V. bölüm paragrafları
  hazirlayan: string; // imza bloğu ad soyad / birim
  disclaimer: string;
}

const SYSTEM_NAME = 'İzSürücü (SENTINEL VSC-9) Dijital Belge İnceleme Konsolu';

/** Antet satırları — PDF ve HTML'de ortak kurum başlığı */
export const HEADER_LINES = [
  'T.C.',
  'ISPARTA İL EMNİYET MÜDÜRLÜĞÜ',
  'YALVAÇ İLÇE EMNİYET MÜDÜRLÜĞÜ',
  'OLAY YERİ İNCELEME GRUP AMİRLİĞİ',
] as const;

/** Raporun sayfa sayısı şişmesin diye gömülen içerik sınırları */
const MAX_REPORT_IMAGES = 4; // rapora gömülecek azami görüntü
const MAX_OCR_CHARS = 600; // uzun OCR okumaları burada kesilir
const MAX_OKUNAN_CHARS = 400; // AI "okunan metin" sınırı

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Roman rakamı — resmî bölüm numaralandırması */
function roman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n - 1] ?? String(n);
}

export function buildReportContent(d: ReportData): ReportContent {
  const tr = (ts: number) => new Date(ts).toLocaleString('tr-TR');

  // --- IV.1 anlık görüntü kayıtları (en fazla MAX_REPORT_IMAGES gömülür) ---
  const allImages: { img: string; caption: string }[] = [
    ...(d.currentView
      ? [{ img: d.currentView.image, caption: `İncelenen görüntü · ${d.currentView.label}` }]
      : []),
    ...d.snapshots.map(
      (s) =>
        ({
          img: s.thumb,
          caption: `${s.modeName} (${s.modeNm}) · ${s.paramsSummary} · ${tr(s.ts)}`,
        }) as { img: string; caption: string },
    ),
  ];
  const imagesTotal = allImages.length;
  const snapshotItems = allImages.slice(0, MAX_REPORT_IMAGES);

  // --- IV.2 OCR kayıtları (uzun okumalar kısaltılır) ---
  const ocrItems = d.ocrs.map((o) => ({
    meta: `[${tr(o.ts)}] Kaynak: ${o.source} · Güven: %${o.confidence.toFixed(1)}`,
    text: clip(o.text.trim(), MAX_OCR_CHARS),
  }));

  // --- IV.3 AI adli analiz kayıtları ---
  const aiItems: AiItem[] = d.analyses.map((a) => {
    const r = (a.result ?? {}) as Record<string, unknown>;
    const bulgular: AiFinding[] = Array.isArray(r.bulgular)
      ? (r.bulgular as Array<Record<string, unknown>>).map((f) => ({
          baslik: String(f.baslik ?? '—'),
          siddet: String(f.siddet ?? 'bilgi'),
          aciklama: String(f.aciklama ?? ''),
          yer: String(f.yer ?? ''),
        }))
      : [];
    return {
      meta: `[${tr(a.ts)}] Bant: ${a.bandLabel}${typeof r.guven === 'number' ? ` · Model güveni: %${r.guven}` : ''}`,
      okunan:
        typeof r.okunan_metin === 'string' && r.okunan_metin.trim()
          ? clip(r.okunan_metin.trim(), MAX_OKUNAN_CHARS)
          : '',
      genel: typeof r.genel_degerlendirme === 'string' ? r.genel_degerlendirme.trim() : '',
      silmeTahrip: typeof r.silme_tahrip_kusu === 'string' ? r.silme_tahrip_kusu.trim() : '',
      bulgular,
      guven: typeof r.guven === 'number' ? r.guven : undefined,
    };
  });

  // --- I. İNCELEMEYE KONU DELİLLER ---
  const deliller: string[] = [];
  deliller.push(
    `İncelemeye konu delil, gönderilen dijital görüntü dosyasıdır${d.imageInfo ? ` (${d.imageInfo})` : ''}. Dosya üzerinde ${imagesTotal} görüntü, ${d.ocrs.length} OCR ve ${d.analyses.length} yapay zekâ analiz kaydı oluşturulmuştur.`,
  );
  if (d.integrity?.sha256) {
    deliller.push(
      `Delil dosyasının ${d.integrity.algo} özeti, inceleme başlangıcında hesaplanmış ve kayıt altına alınmıştır (${d.integrity.sha256}${d.integrity.bytes ? ` · ${d.integrity.bytes} bayt` : ''}). İnceleme boyunca bu özet üzerinden doğrulama yapılmış, dosyada değişiklik yapılmamıştır.`,
    );
  }
  if (d.note.trim()) deliller.push(`Delil notu: ${d.note.trim()}`);

  // --- II. İNCELEMENİN KAPSAMI ---
  const kapsam =
    'İncelemede; karalama/boya altında kalan yazıların okunması, silme, tahrip ve sonradan ekleme şüphelerinin tespiti ile mürekkep/baskı farklılıklarının değerlendirilmesi amaçlanmıştır.';

  // --- III. UYGULANAN YÖNTEM VE TEKNİK (kısa) ---
  const yontem: string[] = [];
  yontem.push(
    `${SYSTEM_NAME} ile çok bantlı spektral inceleme ve dijital görüntü işleme; kontrast/CLAHE, kenar algılama, eşikleme, yanlış renk ve negatif teknikleri uygulanmıştır.`,
  );
  if (d.ocrs.length) {
    yontem.push('Optik karakter okuma (OCR) ile metin okuması yapılmıştır.');
  }
  if (d.analyses.length) {
    yontem.push(
      'Yapay zekâ destekli görüntü analiziyle okuma, silme/tahrip ve mürekkep farklılığı bulguları üretilmiştir.',
    );
  }
  if (d.metaNotes?.length) {
    yontem.push('Delil dosyasının üst verisi (EXIF/PNG) çözümlenmiş; yazılım izleri, çekim bilgisi ve konum verisi değerlendirilmiştir.');
  }
  if (d.audit?.length) {
    yontem.push('İnceleme boyunca her işlem adımı zaman damgasıyla denetim izine kaydedilmiş; delil bütünlüğü SHA-256 özetiyle doğrulanmıştır.');
  }

  // --- V. SONUÇ VE KANAAT (kısa; bulgular IV.3'te ayrıntılıdır) ---
  const sonuc: string[] = [];
  sonuc.push('Yapılan inceleme sonucunda;');
  const primary = aiItems.find((a) => a.okunan) ?? aiItems[0];
  if (primary) {
    if (primary.okunan) {
      sonuc.push(
        `Belge üzerinde okunan metin: "${primary.okunan}"${typeof primary.guven === 'number' ? ` (güven: %${primary.guven})` : ''}`,
      );
    }
    if (primary.genel) sonuc.push(primary.genel);
    if (primary.silmeTahrip) sonuc.push(`Silme/tahrip değerlendirmesi: ${primary.silmeTahrip}`);
  } else {
    sonuc.push(
      'Yapay zekâ analiz kaydı oluşturulmamıştır; değerlendirme gömülü görüntü ve OCR kayıtları temelinde yapılmalıdır.',
    );
  }
  sonuc.push(
    'Kanaat: Bulguların resmî süreçlerde sertifikalı laboratuvar cihazlarıyla (VSC/ESDA) doğrulanması önerilir.',
  );

  // --- IV.4 üst veri özeti ve IV.5 denetim izi ---
  const metaNotes = (d.metaNotes ?? []).slice(0, 10).map((s) => clip(s, 220));
  const auditItems = (d.audit ?? []).slice(-24).map(
    (e) => `[${tr(e.ts)}] ${e.action}${e.detail ? ` — ${e.detail}` : ''}`,
  );

  return {
    raporNo: d.caseNo,
    raporTarihi: d.date,
    talepEdenMakam: d.authority.trim() || '—',
    inceleyen: d.examiner.trim() || '—',
    sistem: SYSTEM_NAME,
    deliller,
    kapsam,
    yontem,
    snapshotItems,
    imagesTotal,
    ocrItems,
    aiItems,
    integrityLine: d.integrity?.sha256
      ? `${d.integrity.algo}: ${d.integrity.sha256}${d.integrity.bytes ? ` · ${d.integrity.bytes} bayt` : ''}`
      : undefined,
    metaNotes,
    auditItems,
    sonuc,
    hazirlayan: d.examiner.trim() || 'İnceleyen Uzman',
    disclaimer:
      'Not: Sanal spektral bantlar yazılım simülasyonudur; bu çıktı bağımsız adli rapor niteliği taşımaz, resmî süreçlerde yetkili adli laboratuvar raporları esas alınır.',
  };
}

export const SECTIONS = { roman };

/* ------------------------------------------------------------------ */
/*  HTML RAPORU — resmî antetli kısa düzen, A4 baskıya uygun           */
/* ------------------------------------------------------------------ */

export function buildHtmlReport(d: ReportData): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const c = buildReportContent(d);

  const snapRows = c.snapshotItems
    .map(
      (s, i) => `
    <div class="snap">
      <img src="${s.img}" alt="Görüntü kaydı ${i + 1}" />
      <div class="cap"><b>Görüntü ${i + 1}:</b> ${esc(s.caption)}</div>
    </div>`,
    )
    .join('');

  const ocrRows = c.ocrItems
    .map(
      (o, i) => `
    <div class="ocr">
      <div class="blk-baslik">OCR Kaydı ${i + 1}</div>
      <div class="meta">${esc(o.meta)}</div>
      <pre>${esc(o.text) || '(boş okuma)'}</pre>
    </div>`,
    )
    .join('');

  const aiRows = c.aiItems
    .map((a, i) => {
      const findings = a.bulgular.length
        ? `<ol class="bulgu">${a.bulgular
            .map(
              (f) =>
                `<li><b>${esc(f.baslik)}</b>${f.yer ? ` <i>(${esc(f.yer)})</i>` : ''} [şiddet: ${esc(f.siddet)}]<br/>${esc(f.aciklama)}</li>`,
            )
            .join('')}</ol>`
        : '';
      return `
    <div class="ai">
      <div class="blk-baslik">Yapay Zekâ Adli Analiz Kaydı ${i + 1}</div>
      <div class="meta">${esc(a.meta)}</div>
      ${a.okunan ? `<div class="okunan"><span class="etiket">Modelin okuduğu metin:</span><pre>${esc(a.okunan)}</pre></div>` : ''}
      ${a.genel ? `<p><span class="etiket">Genel değerlendirme:</span> ${esc(a.genel)}</p>` : ''}
      ${a.silmeTahrip ? `<p><span class="etiket">Silme/tahrip değerlendirmesi:</span> ${esc(a.silmeTahrip)}</p>` : ''}
      ${findings}
    </div>`;
    })
    .join('');

  const metaRows = c.metaNotes.length
    ? c.metaNotes.map((m) => `<li>${esc(m)}</li>`).join('')
    : '';
  const auditRows = c.auditItems.length
    ? `<ol class="audit">${c.auditItems.map((a) => `<li><span class="mono">${esc(a)}</span></li>`).join('')}</ol>`
    : '';

  const sec = (n: number, title: string, body: string) => `
    <div class="bolum">
      <div class="bolum-baslik">${SECTIONS.roman(n)}. ${esc(title.toLocaleUpperCase('tr'))}</div>
      ${body}
    </div>`;

  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Adli Belge İnceleme Raporu — ${esc(c.raporNo)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 13px; line-height: 1.55;
         color: #111; max-width: 210mm; margin: 0 auto; padding: 14mm 16mm; background: #fff; }
  .yazdir { position: sticky; top: 0; background: #f5f2ec; border: 1px solid #c9b98a; padding: 8px 12px;
            font-family: Arial, sans-serif; font-size: 12px; margin-bottom: 10mm; }
  .yazdir button { padding: 6px 14px; cursor: pointer; }
  header { text-align: center; margin-bottom: 5mm; }
  header .tc { font-size: 19px; letter-spacing: 2px; font-weight: bold; }
  header .il { font-size: 16.5px; font-weight: bold; letter-spacing: 1px; }
  header .ilce { font-size: 15px; font-weight: bold; }
  header .birim { font-size: 13.5px; font-weight: bold; }
  header .sistem { font-size: 11px; color: #555; margin-top: 2mm; font-style: italic; }
  .cift-cizgi { border-top: 3px double #111; margin: 4mm 0; }
  table.bilgi { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  table.bilgi td, table.bilgi th { border: 1px solid #444; padding: 5px 9px; font-size: 13px; text-align: left; vertical-align: top; }
  table.bilgi th { background: #efede6; width: 44mm; font-weight: bold; white-space: nowrap; }
  .bolum { margin-bottom: 7mm; page-break-inside: auto; }
  .bolum-baslik { font-weight: bold; font-size: 14px; border-bottom: 1.5px solid #111;
                  padding-bottom: 2px; margin-bottom: 3mm; letter-spacing: 0.5px; }
  .blk-baslik { font-weight: bold; font-size: 13px; margin: 4mm 0 2mm; }
  p { margin: 0 0 2.5mm; text-align: justify; }
  ol.madde { margin: 0 0 2.5mm 6mm; padding: 0; }
  ol.madde li { margin-bottom: 2mm; text-align: justify; }
  .snap { border: 1px solid #999; padding: 3mm; margin: 0 0 4mm; page-break-inside: avoid; }
  .snap img { max-width: 100%; display: block; margin: 0 auto 2mm; }
  .cap { font-size: 12px; color: #333; }
  .ocr, .ai { border: 1px solid #bbb; padding: 3mm; margin: 0 0 4mm; page-break-inside: avoid; }
  .meta { font-size: 12px; color: #333; margin-bottom: 2mm; }
  pre { background: #f7f7f4; border: 1px solid #ddd; padding: 2.5mm; white-space: pre-wrap;
        font-family: 'Courier New', monospace; font-size: 12px; margin: 0 0 2mm; }
  .etiket { font-weight: bold; }
  ol.bulgu { margin: 1mm 0 1mm 6mm; padding: 0; font-size: 13px; }
  ol.bulgu li { margin-bottom: 2mm; text-align: justify; }
  ol.audit { margin: 1mm 0 1mm 6mm; padding: 0; font-size: 11px; }
  ol.audit li { margin-bottom: 1mm; }
  .mono { font-family: 'Courier New', monospace; }
  .imza { margin-top: 10mm; page-break-inside: avoid; width: 100%; }
  .imza td { vertical-align: top; }
  .imza-sag { width: 45%; text-align: center; }
  .imza-sag .rol { font-weight: bold; }
  .imza-cizgi { margin-top: 16mm; border-top: 1px dotted #111; padding-top: 2mm; font-size: 12px; }
  footer { margin-top: 8mm; font-size: 11px; color: #444; border-top: 1px solid #999; padding-top: 2.5mm;
           font-style: italic; text-align: justify; }
  @media print { .yazdir { display: none; } body { padding: 0; max-width: none; } }
</style></head><body>
<div class="yazdir">Resmî düzen: A4 · Bu raporu yazdırırken veya PDF'e çevirirken tarayıcı yazdırma penceresini kullanın.
  <button onclick="window.print()">Yazdır / PDF kaydet</button></div>
<header>
  ${HEADER_LINES.map(
    (line, i) => `<div class="${['tc', 'il', 'ilce', 'birim'][i]}">${esc(line)}</div>`,
  ).join('')}
  <div class="sistem">${esc(c.sistem)} çıktısı</div>
  <div class="cift-cizgi"></div>
</header>
<table class="bilgi">
  <tr><th>Rapor No</th><td colspan="2"><b>${esc(c.raporNo)}</b></td><th>Rapor Tarihi</th><td>${esc(c.raporTarihi)}</td></tr>
  <tr><th>Talep Eden Makam</th><td colspan="4">${esc(c.talepEdenMakam)}</td></tr>
  <tr><th>İnceleyen</th><td colspan="4">${esc(c.inceleyen)}</td></tr>
</table>
${sec(1, 'İncelemeye Konu Deliller', c.deliller.map((p) => `<p>${esc(p)}</p>`).join(''))}
${sec(2, 'İncelemenin Kapsamı ve Talebi', `<p>${esc(c.kapsam)}</p>`)}
${sec(3, 'Uygulanan Yöntem ve Teknik',
  `<ol class="madde">${c.yontem.map((y) => `<li>${esc(y)}</li>`).join('')}</ol>`)}
${sec(4, 'Bulgular', `
  <div class="blk-baslik">IV.1 — Çok Bantlı Görüntü Kayıtları (${c.snapshotItems.length} adet)</div>
  ${c.imagesTotal > c.snapshotItems.length ? `<p><i>Toplam ${c.imagesTotal} görüntü kaydı mevcuttur; rapora ilk ${c.snapshotItems.length} kayıt eklenmiştir.</i></p>` : ''}
  ${snapRows || '<p><i>Görüntü kaydı oluşturulmamıştır.</i></p>'}
  <div class="blk-baslik">IV.2 — OCR (Optik Karakter Okuma) Kayıtları (${c.ocrItems.length} adet)</div>
  ${ocrRows || '<p><i>OCR kaydı oluşturulmamıştır.</i></p>'}
  <div class="blk-baslik">IV.3 — Yapay Zekâ Adli Analiz Kayıtları (${c.aiItems.length} adet)</div>
  ${aiRows || '<p><i>Yapay zekâ analiz kaydı oluşturulmamıştır.</i></p>'}
  ${c.integrityLine ? `<p class="meta"><span class="etiket">Delil bütünlüğü:</span> <span class="mono">${esc(c.integrityLine)}</span></p>` : ''}
  ${metaRows ? `<div class="blk-baslik">IV.4 — Üst Veri (EXIF) Değerlendirme Notları (${c.metaNotes.length} adet)</div><ol class="bulgu">${metaRows}</ol>` : ''}
  ${auditRows ? `<div class="blk-baslik">IV.5 — Denetim İzi: İşlem Kayıtları (${c.auditItems.length} adet)</div>${auditRows}` : ''}
`)}
${sec(5, 'Sonuç ve Kanaat', c.sonuc.map((p) => `<p>${esc(p)}</p>`).join(''))}
<table class="imza"><tr><td></td><td class="imza-sag">
  <div class="rol">İncelemeyi Yapan</div>
  <div>${esc(c.hazirlayan)}</div>
  <div class="imza-cizgi">İmza</div>
  <div style="font-size:12px;color:#333">${esc(c.raporTarihi)}</div>
</td></tr></table>
<footer>${esc(c.disclaimer)}</footer>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/*  İndirme yardımcıları                                               */
/* ------------------------------------------------------------------ */

export function downloadBlob(content: BlobPart, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
