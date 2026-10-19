import { initStore, listInspections, saveInspection, deleteInspection, readFile, writeFile, removePath,
  insDir, uid, storageEstimate, readJSON, insMeta } from './store.js';
import { ELEMENT_GROUPS, ELEMENTS, DEFECTS, UNASSIGNED } from './data.js';
import { resizeToJpeg, readGps, readTaken, currentPosition, pdfToImages } from './img.js';
import { markerSVG } from './markers.js';
import { exportPdfReport, exportDocx, exportPlanPdf, exportHtmlViewer, exportZip, importZip, safeName, photoTitle } from './exporters.js';

/* ---------------- tiny DOM helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
const fmtDate = (t) => t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

function progress(label) {
  const bar = h('div', { class: 'pbar' });
  const txt = h('div', { class: 'ptxt' }, label);
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'pbox' }, txt, h('div', { class: 'ptrack' }, bar)));
  document.body.append(ov);
  return {
    set(i, n, sub) { bar.style.width = `${Math.round((i / n) * 100)}%`; txt.textContent = `${label} ${sub || `(${i}/${n})`}`; },
    done() { ov.remove(); },
  };
}

function sheet(title, content, { full = false, onClose } = {}) {
  const close = () => { ov.remove(); onClose && onClose(); };
  const ov = h('div', { class: 'overlay sheet-ov', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'sheet' + (full ? ' full' : '') },
      h('div', { class: 'sheet-hd' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div', { class: 'sheet-bd' }, content)));
  document.body.append(ov);
  return { close, el: ov };
}

function confirmBox(msg, okLabel = 'Delete', danger = true) {
  return new Promise(res => {
    const s = sheet('Are you sure?', h('div', {},
      h('p', {}, msg),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', onclick: () => { s.close(); res(false); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { s.close(); res(true); } }, okLabel))));
  });
}

async function deliver(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// iOS gives web apps no direct write access to the Photos library; the share
// sheet's "Save Image" is the only route, and it must start from a tap.
async function saveToPhotos(ins, photos) {
  const files = [];
  for (const p of photos) {
    const f = await readFile(`${insDir(ins.id)}/photos/${p.file}`);
    if (!f) continue;
    const ext = p.file.split('.').pop();
    files.push(new File([f], `${safeName(ins.name)} ${ins.photos.indexOf(p) + 1}.${ext}`, { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }));
  }
  if (!files.length) return false;
  if (!(navigator.canShare && navigator.canShare({ files }))) { toast('Saving to Photos is not supported in this browser', 4000); return false; }
  try { await navigator.share({ files }); }
  catch (e) { if (e.name !== 'AbortError') toast('Could not open the share sheet: ' + e.message, 4000); return false; }
  photos.forEach(p => { p.savedToPhotos = true; });
  await saveInspection(ins);
  return true;
}

function pickFiles({ accept, multiple = false, capture = null }) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, capture, style: { display: 'none' } });
    i.onchange = () => { res([...i.files]); i.remove(); };
    document.body.append(i); i.click();
  });
}

function elementSelect(value) {
  const s = h('select', { class: 'inp' }, h('option', { value: '' }, UNASSIGNED));
  for (const g of ELEMENT_GROUPS) s.append(h('optgroup', { label: g.group }, g.items.map(it => h('option', { value: it, selected: it === value }, it))));
  return s;
}
function defectSelect(value) {
  return h('select', { class: 'inp' }, h('option', { value: '' }, '—'), DEFECTS.map(d => h('option', { value: d, selected: d === value }, d)));
}

/* ---------------- state ---------------- */
const app = { ins: null, tab: 'photos', urls: new Map(), storeInfo: null };
const settings = {
  get(k, d) { try { const v = localStorage.getItem('sc.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch {} },
};

async function thumbURL(p) {
  if (app.urls.has(p.id)) return app.urls.get(p.id);
  const f = await readFile(`${insDir(app.ins.id)}/thumbs/${p.thumb}`);
  const u = f ? URL.createObjectURL(f) : '';
  app.urls.set(p.id, u);
  return u;
}
async function fullURL(p) {
  const f = await readFile(`${insDir(app.ins.id)}/photos/${p.file}`);
  return f ? URL.createObjectURL(f) : '';
}
function clearURLs() { for (const u of app.urls.values()) u && URL.revokeObjectURL(u); app.urls.clear(); }
const save = () => saveInspection(app.ins);

/* ================================================================
   GALLERY
   ================================================================ */
async function renderGallery() {
  clearURLs(); app.ins = null;
  const root = $('#app');
  root.innerHTML = '';
  const list = await listInspections();
  const top = h('header', { class: 'bar' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('span', {}, 'SpanCheck')),
    h('button', { class: 'icon-btn', 'aria-label': 'Storage and privacy', onclick: openSettings }, '⚙︎'));
  const actions = h('div', { class: 'row-btns pad' },
    h('button', { class: 'btn primary', onclick: newInspection }, '＋ New inspection'),
    h('button', { class: 'btn', onclick: importPackage }, 'Import package'));
  const grid = h('div', { class: 'grid pad' });
  if (!list.length) grid.append(h('div', { class: 'empty' },
    h('h3', {}, 'No inspections yet'),
    h('p', {}, 'Create one to start capturing photos. Everything is kept in a private folder on this device.')));
  for (const ins of list) grid.append(await galleryCard(ins));
  root.append(top, h('main', { class: 'scroll' }, actions, grid));
}

async function galleryCard(ins) {
  let thumb = '';
  const p0 = ins.photos && ins.photos[0];
  if (p0) {
    const f = await readFile(`${insDir(ins.id)}/thumbs/${p0.thumb}`);
    if (f) { thumb = URL.createObjectURL(f); app.urls.set('g' + ins.id, thumb); }
  }
  return h('div', { class: 'card' },
    h('button', { class: 'card-main', onclick: () => openInspection(ins.id) },
      h('div', { class: 'card-img', style: thumb ? { backgroundImage: `url(${thumb})` } : {} }, thumb ? '' : h('span', {}, '⌒')),
      h('div', { class: 'card-txt' },
        h('b', {}, ins.name || 'Untitled'),
        h('small', {}, [ins.structure, ins.ref].filter(Boolean).join(' · ') || '—'),
        h('small', { class: 'muted' }, `${ins.photos.length} photo${ins.photos.length === 1 ? '' : 's'} · ${ins.plans.length} plan${ins.plans.length === 1 ? '' : 's'} · ${ins.date || ''}`))),
    h('button', { class: 'icon-btn card-more', 'aria-label': 'More', onclick: () => cardMenu(ins) }, '⋯'));
}

function cardMenu(ins) {
  const s = sheet(ins.name || 'Inspection', h('div', { class: 'menu' },
    h('button', { onclick: () => { s.close(); openInspection(ins.id); } }, 'Open'),
    h('button', { onclick: async () => { s.close(); await editDetails(ins, true); } }, 'Rename / edit details'),
    h('button', { onclick: async () => { s.close(); await duplicate(ins); } }, 'Duplicate'),
    h('button', { onclick: async () => { s.close(); const pr = progress('Packaging'); try { const b = await exportZip(ins, (i, n) => pr.set(i, n)); pr.done(); await deliver(b, `${safeName(ins.name)}.spancheck.zip`); } catch (e) { pr.done(); toast(e.message); } } }, 'Export package (.zip)'),
    h('button', { class: 'danger-txt', onclick: async () => { s.close(); if (await confirmBox(`Delete “${ins.name}” and all its photos and plans from this device? This cannot be undone.`)) { await deleteInspection(ins.id); renderGallery(); } } }, 'Delete')));
}

async function newInspection() {
  const ins = { id: uid(), name: '', structure: '', ref: '', location: '', type: 'General', inspector: settings.get('inspector', ''),
    date: today(), notes: '', created: Date.now(), updated: Date.now(), photos: [], plans: [], lastElement: '' };
  const ok = await editDetails(ins, false, true);
  if (ok) { await saveInspection(ins); openInspection(ins.id); }
}

function editDetails(ins, saveAfter, isNew = false) {
  return new Promise(res => {
    const f = {};
    const field = (k, label, el) => { f[k] = el; el.value = ins[k] || ''; return h('label', { class: 'fld' }, h('span', {}, label), el); };
    const typeSel = h('select', { class: 'inp' }, ['General', 'Principal', 'Special', 'Acceptance', 'Safety', 'Other'].map(t => h('option', { value: t }, t)));
    let done = false;
    const s = sheet(isNew ? 'New inspection' : 'Inspection details', h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      for (const k in f) ins[k] = f[k].value.trim();
      if (!ins.name) ins.name = ins.structure || 'Untitled inspection';
      if (ins.inspector) settings.set('inspector', ins.inspector);
      done = true; s.close();
      if (saveAfter) { await saveInspection(ins); if (app.ins && app.ins.id === ins.id) renderInspection(); else renderGallery(); }
      res(true);
    } },
      field('name', 'Inspection name', h('input', { class: 'inp', placeholder: 'e.g. Mill Lane Bridge GI 2026', autofocus: true })),
      field('structure', 'Structure name', h('input', { class: 'inp' })),
      field('ref', 'Structure reference', h('input', { class: 'inp' })),
      field('location', 'Location', h('input', { class: 'inp' })),
      field('type', 'Inspection type', typeSel),
      field('inspector', 'Inspector', h('input', { class: 'inp' })),
      field('date', 'Inspection date', h('input', { class: 'inp', type: 'date' })),
      field('notes', 'Notes', h('textarea', { class: 'inp', rows: 3 })),
      h('button', { class: 'btn primary wide', type: 'submit' }, isNew ? 'Create' : 'Save')), { onClose: () => { if (!done) res(false); } });
  });
}

