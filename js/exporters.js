// Export: PDF report, Word report, annotated plan PDF, HTML plan viewer, ZIP backup.
import { readFile, writeFile, saveInspection, insDir, uid } from './store.js';
import { resizeToJpeg, loadImage, blobToDataURL } from './img.js';
import { drawMarker, markerSVG } from './markers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const fmtGps = (p) => (p.lat != null && p.lng != null) ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : '';
export const safeName = (s) => (String(s || 'Inspection').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Inspection');

export function photoTitle(p, n) {
  const bits = [p.element, p.defect && p.defect !== 'No defect / record only' ? p.defect : null].filter(Boolean);
  return `Photo ${n}${bits.length ? ' – ' + bits.join(' – ') : ''}`;
}

async function photoJpeg(ins, p, maxPx, quality) {
  const f = await readFile(`${insDir(ins.id)}/photos/${p.file}`);
  if (!f) return null;
  return resizeToJpeg(f, maxPx, quality);
}

const u8 = async (blob) => new Uint8Array(await blob.arrayBuffer());

/* ===================== PDF photo report ===================== */
// opts: { perPage: 1|2|4|6, quality: 0..1, maxPx }
export async function exportPdfReport(ins, opts, progress) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 14;
  coverPage(doc, ins, W, M);

  if (opts.plans) await pdfPlanPages(doc, ins, opts.quality);

  const per = opts.perPage;
  const cols = per >= 4 ? 2 : 1;
  const rows = Math.ceil(per / cols);
  const headerH = 10, capH = 15;
  const cellW = (W - 2 * M - (cols - 1) * 6) / cols;
  const cellH = (H - 2 * M - headerH - (rows - 1) * 6) / rows;

  for (let i = 0; i < ins.photos.length; i++) {
    progress && progress(i + 1, ins.photos.length);
    const slot = i % per;
    if (slot === 0) { doc.addPage('a4', 'portrait'); pageHeader(doc, ins, W, M); }
    const p = ins.photos[i];
    const c = slot % cols, r = Math.floor(slot / cols);
    const x = M + c * (cellW + 6), y = M + headerH + r * (cellH + 6);
    const img = await photoJpeg(ins, p, opts.maxPx, opts.quality);
    const boxH = cellH - capH;
    if (img) {
      const s = Math.min(cellW / img.w, boxH / img.h);
      const iw = img.w * s, ih = img.h * s;
      doc.addImage(await u8(img.blob), 'JPEG', x + (cellW - iw) / 2, y + (boxH - ih) / 2, iw, ih, undefined, 'FAST');
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(per >= 6 ? 8 : 9.5); doc.setTextColor(20);
    doc.text(photoTitle(p, i + 1), x, y + boxH + 4.5, { maxWidth: cellW });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(per >= 6 ? 7 : 8.5); doc.setTextColor(60);
    const meta = [p.caption, [fmtDate(p.takenAt), fmtGps(p), opts.plans && planRef(ins, p)].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n');
    doc.text(doc.splitTextToSize(meta, cellW).slice(0, 3), x, y + boxH + 8.5);
  }
  pageNumbers(doc);
  return doc.output('blob');
}

const planRef = (ins, p) => { const pl = p.plan && ins.plans.find(x => x.id === p.plan.planId); return pl ? `Plan: ${pl.name}` : ''; };
const markedOn = (ins, plan) => ins.photos.map((p, i) => ({ p, n: i + 1 })).filter(o => o.p.plan && o.p.plan.planId === plan.id);

// One A4 page per plan (landscape for wide drawings) with its markers and a key.
async function pdfPlanPages(doc, ins, quality) {
  for (const plan of ins.plans) {
    const r = await renderPlan(ins, plan, 3200, Math.max(quality, 0.8));
    if (!r) continue;
    const land = r.w >= r.h;
    doc.addPage('a4', land ? 'landscape' : 'portrait');
    const W = land ? 297 : 210, H = land ? 210 : 297, M = 14;
    pageHeader(doc, ins, W, M);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(`Plan – ${plan.name}`, M, M + 12);
    const marked = markedOn(ins, plan);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60);
    const key = marked.length ? doc.splitTextToSize('Markers: ' + marked.map(({ p, n }) => `${n} ${p.element || ''}`.trim()).join(';  '), W - 2 * M).slice(0, 4) : ['No photos marked on this plan'];
    const keyH = key.length * 3.8 + 2;
    const top = M + 16, availH = H - top - M - 6 - keyH, availW = W - 2 * M;
    const s = Math.min(availW / r.w, availH / r.h);
    doc.addImage(await u8(r.blob), 'JPEG', M + (availW - r.w * s) / 2, top, r.w * s, r.h * s, undefined, 'FAST');
    doc.setDrawColor(200); doc.rect(M + (availW - r.w * s) / 2, top, r.w * s, r.h * s);
    doc.text(key, M, top + r.h * s + 6);
  }
}

function coverPage(doc, ins, W, M) {
  doc.setFillColor(23, 58, 94); doc.rect(0, 0, W, 52, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
  doc.text(ins.name || 'Inspection', M, 26, { maxWidth: W - 2 * M });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text('Photographic inspection record', M, 38);
  const rows = [
    ['Structure', ins.structure], ['Structure ref.', ins.ref], ['Location', ins.location],
    ['Inspection type', ins.type], ['Inspector', ins.inspector], ['Date', ins.date],
    ['Photos', String(ins.photos.length)], ['Plans', String(ins.plans.length)],
  ].filter(r => r[1]);
  let y = 70;
  doc.setTextColor(30);
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(k, M, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(v), M + 42, y, { maxWidth: W - 2 * M - 42 });
    y += 8;
  }
  if (ins.notes) {
    y += 4; doc.setFont('helvetica', 'bold'); doc.text('Notes', M, y); y += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(ins.notes, W - 2 * M), M, y);
  }
}
function pageHeader(doc, ins, W, M) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(23, 58, 94);
  doc.text(ins.name || 'Inspection', M, M + 3);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
  doc.text([ins.ref, ins.date].filter(Boolean).join('  ·  '), W - M, M + 3, { align: 'right' });
  doc.setDrawColor(210); doc.line(M, M + 5.5, W - M, M + 5.5);
}
function pageNumbers(doc) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    doc.text(`Page ${i} of ${n}`, W / 2, H - 7, { align: 'center' });
  }
}

