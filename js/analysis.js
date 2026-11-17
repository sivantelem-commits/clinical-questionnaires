// ניתוח משולב: הצלבה בין שאלונים, שינוי לאורך זמן, אינדיקטורים תפקודיים, טקסט לדו"ח
import { BY_ID, DOMAINS, scoreResponse } from './registry.js';
import { fmt, fmtDate } from './util.js';

export const SEV_WORD = ['תקין/נמוך', 'קל', 'בינוני', 'גבוה/חמור'];

export function scoreAll(responses, patient) {
  return responses.map(r => ({ ...r, res: r.skipped ? null : scoreResponse(r.instrument, r.answers, { gender: patient?.gender || r.meta?.gender }) }))
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
}
export function latestBy(scored) {
  const m = {};
  for (const r of scored) if (!r.skipped && !m[r.instrument]) m[r.instrument] = r;
  return m;
}
export function historyOf(scored, id) {
  return scored.filter(r => r.instrument === id && !r.skipped && r.res).sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
}

// שינוי משמעותי קלינית (MCID) – לפי הספרות המקובלת
const MCID = { 'PHQ-9': 5, 'GAD-7': 4, 'PCL-5': 10, 'BDI': 5, 'MADRS': 6, 'CAPS-5': 10, 'OCI-R': 6, 'DASS-21': 8, 'CES-D': 6, 'DES': 10, 'STAI-S': 8, 'STAI-T': 8, 'ITQ': 4, 'STO': 4, 'ADNM-4': 3, 'DERS': 15, 'TTBQ2-CG31': 0.4, 'EAT-26': 8, 'CGI': 1 };
export function changeOf(scored, id) {
  const h = historyOf(scored, id).filter(r => r.res.total != null);
  if (h.length < 2) return null;
  const first = h[0], last = h[h.length - 1], prev = h[h.length - 2];
  const d = BY_ID[id]; const better = d.higherIsBetter ? 1 : -1;
  const mk = (a, b) => {
    const delta = b.res.total - a.res.total; const m = MCID[id];
    const sig = m != null && Math.abs(delta) >= m;
    const dir = delta === 0 ? 'ללא שינוי' : (delta * better > 0 ? 'שיפור' : 'החמרה');
    return { delta, sig, dir, from: a, to: b, text: `${fmt(a.res.total)} → ${fmt(b.res.total)} (${delta > 0 ? '+' : ''}${fmt(delta)}) – ${dir}${sig ? ' משמעותי/ת קלינית' : delta === 0 ? '' : ' (מתחת לסף שינוי משמעותי)'}` };
  };
  return { n: h.length, overall: mk(first, last), recent: mk(prev, last), series: h.map(r => ({ t: r.completed_at, v: r.res.total })) };
}

export function allFlags(latest) {
  const out = [];
  for (const [id, r] of Object.entries(latest)) for (const f of r.res?.flags || []) out.push({ ...f, id, date: r.completed_at });
  return out.sort((a, b) => (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1));
}

export function domainProfile(latest) {
  const out = [];
  for (const [name, ids] of DOMAINS) {
    const rs = ids.map(i => latest[i]).filter(r => r?.res?.level);
    if (!rs.length) continue;
    const sevs = rs.map(r => r.res.level.sev ?? 0);
    const max = Math.max(...sevs), min = Math.min(...sevs);
    let note = '';
    if (rs.length > 1) note = max - min >= 2 ? 'פער בין המדדים – לבחון (שוני בטווחי זמן, בתוכן, או סגנון דיווח).' : 'ממצאים מתכנסים בין המדדים.';
    out.push({ name, max, rs, note });
  }
  return out;
}

