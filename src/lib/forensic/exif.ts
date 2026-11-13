/**
 * ÜST VERİ (EXIF / PNG CHUNK / XMP) İNCELEMECİSİ — istemci tarafı.
 *
 * Belgenin dijital izlerini yüzeye çıkarır: çekim cihazı, tarih, GPS ve en
 * önemlisi YAZILIM İZLERİ (Photoshop, GIMP, Paint, yapay zekâ üreticileri vb.).
 * Sahte belge tespitinin ilk adımı budur — resmî EXIF kitaplığı olmadan,
 * JPEG segment ve TIFF IFD yapısını doğrudan okur.
 */

export interface MetaEntry {
  tag: string;
  value: string;
}

export interface SegmentInfo {
  name: string;
  size: number;
}

export interface MetaWarning {
  kind: 'software' | 'resaved' | 'gps' | 'stripped';
  text: string;
}

export interface MetaResult {
  container: 'jpeg' | 'png' | 'other';
  segments: SegmentInfo[];
  entries: MetaEntry[];
  software: string[];
  gps?: { lat: number; lon: number };
  warnings: MetaWarning[];
  xmpHits: string[];
}

const SOFTWARE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /photoshop|adobe/i, label: 'Adobe Photoshop/Adobe ailesi' },
  { re: /lightroom/i, label: 'Adobe Lightroom' },
  { re: /gimp/i, label: 'GIMP' },
  { re: /paint\b|paint\.net|mspaint/i, label: 'Paint/Paint.NET' },
  { re: /canva/i, label: 'Canva' },
  { re: /figma/i, label: 'Figma' },
  { re: /snapseed|vsco|picsart|pixlr|photopea|polarr|beFunky/i, label: 'Mobil/çevrimiçi düzenleyici' },
  { re: /affinity/i, label: 'Affinity Photo' },
  { re: /midjourney|dall[- ]?e|stable[- ]?diffusion|firefly|imagen|flux/i, label: 'Yapay zekâ görüntü üreticisi' },
  { re: /inkscape|illustrator|coreldraw/i, label: 'Vektör/çizim yazılımı' },
  { re: /scanner|epson|canon scan|hp scan|brother/i, label: 'Tarayıcı yazılımı' },
  { re: /(openai|gemini|copilot)/i, label: 'Yapay zekâ aracı' },
];

const EXIF_TAGS: Record<number, string> = {
  0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Yönelim', 0x011a: 'X Çözünürlük',
  0x011b: 'Y Çözünürlük', 0x0128: 'Çözünürlük Birimi', 0x0131: 'Software',
  0x0132: 'Değiştirme Tarihi', 0x013b: 'Artist', 0x8298: 'Telif',
  0x829a: 'Pozlama Süresi', 0x829d: 'F Değeri', 0x8827: 'ISO',
  0x9003: 'Çekim Tarihi', 0x9004: 'Dijitalleştirme Tarihi', 0x920a: 'Odak Uzunluğu',
  0xa002: 'Piksel X', 0xa003: 'Piksel Y', 0x9286: 'Kullanıcı Yorumu',
  0xa430: 'Kamera Sahibi', 0xa433: 'Lens Üretici', 0xa434: 'Lens Modeli',
  0xa435: 'Lens Seri No', 0xc614: 'UniqueCameraModel',
};
const GPS_TAGS: Record<number, string> = {
  0x0001: 'GPS Enlem Ref', 0x0002: 'GPS Enlem', 0x0003: 'GPS Boylam Ref',
  0x0004: 'GPS Boylam', 0x0006: 'GPS Yükseklik', 0x001d: 'GPS Tarih',
};

/** dataURL'den ham baytları çeker. */
function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[off + i];
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

function utf16le(bytes: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i + 1 < len; i += 2) {
    const code = bytes[off + i] | (bytes[off + i + 1] << 8);
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s;
}

