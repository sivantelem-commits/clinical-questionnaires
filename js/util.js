export const S = (labels, start = 0) => labels.map((l, i) => ({ v: i + start, l }));
const num = v => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
export const val = (a, k) => num(a?.[k]);
export function sum(a, ids) {
  let s = 0, n = 0;
  for (const k of ids) { const v = val(a, k); if (v != null) { s += v; n++; } }
  return n ? s : null;
}
export function mean(a, ids) {
  let s = 0, n = 0;
  for (const k of ids) { const v = val(a, k); if (v != null) { s += v; n++; } }
  return n ? s / n : null;
}
// band(t, [[max, label, sev], ...])
export function band(t, bands) {
  if (t == null) return null;
  for (const [mx, label, sev] of bands) if (t <= mx) return { label, sev };
  const l = bands[bands.length - 1];
  return { label: l[1], sev: l[2] };
}
export const fmt = v => v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';
export const daysAgo = d => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