// פערים בין דיווח עצמי להערכת קלינאי
export function discrepancies(latest) {
  const out = [];
  const pair = (selfIds, clin, label) => {
    const c = latest[clin]; if (!c?.res?.level) return;
    for (const s of selfIds) {
      const r = latest[s]; if (!r?.res?.level) continue;
      const diff = (r.res.level.sev ?? 0) - (c.res.level.sev ?? 0);
      if (Math.abs(diff) >= 2) out.push(`${label}: ${s} (${r.res.level.label}) לעומת ${clin} (${c.res.level.label}) – ${diff > 0 ? 'דיווח עצמי גבוה מהערכת הקלינאי (אפשרות להגברת דיווח / מצוקה סובייקטיבית גבוהה)' : 'דיווח עצמי נמוך מהערכת הקלינאי (אפשרות להמעטה, הימנעות או תובנה חלקית)'}.`);
    }
  };
  pair(['PHQ-9', 'BDI', 'CES-D'], 'MADRS', 'דיכאון');
  pair(['PCL-5', 'ITQ', 'STO'], 'CAPS-5', 'PTSD');
  const sr = latest['C-SSRS-S'], cf = latest['C-SSRS'];
  if (sr?.res && cf?.res && Math.abs((sr.res.level.sev ?? 0) - (cf.res.level.sev ?? 0)) >= 2) out.push(`אובדנות: פער בין סינון עצמי (${sr.res.level.label}) לראיון (${cf.res.level.label}).`);
  return out;
}

