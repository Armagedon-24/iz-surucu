/**
 * RESMÎ PDF RAPOR ÜRETECİ (İSTEMCİ TARAFI)
 *
 * jsPDF + gömülü DejaVu fontlar (Türkçe ı, İ, ş, ğ karakterleri için
 * WinAnsi kod sayfası yetmez, bu yüzden TTF gömülür — fontlar /fonts/
 * altından statik olarak çekilip tarayıcıda önbelleklenir).
 *
 * Düzen: Isparta İl Emniyet Müdürlüğü / Yalvaç İlçe Emniyet Müdürlüğü Olay
 * Yeri İnceleme Grup Amirliği antetli kısa resmî rapor düzeni
 * (buildReportContent ile HTML raporuyla aynı içerik modeli).
 */
import { buildReportContent, HEADER_LINES, SECTIONS, type ReportData } from './report';

interface Fonts {
  regular: string; // base64
  bold: string; // base64
}

interface PdfDeps {
  fonts?: Fonts; // test/enjeksiyon için
  imgSize?: (dataUrl: string) => Promise<{ w: number; h: number }>;
}

let fontsCache: Fonts | null = null;

function bufToBase64(buf: Uint8Array): string {
  let s = '';
  const CH = 32768;
  for (let i = 0; i < buf.length; i += CH) {
    s += String.fromCharCode(...buf.subarray(i, i + CH));
  }
  return btoa(s);
}

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font dosyası alınamadı (${res.status}): ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return bufToBase64(buf);
}

async function loadFonts(): Promise<Fonts> {
  if (fontsCache) return fontsCache;
  const [regular, bold] = await Promise.all([
    fetchFontBase64('/fonts/DejaVuSans.ttf'),
    fetchFontBase64('/fonts/DejaVuSans-Bold.ttf'),
  ]);
  fontsCache = { regular, bold };
  return fontsCache;
}

function defaultImgSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Görüntü boyutu okunamadı'));
    img.src = dataUrl;
  });
}

// --- düzen sabitleri (mm) ---
const PAGE_W = 210;
const PAGE_H = 297;
const M_LEFT = 18;
const M_RIGHT = 18;
const M_TOP = 14;
const M_BOTTOM = 18;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const FONT = 'DejaVu';