/* ===================== Word (.docx) report ===================== */
// Hand-built OOXML so captions use Word SEQ fields (auto-number on reorder).
// opts: { widthCm, quality, maxPx }
export async function exportDocx(ins, opts, progress) {
  const zip = new window.JSZip();
  const rels = [];
  const body = [];
  const P = (text, style, bold) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

  body.push(P(ins.name || 'Inspection', 'Title'));
  body.push(P('Photographic inspection record', 'Subtitle'));
  const info = [['Structure', ins.structure], ['Structure ref.', ins.ref], ['Location', ins.location],
    ['Inspection type', ins.type], ['Inspector', ins.inspector], ['Date', ins.date]].filter(r => r[1]);
  if (info.length) {
    body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="2600"/><w:gridCol w:w="6400"/></w:tblGrid>` +
      info.map(([k, v]) => `<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E8EEF4"/></w:tcPr>${P(k, null, true)}</w:tc><w:tc>${P(v)}</w:tc></w:tr>`).join('') + `</w:tbl>`);
  }
  if (ins.notes) { body.push(P('Notes', 'Heading2')); ins.notes.split('\n').forEach(l => body.push(P(l))); }
  const picture = async (blob, name, id, cx, cy) => {
    zip.file(`word/media/${name}`, await blob.arrayBuffer());
    const rid = `rId_${name.replace('.', '_')}`;
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    return `<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="240"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };

  if (opts.plans && ins.plans.length) {
    body.push(P('Plans', 'Heading1'));
    const maxW = 17 * 360000, maxH = 22 * 360000; // A4 text area with 2 cm margins
    for (let k = 0; k < ins.plans.length; k++) {
      const plan = ins.plans[k];
      const r = await renderPlan(ins, plan, 3000, Math.max(opts.quality, 0.8));
      if (!r) continue;
      const s = Math.min(maxW / r.w, maxH / r.h);
      body.push(await picture(r.blob, `plan${k + 1}.jpg`, 10000 + k, Math.round(r.w * s), Math.round(r.h * s)));
      body.push(`<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Plan </w:t></w:r><w:fldSimple w:instr=" SEQ Plan \\* ARABIC "><w:r><w:t>${k + 1}</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve">${esc(': ' + plan.name)}</w:t></w:r></w:p>`);
      const marked = markedOn(ins, plan);
      body.push(`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(marked.length ? 'Markers: ' + marked.map(({ p, n }) => `${n} ${p.element || ''}`.trim()).join('; ') : 'No photos marked on this plan')}</w:t></w:r></w:p>`);
    }
  }
  body.push(P('Photographs', 'Heading1'));

  const cx = Math.round(opts.widthCm * 360000);
  for (let i = 0; i < ins.photos.length; i++) {
    progress && progress(i + 1, ins.photos.length);
    const p = ins.photos[i];
    const img = await photoJpeg(ins, p, opts.maxPx, opts.quality);
    if (img) body.push(await picture(img.blob, `image${i + 1}.jpg`, i + 1, cx, Math.round(cx * img.h / img.w)));
    const bits = [p.element, p.defect && p.defect !== 'No defect / record only' ? p.defect : null].filter(Boolean).join(' – ');
    const meta = [p.caption, fmtDate(p.takenAt), fmtGps(p) && 'GPS ' + fmtGps(p), opts.plans && planRef(ins, p)].filter(Boolean).join('. ');
    body.push(`<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Photo </w:t></w:r><w:fldSimple w:instr=" SEQ Photo \\* ARABIC "><w:r><w:t>${i + 1}</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve">${esc(bits ? ': ' + bits : '')}</w:t></w:r></w:p>`);
    if (meta) body.push(`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(meta)}</w:t></w:r></w:p>`);
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:color w:val="173A5E"/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="173A5E"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="173A5E"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BBBBBB"/><w:left w:val="single" w:sz="4" w:color="BBBBBB"/><w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/><w:right w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideH w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideV w:val="single" w:sz="4" w:color="BBBBBB"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`);
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${rels.join('')}</Relationships>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ===================== Annotated plan render ===================== */
async function renderPlan(ins, plan, maxPx, quality) {
  const f = await readFile(`${insDir(ins.id)}/plans/${plan.file}`);
  if (!f) return null;
  const { img, url } = await loadImage(f);
  try {
    const s = Math.min(1, maxPx / Math.max(plan.w, plan.h));
    const c = document.createElement('canvas');
    c.width = Math.round(plan.w * s); c.height = Math.round(plan.h * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const r = Math.max(12, Math.max(c.width, c.height) / 75);
    ins.photos.forEach((p, i) => {
      if (p.plan && p.plan.planId === plan.id) drawMarker(ctx, p.plan.x * s, p.plan.y * s, p.plan.angle, i + 1, r);
    });
    const blob = await new Promise(rs => c.toBlob(rs, 'image/jpeg', quality));
    const out = { blob, w: c.width, h: c.height };
    c.width = c.height = 0;
    return out;
  } finally { URL.revokeObjectURL(url); }
}

export async function exportPlanPdf(ins, progress) {
  const { jsPDF } = window.jspdf;
  let doc = null;
  for (let k = 0; k < ins.plans.length; k++) {
    progress && progress(k + 1, ins.plans.length);
    const plan = ins.plans[k];
    const r = await renderPlan(ins, plan, 4200, 0.88);
    if (!r) continue;
    const land = r.w >= r.h;
    const pw = land ? 420 : 297, ph = land ? 297 : 420; // A3
    if (!doc) doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: land ? 'landscape' : 'portrait', compress: true });
    else doc.addPage([pw, ph], land ? 'landscape' : 'portrait');
    const M = 10, top = 16;
    const s = Math.min((pw - 2 * M) / r.w, (ph - top - M) / r.h);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(23, 58, 94);
    doc.text(`${ins.name || 'Inspection'} – ${plan.name}`, M, 11);
    doc.addImage(await u8(r.blob), 'JPEG', M + (pw - 2 * M - r.w * s) / 2, top, r.w * s, r.h * s, undefined, 'FAST');

    // legend page
    const marked = ins.photos.map((p, i) => ({ p, n: i + 1 })).filter(o => o.p.plan && o.p.plan.planId === plan.id);
    if (marked.length) {
      doc.addPage([297, 210], 'landscape');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(23, 58, 94);
      doc.text(`Marker key – ${plan.name}`, M, 14);
      doc.setFontSize(9); doc.setTextColor(30);
      let y = 24, x = M; const colW = 92;
      for (const { p, n } of marked) {
        if (y > 200) { y = 24; x += colW; if (x > 297 - colW) { doc.addPage([297, 210], 'landscape'); x = M; } }
        doc.setFont('helvetica', 'bold'); doc.text(String(n), x, y);
        doc.setFont('helvetica', 'normal');
        doc.text(doc.splitTextToSize([p.element, p.caption].filter(Boolean).join(' – ') || '—', colW - 12)[0], x + 9, y);
        y += 6;
      }
    }
  }
  if (!doc) throw new Error('No plan drawings to export');
  return doc.output('blob');
}

