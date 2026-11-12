'use client';

/**
 * LABORATUVAR PANELİ — gerçek belge inceleme laboratuvarlarında (VSC, ESDA,
 * spektrofotometre) kullanılan görüntüleme tekniklerinin yazılım benzetimi.
 * Teknikler:
 *  - UV FLORİSANS: UV ışık altında kağıt flörisen yapar; mürekkep/kimyasal
 *    kalıntıları farklı tepki verir → karanlık zemin üzerinde ışıltılı fark.
 *  - İR LÜMİNESANS: kızılötesi yansıma/lüminesans — mürekkep IR'ı emer,
 *    kağıt ıtır → silinen/karalanmış yazı görünür.
 *  - ESDA GİRİNTİ: elektrostatik girinti cihazı benzetimi — kağıt yüzeyindeki
 *    basınç girintileri gölgeli rölyef (shaded relief) ile görünür kılınır.
 *  - CLAHE: eşit olmayan aydınlatmada yerel kontrast — soluk izleri çıkarır.
 *  - KANAL AYRIŞTIRMA: tek kanal (K/Y/M/Ton/Doygunluk/Luma) + sahte renk
 *    haritaları — görsel olarak aynı görünen farklı mürekkepleri ayırır.
 * Panel sonucu "ANA GÖRÜNTÜYE UYGULA" ile İnceleme Varyantına geçer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  FlaskConical, Sun, Flashlight, Mountain, Contrast, Palette, CheckCircle2,
} from 'lucide-react';
import {
  mixToGray, grayToImageData, gaussBlur, percentileStretch, clahe, invert,
  LUTS, type GrayImage, type RGB,
} from '@/lib/forensic/filters';
import { scaleToWidth } from '@/lib/forensic/recovery';

type TechniqueId = 'uv' | 'ir' | 'esda' | 'clahe' | 'kanal';

const TECHNIQUES: ReadonlyArray<{
  id: TechniqueId; label: string; sub: string; desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'uv', label: 'UV FLORİSANS', sub: 'Ultraviyole kaynak benzetimi', icon: Sun,
    desc: 'Gerçek laboratuvarda VSC cihazının UV lambalarıyla yapılır: kağıt uvc altında flörisen yapar (parlar), silme kimyasalları, yapıştırıcı kalıntıları ve farklı mürekkepler ise farklı yoğunlukta parlar ya da kararan bölge bırakır. Bu benzetim parlaklığı florisans renk paletine çevirerek farkları ışıltılı olarak gösterir.',
  },
  {
    id: 'ir', label: 'İR LÜMİNESANS', sub: 'Kızılötesi yansıma benzetimi', icon: Flashlight,
    desc: 'Kızılötesi ışıkta mürekkeplerin çoğu ışığı emer (koyu görünür), kağıt ise yansıtır/ıtır. Karalama altındaki bant ve boyalar IR\u2019ı geçtiği için altındaki yazı ortaya çıkar. "İR DERİNLİĞİ" kaydırıcısı görünür ışıktan derin kızılötesiye geçişi taklit eder; NEGATİF ile lüminesans görüntüsü (ters) alınır.',
  },
  {
    id: 'esda', label: 'ESDA GİRİNTİ', sub: 'Elektrostatik girinti benzetimi', icon: Mountain,
    desc: 'ESDA cihazı kağıt yüzeyindeki basınç girintilerini elektrostatik tozla görünür kılar; üstteki sayfadan alttaki sayfaya geçen yazı izleri böyle çıkarılır. Burada yüzey yükseklik haritası gölgeli rölyef olarak işlenir: azimut (ışık yönü) ve yükseklik açısını çevirerek girinti/basınç izlerini tarama yapın.',
  },
  {
    id: 'clahe', label: 'CLAHE', sub: 'Adaptif yerel kontrast', icon: Contrast,
    desc: 'Taranan belgelerde ışık eşit düşmez; global kontrast soluk izleri kaybettirir. CLAHE (Kontrast Sınırlı Adaptif Histogram Eşitleme) karo karo yerel kontrastı dengeler — suyla silme, soluk kalem izi ve damga kalıntılarında laboratuvarlarda standart ön işlemdir.',
  },
  {
    id: 'kanal', label: 'KANAL AYRIŞTIRMA', sub: 'Tek kanal + sahte renk', icon: Palette,
    desc: 'Gözle aynı görünen iki mürekkep farklı kanallarda (K/Y/M/Ton/Doygunluk) ayrışır; laboratuvarlarda yoğunluk haritalaması (pseudocolor) ile farklar renklendirilir. Sahte renk paletleri (ironbow/spectral/viridis) ince yoğunluk farklarını göz eşiğine taşır.',
  },
];

/* ---------------- yerel yardımcılar ---------------- */

