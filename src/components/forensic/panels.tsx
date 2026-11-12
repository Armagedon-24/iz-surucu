'use client';

/**
 * SPEKTRAL & İŞLEM PANELLERİ — bant seçimi, hızlı reçeteler ve
 * tüm görüntü işleme parametreleri.
 */
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  FlaskConical, PenTool, Layers, Eye, ScanLine, Thermometer, CircleDot, Contrast,
  RotateCcw, FlaskConical as FlaskIcon,
} from 'lucide-react';
import type { Band, BandId, Params, Preset } from '@/lib/forensic/pipeline';
import { BANDS, DEFAULT_PARAMS, PRESETS } from '@/lib/forensic/pipeline';

const PRESET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  flask: FlaskConical,
  pen: PenTool,
  layers: Layers,
  eye: Eye,
  scan: ScanLine,
  thermometer: Thermometer,
  circle: CircleDot,
  contrast: Contrast,
};

const GROUP_ORDER: Band['group'][] = ['UV', 'Görünür', 'IR', 'Filtre', 'Özel'];
const GROUP_COLORS: Record<Band['group'], string> = {
  UV: 'border-violet-700/70 text-violet-300 hover:bg-violet-950/40',
  Görünür: 'border-emerald-800 text-emerald-200 hover:bg-emerald-950/40',
  IR: 'border-red-800/80 text-red-300 hover:bg-red-950/40',
  Filtre: 'border-amber-700/70 text-amber-300 hover:bg-amber-950/40',
  Özel: 'border-zinc-600 text-zinc-300 hover:bg-zinc-900',
};