async function duplicate(ins) {
  const pr = progress('Duplicating');
  const copy = JSON.parse(JSON.stringify(ins));
  copy.id = uid(); copy.name = (ins.name || 'Inspection') + ' (copy)'; copy.created = Date.now();
  const from = insDir(ins.id), to = insDir(copy.id);
  const jobs = [...ins.photos.flatMap(p => [`photos/${p.file}`, `thumbs/${p.thumb}`]), ...ins.plans.map(p => `plans/${p.file}`)];
  for (let i = 0; i < jobs.length; i++) {
    const b = await readFile(`${from}/${jobs[i]}`);
    if (b) await writeFile(`${to}/${jobs[i]}`, b);
    pr.set(i + 1, jobs.length);
  }
  await saveInspection(copy);
  pr.done(); renderGallery();
}

async function importPackage() {
  const [file] = await pickFiles({ accept: '.zip,application/zip' });
  if (!file) return;
  const pr = progress('Importing');
  try { const ins = await importZip(file, (i, n) => pr.set(i, n)); pr.done(); toast(`Imported “${ins.name}”`); renderGallery(); }
  catch (e) { pr.done(); toast('Import failed: ' + e.message, 4000); }
}

async function openSettings() {
  const est = await storageEstimate();
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  sheet('Storage & privacy', h('div', { class: 'prose' },
    h('p', {}, h('b', {}, 'Where your data lives: '), app.storeInfo.backend + '. Photos, plans and records are written as files in a private folder that only this app can read. Nothing is uploaded.'),
    h('p', {}, h('b', {}, 'Protected from automatic clean-up: '), app.storeInfo.persisted ? 'Yes' : 'Not granted yet – add SpanCheck to your Home Screen and open it from there.'),
    est ? h('p', {}, h('b', {}, 'Space used: '), `${mb(est.usage || 0)} of ${mb(est.quota || 0)} available`) : null,
    h('p', {}, h('b', {}, 'Network: '), 'The app works fully offline. The only optional connection is the online base map on the Map tab, which is off unless you switch it on.'),
    h('p', { class: 'muted' }, 'Tip: export a .zip package regularly as a backup. Deleting the app from your Home Screen, or clearing Safari website data, removes its folder.')));
}

