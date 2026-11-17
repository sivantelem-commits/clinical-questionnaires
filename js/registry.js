import * as Q1 from './q1.js';
import * as Q2 from './q2.js';
import * as Q3 from './q3.js';

const ALL = [
  Q3.STAI_S, Q1.MHC, Q1.SHS, Q1.PHQ9, Q3.BDI, Q1.CESD, Q1.DASS, Q1.CSSRS_SCREEN, Q1.GAD7, Q3.STAI_T, Q2.OCIR, Q3.EAT26,
  Q2.DES, Q2.PQB, Q2.TAS20, Q3.IRI, Q3.DERS, Q3.AQ, Q1.LEC, Q1.ADNM4, Q1.LIFE_EVENTS, Q2.PCL5, Q2.ITQ, Q2.STO, Q2.PTGI, Q1.TTBQ,
  Q3.MADRS, Q3.CAPS5, Q3.CSSRS_FULL, Q3.CGI,
];

// נרמול: כל פריט הופך לאובייקט עם id
for (const d of ALL) {
  d.items = d.items.map((it, i) => {
    const o = typeof it === 'string' ? { t: it } : { ...it };
    o.id = String(o.id ?? i + 1);
    if (o.follow) o.follow = { ...o.follow, id: o.id + '_f' };
    return o;
  });
  d.scorable = d.items.filter(i => !i.noScore && i.type !== 'text' && i.type !== 'number');
}

export const INSTRUMENTS = ALL;
export const BY_ID = Object.fromEntries(ALL.map(d => [d.id, d]));
export const ORDER = ALL.map(d => d.id);
export const PATIENT_IDS = ALL.filter(d => !d.clinician).map(d => d.id);
export const CLINICIAN_IDS = ALL.filter(d => d.clinician).map(d => d.id);

// שאלונים "יציבים" – תכונה/היסטוריה. במילוי חוזר: התשובות הקודמות ממולאות מראש והמטופל/ת רק מאשר/ת או מעדכן/ת
export const STABLE = ['AQ', 'IRI', 'TAS-20', 'LIFE-EVENTS', 'STAI-T'];
export const STABLE_DAYS = 180;

export const DOMAINS = [
  ['רווחה נפשית', ['MHC-SF', 'SHS']],
  ['דיכאון', ['PHQ-9', 'BDI', 'CES-D', 'DASS-21', 'MADRS']],
  ['אובדנות', ['C-SSRS-S', 'C-SSRS']],
  ['חרדה', ['GAD-7', 'STAI-S', 'STAI-T']],
  ['טראומה ודחק', ['LIFE-EVENTS', 'PCL-5', 'ITQ', 'STO', 'PTGI', 'CAPS-5']],
  ['הסתגלות', ['LEC-S', 'ADNM-4']],
  ['אובדן ושכול', ['TTBQ2-CG31']],
  ['OCD', ['OCI-R']],
  ['דיסוציאציה', ['DES']],
  ['פסיכוזה', ['PQ-B']],
  ['הפרעות אכילה', ['EAT-26']],
  ['ויסות, רגש ואישיות', ['DERS', 'TAS-20', 'IRI']],
  ['ספקטרום אוטיסטי', ['AQ']],
  ['התרשמות קלינית', ['CGI']],
];

// חפיפות – כדי למנוע שאלות כפולות אצל המטופל/ת
export const OVERLAPS = [
  { ids: ['PHQ-9', 'BDI', 'CES-D', 'DASS-21'], max: 2, text: 'כמה שאלוני דיכאון חופפים (מצב רוח, הנאה, שינה, תיאבון, אשמה). בדרך כלל אחד–שניים מספיקים – למשל PHQ-9 למעקב קצר או BDI להערכה מפורטת.' },
  { ids: ['GAD-7', 'STAI-T', 'DASS-21'], max: 2, text: 'שאלוני חרדה חופפים. GAD-7 לחרדה כללית; STAI להבחנה מצב/תכונה.' },
  { ids: ['PCL-5', 'ITQ'], max: 1, text: 'PCL-5 ו-ITQ שואלים על אותם תסמינים (חודרנות, הימנעות, דריכות). אם נדרשת גם הערכת CPTSD – ITQ; לאבחנת DSM-5 – PCL-5.' },
  { ids: ['LIFE-EVENTS', 'LEC-S'], max: 2, text: 'שתי רשימות אירועים: אחת טראומטית לאורך החיים ואחת של דחק בשנתיים האחרונות – משלימות, אך אפשר להסתפק באחת.' },
  { ids: ['PHQ-9', 'BDI', 'C-SSRS-S'], max: 3, info: true, text: 'פריטי האובדנות ב-PHQ-9 וב-BDI מכסים סינון בסיסי; סולם קולומביה מוסיף דירוג חומרה.' },
];

export const BATTERIES = [
  { name: 'קבלה כללית (כ-15 דק׳)', ids: ['MHC-SF', 'PHQ-9', 'GAD-7', 'C-SSRS-S', 'LEC-S', 'DERS'] },
  { name: 'דיכאון וחרדה (כ-12 דק׳)', ids: ['BDI', 'STAI-S', 'STAI-T', 'C-SSRS-S'] },
  { name: 'טראומה (כ-15 דק׳)', ids: ['LIFE-EVENTS', 'PCL-5', 'ITQ', 'STO', 'DES'] },
  { name: 'מעקב קצר (כ-5 דק׳)', ids: ['PHQ-9', 'GAD-7'] },
  { name: 'מעקב טראומה (כ-6 דק׳)', ids: ['PCL-5', 'PHQ-9'] },
  { name: 'אבל ושכול', ids: ['TTBQ2-CG31', 'PHQ-9', 'C-SSRS-S'] },
];

export function overlapWarnings(ids) {
  const set = new Set(ids);
  return OVERLAPS.filter(o => !o.info && o.ids.filter(i => set.has(i)).length > o.max).map(o => o.text);
}
export const minutesFor = ids => ids.reduce((s, i) => s + (BY_ID[i]?.minutes ?? 3), 0);
export const sortIds = ids => [...ids].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

export function scoreResponse(instrument, answers, ctx = {}) {
  const d = BY_ID[instrument];
  if (!d) return null;
  try { return d.score(answers || {}, d, ctx); } catch (e) { console.error(instrument, e); return null; }
}