function parseIfd(
  v: DataView, le: boolean, ifdOff: number, tiffStart: number,
  tagMap: Record<number, string>, entries: MetaEntry[],
): { exifIfd: number; gpsIfd: number } {
  let exifIfd = 0;
  let gpsIfd = 0;
  if (ifdOff <= 0 || ifdOff + 2 > v.byteLength) return { exifIfd, gpsIfd };
  const count = v.getUint16(ifdOff, le);
  for (let i = 0; i < count; i++) {
    const eOff = ifdOff + 2 + i * 12;
    if (eOff + 12 > v.byteLength) break;
    const tag = v.getUint16(eOff, le);
    const type = v.getUint16(eOff + 2, le);
    const n = v.getUint32(eOff + 4, le);
    let value = '';
    const sizeOf: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const unit = sizeOf[type] ?? 1;
    const total = unit * n;
    const valOff = total > 4 ? tiffStart + v.getUint32(eOff + 8, le) : eOff + 8;
    if (valOff < 0 || valOff + Math.min(total, 4) > v.byteLength) continue;
    if (tag === 0x8769) { exifIfd = v.getUint32(eOff + 8, le); continue; }
    if (tag === 0x8825) { gpsIfd = v.getUint32(eOff + 8, le); continue; }
    if (type === 2) {
      value = ascii(new Uint8Array(v.buffer, v.byteOffset), valOff, Math.min(n, 128));
    } else if (type === 3) {
      value = String(v.getUint16(valOff, le));
    } else if (type === 4) {
      value = String(v.getUint32(valOff, le));
    } else if (type === 5 || type === 10) {
      const parts: string[] = [];
      for (let k = 0; k < Math.min(n, 3); k++) {
        const num = type === 5 ? v.getUint32(valOff + k * 8, le) : v.getInt32(valOff + k * 8, le);
        const den = type === 5 ? v.getUint32(valOff + k * 8 + 4, le) : v.getInt32(valOff + k * 8 + 4, le);
        parts.push(den ? `${num}/${den}` : `${num}`);
      }
      value = parts.join(', ');
      if (tag === 0x829a && n === 1) { // pozlama süresi ondalık
        const num = v.getUint32(valOff, le), den = v.getUint32(valOff + 4, le);
        if (den) value = `${(num / den).toFixed(4)} sn`;
      }
    } else if (type === 1 || type === 7) {
      const raw = ascii(new Uint8Array(v.buffer, v.byteOffset), valOff, Math.min(n, 96));
      value = raw.trim() || `(${n} bayt veri)`;
    }
    const name = tagMap[tag] ?? `Etiket 0x${tag.toString(16).padStart(4, '0')}`;
    if (value.trim()) entries.push({ tag: name, value: value.trim().slice(0, 140) });
  }
  return { exifIfd, gpsIfd };
}

function rationalTriple(bytes: Uint8Array, v: DataView, le: boolean, off: number): number {
  const num = v.getUint32(off, le), den = v.getUint32(off + 4, le);
  return den ? num / den : 0;
}

/** JPEG SOI/APP segmentlerini gezer; EXIF + XMP toplar. */
function parseJpeg(bytes: Uint8Array, res: MetaResult): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let off = 2;
  while (off + 4 < bytes.length) {
    if (bytes[off] !== 0xff) { off++; continue; }
    const marker = bytes[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { off += 2; continue; }
    const size = dv.getUint16(off + 2);
    if (marker === 0xda) { res.segments.push({ name: 'SOS (görüntü verisi)', size: bytes.length - off }); break; }
    const name =
      marker === 0xe0 ? 'APP0 (JFIF)' :
      marker === 0xe1 ? 'APP1 (EXIF/XMP)' :
      marker === 0xed ? 'APP13 (Photoshop IRB)' :
      marker >= 0xe0 && marker <= 0xef ? `APP${marker - 0xe0}` :
      marker === 0xfe ? 'COM (yorum)' :
      `0xFF${marker.toString(16)}`;
    res.segments.push({ name, size });
    const payload = bytes.subarray(off + 4, Math.min(off + 2 + size, bytes.length));
    const head = ascii(bytes.subarray(off + 4), 0, 29);
    if (marker === 0xe1 && head.startsWith('Exif')) {
      parseExif(payload.subarray(6), res);
    } else if (marker === 0xe1 && head.includes('http://ns.adobe.com/xap')) {
      const xmp = ascii(payload, 0, Math.min(payload.length, 65536));
      collectXmp(xmp, res);
    } else if (marker === 0xfe) {
      const c = ascii(payload, 0, Math.min(payload.length, 200)).trim();
      if (c) res.entries.push({ tag: 'JPEG Yorumu', value: c });
    } else if (marker === 0xed) {
      const p = ascii(payload, 0, Math.min(payload.length, 4096));
      if (/photoshop|adobe/i.test(p)) res.software.push('APP13: Photoshop kaynak izi (IRB meta verisi)');
    }
    off += 2 + size;
  }
}

