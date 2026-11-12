/**
 * ÖRNEK VAKA ÜRETECİ
 * Eğitim ve test için prosedürel "tatil edilmiş belge": kimyasal silme,
 * mavi tükenmez kalem müdahalesi, UV altında görünen gizli kayıt numarası
 * ve eğik ışıkta beliren girinti yazısı içerir.
 */

export function generateDemoCase(): { imageData: ImageData; name: string } {
  const w = 1600;
  const h = 1100;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // --- kağıt zemini ---
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#f6f2e7');
  grad.addColorStop(0.5, '#f3efe2');
  grad.addColorStop(1, '#efe9d8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // kağıt dokusu (hafif gren)
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = Math.random() * 0.045;
    ctx.fillStyle = `rgba(120,110,90,${a})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  // lifler
  ctx.strokeStyle = 'rgba(160,150,120,0.05)';
  for (let i = 0; i < 240; i++) {
    ctx.beginPath();
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 + Math.random() * 40, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }

  // --- girinti yazısı (eğik ışıkta görünür) ---
  ctx.save();
  ctx.font = 'italic 42px Georgia, serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(60,50,30,0.30)';
  ctx.shadowOffsetX = 2.2;
  ctx.shadowOffsetY = 2.6;
  ctx.shadowBlur = 0.5;
  ctx.fillText('5 Kasim odemesini iptal et', 130, 830);
  ctx.restore();

  // --- basılı içerik ---
  ctx.fillStyle = '#262626';
  ctx.font = 'bold 46px Georgia, serif';
  ctx.fillText('TALİMAT FORMU — GİZLİ', 110, 110);
  ctx.font = '17px ui-monospace, monospace';
  ctx.fillStyle = '#6a6a6a';
  ctx.fillText('FORM NO: TF-2024/117     DÜZENLEME: 03.11.2024     SAYFA: 1/1', 110, 150);

  // yatay çizgi
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(110, 172);
  ctx.lineTo(1480, 172);
  ctx.stroke();

  const printLine = (text: string, x: number, y: number, size = 26, bold = false) => {
    ctx.fillStyle = '#2e2e2e';
    ctx.font = `${bold ? 'bold ' : ''}${size}px Georgia, serif`;
    ctx.fillText(text, x, y);
  };

  printLine('Sayın Yetkili,', 110, 230);
  printLine('Aşağıda belirtilen hesaptan, ekli talimat çerçevesinde havale', 110, 276);
  printLine('gerçekleştirilecektir. İşlem onayı için imza ve kaşe gereklidir.', 110, 312);
  printLine('İşlem tutarı limit dahilinde değerlendirilecektir.', 110, 348);

  // tablo çerçevesi
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(110, 390, 620, 120);
  ctx.beginPath();
  ctx.moveTo(110, 430); ctx.lineTo(730, 430);
  ctx.moveTo(110, 470); ctx.lineTo(730, 470);
  ctx.moveTo(400, 390); ctx.lineTo(400, 510);
  ctx.stroke();
  printLine('ALICI ADI', 122, 417, 15, true);
  printLine('İBAN', 122, 457, 15, true);
  printLine('TUTAR', 122, 497, 15, true);

  printLine('Anadolu Yapı ve Ticaret A.Ş.', 412, 417, 21);
  printLine('TR33 0006 1005 1978 6457 3355 66', 412, 457, 20);

  // tutar (elle mavi kalemle yazılmış — sonra kısmen silinecek)
  const drawPenText = (text: string, x: number, y: number, size: number) => {
    ctx.save();
    ctx.font = `italic ${size}px 'Comic Sans MS', 'Segoe Script', cursive`;
    ctx.fillStyle = '#1f3fae';
    ctx.translate(x, y);
    ctx.rotate(-0.018);
    // hafif dalgalı çizim
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const jx = (Math.random() - 0.5) * 1.6;
      const jy = Math.sin(i * 0.7) * 1.8 + (Math.random() - 0.5) * 1.2;
      ctx.fillText(ch, jx, jy);
      ctx.translate(ctx.measureText(ch).width, 0);
    }
    ctx.restore();
  };
  drawPenText('24.850,00 TL', 415, 505, 34);

  printLine('İşlem, değerleme tarihinden itibaren 3 gün içinde geçerlidir.', 110, 580);
  printLine('Ödeme sırasında ek doğrulama istenebilir.', 110, 616);

  // imza alanı
  ctx.strokeStyle = '#555';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(110, 900); ctx.lineTo(480, 900);
  ctx.stroke();
  ctx.setLineDash([]);
  printLine('İMZA / KAŞE', 110, 930, 15, true);
  ctx.save();
  ctx.font = 'italic 40px Georgia, serif';
  ctx.fillStyle = '#1a1a5e';
  ctx.translate(190, 885);
  ctx.rotate(-0.06);
  ctx.fillText('M. Aydın', 0, 0);
  ctx.restore();

  // alt bilgi
  ctx.fillStyle = '#777';
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillText('Bu form ve ekleri şifrelidir. Yetkisiz çoğaltma yasaktır. | Dahili No: 4417', 110, 1040);

  // --- GİZLİ UV METİN (sadece UV bandında görünür) ---
  ctx.font = 'bold 30px ui-monospace, monospace';
  ctx.fillStyle = '#e9f0ff'; // krem kağıt üzerinde neredeyse görünmez
  ctx.globalAlpha = 0.5;
  ctx.fillText('REF: 7734-B / İÇ KOD 91', 1080, 300);
  ctx.globalAlpha = 1;

  // --- kimyasal silme lekesi (tutarın üzerinden) ---
  const stain = (cx: number, cy: number, r: number, alpha: number) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(196,178,120,${alpha})`);
    rg.addColorStop(0.7, `rgba(205,190,140,${alpha * 0.55})`);
    rg.addColorStop(1, 'rgba(210,195,150,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  // silme: mavi mürekkebi kısmen soldur (kalem renginin üstüne leke)
  ctx.globalCompositeOperation = 'source-atop';
  stain(560, 488, 150, 0.5);
  stain(640, 495, 110, 0.42);
  stain(480, 500, 90, 0.38);
  ctx.globalCompositeOperation = 'source-over';
  // silme artığı: sarımsı hale (tutar bölgesinin çevresi)
  ctx.globalCompositeOperation = 'multiply';
  stain(560, 490, 190, 0.30);
  ctx.globalCompositeOperation = 'source-over';

  // kenar gölgesi (fotoğraf görünümü)
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(30,25,15,0.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  return {
    imageData: ctx.getImageData(0, 0, w, h),
    name: 'ORNEK_VAKA_TF-2024-117.png',
  };
}