export function SpectralPanel({
  params,
  onChange,
}: {
  params: Params;
  onChange: (p: Partial<Params>) => void;
}) {
  const active = BANDS.find((b) => b.id === params.band) as Band;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-2 font-mono text-[11px] tracking-widest text-amber-600">IŞIK BANDI SEÇİMİ</h3>
        {GROUP_ORDER.map((grp) => (
          <div key={grp} className="mb-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {grp} Bantları
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {BANDS.filter((b) => b.group === grp).map((b) => (
                <button
                  key={b.id}
                  onClick={() => onChange({ band: b.id as BandId })}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-2 text-left transition-colors ${
                    params.band === b.id
                      ? 'border-amber-500 bg-amber-950/50 text-amber-300 shadow-[0_0_12px_rgba(240,166,58,0.15)]'
                      : GROUP_COLORS[b.group]
                  }`}
                >
                  <span className="text-xs font-medium">{b.name}</span>
                  <span className="font-mono text-[9px] opacity-70">{b.nm}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="rounded-md border border-border bg-card/60 p-3">
        <div className="mb-1 flex items-center gap-2">
          <FlaskIcon className="size-3.5 text-amber-600" />
          <span className="font-mono text-xs font-semibold text-amber-500">{active.name.toUpperCase()}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{active.nm}</span>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{active.desc}</p>
      </div>

      {params.band === 'custom' && (
        <section className="rounded-md border border-border p-3">
          <h3 className="mb-3 font-mono text-[11px] tracking-widest text-amber-600">SPEKTRAL KANAL MİKSERİ</h3>
          <SliderRow label="Kırmızı (R)" value={params.mixR} min={0} max={1} step={0.01}
            onChange={(v) => onChange({ mixR: v })} />
          <SliderRow label="Yeşil (G)" value={params.mixG} min={0} max={1} step={0.01}
            onChange={(v) => onChange({ mixG: v })} />
          <SliderRow label="Mavi (B)" value={params.mixB} min={0} max={1} step={0.01}
            onChange={(v) => onChange({ mixB: v })} />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Ağırlıkları değiştirerek herhangi bir dalga boyu tepkisini simüle edin. Örn. mavi
            tükenmez mürekkebi R=1,0 (saf kırmızı) bandında koyu, boya mürekkepleri açık görünür.
          </p>
        </section>
      )}

      <Separator />

      <section>
        <h3 className="mb-2 font-mono text-[11px] tracking-widest text-amber-600">ADLİ REÇETELER</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => {
            const Icon = PRESET_ICONS[p.icon] ?? FlaskConical;
            return (
              <button
                key={p.id}
                onClick={() => onChange({ ...p.params, band: (p.params.band ?? params.band) as BandId })}
                title={p.desc}
                className="flex flex-col items-start gap-1 rounded-md border border-border bg-card/60 px-2.5 py-2 text-left transition-colors hover:border-amber-600/60 hover:bg-amber-950/30"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Icon className="size-3.5 text-amber-600" />
                  {p.name}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground line-clamp-2">{p.desc}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, onChange, format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs text-foreground/85">{label}</Label>
        <span className="font-mono text-[11px] text-amber-500">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

function SwitchRow({
  label, checked, onChange, desc,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  desc?: string;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <Label className="text-xs text-foreground/85">{label}</Label>
        {desc && <p className="text-[10px] leading-tight text-muted-foreground">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ProcessPanel({
  params,
  onChange,
}: {
  params: Params;
  onChange: (p: Partial<Params>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-widest text-amber-600">TON & POZLAMA</h3>
        <SliderRow label="Pozlama" value={params.exposure} min={-0.45} max={0.45} step={0.01}
          onChange={(v) => onChange({ exposure: v })} />
        <SliderRow label="Kontrast" value={params.contrast} min={-0.8} max={2.5} step={0.01}
          onChange={(v) => onChange({ contrast: v })} />
        <SliderRow label="Gamma" value={params.gamma} min={0.4} max={2.2} step={0.01}
          onChange={(v) => onChange({ gamma: v })} />
        <SliderRow label="Siyah nokta" value={params.blackPoint} min={0} max={0.35} step={0.005}
          onChange={(v) => onChange({ blackPoint: v })} />
        <SliderRow label="Beyaz nokta" value={params.whitePoint} min={0.65} max={1} step={0.005}
          onChange={(v) => onChange({ whitePoint: v })} />
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-widest text-amber-600">YEREL KONTRAST</h3>
        <SwitchRow label="CLAHE (adaptif kontrast)" checked={params.claheOn}
          onChange={(v) => onChange({ claheOn: v })}
          desc="Gölgede kalan silik izleri yerel olarak belirginleştirir." />
        {params.claheOn && (
          <>
            <SliderRow label="Kırpma limiti" value={params.claheClip} min={0.5} max={6} step={0.1}
              onChange={(v) => onChange({ claheClip: v })} />
            <SliderRow label="Izgara sayısı" value={params.claheTiles} min={2} max={16} step={1}
              onChange={(v) => onChange({ claheTiles: v })} format={(v) => `${v}×${v}`} />
          </>
        )}
        <SwitchRow label="Histogram eşitleme" checked={params.heqOn}
          onChange={(v) => onChange({ heqOn: v })}
          desc="Tüm görüntünün ton dağılımını dengeler." />
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-widest text-amber-600">YAPISAL FİLTRELER</h3>
        <SwitchRow label="Eğik ışık (girinti taraması)" checked={params.rakeOn}
          onChange={(v) => onChange({ rakeOn: v })}
          desc="Kağıt yüzeyindeki baskı/girinti izlerini sahte kabartma gölgesiyle gösterir (ESDA benzeri)." />
        {params.rakeOn && (
          <>
            <SliderRow label="Işık açısı" value={params.rakeAngle} min={0} max={360} step={1}
              onChange={(v) => onChange({ rakeAngle: v })} format={(v) => `${v.toFixed(0)}°`} />
            <SliderRow label="Gölgelendirme gücü" value={params.rakeStrength} min={0.1} max={2} step={0.05}
              onChange={(v) => onChange({ rakeStrength: v })} />
          </>
        )}
        <SwitchRow label="Sobel kenar algılama" checked={params.sobelOn}
          onChange={(v) => onChange({ sobelOn: v })}
          desc="Kenar/çizgi yapılarını vurgular." />
        <SwitchRow label="Unsharp maske (keskinleştirme)" checked={params.unsharpOn}
          onChange={(v) => onChange({ unsharpOn: v })} />
        {params.unsharpOn && (
          <>
            <SliderRow label="Miktar" value={params.unsharpAmount} min={0.1} max={2.5} step={0.05}
              onChange={(v) => onChange({ unsharpAmount: v })} />
            <SliderRow label="Yarıçap (σ)" value={params.unsharpSigma} min={0.5} max={4} step={0.1}
              onChange={(v) => onChange({ unsharpSigma: v })} />
          </>
        )}
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-widest text-amber-600">EŞİKLEME & RENK</h3>
        <div className="mb-3">
          <Label className="mb-1 block text-xs text-foreground/85">İkilileştirme (OCR ön işlemesi)</Label>
          <Select value={params.threshold} onValueChange={(v) => onChange({ threshold: v as Params['threshold'] })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Kapalı</SelectItem>
              <SelectItem value="otsu">Otsu (global)</SelectItem>
              <SelectItem value="sauvola">Sauvola (adaptif)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {params.threshold === 'sauvola' && (
          <>
            <SliderRow label="Pencere" value={params.sauvolaWindow} min={15} max={99} step={2}
              onChange={(v) => onChange({ sauvolaWindow: v })} format={(v) => `${v.toFixed(0)} px`} />
            <SliderRow label="Duyarlılık (k)" value={params.sauvolaK} min={0.1} max={0.7} step={0.02}
              onChange={(v) => onChange({ sauvolaK: v })} />
          </>
        )}
        <div className="mb-3">
          <Label className="mb-1 block text-xs text-foreground/85">Yoğunluk renk haritası (false-color)</Label>
          <Select value={params.falseColor} onValueChange={(v) => onChange({ falseColor: v as Params['falseColor'] })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Kapalı (gri)</SelectItem>
              <SelectItem value="ironbow">Ironbow (termal)</SelectItem>
              <SelectItem value="spectral">Spektral</SelectItem>
              <SelectItem value="viridis">Viridis</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SwitchRow label="Negatif (tersine çevir)" checked={params.invertOn}
          onChange={(v) => onChange({ invertOn: v })} />
      </section>

      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-2 font-mono text-[11px]"
        onClick={() => onChange({ ...DEFAULT_PARAMS, band: params.band, mixR: params.mixR, mixG: params.mixG, mixB: params.mixB })}
      >
        <RotateCcw className="size-3.5" /> TÜM PARAMETRELERİ SIFIRLA
      </Button>
    </div>
  );
}