/** Renk rampası: GrayImage → ImageData (duraklı gradyan). */
function rampImageData(g: GrayImage, stops: ReadonlyArray<[number, string]>): ImageData {
  const pal = new Uint8ClampedArray(256 * 3);
  const rgb = stops.map(([, hex]) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const span = Math.max(1e-6, stops[k + 1][0] - stops[k][0]);
    const f = Math.min(1, Math.max(0, (t - stops[k][0]) / span));
    pal[i * 3] = rgb[k][0] + (rgb[k + 1][0] - rgb[k][0]) * f;
    pal[i * 3 + 1] = rgb[k][1] + (rgb[k + 1][1] - rgb[k][1]) * f;
    pal[i * 3 + 2] = rgb[k][2] + (rgb[k + 1][2] - rgb[k][2]) * f;
  }
  const out = new ImageData(g.w, g.h);
  const o = out.data;
  for (let i = 0, p = 0; i < g.d.length; i++, p += 4) {
    const idx = Math.max(0, Math.min(255, Math.round(g.d[i] * 255))) * 3;
    o[p] = pal[idx];
    o[p + 1] = pal[idx + 1];
    o[p + 2] = pal[idx + 2];
    o[p + 3] = 255;
  }
  return out;
}

/** Gölgeli rölyef (ESDA benzetimi): yükseklik → azimut/elevasyon ile gölgeleme. */
function shadedRelief(g: GrayImage, azDeg: number, elevDeg: number, power: number): GrayImage {
  const { w, h } = g;
  const smooth = gaussBlur(g, 1.4);
  const az = (azDeg * Math.PI) / 180;
  const el = (Math.max(5, Math.min(85, elevDeg)) * Math.PI) / 180;
  const lx = Math.cos(el) * Math.cos(az);
  const ly = Math.cos(el) * Math.sin(az);
  const lz = Math.sin(el);
  const out = new Float32Array(w * h);
  const k = power / 100 * 3.2;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w, y1 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      // yükseklik = karartı (1 - gri): mürekkep/girinti kabarık okunur
      const gx = ((1 - smooth.d[y0 + x1]) - (1 - smooth.d[y0 + x0])) * 2;
      const gy = ((1 - smooth.d[y1 + x]) - (1 - smooth.d[y0 + x])) * 2;
      let s = lz * 0.55 - k * (lx * gx + ly * gy) + 0.45;
      out[y * w + x] = Math.min(1, Math.max(0, s));
    }
  }
  return { w, h, d: out };
}

/** HSV kanalını griye çevirir (t=ton, d=doygunluk). */
function hsvGray(src: ImageData, mode: 't' | 'd'): GrayImage {
  const { width: w, height: h, data } = src;
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = data[p] / 255, gg = data[p + 1] / 255, b = data[p + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mode === 'd') {
      out[i] = mx > 0 ? (mx - mn) / mx : 0;
    } else {
      let hh = 0;
      const d0 = mx - mn;
      if (d0 > 0) {
        if (mx === r) hh = ((gg - b) / d0 + 6) % 6;
        else if (mx === gg) hh = (b - r) / d0 + 2;
        else hh = (r - gg) / d0 + 4;
      }
      out[i] = hh / 6;
    }
  }
  return { w, h, d: out };
}