/* ===================== Interactive HTML plan viewer ===================== */
export async function exportHtmlViewer(ins, opts, progress) {
  const plans = [];
  for (const plan of ins.plans) {
    const f = await readFile(`${insDir(ins.id)}/plans/${plan.file}`);
    if (!f) continue;
    const r = await resizeToJpeg(f, 3600, 0.85);
    plans.push({ id: plan.id, name: plan.name, w: r.w, h: r.h, sx: r.w / plan.w, src: await blobToDataURL(r.blob) });
  }
  const photos = [];
  for (let i = 0; i < ins.photos.length; i++) {
    progress && progress(i + 1, ins.photos.length);
    const p = ins.photos[i];
    const r = await photoJpeg(ins, p, opts.maxPx, opts.quality);
    photos.push({
      n: i + 1, element: p.element || '', defect: p.defect || '', caption: p.caption || '',
      date: fmtDate(p.takenAt), gps: fmtGps(p), src: r ? await blobToDataURL(r.blob) : '',
      plan: p.plan ? { id: p.plan.planId, x: p.plan.x, y: p.plan.y, a: p.plan.angle } : null,
    });
  }
  const data = { name: ins.name, ref: ins.ref, date: ins.date, structure: ins.structure, plans, photos };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const markerFn = markerSVG.toString();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${esc(ins.name || 'Inspection')} – plan viewer</title>
<style>
:root{--bg:#f4f6f8;--card:#fff;--ink:#14212e;--muted:#5d6b78;--line:#dde3e9;--accent:#173a5e}
@media (prefers-color-scheme:dark){:root{--bg:#0f151b;--card:#18212a;--ink:#e8eef3;--muted:#93a1ad;--line:#2a3742;--accent:#7fb2e5}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,system-ui,Segoe UI,sans-serif}
header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:var(--card);border-bottom:1px solid var(--line)}
header h1{font-size:16px;margin:0 auto 0 0}select,input{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
input{width:110px}#wrap{position:absolute;top:var(--hh,58px);left:0;right:0;bottom:0;overflow:hidden;touch-action:none;background:#7d8790}
#stage{position:absolute;left:0;top:0;transform-origin:0 0}#stage img{display:block;user-select:none;-webkit-user-drag:none}
#stage svg{position:absolute;left:0;top:0}.mk{cursor:pointer}.mk.hit circle{stroke:#ffd400}
#modal{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;padding:14px;z-index:9}
#modal .box{background:var(--card);border-radius:14px;max-width:900px;width:100%;max-height:100%;overflow:auto}
#modal img{width:100%;display:block;border-radius:14px 14px 0 0}#modal .t{padding:12px 14px}#modal .t b{display:block;margin-bottom:4px}
#modal .t small{color:var(--muted)}#nav{display:flex;gap:8px;padding:0 14px 14px}button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
#msg{color:var(--muted);font-size:13px}
</style></head><body>
<header><h1>${esc(ins.name || 'Inspection')}</h1><select id="plan"></select><input id="q" inputmode="numeric" placeholder="Photo no."><span id="msg"></span></header>
<div id="wrap"><div id="stage"><img id="pimg" alt=""><svg id="ov"></svg></div></div>
<div id="modal"><div class="box"><img id="mimg" alt=""><div class="t"><b id="mt"></b><div id="mc"></div><small id="mm"></small></div><div id="nav"><button id="prev">‹ Previous</button><button id="next">Next ›</button><button id="close" style="margin-left:auto">Close</button></div></div></div>
<script>
const D=${json};
const MARKER_COLOR='#e4572e';
const markerSVG=${markerFn};
const $=id=>document.getElementById(id);
let cur=0,z=1,tx=0,ty=0,open=-1;
document.documentElement.style.setProperty('--hh',document.querySelector('header').offsetHeight+'px');
D.plans.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.name;$('plan').appendChild(o)});
if(!D.plans.length){$('msg').textContent='No plan drawings in this inspection.'}
function show(i,keep){cur=i;const p=D.plans[i];if(!p)return;$('pimg').src=p.src;$('pimg').width=p.w;$('pimg').height=p.h;
 const ov=$('ov');ov.setAttribute('width',p.w);ov.setAttribute('height',p.h);ov.setAttribute('viewBox','0 0 '+p.w+' '+p.h);
 const r=Math.max(12,Math.max(p.w,p.h)/95);
 ov.innerHTML=D.photos.filter(f=>f.plan&&f.plan.id===p.id).map(f=>markerSVG(f.plan.x*p.sx,f.plan.y*p.sx,f.plan.a,f.n,r,'data-n="'+f.n+'"')).join('');
 if(!keep)fit();}
function fit(){const p=D.plans[cur];const w=$('wrap');z=Math.min(w.clientWidth/p.w,w.clientHeight/p.h);tx=(w.clientWidth-p.w*z)/2;ty=(w.clientHeight-p.h*z)/2;apply()}
function apply(){$('stage').style.transform='translate('+tx+'px,'+ty+'px) scale('+z+')'}
$('plan').onchange=e=>show(+e.target.value);
const pts=new Map();let last=null,moved=0;
$('wrap').addEventListener('pointerdown',e=>{$('wrap').setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=0;last=null});
$('wrap').addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;const prev=pts.get(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pts.size===1){tx+=e.clientX-prev.x;ty+=e.clientY-prev.y;moved+=Math.abs(e.clientX-prev.x)+Math.abs(e.clientY-prev.y)}
 else if(pts.size===2){const [a,b]=[...pts.values()];const d=Math.hypot(a.x-b.x,a.y-b.y),mx=(a.x+b.x)/2,my=(a.y+b.y)/2-$('wrap').getBoundingClientRect().top;
  if(last){const k=d/last.d;zoomAt(last.mx,last.my,k);tx+=mx-last.mx;ty+=my-last.my}last={d,mx,my};moved+=99}
 apply()});
