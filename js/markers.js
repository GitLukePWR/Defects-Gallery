// Shared drawing of a numbered, directional plan marker.
// angle is in degrees, 0 = pointing up (north on the drawing), clockwise.
export const MARKER_COLOR = '#e4572e';

export function drawMarker(ctx, x, y, angle, n, r, opts = {}) {
  const color = opts.color || MARKER_COLOR;
  ctx.save();
  ctx.translate(x, y);
  if (angle !== null && angle !== undefined) {
    ctx.save();
    ctx.rotate((angle * Math.PI) / 180);
    // view cone
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 3.2, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
    ctx.closePath();
    ctx.fillStyle = hexA(color, 0.28);
    ctx.fill();
    // arrow
    ctx.beginPath();
    ctx.moveTo(0, -r * 2.25);
    ctx.lineTo(-r * 0.6, -r * 1.25);
    ctx.lineTo(r * 0.6, -r * 1.25);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(r * (String(n).length > 2 ? 0.8 : 1.0))}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 0, r * 0.06);
  ctx.restore();
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

// SVG version for the live plan editor and the HTML viewer.
export function markerSVG(x, y, angle, n, r, extraAttrs = '') {
  const cone = (angle === null || angle === undefined) ? '' : (() => {
    const R = r * 3.2, a1 = -Math.PI / 2 - 0.42, a2 = -Math.PI / 2 + 0.42;
    const p1 = [R * Math.cos(a1), R * Math.sin(a1)], p2 = [R * Math.cos(a2), R * Math.sin(a2)];
    return `<g transform="rotate(${angle})">
      <path d="M0 0 L${p1[0]} ${p1[1]} A${R} ${R} 0 0 1 ${p2[0]} ${p2[1]} Z" fill="${MARKER_COLOR}" fill-opacity=".28"/>
      <path d="M0 ${-r * 2.25} L${-r * .6} ${-r * 1.25} L${r * .6} ${-r * 1.25} Z" fill="${MARKER_COLOR}"/>
    </g>`;
  })();
  const fs = r * (String(n).length > 2 ? 0.8 : 1.0);
  return `<g class="mk" transform="translate(${x} ${y})" ${extraAttrs}>${cone}
    <circle r="${r}" fill="${MARKER_COLOR}" stroke="#fff" stroke-width="${r * .16}"/>
    <text y="${r * .06}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-weight="700" fill="#fff" font-family="-apple-system,system-ui,sans-serif">${n}</text></g>`;
}
