/**
 * VAKA DELİL DEPOSU (IndexedDB) — tek vaka altında birden çok delil
 * (belge fotoğrafı/taraması) saklanır; deliller arası geçiş tek tık.
 * Görüntü verileri localStorage'a sığmayacağı için IndexedDB kullanılır;
 * liste/kapaklar hafiftir, tam görüntü dataURL olarak saklanır.
 */

export interface ExhibitRecord {
  id: string;
  name: string;
  addedTs: number;
  width: number;
  height: number;
  thumb: string; // küçük kapak (dataURL jpeg)
  dataUrl: string; // tam delil görüntüsü (jpeg ~1400px)
  sha256?: string;
}

const DB_NAME = 'izsurucu-v1';
const STORE = 'exhibits';
const MAX_EXHIBITS = 16;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB açılamadı'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB işlemi başarısız'));
    t.oncomplete = () => db.close();
  });
}

export async function listExhibits(): Promise<ExhibitRecord[]> {
  try {
    const all = await tx<ExhibitRecord[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => a.addedTs - b.addedTs).slice(0, MAX_EXHIBITS);
  } catch {
    return [];
  }
}

export async function saveExhibit(rec: ExhibitRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(rec));
}

export async function deleteExhibit(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Sayfalı PDF/çoklu dosya gibi toplu eklemelerde eski fazlalıkları düşürür. */
export async function trimExhibits(keepIds: string[]): Promise<void> {
  const all = await listExhibits();
  const keep = new Set(keepIds);
  for (const rec of all) {
    if (!keep.has(rec.id) && all.length > MAX_EXHIBITS) {
      await deleteExhibit(rec.id);
    }
  }
}