const KANAL_KEYS = ['K', 'Y', 'M', 'T', 'D', 'L'] as const;
const KANAL_LABELS: Record<string, string> = {
  K: 'KIRMIZI', Y: 'YEŞİL', M: 'MAVİ', T: 'TON (H)', D: 'DOYGUNLUK (S)', L: 'LUMA',
};
const LUT_KEYS = ['gri', 'ironbow', 'spectral', 'viridis'] as const;

export function LabPanel({
  original,
  onApply,
  onLivePreview,
}: {
  original: ImageData | null;
  onApply: (out: ImageData, label: string) => void;
  onLivePreview?: (img: ImageData | null) => void;
}) {
  const [tech, setTech] = useState<TechniqueId>('uv');
  const [uv, setUv] = useState({ force: 70 });
  const [ir, setIr] = useState({ depth: 65, stretch: 2, neg: false });
  const [esda, setEsda] = useState({ az: 315, elev: 40, power: 60 });
  const [clh, setClh] = useState({ tiles: 8, clip: 2.5 });
  const [kanal, setKanal] = useState<{ ch: typeof KANAL_KEYS[number]; lut: typeof LUT_KEYS[number] }>({ ch: 'L', lut: 'ironbow' });
  const [out, setOut] = useState<ImageData | null>(null);
  const [busy, setBusy] = useState(false);

  const liveCbRef = useRef(onLivePreview);
  liveCbRef.current = onLivePreview;
  useEffect(() => () => { liveCbRef.current?.(null); }, []);

  // önizleme için çalışma kopyası (hız)
  const work = useMemo(() => (original ? scaleToWidth(original, 1400) : null), [original]);

  /** Teknik hesaplaması — önizleme ve uygulama aynı kodu kullanır. */
  const compute = useCallback((src: ImageData): ImageData => {
    if (tech === 'uv') {
      const g = mixToGray(src, [0.16, 0.52, 0.32]);
      percentileStretch(g, 2, 98);
      const f = uv.force / 100;
      if (f < 0.02) return grayToImageData(g);
      const ramp = rampImageData(g, [
        [0, '#07010f'], [0.3, '#2e1065'], [0.55, '#7c3aed'],
        [0.78, '#22d3ee'], [1, '#f5f0ff'],
      ]);
      // sönük gri görüntü ile florisans rampayı harmanla (kuvvet)
      const o = ramp.data;
      for (let i = 0, p = 0; i < g.d.length; i++, p += 4) {
        const gy = g.d[i] * 255;
        o[p] = o[p] * f + gy * (1 - f);
        o[p + 1] = o[p + 1] * f + gy * (1 - f);
        o[p + 2] = o[p + 2] * f + gy * (1 - f);
      }
      return ramp;
    }
    if (tech === 'ir') {
      const t = ir.depth / 100;
      const mix: RGB = [0.30 + 0.60 * t, 0.34 - 0.27 * t, 0.36 - 0.33 * t];
      const g = mixToGray(src, mix);
      percentileStretch(g, ir.stretch, 100 - ir.stretch);
      if (ir.neg) invert(g);
      return grayToImageData(g);
    }
    if (tech === 'esda') {
      const g = mixToGray(src, [0.299, 0.587, 0.114]);
      const relief = shadedRelief(g, esda.az, esda.elev, esda.power);
      percentileStretch(relief, 1, 99);
      return grayToImageData(relief);
    }
    if (tech === 'clahe') {
      const g = mixToGray(src, [0.299, 0.587, 0.114]);
      clahe(g, clh.tiles, clh.tiles, clh.clip);
      percentileStretch(g, 1, 99);
      return grayToImageData(g);
    }
    // kanal ayrıştırma
    let g: GrayImage;
    if (kanal.ch === 'K') g = mixToGray(src, [1, 0, 0]);
    else if (kanal.ch === 'Y') g = mixToGray(src, [0, 1, 0]);
    else if (kanal.ch === 'M') g = mixToGray(src, [0, 0, 1]);
    else if (kanal.ch === 'T') g = hsvGray(src, 't');
    else if (kanal.ch === 'D') g = hsvGray(src, 'd');
    else g = mixToGray(src, [0.299, 0.587, 0.114]);
    percentileStretch(g, 1, 99);
    if (kanal.lut === 'gri') return grayToImageData(g);
    return grayToImageData(g, undefined, 0, LUTS[kanal.lut]);
  }, [tech, uv, ir, esda, clh, kanal]);

  // canlı önizleme (debounce'lu)
  useEffect(() => {
    if (!work) { setOut(null); liveCbRef.current?.(null); return; }
    const t = setTimeout(() => {
      try {
        const img = compute(work);
        setOut(img);
        liveCbRef.current?.(img);
      } catch { /* önizleme hatası yutulur */ }
    }, 110);
    return () => clearTimeout(t);
  }, [work, compute]);

  const handleApply = () => {
    if (!original || !out) return;
    setBusy(true);
    try {
      // tam çözünürlükte yeniden hesapla (önizleme 1400px'ti)
      const img = compute(original);
      const label = `${TECHNIQUES.find((x) => x.id === tech)?.label ?? 'LAB'}`;
      onApply(img, label);
    } finally {
      setBusy(false);
    }
  };

  const cur = TECHNIQUES.find((x) => x.id === tech)!;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-cyan-400">
        <FlaskConical className="size-4" /> LABORATUVAR TEKNİKLERİ
      </div>

      {/* teknik kartları */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {TECHNIQUES.map((t) => {
          const Icon = t.icon;
          const on = tech === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTech(t.id)}
              className={`flex items-start gap-2 rounded-md border p-2 text-left transition-colors ${on
                ? 'border-cyan-500 bg-cyan-950/40'
                : 'border-border bg-card/50 hover:border-muted-foreground/40'}`}
            >
              <Icon className={`mt-0.5 size-4 flex-none ${on ? 'text-cyan-400' : 'text-muted-foreground'}`} />
              <span className="min-w-0">
                <span className="block font-mono text-[10px] font-bold tracking-wider text-foreground">{t.label}</span>
                <span className="block truncate text-[9px] text-muted-foreground">{t.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* teknik açıklaması */}
      <p className="rounded-md border border-cyan-900/50 bg-black/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {cur.desc}
      </p>

      {/* parametreler */}
      {tech === 'uv' && (
        <div className="space-y-2 rounded-md border border-border bg-card/40 p-2.5">
          <ParamSlider label="FLORİSANS KUVVETİ" value={uv.force} min={0} max={100} step={1}
            fmt={(v) => `${v.toFixed(0)}%`} onChange={(v) => setUv({ force: v })} />
        </div>
      )}
      {tech === 'ir' && (
        <div className="space-y-2 rounded-md border border-border bg-card/40 p-2.5">
          <ParamSlider label="İR DERİNLİĞİ" value={ir.depth} min={0} max={100} step={1}
            fmt={(v) => `${v.toFixed(0)}%`} onChange={(v) => setIr((s) => ({ ...s, depth: v }))} />
          <ParamSlider label="ESİK GERME" value={ir.stretch} min={0.5} max={10} step={0.5}
            fmt={(v) => `±${v.toFixed(1)}%`} onChange={(v) => setIr((s) => ({ ...s, stretch: v }))} />
          <Button size="sm" variant={ir.neg ? 'default' : 'outline'}
            onClick={() => setIr((s) => ({ ...s, neg: !s.neg }))}
            className={`h-7 gap-1.5 font-mono text-[10px] ${ir.neg ? 'bg-cyan-600 text-black hover:bg-cyan-500' : ''}`}>
            NEGATİF (LÜMİNESANS) {ir.neg ? 'AÇIK' : 'KAPALI'}
          </Button>
        </div>
      )}
      {tech === 'esda' && (
        <div className="space-y-2 rounded-md border border-border bg-card/40 p-2.5">
          <ParamSlider label="AZİMUT (IŞIK YÖNÜ)" value={esda.az} min={0} max={360} step={1}
            fmt={(v) => `${v.toFixed(0)}°`} onChange={(v) => setEsda((s) => ({ ...s, az: v }))} />
          <ParamSlider label="YÜKSEKLİK AÇISI" value={esda.elev} min={5} max={85} step={1}
            fmt={(v) => `${v.toFixed(0)}°`} onChange={(v) => setEsda((s) => ({ ...s, elev: v }))} />
          <ParamSlider label="RÖLYEF GÜCÜ" value={esda.power} min={10} max={100} step={1}
            fmt={(v) => `${v.toFixed(0)}%`} onChange={(v) => setEsda((s) => ({ ...s, power: v }))} />
        </div>
      )}
      {tech === 'clahe' && (
        <div className="space-y-2 rounded-md border border-border bg-card/40 p-2.5">
          <ParamSlider label="KARO SAYISI" value={clh.tiles} min={4} max={16} step={1}
            fmt={(v) => `${v.toFixed(0)}×${v.toFixed(0)}`} onChange={(v) => setClh((s) => ({ ...s, tiles: Math.round(v) }))} />
          <ParamSlider label="KONTRAST KIRPMASI" value={clh.clip} min={1} max={6} step={0.1}
            fmt={(v) => v.toFixed(1)} onChange={(v) => setClh((s) => ({ ...s, clip: v }))} />
        </div>
      )}
      {tech === 'kanal' && (
        <div className="space-y-2 rounded-md border border-border bg-card/40 p-2.5">
          <div>
            <div className="mb-1 font-mono text-[9px] tracking-wider text-muted-foreground">KANAL</div>
            <div className="flex flex-wrap gap-1">
              {KANAL_KEYS.map((k) => (
                <button key={k} onClick={() => setKanal((s) => ({ ...s, ch: k }))}
                  className={`rounded border px-2 py-1 font-mono text-[9px] tracking-wider transition-colors ${kanal.ch === k
                    ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'}`}>
                  {k} · {KANAL_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 font-mono text-[9px] tracking-wider text-muted-foreground">SAHTE RENK HARİTASI</div>
            <div className="flex flex-wrap gap-1">
              {LUT_KEYS.map((k) => (
                <button key={k} onClick={() => setKanal((s) => ({ ...s, lut: k }))}
                  className={`rounded border px-2 py-1 font-mono text-[9px] tracking-wider transition-colors ${kanal.lut === k
                    ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'}`}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* uygula */}
      <Button onClick={handleApply} disabled={!original || !out || busy}
        className="h-9 w-full gap-2 bg-cyan-600 font-mono text-[11px] font-bold tracking-wider text-black hover:bg-cyan-500">
        <CheckCircle2 className="size-4" />
        ANA GÖRÜNTÜYE UYGULA{out ? ` · ${out.width}×${out.height}` : ''}
      </Button>
      <p className="text-[9px] leading-relaxed text-muted-foreground/70">
        Uygulama sonucu İNCELEME VARYANTINA geçer; araç çubuğundaki GÖRÜNTÜYÜ KES ile
        kritik bölgeyi piksel hassasiyetinde kesip rapora ekleyebilirsiniz.
      </p>
    </div>
  );
}

/** Parametre kaydırıcısı — panel stili. */
function ParamSlider({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="text-cyan-400">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]}
        onValueChange={(vals) => onChange(vals[0] ?? min)} className="h-1" />
    </div>
  );
}
