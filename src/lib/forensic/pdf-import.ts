/**
 * PDF İÇE AKTARMA — pdf.js ile çok sayfalı taranmış PDF'leri sayfa sayfa
 * çalışma alanına açar. Worker dosyası public/pdf.worker.min.mjs olarak
 * dağıtıma dahildir (bundler bağımsız, Next/Turbopack uyumlu).
 */

export interface PdfDoc {
  numPages: number;
  /** n. sayfayı (1 tabanlı) en fazla maxDim piksel olacak biçimde çizer. */
  renderPage: (n: number, maxDim?: number) => Promise<{ dataUrl: string; width: number; height: number }>;
}

type PdfjsModule = typeof import('pdfjs-dist');

let mod: PdfjsModule | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (!mod) {
    mod = await import('pdfjs-dist');
    mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  return mod;
}

/** PDF dosyasını açar; sayfa render işleviyle döner. */
export async function openPdf(file: File | ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = await getPdfjs();
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  return {
    numPages: doc.numPages,
    renderPage: async (n, maxDim = 1600) => {
      const page = await doc.getPage(Math.min(Math.max(1, n), doc.numPages));
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(0.2, maxDim / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
      return {
        dataUrl: canvas.toDataURL('image/jpeg', 0.88),
        width: canvas.width,
        height: canvas.height,
      };
    },
  };
}