/* ================================================================
   INSPECTION
   ================================================================ */
async function openInspection(id) {
  clearURLs();
  const ins = await readJSON(insMeta(id));
  if (!ins) { toast('Inspection not found'); return renderGallery(); }
  app.ins = ins; app.tab = 'photos';
  renderInspection();
}

function renderInspection() {
  const root = $('#app');
  root.innerHTML = '';
  const ins = app.ins;
  const tabs = [['photos', 'Photos', '▦'], ['plans', 'Plans', '⌗'], ['map', 'Map', '◎'], ['export', 'Export', '⇪']];
  root.append(
    h('header', { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: renderGallery }, '‹'),
      h('div', { class: 'title' }, h('b', {}, ins.name), h('small', {}, [ins.structure, ins.ref].filter(Boolean).join(' · '))),
      h('button', { class: 'icon-btn', 'aria-label': 'Details', onclick: () => editDetails(ins, true) }, 'ⓘ')),
    h('main', { class: 'scroll', id: 'tab' }),
    h('nav', { class: 'tabs' }, tabs.map(([k, l, ic]) => h('button', { class: app.tab === k ? 'on' : '', onclick: () => { app.tab = k; renderInspection(); } }, h('i', {}, ic), l))));
  ({ photos: tabPhotos, plans: tabPlans, map: tabMap, export: tabExport })[app.tab]($('#tab'));
}

/* ---------------- Photos tab ---------------- */
async function tabPhotos(el) {
  const ins = app.ins;
  el.append(h('div', { class: 'row-btns pad sticky' },
    h('button', { class: 'btn primary', onclick: () => addPhotos(true) }, '📷 Camera'),
    h('button', { class: 'btn', onclick: () => addPhotos(false) }, 'Library'),
    ins.photos.length > 1 ? h('button', { class: 'btn', onclick: sortByElement, title: 'Renumber photos in element order' }, 'Sort') : null));
  const unsaved = ins.photos.filter(p => p.fromCamera && !p.savedToPhotos);
  if (unsaved.length) el.append(h('div', { class: 'pad' }, h('button', { class: 'btn wide save-photos', onclick: async () => { if (await saveToPhotos(ins, unsaved)) renderInspection(); } },
    `Save ${unsaved.length} camera photo${unsaved.length === 1 ? '' : 's'} to Photos`)));
  if (!ins.photos.length) {
    el.append(h('div', { class: 'empty' }, h('h3', {}, 'No photos yet'), h('p', {}, 'Take photos with the camera or import them from your library. GPS is read from each photo automatically.')));
    return;
  }
  const groups = new Map();
  ins.photos.forEach((p, i) => {
    const k = p.element || UNASSIGNED;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ p, n: i + 1 });
  });
  const order = [...ELEMENTS, UNASSIGNED].filter(k => groups.has(k));
  for (const k of order) {
    el.append(h('h4', { class: 'grp' }, k, h('span', {}, String(groups.get(k).length))));
    const list = h('div', { class: 'plist' });
    for (const { p, n } of groups.get(k)) {
      const img = h('div', { class: 'pthumb' }, h('span', { class: 'pno' }, String(n)));
      thumbURL(p).then(u => { if (u) img.style.backgroundImage = `url(${u})`; });
      list.append(h('button', { class: 'prow', onclick: () => editPhoto(n - 1) }, img,
        h('div', { class: 'ptxt2' },
          h('b', {}, p.defect && p.defect !== DEFECTS[0] ? p.defect : (p.defect || 'No category')),
          h('small', {}, p.caption || h('span', { class: 'muted' }, 'No description')),
          h('small', { class: 'muted' }, [p.lat != null ? '📍 GPS' : null, p.plan ? '⌗ On plan' : null, fmtDate(p.takenAt)].filter(Boolean).join('  ·  ')))));
    }
    el.append(list);
  }
}

