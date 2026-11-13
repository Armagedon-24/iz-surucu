/**
 * BARKOD / QR OKUYUCU — istemci tarafı.
 *
 * QR: jsQR (hızlı, çapraz doğrulamalı). Barkod (Code128/EAN/DataMatrix…):
 * ZXing BrowserMultiFormatReader, yalnızca yedek olarak dinamik yüklenir.
 */
import jsQR from 'jsqr';

export interface DecodeHit {
  text: string;
  format: string;
  /** QR köşe noktaları (görüntü koordinatları) — çizim için. */
  corners?: { x: number; y: number }[];
}

/** Tek deneme: jsQR. */
function jsqrOnce(img: ImageData, invert: boolean): DecodeHit | null {
  const data = img.data;
  let buf = data;
  if (invert) {
    buf = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      buf[i] = 255 - data[i];
      buf[i + 1] = 255 - data[i + 1];
      buf[i + 2] = 255 - data[i + 2];
      buf[i + 3] = data[i + 3];
    }
  }
  const hit = jsQR(buf, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!hit) return null;
  const loc = hit.location;
  return {
    text: hit.data,
    format: 'QR Code',
    corners: [
      loc.topLeftCorner, loc.topRightCorner,
      loc.bottomRightCorner, loc.bottomLeftCorner,
    ],
  };
}

/** QR: normal + ters + 2× büyütülmüş denemeler. */
export function decodeQr(img: ImageData): DecodeHit[] {
  const hits: DecodeHit[] = [];
  const seen = new Set<string>();
  const push = (h: DecodeHit | null) => {
    if (h && !seen.has(h.text)) {
      seen.add(h.text);
      hits.push(h);
    }
  };
  push(jsqrOnce(img, false));
  if (hits.length === 0) push(jsqrOnce(img, true));
  if (hits.length === 0) {
    // küçük kodlar için 2× büyüt
    const w2 = img.width * 2, h2 = img.height * 2;
    if (w2 * h2 <= 40_000_000) {
      const big = new ImageData(w2, h2);
      for (let y = 0; y < h2; y++) {
        const sy = y >> 1;
        for (let x = 0; x < w2; x++) {
          const sp = (sy * img.width + (x >> 1)) * 4;
          const dp = (y * w2 + x) * 4;
          big.data[dp] = img.data[sp];
          big.data[dp + 1] = img.data[sp + 1];
          big.data[dp + 2] = img.data[sp + 2];
          big.data[dp + 3] = 255;
        }
      }
      push(jsqrOnce(big, false));
      if (hits.length === 0) push(jsqrOnce(big, true));
    }
  }
  return hits;
}

/** Barkod yedeği — ZXing dinamik yüklenir (yalnız istek anında pakete girer). */
export async function decodeBarcodeFallback(dataUrl: string): Promise<DecodeHit[]> {
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/library');
    const reader = new BrowserMultiFormatReader();
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const result = await reader.decodeFromImageElement(img);
    if (!result) return [];
    const fmt = result.getBarcodeFormat?.()?.toString?.() ?? 'Barcode';
    return [{ text: result.getText(), format: fmt }];
  } catch {
    return [];
  }
}