// ---------- אינדיקטורים תפקודיים ברמת הפריט ----------
const IND = {
  'תעסוקה / לימודים': [['PHQ-9', 'F', 'השפעה תפקודית כללית (PHQ-9)', v => v >= 2, ['', 'במידת מה', 'הקשו מאוד', 'קיצוני']], ['ITQ', 'P8', 'השפעת תסמיני טראומה על העבודה (ITQ)', v => v >= 2], ['ITQ', 'C8', 'השפעת קשיי ויסות/עצמי על העבודה (ITQ)', v => v >= 2],
    ['CAPS-5', 'G3', 'פגיעה תעסוקתית (CAPS-5)', v => v >= 2], ['ADNM-4', '4', 'חוסר חשק ללכת לעבודה/לבצע פעולות יומיום (ADNM-4)', v => v >= 3], ['BDI', '15', 'ירידה ביכולת לעבוד (BDI)', v => v >= 2],
    ['TTBQ2-CG31', 'A5', 'תפקוד בעבודה/לימודים לאחר האובדן (TTBQ)', v => v >= 4], ['MADRS', '7', 'לאות וקושי ביזימה (MADRS)', v => v >= 3]],
  'יחסים חברתיים ומשפחתיים': [['ITQ', 'P7', 'השפעה על מערכות יחסים (ITQ)', v => v >= 2], ['ITQ', 'C5', 'תחושת ריחוק וניתוק (ITQ)', v => v >= 2], ['PCL-5', '13', 'ריחוק/ניתוק מאחרים (PCL-5)', v => v >= 2],
    ['CAPS-5', 'G2', 'פגיעה בתפקוד החברתי (CAPS-5)', v => v >= 2], ['BDI', '12', 'אובדן עניין באנשים (BDI)', v => v >= 2], ['CES-D', '14', 'בדידות (CES-D)', v => v >= 2],
    ['TTBQ2-CG31', 'A7', 'קושי בתפקוד חברתי לאחר האובדן (TTBQ)', v => v <= 2], ['MADRS', '8', 'אובדן רגשות כלפי קרובים (MADRS)', v => v >= 3]],
  'שינה': [['PHQ-9', '3', 'הפרעת שינה (PHQ-9)', v => v >= 2], ['PCL-5', '20', 'קשיי שינה (PCL-5)', v => v >= 2], ['BDI', '16', 'יקיצות מוקדמות/שינה (BDI)', v => v >= 2], ['MADRS', '4', 'הפחתה בשינה (MADRS)', v => v >= 3], ['CAPS-5', 'E6', 'הפרעות שינה (CAPS-5)', v => v >= 2], ['CES-D', '11', 'שינה חסרת מנוחה (CES-D)', v => v >= 2]],
  'ריכוז וקוגניציה': [['PHQ-9', '7', 'קשיי ריכוז (PHQ-9)', v => v >= 2], ['PCL-5', '19', 'קשיי ריכוז (PCL-5)', v => v >= 2], ['BDI', '13', 'קושי בקבלת החלטות (BDI)', v => v >= 2], ['MADRS', '6', 'קשיי ריכוז (MADRS)', v => v >= 3], ['CES-D', '5', 'קושי להתרכז (CES-D)', v => v >= 2], ['ADNM-4', '2', 'קושי להתרכז מאז האירוע (ADNM-4)', v => v >= 3]],
  'אנרגיה ותפקוד יומיומי': [['PHQ-9', '4', 'עייפות/אנרגיה מועטה (PHQ-9)', v => v >= 2], ['BDI', '17', 'עייפות (BDI)', v => v >= 2], ['DASS-21', '5', 'חוסר כוחות לעשות דברים (DASS)', v => v >= 2], ['CES-D', '20', 'קושי להפעיל את עצמו (CES-D)', v => v >= 2], ['PHQ-9', '5', 'שינוי בתיאבון (PHQ-9)', v => v >= 2], ['BDI', '18', 'ירידה בתיאבון (BDI)', v => v >= 2]],
  'ויסות רגשי והתנהגותי': [['PCL-5', '15', 'עצבנות/התפרצויות כעס (PCL-5)', v => v >= 2], ['PCL-5', '16', 'התנהגות מסכנת (PCL-5)', v => v >= 2], ['GAD-7', '6', 'רגזנות (GAD-7)', v => v >= 2], ['BDI', '11', 'רגזנות (BDI)', v => v >= 2], ['ITQ', 'C1', 'קושי להירגע (ITQ)', v => v >= 2], ['DASS-21', '8', 'מתעצבן/ת יותר מדי (DASS)', v => v >= 2]],
  'הנאה ומשמעות': [['PHQ-9', '1', 'ירידה בעניין ובהנאה (PHQ-9)', v => v >= 2], ['BDI', '4', 'אובדן הנאה (BDI)', v => v >= 2], ['PCL-5', '12', 'אובדן עניין בפעילויות (PCL-5)', v => v >= 2], ['DASS-21', '21', 'תחושה שהחיים חסרי משמעות (DASS)', v => v >= 2]],
};
const SUBSCALE_IND = {
  'יחסים חברתיים ומשפחתיים': [['MHC-SF', 'רווחה חברתית', s => s.score != null && s.score < 2.32, 'רווחה חברתית נמוכה (MHC-SF)'], ['AQ', 'מיומנויות חברתיות', s => s.score >= 6, 'קשיים במיומנויות חברתיות (AQ)']],
  'ויסות רגשי והתנהגותי': [['DERS', 'קושי בשליטה בדחפים', s => s.score >= 16, 'קושי בשליטה בדחפים במצבי מצוקה (DERS)'], ['DERS', 'קושי בהתנהגות מכוונת מטרה', s => s.score >= 18, 'קושי בהתנהגות מכוונת מטרה במצבי מצוקה (DERS)']],
  'תעסוקה / לימודים': [['TTBQ2-CG31', 'חוסר תפקוד (מסלול I)', s => s.score >= 3.5, 'ציון גבוה בחוסר תפקוד לאחר האובדן (TTBQ)']],
};
export function functionalIndicators(latest) {
  const out = {};
  for (const [dom, list] of Object.entries(IND)) {
    const hits = [];
    for (const [id, k, label, pred, words] of list) {
      const r = latest[id]; const v = r?.answers?.[k];
      if (typeof v === 'number' && pred(v)) hits.push({ id, label, v, date: r.completed_at, word: words?.[v] });
    }
    for (const [id, subName, pred, label] of SUBSCALE_IND[dom] || []) {
      const s = latest[id]?.res?.subscales?.find(x => x.name.startsWith(subName));
      if (s && pred(s)) hits.push({ id, label, v: fmt(s.score) });
    }
    out[dom] = hits;
  }
  return out;
}