export async function buildOfficialPdf(d: ReportData, deps: PdfDeps = {}): Promise<Blob> {
  // jspdf yalnızca rapor indirilirken gerekir — başlangıç paketine girmesin
  // (statik import ~370 KB'lık kütüphaneyi ana chunk'a taşıyordu)
  const { jsPDF } = await import('jspdf');
  const fonts = deps.fonts ?? (await loadFonts());
  const imgSize = deps.imgSize ?? defaultImgSize;
  const c = buildReportContent(d);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.addFileToVFS('DejaVuSans.ttf', fonts.regular);
  pdf.addFont('DejaVuSans.ttf', FONT, 'normal');
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold);
  pdf.addFont('DejaVuSans-Bold.ttf', FONT, 'bold');

  let y = M_TOP;

  const ensure = (need: number) => {
    if (y + need > PAGE_H - M_BOTTOM) {
      pdf.addPage();
      y = M_TOP;
    }
  };

  const text = (
    s: string,
    opts: {
      size?: number;
      style?: 'normal' | 'bold';
      align?: 'left' | 'center' | 'right';
      x?: number;
      w?: number;
      color?: [number, number, number];
      lh?: number;
      gapAfter?: number;
    } = {},
  ) => {
    const {
      size = 10,
      style = 'normal',
      align = 'left',
      x = M_LEFT,
      w = CONTENT_W,
      color = [20, 20, 20],
      lh = 4.8,
      gapAfter = 2,
    } = opts;
    pdf.setFont(FONT, style);
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
    const lines = pdf.splitTextToSize(s, w) as string[];
    for (const line of lines) {
      ensure(lh);
      pdf.text(line, align === 'center' ? PAGE_W / 2 : align === 'right' ? PAGE_W - M_RIGHT : x, y, {
        align,
        maxWidth: w,
      });
      y += lh;
    }
    y += gapAfter;
  };

  const rule = (thickness = 0.4, gapAfter = 3) => {
    ensure(3);
    pdf.setDrawColor(30, 30, 30);
    pdf.setLineWidth(thickness);
    pdf.line(M_LEFT, y, PAGE_W - M_RIGHT, y);
    y += gapAfter;
  };

  const sectionTitle = (n: number, title: string) => {
    ensure(14);
    y += 2;
    text(`${SECTIONS.roman(n)}. ${title.toLocaleUpperCase('tr')}`, { size: 12, style: 'bold', gapAfter: 1 });
    rule(0.5, 3);
  };

  const kvRow = (cells: Array<{ label: string; value: string; w: number; labelW: number }>) => {
    const H = 8;
    ensure(H);
    let x = M_LEFT;
    pdf.setDrawColor(80, 80, 80);
    pdf.setLineWidth(0.25);
    for (const cell of cells) {
      // ÖNEMLİ: setTextColor dolgu rengini (g) koyu griya çevirir; her rect
      // öncesinde setFillColor yeniden kurulmazsa hücreler koyu blok olur.
      pdf.setFillColor(238, 236, 229);
      pdf.rect(x, y, cell.w, H, 'FD');
      pdf.setFillColor(238, 236, 229);
      pdf.rect(x, y, cell.labelW, H, 'FD');
      pdf.setFont(FONT, 'bold');
      pdf.setFontSize(9.5);
      pdf.text(cell.label, x + 2.5, y + H / 2 + 1.2);
      pdf.setFont(FONT, 'normal');
      const v = (pdf.splitTextToSize(cell.value, cell.w - cell.labelW - 5)[0] as string) ?? cell.value;
      pdf.text(v, x + cell.labelW + 2.5, y + H / 2 + 1.2);
      x += cell.w;
    }
    y += H;
  };

  const HALF = CONTENT_W / 2;
  const drawMetaTable = () => {
    kvRow([
      { label: 'RAPOR NO', value: c.raporNo, w: HALF, labelW: 30 },
      { label: 'RAPOR TARİHİ', value: c.raporTarihi, w: HALF, labelW: 34 },
    ]);
    kvRow([{ label: 'TALEP EDEN MAKAM', value: c.talepEdenMakam, w: CONTENT_W, labelW: 46 }]);
    kvRow([{ label: 'İNCELEYEN', value: c.inceleyen, w: CONTENT_W, labelW: 46 }]);
    y += 4;
  };

  const image = async (dataUrl: string, caption: string, idx: number) => {
    try {
      const { w, h } = await imgSize(dataUrl);
      let dispW = w > h ? 140 : 95; // yatay: geniş, dikey: dar — sayfa şişmesin
      let dispH = (dispW * h) / w;
      if (dispH > 160) {
        dispW = (dispW * 160) / dispH;
        dispH = 160;
      }
      ensure(dispH + 10);
      pdf.addImage(dataUrl, 'JPEG', PAGE_W / 2 - dispW / 2, y, dispW, dispH);
      y += dispH + 3.5; // altyazı harf yüksekliği görselin üstüne binmesin
      text(`Görüntü ${idx}: ${caption}`, { size: 8.5, color: [70, 70, 70], lh: 4, gapAfter: 4 });
    } catch {
      text(`[Görüntü ${idx} gömülemedi: ${caption}]`, { size: 8.5, color: [150, 30, 30] });
    }
  };

  const numbered = (items: string[], size = 10) => {
    items.forEach((it, i) => {
      const head = `${i + 1}) `;
      const wrapped = pdf.splitTextToSize(head + it, CONTENT_W - 5) as string[];
      wrapped.forEach((line, li) => {
        text(line, { size, x: M_LEFT + 5, lh: 4.8, gapAfter: li === wrapped.length - 1 ? 2 : 0 });
      });
    });
    y += 1.5;
  };

  /* ------------------------- ÜST BAŞLIK ------------------------- */
  text(HEADER_LINES[0], { size: 13, style: 'bold', align: 'center', lh: 6, gapAfter: 0 });
  text(HEADER_LINES[1], { size: 14, style: 'bold', align: 'center', lh: 6.5, gapAfter: 0 });
  text(HEADER_LINES[2], { size: 12.5, style: 'bold', align: 'center', lh: 6, gapAfter: 0 });
  text(HEADER_LINES[3], { size: 11, style: 'bold', align: 'center', lh: 5.5, gapAfter: 1 });
  text(c.sistem + ' çıktısı', { size: 8.5, color: [90, 90, 90], align: 'center', lh: 4, gapAfter: 1.5 });
  // çift çizgi
  rule(0.6, 1.2);
  rule(0.25, 3.5);

  /* ------------------------- BİLGİ TABLOSU ------------------------- */
  drawMetaTable();

  /* ------------------------- I. DELİLLER ------------------------- */
  sectionTitle(1, 'İncelemeye Konu Deliller');
  for (const p of c.deliller) text(p);

  /* ------------------------- II. KAPSAM ------------------------- */
  sectionTitle(2, 'İncelemenin Kapsamı ve Talebi');
  text(c.kapsam);

  /* ------------------------- III. YÖNTEM ------------------------- */
  sectionTitle(3, 'Uygulanan Yöntem ve Teknik');
  numbered(c.yontem);

  /* ------------------------- IV. BULGULAR ------------------------- */
  ensure(46); // başlık + ilk içerik aynı sayfada kalsın
  sectionTitle(4, 'Bulgular');

  y += 1;
  ensure(30);
  text(`IV.1 — Çok Bantlı Görüntü Kayıtları (${c.snapshotItems.length} adet)`, { size: 10.5, style: 'bold', gapAfter: 2 });
  if (!c.snapshotItems.length) text('Görüntü kaydı oluşturulmamıştır.', { color: [90, 90, 90] });
  if (c.imagesTotal > c.snapshotItems.length) {
    text(
      `Toplam ${c.imagesTotal} görüntü kaydı mevcut; rapora ilk ${c.snapshotItems.length} kayıt eklenmiştir.`,
      { size: 8.5, color: [90, 90, 90] },
    );
  }
  let imgIdx = 0;
  for (const s of c.snapshotItems) {
    imgIdx += 1;
    await image(s.img, s.caption, imgIdx);
  }

  y += 1;
  ensure(24);
  text(`IV.2 — OCR (Optik Karakter Okuma) Kayıtları (${c.ocrItems.length} adet)`, { size: 10.5, style: 'bold', gapAfter: 2 });
  if (!c.ocrItems.length) text('OCR kaydı oluşturulmamıştır.', { color: [90, 90, 90] });
  c.ocrItems.forEach((o, i) => {
    text(`OCR Kaydı ${i + 1}`, { size: 10, style: 'bold', gapAfter: 0.5 });
    text(o.meta, { size: 8.5, color: [70, 70, 70], gapAfter: 1 });
    for (const line of o.text.split('\n')) {
      text(line || ' ', { size: 9.5, lh: 4.6, gapAfter: 0 });
    }
    y += 2.5;
  });

  y += 1;
  ensure(24);
  text(`IV.3 — Yapay Zekâ Adli Analiz Kayıtları (${c.aiItems.length} adet)`, { size: 10.5, style: 'bold', gapAfter: 2 });
  if (!c.aiItems.length) text('Yapay zekâ analiz kaydı oluşturulmamıştır.', { color: [90, 90, 90] });
  c.aiItems.forEach((a, i) => {
    ensure(20);
    text(`Yapay Zekâ Adli Analiz Kaydı ${i + 1}`, { size: 10, style: 'bold', gapAfter: 0.5 });
    text(a.meta, { size: 8.5, color: [70, 70, 70], gapAfter: 1 });
    if (a.okunan) {
      text('Modelin okuduğu metin:', { size: 9.5, style: 'bold', gapAfter: 0.5 });
      for (const line of a.okunan.split('\n')) text(line || ' ', { size: 9.5, lh: 4.6, gapAfter: 0 });
    }
    if (a.genel) text(`Genel değerlendirme: ${a.genel}`);
    if (a.silmeTahrip) text(`Silme/tahrip değerlendirmesi: ${a.silmeTahrip}`);
    a.bulgular.forEach((f, fi) => {
      const head = `${fi + 1}) ${f.baslik}${f.yer ? ` (${f.yer})` : ''} [şiddet: ${f.siddet}]`;
      text(head, { size: 9.5, style: 'bold', x: M_LEFT + 5, lh: 4.6, gapAfter: 0 });
      text(f.aciklama, { size: 9.5, x: M_LEFT + 5, lh: 4.6, gapAfter: 1.5 });
    });
    y += 2.5;
  });

  /* ------------------------- V. SONUÇ ------------------------- */
  sectionTitle(5, 'Sonuç ve Kanaat');
  for (const p of c.sonuc) text(p);

  /* ------------------------- YASAL UYARI + İMZA -------------------------
     Uyari ve imza aynı sayfada kalır: imza bloğu sayfa altına, uyari hemen
     üstüne yerleştirilir. */
  const signBlockH = 34;
  y = Math.max(y + 6, PAGE_H - M_BOTTOM - signBlockH - 20); // uyari + imza için yer ayır

  text(c.disclaimer, { size: 8, color: [80, 80, 80], lh: 4, gapAfter: 0 });

  y = Math.max(y + 4, PAGE_H - M_BOTTOM - signBlockH);
  const bx = PAGE_W - M_RIGHT - 80;
  pdf.setDrawColor(120, 120, 120);
  pdf.setLineWidth(0.3);
  pdf.rect(bx, y - 4, 80, 32);
  pdf.setFont(FONT, 'bold');
  pdf.setFontSize(10);
  pdf.text('İNCELEMESİNİ YAPAN', bx + 40, y + 2, { align: 'center' });
  pdf.setFont(FONT, 'normal');
  pdf.setFontSize(10);
  pdf.text(pdf.splitTextToSize(c.hazirlayan, 74), bx + 40, y + 9, { align: 'center' });
  pdf.setDrawColor(60, 60, 60);
  pdf.setLineWidth(0.25);
  pdf.line(bx + 12, y + 22, bx + 68, y + 22);
  pdf.setFontSize(8.5);
  pdf.text('Ad Soyad / İmza', bx + 40, y + 25.5, { align: 'center' });
  y += signBlockH;

  /* ------------------------- SAYFA ALT BİLGİSİ ------------------------- */
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(140, 140, 140);
    pdf.setLineWidth(0.2);
    pdf.line(M_LEFT, PAGE_H - M_BOTTOM + 2, PAGE_W - M_RIGHT, PAGE_H - M_BOTTOM + 2);
    pdf.setFont(FONT, 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Rapor No: ${c.raporNo}`, M_LEFT, PAGE_H - M_BOTTOM + 6);
    pdf.text(`Sayfa ${p}/${total}`, PAGE_W - M_RIGHT, PAGE_H - M_BOTTOM + 6, { align: 'right' });
  }

  return pdf.output('blob');
}
