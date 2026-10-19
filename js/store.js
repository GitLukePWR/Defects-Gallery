// On-device storage.
// Primary: the Origin Private File System (OPFS) – a real, private folder tree
// on the device that only this app can see. Layout:
//   inspections/<id>/inspection.json
//   inspections/<id>/photos/<photoId>.jpg      (original file, untouched)
//   inspections/<id>/thumbs/<photoId>.jpg      (small preview)
//   inspections/<id>/plans/<planId>.png        (plan drawing page)
// Fallback (very old browsers only): IndexedDB with the same path keys.

let backend = null;

/* ---------- OPFS ---------- */
const opfs = {
  name: 'On-device folder (OPFS)',
  root: null,
  worker: null,
  pending: new Map(),
  seq: 0,
  async init() {
    this.root = await navigator.storage.getDirectory();
    // Probe whether createWritable exists; Safari historically only allowed
    // writes via a sync access handle inside a worker.
    const probeDir = await this.root.getDirectoryHandle('.probe', { create: true });
    const fh = await probeDir.getFileHandle('p', { create: true });
    this.hasWritable = typeof fh.createWritable === 'function';
    if (!this.hasWritable) this.startWorker();
    await this.root.removeEntry('.probe', { recursive: true }).catch(() => {});
  },
  startWorker() {
    const src = `
      self.onmessage = async (e) => {
        const { id, path, buf } = e.data;
        try {
          let dir = await navigator.storage.getDirectory();
          const parts = path.split('/'); const name = parts.pop();
          for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
          const fh = await dir.getFileHandle(name, { create: true });
          const ah = await fh.createSyncAccessHandle();
          ah.truncate(0); ah.write(new Uint8Array(buf), { at: 0 }); ah.flush(); ah.close();
          self.postMessage({ id });
        } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
      };`;
    this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id); if (!p) return;
      this.pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve();
    };
  },
  async dir(parts, create) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  },
  async write(path, blob) {
    if (!this.hasWritable) {
      const buf = await blob.arrayBuffer();
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ id, path, buf }, [buf]);
      });
    }
    const parts = path.split('/'); const name = parts.pop();
    const d = await this.dir(parts, true);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob); await w.close();
  },
  async read(path) {
    try {
      const parts = path.split('/'); const name = parts.pop();
      const d = await this.dir(parts, false);
      const fh = await d.getFileHandle(name);
      return await fh.getFile();
    } catch { return null; }
  },
  async remove(path) {
    try {
      const parts = path.split('/'); const name = parts.pop();
      const d = await this.dir(parts, false);
      await d.removeEntry(name, { recursive: true });
    } catch { /* already gone */ }
  },
  async list(path) {
    try {
      const d = await this.dir(path.split('/').filter(Boolean), false);
      const out = [];
      for await (const [name] of d.entries()) out.push(name);
      return out;
    } catch { return []; }
  },
};

/* ---------- IndexedDB fallback ---------- */
const idb = {
  name: 'On-device database (IndexedDB)',
  db: null,
  init() {
    return new Promise((res, rej) => {
      // Original database name kept so existing data still loads.
      const r = indexedDB.open('spancheck', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('files', mode);
      const s = t.objectStore('files');
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  write(path, blob) { return this.tx('readwrite', s => s.put(blob, path)); },
  async read(path) { return (await this.tx('readonly', s => s.get(path))) || null; },
  async remove(path) {
    const keys = await this.tx('readonly', s => s.getAllKeys());
    await this.tx('readwrite', s => keys.filter(k => k === path || k.startsWith(path + '/')).forEach(k => s.delete(k)));
  },
  async list(path) {
    const pre = path.replace(/\/?$/, '/');
    const keys = await this.tx('readonly', s => s.getAllKeys());
    return [...new Set(keys.filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split('/')[0]))];
  },
};

/* ---------- public API ---------- */
export async function initStore() {
  if (navigator.storage && navigator.storage.getDirectory) {
    try { await opfs.init(); backend = opfs; } catch (e) { console.warn('OPFS unavailable', e); }
  }
  if (!backend) { await idb.init(); backend = idb; }
  // Ask the browser not to evict our data under storage pressure.
  let persisted = false;
  try { persisted = await navigator.storage.persist(); } catch {}
  return { backend: backend.name, persisted };
}

export const writeFile = (p, b) => backend.write(p, b);
export const readFile = (p) => backend.read(p);
export const removePath = (p) => backend.remove(p);
export const listDir = (p) => backend.list(p);

export async function writeJSON(path, obj) {
  await writeFile(path, new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
}
export async function readJSON(path) {
  const f = await readFile(path);
  if (!f) return null;
  try { return JSON.parse(await f.text()); } catch { return null; }
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

/* ---------- inspection helpers ---------- */
export const insDir = (id) => `inspections/${id}`;
export const insMeta = (id) => `${insDir(id)}/inspection.json`;

export async function listInspections() {
  const ids = await listDir('inspections');
  const out = [];
  for (const id of ids) {
    const m = await readJSON(insMeta(id));
    if (m) out.push(m);
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function saveInspection(ins) {
  ins.updated = Date.now();
  await writeJSON(insMeta(ins.id), ins);
}

export const deleteInspection = (id) => removePath(insDir(id));

export function uid() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
}