// ---------- טקסטים לדו"ח ----------
export function findingsText(latest) {
  const lines = [];
  const ids = Object.keys(latest).sort((a, b) => Object.keys(BY_ID).indexOf(a) - Object.keys(BY_ID).indexOf(b));
  for (const id of ids) {
    const r = latest[id], d = BY_ID[id], res = r.res; if (!res) continue;
    const tot = res.total != null ? `${fmt(res.total)}${res.max ? '/' + res.max : ''}` : '';
    let l = `• ${d.title} (${d.name}, ${fmtDate(r.completed_at)}${r.source === 'clinician' ? ', הערכת קלינאי' : ''}): ${tot ? tot + ' – ' : ''}${res.level?.label || ''}.`;
    const subs = (res.subscales || []).filter(s => s.score != null).map(s => `${s.name} ${fmt(s.score)}${s.note ? ` (${s.note})` : ''}`);
    if (subs.length && subs.length <= 7) l += ` תתי-סולמות: ${subs.join('; ')}.`;
    const crit = (res.criteria || []).filter(c => c.met).map(c => c.name);
    if (crit.length) l += ` קריטריונים שנענו: ${crit.join(', ')}.`;
    if (res.functional) l += ` ${res.functional}.`;
    lines.push(l);
  }
  return lines.join('\n');
}
export function riskText(latest) {
  const flags = allFlags(latest).filter(f => /אובדנ|מוות|פגיעה|שים קץ|C-SSRS|קולומביה/.test(f.text) || f.id.startsWith('C-SSRS'));
  const cs = latest['C-SSRS'] || latest['C-SSRS-S'];
  const lines = [];
  if (cs?.res) lines.push(`${BY_ID[cs.instrument].title} (${fmtDate(cs.completed_at)}): ${cs.res.level.label}.`);
  flags.filter(f => !(cs && f.id.startsWith('C-SSRS'))).forEach(f => lines.push(`${f.text} (${f.id}, ${fmtDate(f.date)}).`));
  if (!lines.length) lines.push('בשאלונים שהועברו לא עלו אינדיקציות לסיכון אובדני. [להשלים מהראיון הקליני]');
  return lines.join('\n');
}
export function functionalText(latest, lastSession) {
  const ind = functionalIndicators(latest); const lines = [];
  const sd = lastSession?.domains || {};
  for (const [dom, hits] of Object.entries(ind)) {
    const s = sd[dom];
    if (!hits.length && !s?.text && s?.rating == null) continue;
    let l = `${dom}: `;
    if (s?.rating != null) l += `[דירוג קלינאי: ${['ללא פגיעה', 'פגיעה קלה', 'פגיעה בינונית', 'פגיעה ניכרת', 'פגיעה חמורה'][s.rating]}] `;
    if (s?.text) l += s.text + ' ';
    if (hits.length) l += `בשאלונים דווחו: ${hits.map(h => h.label + (h.word ? ` – ${h.word}` : '')).join('; ')}.`;
    lines.push(l.trim());
  }
  for (const [dom, s] of Object.entries(sd)) if (!ind[dom] && (s?.text || s?.rating != null)) lines.push(`${dom}: ${s.rating != null ? `[דירוג: ${s.rating}/4] ` : ''}${s.text || ''}`);
  return lines.join('\n\n') || '[לא נאספו נתונים תפקודיים – להשלים מהשיחות]';
}
export function changeText(scored) {
  const ids = [...new Set(scored.map(r => r.instrument))];
  return ids.map(id => { const c = changeOf(scored, id); return c ? `• ${BY_ID[id].name} (${c.n} מדידות, ${fmtDate(c.overall.from.completed_at)}–${fmtDate(c.overall.to.completed_at)}): ${c.overall.text}` : null; }).filter(Boolean).join('\n');
}
export const FUNC_DOMAINS = Object.keys(IND).concat(['טיפול עצמי ומשק בית', 'בריאות גופנית']);