async function addPhotos(camera) {
  const files = await pickFiles({ accept: 'image/*', multiple: !camera, capture: camera ? 'environment' : null });
  if (!files.length) return;
  const ins = app.ins;
  const pr = progress('Adding photos');
  let fallback;
  try {
    for (let i = 0; i < files.length; i++) {
      pr.set(i + 1, files.length);
      const file = files[i];
      const id = uid();
      const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
      let gps = await readGps(file);
      if (!gps && settings.get('gpsFallback', true)) {
        // Camera captures on iPhone usually arrive without location metadata,
        // so take the device's current position instead.
        if (fallback === undefined) fallback = await currentPosition();
        gps = fallback;
      }
      const taken = (await readTaken(file)) || (camera ? Date.now() : file.lastModified) || Date.now();
      const th = await resizeToJpeg(file, 480, 0.8);
      await writeFile(`${insDir(ins.id)}/photos/${id}.${ext}`, file);
      await writeFile(`${insDir(ins.id)}/thumbs/${id}.jpg`, th.blob);
      ins.photos.push({ id, file: `${id}.${ext}`, thumb: `${id}.jpg`, w: th.w0, h: th.h0,
        element: ins.lastElement || '', defect: '', caption: '',
        lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, gpsSource: gps ? (gps.acc ? 'device' : 'photo') : null,
        takenAt: taken, plan: null, fromCamera: camera || undefined });
    }
    await save();
  } catch (e) { toast('Could not add photo: ' + e.message, 4000); }
  pr.done();
  renderInspection();
  if (files.length === 1) editPhoto(ins.photos.length - 1);
}

async function sortByElement() {
  if (!await confirmBox('Reorder and renumber all photos so they follow the element list order? Plan markers update to match.', 'Sort & renumber', false)) return;
  const idx = (e) => { const i = ELEMENTS.indexOf(e); return i < 0 ? 999 : i; };
  app.ins.photos = app.ins.photos.map((p, i) => ({ p, i })).sort((a, b) => idx(a.p.element) - idx(b.p.element) || a.i - b.i).map(o => o.p);
  await save(); renderInspection();
}

