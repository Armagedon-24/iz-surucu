/** Canvas yardımcıları — istemci tarafı ImageData ↔ dataURL dönüşümleri. */
import { resizeImageData } from './filters';

export function imageDataToDataUrl(
  img: ImageData,
  maxDim = 1600,
  quality = 0.9,
  mime: 'image/jpeg' | 'image/png' = 'image/jpeg'
): string {
  const scaled = resizeImageData(img, maxDim);
  const c = document.createElement('canvas');
  c.width = scaled.width;
  c.height = scaled.height;
  c.getContext('2d')!.putImageData(scaled, 0, 0);
  return c.toDataURL(mime, quality);
}

export async function dataUrlToImageData(url: string, maxDim = 1800): Promise<ImageData> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.getContext('2d')!.getImageData(0, 0, w, h);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
