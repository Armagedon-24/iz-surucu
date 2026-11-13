'use client';

/**
 * DELİL ÇUBUĞU — tek vaka altında birden çok delil (belge/tarama) saklama
 * ve aralarında tek tıkla geçiş (Vaka Yönetimi). Veriler IndexedDB'de;
 * çubuk yalnızca kapak + ad gösterir. Aktif delil adıyla eşleşen kayıt
 * vurgulanır.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { FolderOpen, Plus, Trash2, LoaderCircle, Images } from 'lucide-react';
import { listExhibits, saveExhibit, deleteExhibit, type ExhibitRecord } from '@/lib/forensic/exhibits';
import { useCaseStore } from '@/lib/forensic/store';

export function ExhibitBar({
  activeName,
  currentDataUrl,
  onLoad,
}: {
  activeName: string;
  currentDataUrl: string | null;
  onLoad: (url: string, name: string) => void;
}) {
  const { toast } = useToast();
  const addAudit = useCaseStore((s) => s.addAudit);
  const [items, setItems] = useState<ExhibitRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listExhibits());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addCurrent = async () => {
    if (!currentDataUrl) return;
    setBusy(true);
    try {
      const name = activeName || `delil_${Date.now()}`;
      const rec: ExhibitRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        addedTs: Date.now(),
        width: 0,
        height: 0,
        thumb: currentDataUrl,
        dataUrl: currentDataUrl,
      };
      await saveExhibit(rec);
      await refresh();
      addAudit('DELİL LİSTESİNE EKLE', name);
      toast({ title: 'Delil vaka listesine eklendi', description: name });
    } catch (e) {
      toast({ title: 'Delil kaydedilemedi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rec: ExhibitRecord) => {
    await deleteExhibit(rec.id);
    await refresh();
    addAudit('DELİL LİSTEDEN ÇIKARILDI', rec.name);
  };

  return (
    <div className="flex items-center gap-2 border-b border-border bg-black/25 px-3 py-1.5">
      <Badge variant="outline" className="shrink-0 gap-1 border-amber-700/50 font-mono text-[9px] text-amber-500">
        <Images className="size-3" /> VAKA DELİLLERİ ({items.length})
      </Badge>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        {items.length === 0 && (
          <span className="font-mono text-[10px] text-muted-foreground/70">
            Vaka klasörü boş — mevcut görüntüyü delil olarak kaydedin, sonra tek tıkla dönün.
          </span>
        )}
        {items.map((rec) => {
          const active = rec.name === activeName;
          return (
            <div key={rec.id}
              className={`group relative flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors ${
                active ? 'border-amber-500 bg-amber-950/30' : 'border-border bg-card/50 hover:border-amber-800'
              }`}>
              <button type="button" className="flex items-center gap-1.5 text-left"
                onClick={() => { onLoad(rec.dataUrl, rec.name); addAudit('DELİL SEÇİMİ', rec.name); }}
                title={`${rec.name} — çalışma alanına yükle`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rec.thumb} alt={rec.name} className="size-7 w-7 rounded-sm border border-border object-cover" />
                <span className={`max-w-[130px] truncate font-mono text-[10px] ${active ? 'text-amber-300' : 'text-muted-foreground'}`}>
                  {rec.name}
                </span>
              </button>
              <button type="button" aria-label="Delili listeden çıkar"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => remove(rec)}>
                <Trash2 className="size-3 text-red-400 hover:text-red-300" />
              </button>
            </div>
          );
        })}
      </div>
      <Button size="sm" variant="outline" onClick={addCurrent} disabled={busy || !currentDataUrl}
        className="h-7 shrink-0 gap-1 border-amber-800/60 font-mono text-[10px] text-amber-300 hover:bg-amber-950/40">
        {busy ? <LoaderCircle className="size-3 animate-spin" /> : <Plus className="size-3" />}
        DELİL EKLE
      </Button>
      <FolderOpen className="hidden size-3.5 shrink-0 text-muted-foreground/50 sm:block" />
    </div>
  );
}
