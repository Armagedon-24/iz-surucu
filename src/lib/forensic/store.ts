/**
 * VAKA DEPOSU — kamera/analiz kayıtları localStorage'da saklanır.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Params } from '@/lib/forensic/pipeline';

export interface Snapshot {
  id: string;
  ts: number;
  label: string;
  thumb: string; // jpeg dataURL
  modeName: string;
  modeNm: string;
  paramsSummary: string;
}

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
  setCaseNo: (v: string) => void;
  setExaminer: (v: string) => void;
  setAuthority: (v: string) => void;
  setNote: (v: string) => void;
  addSnapshot: (s: Snapshot) => void;
  removeSnapshot: (id: string) => void;
  addAnalysis: (a: AnalysisRecord) => void;
  addOcr: (o: OcrRecord) => void;
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
      setCaseNo: (v) => set({ caseNo: v }),
      setExaminer: (v) => set({ examiner: v }),
      setAuthority: (v) => set({ authority: v }),
      setNote: (v) => set({ note: v }),
      addSnapshot: (s) => set((st) => ({ snapshots: [s, ...st.snapshots].slice(0, 16) })),
      removeSnapshot: (id) => set((st) => ({ snapshots: st.snapshots.filter((x) => x.id !== id) })),
      addAnalysis: (a) => set((st) => ({ analyses: [a, ...st.analyses].slice(0, 12) })),
      addOcr: (o) => set((st) => ({ ocrResults: [o, ...st.ocrResults].slice(0, 12) })),
      resetCase: () =>
        set({
          caseNo: newCaseNo(),
          note: '',
          snapshots: [],
          analyses: [],
          ocrResults: [],
        }),
    }),
    {
      name: 'vsc9-case-v1',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

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
