/**
 * VAKA DEPOSU — kamera/analiz kayıtları localStorage'da saklanır.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Params } from '@/lib/forensic/pipeline';
import type { Annotation, AnnKind } from '@/lib/forensic/annotate';
import { ANN_COLORS } from '@/lib/forensic/annotate';

/** Denetim izi kaydı — zincirleme saklama ve resmî rapor için. */
export interface AuditEntry {
  id: string;
  ts: number;
  action: string; // kısa kod (LOAD, KURTARMA, ANOMALİ…)
  detail?: string;
}

export interface Snapshot {
  id: string;
  ts: number;
  label: string;
  thumb: string; // jpeg dataURL
  modeName: string;
  modeNm: string;
  paramsSummary: string;
}

/** Otomatik canlı işaretleme kaydının sabit kimliği — her çizimde güncellenir,
 *  yeni delil yüklenince silinir (bayat kayıt yanıltmasın). */
export const LIVE_ANNOT_SNAPSHOT_ID = 'annot-live-auto';

export interface AnalysisRecord {
  id: string;
  ts: number;
  bandLabel: string;
  result: Record<string, unknown>;
  raw: string;
}

export interface OcrRecord {
  id: string;
  ts: number;
  text: string;
  confidence: number;
  source: string;
  wordCount: number;
}

interface CaseStore {
  caseNo: string;
  examiner: string;
  authority: string; // talep eden makam (ör. ... Cumhuriyet Başsavcılığı)
  note: string;
  snapshots: Snapshot[];
  analyses: AnalysisRecord[];
  ocrResults: OcrRecord[];
  audit: AuditEntry[]; // denetim izi — yapılan her işlem kronolojik
  annotations: Annotation[]; // ölçüm/işaretleme — araçlar sekmesi + büyük ekran
  pxPerMm: number | null; // cetvel kalibrasyonu — mm ölçümleri için (kalıcı)
  /** Aktif işaretleme aracı/renk/kalınlık — panel ile büyük ekran paleti ortak (REV 9.10). */
  annotTool: AnnKind;
  annotColor: string;
  annotThickness: number; // İNCE 0.8 / NORMAL 1 / KALIN 1.5
  metaNotes: string[]; // üst veri (EXIF) özet notları — delil sekmesi
  aiDraft: string; // YZ rapor taslağı — rapor sekmesi
  setCaseNo: (v: string) => void;
  setExaminer: (v: string) => void;
  setAuthority: (v: string) => void;
  setNote: (v: string) => void;
  addSnapshot: (s: Snapshot) => void;
  /** Aynı kimlikli kayıt varsa değiştirir, yoksa ekler — canlı işaretleme kaydı için. */
  upsertSnapshot: (s: Snapshot) => void;
  removeSnapshot: (id: string) => void;
  addAnalysis: (a: AnalysisRecord) => void;
  addOcr: (o: OcrRecord) => void;
  addAudit: (action: string, detail?: string) => void;
  clearAudit: () => void;
  setAnnotations: (a: Annotation[]) => void;
  setPxPerMm: (v: number | null) => void;
  setAnnotTool: (t: AnnKind) => void;
  setAnnotColor: (c: string) => void;
  setAnnotThickness: (n: number) => void;
  setMetaNotes: (n: string[]) => void;
  setAiDraft: (t: string) => void;
  resetCase: () => void;
}

function newCaseNo(): string {
  const y = new Date().getFullYear();
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `FDS-${y}-${rnd}`;
}

export const useCaseStore = create<CaseStore>()(
  persist(
    (set) => ({
      caseNo: newCaseNo(),
      examiner: '',
      authority: '',
      note: '',
      snapshots: [],
      analyses: [],
      ocrResults: [],
      audit: [],
      annotations: [],
      pxPerMm: null,
      annotTool: 'ruler',
      annotColor: ANN_COLORS[0],
      annotThickness: 1,
      metaNotes: [],
      aiDraft: '',
      setCaseNo: (v) => set({ caseNo: v }),
      setExaminer: (v) => set({ examiner: v }),
      setAuthority: (v) => set({ authority: v }),
      setNote: (v) => set({ note: v }),
      addSnapshot: (s) => set((st) => ({ snapshots: [s, ...st.snapshots].slice(0, 16) })),
      upsertSnapshot: (s) =>
        set((st) => ({ snapshots: [s, ...st.snapshots.filter((x) => x.id !== s.id)].slice(0, 16) })),
      removeSnapshot: (id) => set((st) => ({ snapshots: st.snapshots.filter((x) => x.id !== id) })),
      addAnalysis: (a) => set((st) => ({ analyses: [a, ...st.analyses].slice(0, 12) })),
      addOcr: (o) => set((st) => ({ ocrResults: [o, ...st.ocrResults].slice(0, 12) })),
      addAudit: (action, detail) =>
        set((st) => ({
          audit: [
            ...st.audit,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              ts: Date.now(),
              action,
              detail,
            },
          ].slice(-120), // en eski kayıtlar düşer — iz kronolojik sırada kalır
        })),
      clearAudit: () => set({ audit: [] }),
      setAnnotations: (a) => set({ annotations: a.slice(0, 60) }),
      setPxPerMm: (v) => set({ pxPerMm: v }),
      setAnnotTool: (t) => set({ annotTool: t }),
      setAnnotColor: (c) => set({ annotColor: c }),
      setAnnotThickness: (n) => set({ annotThickness: n }),
      setMetaNotes: (n) => set({ metaNotes: n.slice(0, 12) }),
      setAiDraft: (t) => set({ aiDraft: t.slice(0, 20000) }),
      resetCase: () =>
        set({
          caseNo: newCaseNo(),
          note: '',
          snapshots: [],
          analyses: [],
          ocrResults: [],
          audit: [],
          annotations: [],
          pxPerMm: null,
          metaNotes: [],
          aiDraft: '',
        }),
    }),
    {
      name: 'vsc9-case-v1',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/** Denetim kaydını rapor/dizin satırına biçimler. */
export function formatAuditEntry(e: AuditEntry): string {
  const t = new Date(e.ts).toLocaleString('tr-TR');
  return `[${t}] ${e.action}${e.detail ? ` — ${e.detail}` : ''}`;
}

export function paramsSummary(params: Params): string {
  const parts: string[] = [];
  if (params.exposure !== 0) parts.push(`Poz${params.exposure > 0 ? '+' : ''}${params.exposure.toFixed(2)}`);
  if (params.contrast !== 0) parts.push(`Knt${params.contrast > 0 ? '+' : ''}${params.contrast.toFixed(2)}`);
  if (params.gamma !== 1) parts.push(`γ${params.gamma.toFixed(2)}`);
  if (params.claheOn) parts.push('CLAHE');
  if (params.heqOn) parts.push('HEş');
  if (params.sobelOn) parts.push('Sobel');
  if (params.rakeOn) parts.push(`EğikIşık ${params.rakeAngle}°`);
  if (params.unsharpOn) parts.push('USM');
  if (params.threshold !== 'off') parts.push(params.threshold === 'otsu' ? 'Otsu' : 'Sauvola');
  if (params.falseColor !== 'off') parts.push('LUT');
  if (params.invertOn) parts.push('Neg');
  return parts.length ? parts.join(' · ') : 'saf bant';
}