async function editPhoto(index) {
  const ins = app.ins;
  let i = index;
  let fullUrl = '';
  const body = h('div', { class: 'pedit' });
  const s = sheet('', body, { full: true, onClose: () => { fullUrl && URL.revokeObjectURL(fullUrl); renderInspection(); } });
  const titleEl = $('.sheet-hd h2', s.el);

  async function draw() {
    const p = ins.photos[i];
    titleEl.textContent = `Photo ${i + 1} of ${ins.photos.length}`;
    body.innerHTML = '';
    const imgEl = h('img', { class: 'pfull', alt: `Photo ${i + 1}` });
    body.append(h('div', { class: 'pfull-wrap' }, imgEl));
    if (fullUrl) URL.revokeObjectURL(fullUrl);
    fullURL(p).then(u => { fullUrl = u; imgEl.src = u; });

    const elSel = elementSelect(p.element);
    const dfSel = defectSelect(p.defect);
    const cap = h('textarea', { class: 'inp', rows: 3, placeholder: 'Describe what the photo shows…' }); cap.value = p.caption || '';
    const commit = async () => { p.element = elSel.value; p.defect = dfSel.value; p.caption = cap.value.trim(); if (p.element) ins.lastElement = p.element; await save(); };
    elSel.onchange = commit; dfSel.onchange = commit; cap.onchange = commit;

    const gpsTxt = p.lat != null ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}${p.gpsSource === 'device' ? ' (device location)' : ''}` : 'No location';
    const planTxt = p.plan ? `On “${(ins.plans.find(x => x.id === p.plan.planId) || {}).name || 'plan'}”${p.plan.angle == null ? '' : ` · facing ${Math.round(p.plan.angle)}°`}` : 'Not marked on a plan';

    if (p.fromCamera && !p.savedToPhotos) body.append(h('button', { class: 'btn primary wide save-photos', onclick: async () => { await commit(); if (await saveToPhotos(ins, [p])) draw(); } },
      'Save to Photos'), h('p', { class: 'muted small' }, 'Then choose “Save Image” in the share sheet.'));
    body.append(
      h('div', { class: 'nav2' },
        h('button', { class: 'btn', disabled: i === 0, onclick: async () => { await commit(); i--; draw(); } }, '‹ Previous'),
        h('button', { class: 'btn', disabled: i === ins.photos.length - 1, onclick: async () => { await commit(); i++; draw(); } }, 'Next ›')),
      h('div', { class: 'form' },
        h('label', { class: 'fld' }, h('span', {}, 'Element'), elSel),
        h('label', { class: 'fld' }, h('span', {}, 'Defect category'), dfSel),
        h('label', { class: 'fld' }, h('span', {}, 'Description'), cap),
        h('div', { class: 'fld' }, h('span', {}, 'Location'), h('div', { class: 'kv' }, gpsTxt,
          h('button', { class: 'link', onclick: async () => { const g = await currentPosition(); if (!g) return toast('Location unavailable'); p.lat = g.lat; p.lng = g.lng; p.gpsSource = 'device'; await commit(); draw(); } }, 'Use current'),
          p.lat != null ? h('button', { class: 'link', onclick: async () => { p.lat = p.lng = null; p.gpsSource = null; await commit(); draw(); } }, 'Clear') : null)),
        h('div', { class: 'fld' }, h('span', {}, 'Plan location'), h('div', { class: 'kv' }, planTxt,
          ins.plans.length ? h('button', { class: 'link', onclick: async () => { await commit(); s.close(); openPlanEditor(p.plan ? p.plan.planId : ins.plans[0].id, p.id); } }, p.plan ? 'Move' : 'Mark on plan') : h('span', { class: 'muted' }, ' – add a plan first'),
          p.plan ? h('button', { class: 'link', onclick: async () => { p.plan = null; await commit(); draw(); } }, 'Remove') : null)),
        h('div', { class: 'fld' }, h('span', {}, 'Taken'), h('div', { class: 'kv' }, fmtDate(p.takenAt))),
        h('div', { class: 'fld' }, h('span', {}, 'Photos app'), h('div', { class: 'kv' }, p.savedToPhotos ? 'Saved' : 'Not saved',
          h('button', { class: 'link', onclick: async () => { await commit(); if (await saveToPhotos(ins, [p])) draw(); } }, p.savedToPhotos ? 'Save again' : 'Save to Photos'))),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', disabled: i === 0, onclick: async () => { await commit(); [ins.photos[i - 1], ins.photos[i]] = [ins.photos[i], ins.photos[i - 1]]; i--; await save(); draw(); } }, '↑ Move earlier'),
          h('button', { class: 'btn', disabled: i === ins.photos.length - 1, onclick: async () => { await commit(); [ins.photos[i + 1], ins.photos[i]] = [ins.photos[i], ins.photos[i + 1]]; i++; await save(); draw(); } }, '↓ Move later')),
        h('button', { class: 'btn danger wide', onclick: async () => {
          if (!await confirmBox(`Delete photo ${i + 1}? Later photos are renumbered.`)) return;
          const [gone] = ins.photos.splice(i, 1);
          await removePath(`${insDir(ins.id)}/photos/${gone.file}`); await removePath(`${insDir(ins.id)}/thumbs/${gone.thumb}`);
          const u = app.urls.get(gone.id); if (u) { URL.revokeObjectURL(u); app.urls.delete(gone.id); }
          await save();
          if (!ins.photos.length) return s.close();
          i = Math.min(i, ins.photos.length - 1); draw();
        } }, 'Delete photo')));
  }
  draw();
}

/* ---------------- Plans tab ---------------- */
async function tabPlans(el) {
  const ins = app.ins;
  el.append(h('div', { class: 'row-btns pad sticky' }, h('button', { class: 'btn primary', onclick: addPlan }, '＋ Add plan drawing')),
    h('p', { class: 'pad muted small' }, 'Images or PDFs. Each PDF page becomes its own plan.'));
  if (!ins.plans.length) { el.append(h('div', { class: 'empty' }, h('h3', {}, 'No plans yet'), h('p', {}, 'Add a general arrangement or elevation drawing, then mark where each photo was taken.'))); return; }
  const list = h('div', { class: 'grid pad' });
  for (const pl of ins.plans) {
    const n = ins.photos.filter(p => p.plan && p.plan.planId === pl.id).length;
    const img = h('div', { class: 'card-img plan' });
    readFile(`${insDir(ins.id)}/plans/${pl.file}`).then(f => { if (f) { const u = URL.createObjectURL(f); app.urls.set('pl' + pl.id, u); img.style.backgroundImage = `url(${u})`; } });
    list.append(h('div', { class: 'card' },
      h('button', { class: 'card-main', onclick: () => openPlanEditor(pl.id) }, img,
        h('div', { class: 'card-txt' }, h('b', {}, pl.name), h('small', { class: 'muted' }, `${n} marker${n === 1 ? '' : 's'}`))),
      h('button', { class: 'icon-btn card-more', onclick: () => planMenu(pl) }, '⋯')));
  }
  el.append(list);
}

function planMenu(pl) {
  const ins = app.ins;
  const s = sheet(pl.name, h('div', { class: 'menu' },
    h('button', { onclick: async () => { s.close(); const n = prompt('Plan name', pl.name); if (n && n.trim()) { pl.name = n.trim(); await save(); renderInspection(); } } }, 'Rename'),
    h('button', { class: 'danger-txt', onclick: async () => {
      s.close();
      if (!await confirmBox(`Delete “${pl.name}”? Markers on it will be removed (photos are kept).`)) return;
      ins.plans = ins.plans.filter(x => x.id !== pl.id);
      ins.photos.forEach(p => { if (p.plan && p.plan.planId === pl.id) p.plan = null; });
      await removePath(`${insDir(ins.id)}/plans/${pl.file}`);
      await save(); renderInspection();
    } }, 'Delete plan')));
}

async function addPlan() {
  const files = await pickFiles({ accept: 'image/*,application/pdf', multiple: true });
  if (!files.length) return;
  const ins = app.ins;
  const pr = progress('Adding plans');
  try {
    for (const file of files) {
      const base = file.name.replace(/\.[^.]+$/, '');
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const pages = await pdfToImages(file, (i, n) => pr.set(i, n, `– page ${i} of ${n}`));
        for (const pg of pages) {
          const id = uid();
          await writeFile(`${insDir(ins.id)}/plans/${id}.png`, pg.blob);
          ins.plans.push({ id, file: `${id}.png`, w: pg.w, h: pg.h, name: pages.length > 1 ? `${base} – p${pg.page}` : base });
        }
      } else {
        const r = await resizeToJpeg(file, 6000, 0.92);
        const id = uid();
        await writeFile(`${insDir(ins.id)}/plans/${id}.jpg`, r.blob);
        ins.plans.push({ id, file: `${id}.jpg`, w: r.w, h: r.h, name: base });
      }
    }
    await save();
  } catch (e) { toast('Could not add plan: ' + e.message, 4000); }
  pr.done(); renderInspection();
}

/* ---------------- Plan editor (pan, pinch-zoom, place markers) ---------------- */
async function openPlanEditor(planId, placePhotoId = null) {
  const ins = app.ins;
  let plan = ins.plans.find(p => p.id === planId);
  if (!plan) return;
  let z = 1, tx = 0, ty = 0;
  let placingId = placePhotoId;   // photo waiting to be placed
  let selectedId = placePhotoId && ins.photos.find(p => p.id === placePhotoId && p.plan && p.plan.planId === planId) ? placePhotoId : null;
  let planUrl = '';

  const imgEl = h('img', { alt: '', draggable: 'false' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const stage = h('div', { class: 'pstage' }, imgEl, svg);
  const wrap = h('div', { class: 'pwrap' }, stage);
  const planSel = h('select', { class: 'inp sm' }, ins.plans.map(p => h('option', { value: p.id, selected: p.id === plan.id }, p.name)));
  const hint = h('div', { class: 'phint' });
  const panel = h('div', { class: 'ppanel' });
  const ov = h('div', { class: 'editor' },
    h('header', { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Done', onclick: close }, '‹'),
      planSel,
      h('button', { class: 'icon-btn', 'aria-label': 'Fit', onclick: fit }, '⤢')),
    wrap, hint, panel);
  document.body.append(ov);

  function close() { planUrl && URL.revokeObjectURL(planUrl); ov.remove(); renderInspection(); }

  async function loadPlan() {
    if (planUrl) URL.revokeObjectURL(planUrl);
    const f = await readFile(`${insDir(ins.id)}/plans/${plan.file}`);
    planUrl = f ? URL.createObjectURL(f) : '';
    imgEl.src = planUrl; imgEl.width = plan.w; imgEl.height = plan.h;
    svg.setAttribute('width', plan.w); svg.setAttribute('height', plan.h); svg.setAttribute('viewBox', `0 0 ${plan.w} ${plan.h}`);
    fit(); drawMarkers(); drawPanel();
  }
  planSel.onchange = () => { plan = ins.plans.find(p => p.id === planSel.value); selectedId = null; loadPlan(); };

  function fit() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    z = Math.min(W / plan.w, H / plan.h); tx = (W - plan.w * z) / 2; ty = (H - plan.h * z) / 2;
    apply();
  }
  let raf = 0;
  function apply() {
    stage.style.transform = `translate(${tx}px,${ty}px) scale(${z})`;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(drawMarkers);
  }
  function drawMarkers() {
    const r = 14 / z; // constant on-screen size
    svg.innerHTML = ins.photos.map((p, i) => (p.plan && p.plan.planId === plan.id)
      ? markerSVG(p.plan.x, p.plan.y, p.plan.angle, i + 1, r, `data-id="${p.id}"${p.id === selectedId ? ' class="mk sel"' : ''}`) : '').join('');
  }
  function zoomAt(x, y, k) {
    const nz = Math.min(20, Math.max(0.02, z * k)); k = nz / z;
    tx = x - (x - tx) * k; ty = y - (y - ty) * k; z = nz;
  }
  const local = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toPlan = (pt) => ({ x: (pt.x - tx) / z, y: (pt.y - ty) / z });
  const inPlan = (q) => q.x >= 0 && q.y >= 0 && q.x <= plan.w && q.y <= plan.h;

  function drawPanel() {
    panel.innerHTML = '';
    const placing = placingId && ins.photos.find(p => p.id === placingId);
    if (placing) {
      const n = ins.photos.indexOf(placing) + 1;
      hint.textContent = `Tap where photo ${n} was taken. Drag from that point to set the direction you were facing.`;
      hint.style.display = 'block';
      panel.append(h('div', { class: 'row-btns' },
        h('span', { class: 'grow' }, `Placing photo ${n}`),
        h('button', { class: 'btn', onclick: () => { placingId = null; drawPanel(); } }, 'Cancel')));
      return;
    }
    hint.style.display = 'none';
    const sel = selectedId && ins.photos.find(p => p.id === selectedId);
    if (sel) {
      const n = ins.photos.indexOf(sel) + 1;
      const thumb = h('div', { class: 'pthumb sm' });
      thumbURL(sel).then(u => { if (u) thumb.style.backgroundImage = `url(${u})`; });
      const ang = h('input', { type: 'range', min: 0, max: 359, value: sel.plan.angle ?? 0, class: 'grow' });
      const angLbl = h('span', { class: 'angle' }, sel.plan.angle == null ? 'No direction' : `${Math.round(sel.plan.angle)}°`);
      ang.oninput = () => { sel.plan.angle = +ang.value; angLbl.textContent = `${ang.value}°`; drawMarkers(); };
      ang.onchange = save;
      panel.append(
        h('div', { class: 'row-btns' }, thumb, h('div', { class: 'grow' }, h('b', {}, `Photo ${n}`), h('br'), h('small', { class: 'muted' }, sel.element || UNASSIGNED)),
          h('button', { class: 'btn sm', onclick: () => { placingId = sel.id; drawPanel(); } }, 'Re-place'),
          h('button', { class: 'btn sm danger', onclick: async () => { sel.plan = null; selectedId = null; await save(); drawMarkers(); drawPanel(); } }, 'Remove')),
        h('div', { class: 'row-btns' }, h('span', {}, 'Direction'), ang, angLbl,
          h('button', { class: 'link', onclick: async () => { sel.plan.angle = null; await save(); drawMarkers(); drawPanel(); } }, 'None')));
      return;
    }
    const unplaced = ins.photos.map((p, i) => ({ p, n: i + 1 })).filter(o => !o.p.plan);
    const pick = h('select', { class: 'inp sm grow' }, h('option', { value: '' }, unplaced.length ? `Choose a photo to place (${unplaced.length} unplaced)` : 'All photos are placed'),
      unplaced.map(o => h('option', { value: o.p.id }, `${o.n} – ${o.p.element || UNASSIGNED}`)));
    pick.onchange = () => { if (pick.value) { placingId = pick.value; drawPanel(); } };
    panel.append(h('div', { class: 'row-btns' }, pick), h('small', { class: 'muted' }, 'Tap a marker to select it. Pinch to zoom, drag to pan.'));
  }

  // ---- gestures
  const pts = new Map();
  let gesture = null; // {type:'pan'|'pinch'|'place'|'move', ...}
  wrap.addEventListener('pointerdown', (e) => {
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size === 2) {
      if (gesture && gesture.type === 'place') { const p = ins.photos.find(x => x.id === gesture.photoId); p.plan = gesture.before; drawMarkers(); }
      const [a, b] = [...pts.values()];
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    const pt = local(e);
    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
    const hit = hitEl && hitEl.closest && hitEl.closest('.mk');
    if (placingId) {
      const q = toPlan(pt);
      if (!inPlan(q)) return;
      const p = ins.photos.find(x => x.id === placingId);
      gesture = { type: 'place', photoId: p.id, start: pt, before: p.plan ? { ...p.plan } : null };
      p.plan = { planId: plan.id, x: q.x, y: q.y, angle: p.plan && p.plan.planId === plan.id ? p.plan.angle : null };
      selectedId = p.id; drawMarkers();
    } else if (hit && hit.dataset.id === selectedId) {
      gesture = { type: 'move', start: pt, moved: 0 };
    } else {
      gesture = { type: 'pan', start: pt, last: pt, moved: 0, hit: hit ? hit.dataset.id : null };
    }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gesture) return;
    const pt = local(e);
    pts.set(e.pointerId, pt);
    if (gesture.type === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(gesture.m.x, gesture.m.y, d / gesture.d);
      tx += m.x - gesture.m.x; ty += m.y - gesture.m.y;
      gesture.d = d; gesture.m = m; apply();
    } else if (gesture.type === 'pan') {
      tx += pt.x - gesture.last.x; ty += pt.y - gesture.last.y;
      gesture.moved += Math.abs(pt.x - gesture.last.x) + Math.abs(pt.y - gesture.last.y);
      gesture.last = pt; apply();
    } else if (gesture.type === 'place') {
      const dx = pt.x - gesture.start.x, dy = pt.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 14) {
        const p = ins.photos.find(x => x.id === gesture.photoId);
        p.plan.angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        drawMarkers();
      }
    } else if (gesture.type === 'move') {
      const p = ins.photos.find(x => x.id === selectedId);
      const q = toPlan(pt);
      if (inPlan(q)) { p.plan.x = q.x; p.plan.y = q.y; drawMarkers(); }
    }
  });
  const end = async (e) => {
    pts.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'pinch') { if (pts.size === 0) gesture = null; else { const [only] = [...pts.values()]; gesture = { type: 'pan', start: only, last: only, moved: 99 }; } return; }
    if (gesture.type === 'place') { placingId = null; await save(); drawPanel(); }
    else if (gesture.type === 'move') { await save(); }
    else if (gesture.type === 'pan' && gesture.moved < 8) { selectedId = gesture.hit; drawMarkers(); drawPanel(); }
    gesture = null;
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY / 400)); apply(); }, { passive: false });
  // stop iOS page-level pinch
  ov.addEventListener('gesturestart', (e) => e.preventDefault());

  await loadPlan();
}

/* ---------------- Map tab ---------------- */
let leafletMap = null;
async function tabMap(el) {
  const ins = app.ins;
  const pts = ins.photos.map((p, i) => ({ p, n: i + 1 })).filter(o => o.p.lat != null);
  const online = settings.get('mapTiles', false);
  el.classList.add('noscroll');
  const mapDiv = h('div', { class: 'map' });
  el.append(
    h('div', { class: 'row-btns pad mapbar' },
      h('span', { class: 'grow small' }, `${pts.length} of ${ins.photos.length} photos have a location`),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: online, onchange: (e) => { settings.set('mapTiles', e.target.checked); renderInspection(); } }), h('span', {}, 'Online base map'))),
    mapDiv);
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  if (!pts.length) { mapDiv.append(h('div', { class: 'empty' }, h('h3', {}, 'No geotagged photos'), h('p', {}, 'Locations come from photo metadata or the device when you take a photo.'))); return; }
  const L = window.L;
  leafletMap = L.map(mapDiv, { zoomControl: true, attributionControl: online });
  if (online) {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(leafletMap);
  } else {
    mapDiv.classList.add('offline');
    L.control.scale({ imperial: false }).addTo(leafletMap);
  }
  const bounds = [];
  for (const { p, n } of pts) {
    const icon = L.divIcon({ className: 'mapmk', html: `<span>${n}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    const m = L.marker([p.lat, p.lng], { icon }).addTo(leafletMap);
    m.on('click', async () => {
      const u = await thumbURL(p);
      m.bindPopup(`<div class="mpop"><img src="${u}" alt=""><b>${photoTitle(p, n).replace(/</g, '&lt;')}</b><br><small>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</small><br><a href="#" data-i="${n - 1}">Open photo</a></div>`).openPopup();
    });
    bounds.push([p.lat, p.lng]);
  }
  leafletMap.on('popupopen', (e) => {
    const a = e.popup.getElement().querySelector('a[data-i]');
    if (a) a.onclick = (ev) => { ev.preventDefault(); editPhoto(+a.dataset.i); };
  });
  setTimeout(() => { leafletMap.invalidateSize(); leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 }); }, 50);
}