const up=e=>{pts.delete(e.pointerId);last=null;if(pts.size===0&&moved<8){const el=document.elementFromPoint(e.clientX,e.clientY);const g=el&&el.closest('.mk');if(g)openPhoto(+g.dataset.n)}};
$('wrap').addEventListener('pointerup',up);$('wrap').addEventListener('pointercancel',up);
$('wrap').addEventListener('wheel',e=>{e.preventDefault();const r=$('wrap').getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,Math.exp(-e.deltaY/400));apply()},{passive:false});
function zoomAt(x,y,k){const nz=Math.min(12,Math.max(.05,z*k));k=nz/z;tx=x-(x-tx)*k;ty=y-(y-ty)*k;z=nz}
function openPhoto(n){const f=D.photos[n-1];if(!f)return;open=n;$('mimg').src=f.src;$('mt').textContent='Photo '+f.n+(f.element?' – '+f.element:'')+(f.defect&&f.defect!=='No defect / record only'?' – '+f.defect:'');
 $('mc').textContent=f.caption;$('mm').textContent=[f.date,f.gps].filter(Boolean).join('  ·  ');$('modal').style.display='flex'}
$('close').onclick=()=>{$('modal').style.display='none';open=-1};$('modal').onclick=e=>{if(e.target.id==='modal')$('close').onclick()};
$('prev').onclick=()=>open>1&&openPhoto(open-1);$('next').onclick=()=>open<D.photos.length&&openPhoto(open+1);
$('q').addEventListener('keydown',e=>{if(e.key!=='Enter')return;const n=+$('q').value;const f=D.photos[n-1];
 if(!f){$('msg').textContent='No photo '+n;return}
 if(!f.plan){$('msg').textContent='Photo '+n+' is not marked on a plan';openPhoto(n);return}
 const pi=D.plans.findIndex(p=>p.id===f.plan.id);if(pi<0)return;$('plan').value=pi;show(pi);
 const p=D.plans[pi],w=$('wrap');z=Math.min(3,Math.max(w.clientWidth/p.w,w.clientHeight/p.h)*2.5);tx=w.clientWidth/2-f.plan.x*p.sx*z;ty=w.clientHeight/2-f.plan.y*p.sx*z;apply();
 document.querySelectorAll('.mk').forEach(m=>m.classList.toggle('hit',+m.dataset.n===n));$('msg').textContent='';});