function parseExif(tiff: Uint8Array, res: MetaResult): void {
  if (tiff.length < 8) return;
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return;
  const ifd0 = dv.getUint32(4, le);
  const { exifIfd, gpsIfd } = parseIfd(dv, le, ifd0, 0, EXIF_TAGS, res.entries);
  if (exifIfd) parseIfd(dv, le, exifIfd, 0, EXIF_TAGS, res.entries);
  if (gpsIfd) {
    const gpsEntries: MetaEntry[] = [];
    parseIfd(dv, le, gpsIfd, 0, GPS_TAGS, gpsEntries);
    res.entries.push(...gpsEntries);
    // enlem/boylam ondalığa
    const find = (t: string) => gpsEntries.find((e) => e.tag === t);
    const latRef = find('GPS Enlem Ref')?.value ?? '';
    const lonRef = find('GPS Boylam Ref')?.value ?? '';
    const lat = find('GPS Enlem'), lon = find('GPS Boylam');
    if (lat && lon) {
      const parseRats = (s: string): number => {
        const parts = s.split(', ').map((p) => {
          const [a, b] = p.split('/').map(Number);
          return b ? a / b : a;
        });
        return (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
      };
      const la = parseRats(lat.value) * (latRef.includes('S') ? -1 : 1);
      const lo = parseRats(lon.value) * (lonRef.includes('W') ? -1 : 1);
      res.gps = { lat: +la.toFixed(6), lon: +lo.toFixed(6) };
      res.warnings.push({ kind: 'gps', text: 'Konum verisi (GPS) gömülü — çekim yeri raporlanabilir.' });
    }
  }
}

function collectXmp(xmp: string, res: MetaResult): void {
  for (const pat of [
    /xmp:CreatorTool="([^"]{1,80})"/,
    /<xmp:CreatorTool>([^<]{1,80})</,
    /photoshop:Source="([^"]{1,80})"/,
    /xmpMM:HistorySoftwareAgent="([^"]{1,80})"/,
    /<stEvt:softwareAgent>([^<]{1,80})</,
    /dc:format="([^"]{1,40})"/,
  ]) {
    const m = xmp.match(pat);
    if (m?.[1]) res.xmpHits.push(m[1]);
  }
  if (/xmpMM:History/i.test(xmp)) res.xmpHits.push('XMP geçmiş (History) kaydı mevcut — dosya daha önce düzenlenmiş olabilir');
}

/** PNG chunk'larını gezer. */
function parsePng(bytes: Uint8Array, res: MetaResult): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 8 < bytes.length) {
    const len = dv.getUint32(off);
    const type = ascii(bytes.subarray(off + 4), 0, 4);
    res.segments.push({ name: `chunk ${type}`, size: len });
    const data = bytes.subarray(off + 8, Math.min(off + 8 + len, bytes.length));
    if (type === 'tEXt' || type === 'iTXt') {
      const isUtf = type === 'iTXt' && data[0] !== 0x4c; // latin-1 değilse
      const text = isUtf ? utf16le(data, 0, Math.min(data.length, 200)) : ascii(data, 0, Math.min(data.length, 200));
      const m = text.match(/^([\w -]{1,30})\0([\s\S]{1,120})/);
      if (m) res.entries.push({ tag: `PNG ${m[1]}`, value: m[2].trim() });
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
}

/** Ana giriş: dataURL'den tüm üst veriyi çıkarır. */
export function parseImageMetadata(dataUrl: string): MetaResult {
  const bytes = bytesFromDataUrl(dataUrl);
  const res: MetaResult = {
    container: bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : 'other',
    segments: [], entries: [], software: [], warnings: [], xmpHits: [],
  };
  if (res.container === 'jpeg') parseJpeg(bytes, res);
  else if (res.container === 'png') parsePng(bytes, res);
  else return res;

  // yazılım izleri — tüm metin alanlarında taranır
  const corpus = [
    ...res.entries.filter((e) => /Software|Üretici|Lens Üretici|Artist|Telif|PNG/i.test(e.tag)).map((e) => e.value),
    ...res.xmpHits,
    ...res.software,
  ].join(' | ');
  for (const { re, label } of SOFTWARE_PATTERNS) {
    if (re.test(corpus)) {
      res.software.push(label);
      res.warnings.push({
        kind: 'software',
        text: `Yazılım izi bulundu: ${label} — belge bir düzenleyici/yazılımdan geçmiş olabilir.`,
      });
    }
  }
  if (res.container === 'jpeg' && !res.entries.some((e) => /Çekim Tarihi|Make|Model/.test(e.tag))) {
    res.warnings.push({
      kind: 'stripped',
      text: 'EXIF çekim bilgisi yok — dosya temizlenmiş/kayıp üst verili (sosyal medya, ekran görüntüsü veya elle sıfırlanmış).',
    });
  }
  if (res.xmpHits.length) {
    res.warnings.push({ kind: 'resaved', text: 'XMP geçmiş kaydı mevcut — dosya yeniden kaydedilmiş olabilir.' });
  }
  return res;
}