/* ---------------- Export tab ---------------- */
function tabExport(el) {
  const ins = app.ins;
  const q = (key, def) => {
    const v = settings.get(key, def);
    const out = h('output', {}, `${Math.round(v * 100)}%`);
    const r = h('input', { type: 'range', min: 0.3, max: 0.95, step: 0.05, value: v, class: 'grow', oninput: () => { out.textContent = `${Math.round(r.value * 100)}%`; settings.set(key, +r.value); } });
    return { el: h('div', { class: 'row-btns' }, h('span', {}, 'Photo quality'), r, out), get: () => +r.value };
  };
  const sizeToPx = { 1: 2000, 2: 1600, 4: 1200, 6: 1000 };

  const run = async (label, fn, name) => {
    if (!ins.photos.length && !/plan/i.test(label)) return toast('Add some photos first');
    const pr = progress(label);
    try { const blob = await fn((i, n) => pr.set(i, n)); pr.done(); await deliver(blob, name); }
    catch (e) { pr.done(); toast(e.message, 4000); console.error(e); }
  };
  const base = safeName(ins.name);

  const perPage = h('select', { class: 'inp sm' }, [[1, '1 large photo per page'], [2, '2 per page'], [4, '4 per page'], [6, '6 per page']].map(([v, l]) => h('option', { value: v, selected: v === settings.get('pdfPer', 2) }, l)));
  perPage.onchange = () => settings.set('pdfPer', +perPage.value);
  const pdfQ = q('pdfQ', 0.75);

  const wordSize = h('select', { class: 'inp sm' }, [[8, 'Small (8 cm wide)'], [12, 'Medium (12 cm)'], [16, 'Large (16 cm)']].map(([v, l]) => h('option', { value: v, selected: v === settings.get('docW', 12) }, l)));
  wordSize.onchange = () => settings.set('docW', +wordSize.value);
  const docQ = q('docQ', 0.7);
  const htmlQ = q('htmlQ', 0.7);

  const card = (title, desc, controls, btn) => h('section', { class: 'xcard' }, h('h3', {}, title), h('p', { class: 'muted small' }, desc), controls, btn);

  el.append(h('div', { class: 'pad' },
    card('PDF photo report', 'Cover sheet plus captioned photos, in photo-number order.',
      h('div', { class: 'form' }, perPage, pdfQ.el),
      h('button', { class: 'btn primary wide', onclick: () => run('Building PDF', (p) => exportPdfReport(ins, { perPage: +perPage.value, quality: pdfQ.get(), maxPx: sizeToPx[perPage.value] }, p), `${base}_Photo_Report.pdf`) }, 'Create PDF')),
    card('Word report', 'Editable .docx. Captions use Word numbering, so they renumber if you reorder photos in Word (select all, then F9).',
      h('div', { class: 'form' }, wordSize, docQ.el),
      h('button', { class: 'btn primary wide', onclick: () => run('Building Word report', (p) => exportDocx(ins, { widthCm: +wordSize.value, quality: docQ.get(), maxPx: +wordSize.value * 110 }, p), `${base}_Photo_Report.docx`) }, 'Create Word document')),
    card('Annotated plans PDF', `Every plan with its numbered direction markers, plus a marker key. ${ins.plans.length} plan${ins.plans.length === 1 ? '' : 's'}.`,
      null,
      h('button', { class: 'btn primary wide', disabled: !ins.plans.length, onclick: () => run('Drawing plans', (p) => exportPlanPdf(ins, p), `${base}_Plans.pdf`) }, 'Create plans PDF')),
    card('Interactive plan viewer', 'A single .html file: tap a marker to see its photo, search by photo number. Opens offline in any browser.',
      h('div', { class: 'form' }, htmlQ.el),
      h('button', { class: 'btn primary wide', onclick: () => run('Building viewer', (p) => exportHtmlViewer(ins, { quality: htmlQ.get(), maxPx: 1600 }, p), `${base}_Plan_Viewer.html`) }, 'Create viewer')),
    card('Backup package', 'Full .zip of this inspection (original photos, plans, all records). Import it on another device or keep it as a backup.',
      null,
      h('button', { class: 'btn wide', onclick: () => run('Packaging', (p) => exportZip(ins, p), `${base}.spancheck.zip`) }, 'Export package')),
    h('p', { class: 'muted small' }, 'Exports are created on this device and only leave it when you choose where to share or save them.')));
}

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    app.storeInfo = await initStore();
  } catch (e) {
    $('#app').innerHTML = `<div class="empty"><h3>Storage unavailable</h3><p>${e.message}. Private browsing mode blocks on-device storage – open SpanCheck in a normal Safari tab or from your Home Screen.</p></div>`;
    return;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  renderGallery();
})();