addEventListener('resize',()=>D.plans.length&&fit());
if(D.plans.length)show(0);
</script></body></html>`;
  return new Blob([html], { type: 'text/html' });
}

/* ===================== ZIP backup / import ===================== */
export async function exportZip(ins, progress) {
  const zip = new window.JSZip();
  const base = insDir(ins.id);
  zip.file('inspection.json', JSON.stringify(ins, null, 2));
  zip.file('FORMAT.txt', 'Survport inspection package. inspection.json holds all records; photos/, thumbs/ and plans/ hold the files it references.');
  let k = 0; const total = ins.photos.length * 2 + ins.plans.length;
  for (const p of ins.photos) {
    for (const sub of ['photos', 'thumbs']) {
      const name = sub === 'photos' ? p.file : p.thumb;
      const f = await readFile(`${base}/${sub}/${name}`);
      if (f) zip.file(`${sub}/${name}`, f);
      progress && progress(++k, total);
    }
  }
  for (const pl of ins.plans) {
    const f = await readFile(`${base}/plans/${pl.file}`);
    if (f) zip.file(`plans/${pl.file}`, f);
    progress && progress(++k, total);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

export async function importZip(file, progress) {
  const zip = await window.JSZip.loadAsync(file);
  const metaFile = zip.file('inspection.json');
  if (!metaFile) throw new Error('Not an inspection package (inspection.json missing)');
  const ins = JSON.parse(await metaFile.async('string'));
  if (!Array.isArray(ins.photos) || !Array.isArray(ins.plans)) throw new Error('Package is damaged');
  // File names become storage paths, so only accept the plain names the app writes.
  const okName = (n) => typeof n === 'string' && /^[\w-]+\.[a-z0-9]+$/i.test(n);
  if (![...ins.photos.flatMap(p => [p.file, p.thumb]), ...ins.plans.map(p => p.file)].every(okName)) throw new Error('Package is damaged');
  ins.id = uid();
  const base = insDir(ins.id);
  const entries = Object.values(zip.files).filter(f => !f.dir && /^(photos|thumbs|plans)\/[^/]+$/.test(f.name));
  let k = 0;
  for (const e of entries) {
    await writeFile(`${base}/${e.name}`, await e.async('blob'));
    progress && progress(++k, entries.length);
  }
  await saveInspection(ins);
  return ins;
}
