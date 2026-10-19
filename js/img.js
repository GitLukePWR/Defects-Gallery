// Image helpers: decode, resize, read GPS, render PDFs to images.

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

// Draw an image (EXIF orientation honoured by the browser) into a canvas no
// larger than maxPx on its long side and return a JPEG blob.
export async function resizeToJpeg(blob, maxPx, quality = 0.85) {
  const { img, url } = await loadImage(blob);
  try {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const s = Math.min(1, maxPx / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    return { blob: out, w, h, w0, h0 };
  } finally { URL.revokeObjectURL(url); }
}

export async function readGps(file) {
  try {
    if (!window.exifr) return null;
    const g = await window.exifr.gps(file);
    if (g && isFinite(g.latitude) && isFinite(g.longitude)) return { lat: g.latitude, lng: g.longitude };
  } catch {}
  return null;
}

export async function readTaken(file) {
  try {
    const t = await window.exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const d = t && (t.DateTimeOriginal || t.CreateDate);
    if (d instanceof Date && !isNaN(d)) return d.getTime();
  } catch {}
  return null;
}

export function currentPosition(timeout = 8000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    // iOS sometimes never calls back at all (its own timeout doesn't cover a
    // pending permission prompt), so give up ourselves too.
    const cap = setTimeout(() => resolve(null), timeout + 2000);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(cap); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      () => { clearTimeout(cap); resolve(null); },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

// Render each page of a PDF plan to a PNG blob.
export async function pdfToImages(file, onProgress) {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress && onProgress(i, doc.numPages);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    // Aim for ~4000px on the long side: sharp enough to zoom into details.
    const scale = Math.min(6, 4000 / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    out.push({ blob, w: c.width, h: c.height, page: i });
    c.width = c.height = 0;
  }
  return out;
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
