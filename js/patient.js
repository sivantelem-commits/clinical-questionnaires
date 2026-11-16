import { sb, SAFETY_HTML } from './config.js';
import { BY_ID, sortIds, minutesFor } from './registry.js';
import { esc } from './util.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const token = new URLSearchParams(location.search).get('t') || location.hash.replace(/^#\/?/, '');
const LS = 'qf_' + token;

let D = null;            // נתוני ההקצאה מהשרת
let st = { ans: {}, gate: {}, pos: null, reviewed: {}, safetyShown: false, gender: null };
let steps = [];
let RESUME = null;

const EVENT_WHEN = ['בששת החודשים האחרונים', 'לפני 6 עד 12 חודשים', 'לפני 1 עד 5 שנים', 'לפני 5 עד 10 שנים', 'לפני 10–20 שנים', 'לפני יותר מ-20 שנה'];

// ---------- בניית רצף המסכים (מחושב מחדש אחרי כל תשובה) ----------
function A(id) { return (st.ans[id] ??= {}); }
function buildSteps() {
  const out = [{ key: 'welcome', type: 'welcome' }];
  const ids = sortIds(D.instruments);
  const needGender = ids.some(i => BY_ID[i].usesGender) && !D.gender;
  if (needGender) out.push({ key: 'gender', type: 'gender' });
  let traumaAsked = false, lossAsked = false;
  for (const id of ids) {
    const d = BY_ID[id];
    if (d.needsEvent === 'trauma') {
      if (!traumaAsked) { out.push({ key: 'g:trauma', type: 'gate-trauma' }); traumaAsked = true; }
      if (st.gate.trauma !== true) continue;
    }
    if (d.needsLoss) {
      const auto = A('LEC-S')['6'] === 1;
      if (!lossAsked && !auto) { out.push({ key: 'g:loss', type: 'gate-loss' }); lossAsked = true; }
      if (!(auto || st.gate.loss === true)) continue;
    }
    const pre = D.prefill?.[id];
    if (pre && Object.keys(pre).length) {
      out.push({ key: `r:${id}`, type: 'review', id });
      if (st.reviewed[id] === 'ok') continue;
    }
    if (d.pre?.length) out.push({ key: `pre:${id}`, type: 'form', id, fields: d.pre });
    const ans = A(id);
    for (const it of d.items) {
      if (it.show && !it.show(ans)) continue;
      if (it.type === 'number' || it.type === 'text') continue; // מוצגים בטופס
      out.push({ key: `i:${id}:${it.id}`, type: 'item', id, it });
    }
    const nums = d.items.filter(it => it.type === 'number' || it.type === 'text');
    const post = [...nums, ...(d.post || [])];
    if (post.length) out.push({ key: `post:${id}`, type: 'form', id, fields: post });
  }
  out.push({ key: 'done', type: 'done' });
  return out;
}

function skippedSet() {
  const s = new Set();
  for (const id of D.instruments) {
    const d = BY_ID[id];
    if (d.needsEvent === 'trauma' && st.gate.trauma === false) s.add(id);
    if (d.needsLoss && st.gate.loss === false && A('LEC-S')['6'] !== 1) s.add(id);
  }
  return s;
}

// ---------- שמירה ----------
let saveT = null;
function persist() {
  try { localStorage.setItem(LS, JSON.stringify(st)); } catch { }
  clearTimeout(saveT);
  saveT = setTimeout(() => sb.rpc('save_progress', { p_token: token, p_progress: st }).then(() => { }), 800);
}

// ---------- ניווט ----------
function go(delta) {
  steps = buildSteps();
  let i = steps.findIndex(s => s.key === st.pos);
  if (i < 0) i = 0;
  i = Math.max(0, Math.min(steps.length - 1, i + delta));
  st.pos = steps[i].key; persist(); render();
}
function render() {
  steps = buildSteps();
  let i = steps.findIndex(s => s.key === st.pos);
  if (i < 0) { i = 0; st.pos = steps[0].key; }
  const s = steps[i];
  const itemSteps = steps.filter(x => x.type === 'item');
  const doneN = itemSteps.filter(x => A(x.id)[x.it.id] != null).length;
  const pct = s.type === 'done' ? 100 : itemSteps.length ? Math.round(doneN / itemSteps.length * 100) : 0;
  const leftMin = Math.max(1, Math.round((1 - pct / 100) * minutesFor(D.instruments.filter(x => !skippedSet().has(x)))));
  const top = s.type === 'welcome' ? '' : `<div class="p-top"><div class="p-bar"><i style="width:${pct}%"></i></div>
     <div class="p-meta"><span>${pct}% הושלם</span><span>${s.type === 'done' ? '' : `נותרו כ-${leftMin} דק׳`}</span></div></div>`;
  app.innerHTML = `<div class="p-wrap">${top}<div id="scr"></div></div>
    ${['welcome', 'done'].includes(s.type) ? '' : `<div class="p-nav"><div>
      <button class="btn ghost sm" id="back" ${i <= 1 ? 'disabled' : ''}>→ הקודם</button>
      <button class="btn sm" id="next">הבא ←</button></div></div>`}`;
  const scr = $('#scr');
  RENDER[s.type](scr, s);
  $('#back')?.addEventListener('click', () => go(-1));
  const nx = $('#next');
  if (nx) {
    nx.addEventListener('click', () => go(1));
    if (s.type === 'item') nx.disabled = A(s.id)[s.it.id] == null && !s.it.optional;
    if (s.type.startsWith('gate')) nx.disabled = st.gate[s.type === 'gate-trauma' ? 'trauma' : 'loss'] == null;
    if (s.type === 'gender') nx.disabled = !st.gender;
    if (s.type === 'review') nx.classList.add('hide');
  }
  window.scrollTo({ top: 0 });
}

const sevText = s => s.replace(/\[שם\]/g, st.ans['TTBQ2-CG31']?.name || '[שם]');
function header(d, it) {
  const first = d.items.find(x => !x.show || x.show(A(d.id))) === it;
  return `<div class="q-head"><span class="chip">${esc(d.title)}</span><span class="muted small">${esc(d.frame || '')}</span></div>
    ${first && d.intro ? `<div class="intro-box">${esc(d.intro)}</div>` : ''}
    ${it.sec ? `<div class="muted" style="margin-top:.8rem;font-weight:600">${esc(it.sec)}</div>` : ''}
    ${d.needsEvent === 'trauma' && st.gate.event ? `<div class="small muted" style="margin-top:.5rem">האירוע: ${esc(st.gate.event)}</div>` : ''}`;
}
function optsHtml(scale, cur, cls = '') {
  const lik = !cls && scale.length <= 7 && scale.every(o => o.l.length < 26);
  return `<div class="opts ${cls || (lik ? 'likert' : '')}" style="--n:${scale.length}">${scale.map(o =>
    `<button class="opt ${cur === o.v ? 'sel' : ''}" data-v="${o.v}">${esc(o.l)}</button>`).join('')}</div>`;
}
function checkSafety(d, it, v) {
  if (st.safetyShown || !it.critical) return false;
  const pos = d.id === 'TTBQ2-CG31' ? v <= 2 : v > 0;
  if (pos && (d.safety || ['PHQ-9', 'BDI'].includes(d.id) || d.id === 'TTBQ2-CG31')) { st.safetyShown = true; return true; }
  return false;
}

const RENDER = {
  welcome(el) {
    const ids = D.instruments.filter(i => !BY_ID[i].clinician);
    el.innerHTML = `<div class="card" style="margin-top:2rem">
      <h1>שלום${D.first_name ? ' ' + esc(D.first_name) : ''},</h1>
      <p>${D.therapist ? `${esc(D.therapist)} ביקש/ה ממך` : 'התבקשת'} למלא ${ids.length > 1 ? `${ids.length} שאלונים קצרים` : 'שאלון קצר'}. המילוי לוקח בערך <b>${minutesFor(ids)} דקות</b>.</p>
      ${D.message ? `<div class="intro-box" style="margin:1rem 0">${esc(D.message)}</div>` : ''}
      <ul class="muted small" style="padding-inline-start:1.2em">
        <li>אין תשובות נכונות או לא נכונות – עני/ה לפי התחושה הראשונה.</li>
        <li>התשובות נשמרות אוטומטית. אפשר לעצור ולחזור לאותו קישור מאוחר יותר.</li>
        <li>שאלות שאינן רלוונטיות עבורך ידולגו אוטומטית.</li>
        <li>התשובות מגיעות רק למטפל/ת שלך.</li></ul>
      <button class="btn" id="start" style="margin-top:1rem">${RESUME ? 'להמשיך מאיפה שעצרתי' : 'בואו נתחיל'}</button></div>`;
    $('#start').onclick = () => { if (RESUME) { st.pos = RESUME; RESUME = null; render(); } else go(1); };
  },
  gender(el) {
    el.innerHTML = `<p class="q-text">כדי להתאים את נוסח השאלות – איך לפנות אלייך?</p>
      ${optsHtml([{ v: 'F', l: 'בלשון נקבה' }, { v: 'M', l: 'בלשון זכר' }, { v: 'O', l: 'לא משנה לי' }], st.gender, 'x')}`;
    el.querySelectorAll('.opt').forEach(b => b.onclick = () => { st.gender = b.dataset.v; persist(); go(1); });
  },
  'gate-trauma'(el) {
    const anyLE = Object.entries(A('LIFE-EVENTS')).some(([k, v]) => !k.includes('_') && v === 1);
    el.innerHTML = `<div class="q-head"><span class="chip">אירוע קשה</span></div>
      <p class="q-text">${anyLE ? 'מבין האירועים שציינת – ' : ''}האם יש אירוע קשה או טראומטי בחייך שעדיין מטריד אותך?</p>
      <p class="muted small">השאלות הבאות יתייחסו לאירוע הזה. אם אין אירוע כזה – נדלג עליהן.</p>
      ${optsHtml([{ v: true, l: 'כן' }, { v: false, l: 'לא' }].map(o => ({ ...o, v: o.v })), st.gate.trauma)}
      <div id="ev" class="follow ${st.gate.trauma ? '' : 'hide'}">
        <label class="f">במשפט קצר – מהו האירוע? (לא חובה; אפשר גם מילה אחת)</label>
        <input type="text" id="evd" value="${esc(st.gate.event || '')}" maxlength="200">
        <label class="f">מתי הוא התרחש?</label>
        <select id="evw"><option value="">—</option>${EVENT_WHEN.map((w, i) => `<option value="${i}" ${st.gate.when == i ? 'selected' : ''}>${w}</option>`).join('')}</select></div>`;
    el.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      st.gate.trauma = b.dataset.v === 'true'; persist();
      if (!st.gate.trauma) go(1); else render();
    });
    $('#evd').oninput = e => { st.gate.event = e.target.value; persist(); };
    $('#evw').onchange = e => { st.gate.when = e.target.value; persist(); };
  },
  'gate-loss'(el) {
    el.innerHTML = `<div class="q-head"><span class="chip">אובדן</span></div>
      <p class="q-text">האם נפטר/ה אדם קרוב אלייך?</p><p class="muted small">אם לא – נדלג על השאלות בנושא.</p>
      ${optsHtml([{ v: true, l: 'כן' }, { v: false, l: 'לא' }], st.gate.loss)}`;
    el.querySelectorAll('.opt').forEach(b => b.onclick = () => { st.gate.loss = b.dataset.v === 'true'; persist(); go(1); });
  },
  review(el, s) {
    const d = BY_ID[s.id]; const pre = D.prefill[s.id];
    const lines = d.items.filter(it => pre[it.id] != null).map(it => {
      const sc = it.s || d.scale || []; const o = sc.find(x => x.v === pre[it.id]);
      return `<div>${esc(sevText(it.t))} – <b>${esc(o?.l ?? pre[it.id])}</b></div>`;
    }).join('');
    el.innerHTML = `<div class="q-head"><span class="chip">${esc(d.title)}</span></div>
      <p class="q-text">כבר ענית על השאלון הזה בעבר. כדי לחסוך זמן – אלה התשובות הקודמות שלך:</p>
      <div class="review-list">${lines}</div>
      <div class="row" style="margin-top:1rem"><button class="btn" id="ok">הכול עדיין נכון ✓</button><button class="btn ghost" id="upd">אני רוצה לעדכן</button></div>`;
    $('#ok').onclick = () => { st.reviewed[s.id] = 'ok'; st.ans[s.id] = { ...pre, ...st.ans[s.id] }; persist(); go(1); };
    $('#upd').onclick = () => { st.reviewed[s.id] = 'edit'; st.ans[s.id] = { ...pre, ...st.ans[s.id] }; persist(); go(1); };
  },
  item(el, s) {
    const d = BY_ID[s.id], it = s.it, ans = A(s.id);
    const male = (D.gender || st.gender) === 'M';
    const text = sevText(male && it.tm ? it.tm : it.t);
    const scale = it.s || d.scale;
    const isChoice = d.choice;
    el.innerHTML = header(d, it) + `
      ${isChoice ? `<p class="q-text">${esc(text)}</p>` : `<p class="q-text">${esc(text)}</p>`}
      ${optsHtml(scale, ans[it.id], d.compact ? 'compact' : isChoice ? 'x' : '')}
      ${it.na ? `<button class="link small" id="na" style="margin-top:.6rem">${esc(it.na)}</button>` : ''}
      <div id="fol"></div><div id="safety"></div>`;
    const showFollow = () => {
      const f = it.follow; const box = $('#fol');
      if (!f || ans[it.id] == null || !f.when(ans[it.id])) { box.innerHTML = ''; return false; }
      box.innerHTML = `<div class="follow"><p style="font-weight:600">${esc(f.t)}</p>${f.scale ? optsHtml(f.scale, ans[f.id]) :
        `<input type="text" id="ft" value="${esc(ans[f.id] || '')}" maxlength="300">`}</div>`;
      box.querySelectorAll('.opt').forEach(b => b.onclick = () => { ans[f.id] = +b.dataset.v; persist(); go(1); });
      const ft = $('#ft'); if (ft) ft.oninput = e => { ans[f.id] = e.target.value; persist(); };
      return !!f.scale || !f.optional;
    };
    showFollow();
    el.querySelector('.opts').querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const v = +b.dataset.v; ans[it.id] = v;
      if (it.follow) { const f = it.follow; if (!f.when(v)) delete ans[f.id]; }
      persist();
      if (checkSafety(d, it, v)) { render(); $('#safety').innerHTML = `<div class="alert crit" style="margin-top:1rem">${SAFETY_HTML}</div>`; return; }
      const waitFollow = it.follow && it.follow.when(v);
      if (waitFollow) { render(); return; }
      setTimeout(() => go(1), 140);
    });
    $('#na')?.addEventListener('click', () => { ans[it.id] = 'NA'; persist(); go(1); });
  },
  form(el, s) {
    const d = BY_ID[s.id], ans = A(s.id);
    el.innerHTML = `<div class="q-head"><span class="chip">${esc(d.title)}</span></div>
      ${s.key.startsWith('pre') && d.intro ? `<div class="intro-box">${esc(d.intro)}</div>` : ''}
      ${s.fields.map(f => `<label class="f">${esc(f.t)}${f.optional ? ' <span class="muted small">(לא חובה)</span>' : ''}</label>
        ${f.type === 'textarea' ? `<textarea data-k="${f.id}">${esc(ans[f.id] || '')}</textarea>` :
          `<input type="${f.type === 'number' ? 'number' : 'text'}" data-k="${f.id}" value="${esc(ans[f.id] ?? '')}" ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`}`).join('')}`;
    el.querySelectorAll('[data-k]').forEach(i => i.oninput = e => {
      const k = e.target.dataset.k; const f = s.fields.find(x => x.id === k);
      ans[k] = f.type === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value; persist();
    });
  },
  async done(el) {
    el.innerHTML = `<div class="card center" style="margin-top:2rem"><h2>כמעט סיימנו</h2><p>לחיצה על "שליחה" תעביר את התשובות למטפל/ת.</p>
      <div class="row" style="justify-content:center"><button class="btn ghost" id="bk">→ חזרה</button><button class="btn" id="send">שליחה</button></div><p id="err" class="small" style="color:var(--sev3)"></p></div>`;
    $('#bk').onclick = () => go(-1);
    $('#send').onclick = async () => {
      $('#send').disabled = true;
      const skip = skippedSet();
      const results = D.instruments.filter(i => !BY_ID[i].clinician).map(id => ({
        instrument: id, answers: st.ans[id] || {}, skipped: skip.has(id),
        meta: { ...(BY_ID[id].needsEvent === 'trauma' ? { event: st.gate.event || null, event_when: st.gate.when != null && st.gate.when !== '' ? EVENT_WHEN[st.gate.when] : null } : {}), gender: st.gender || D.gender, prefill: st.reviewed[id] || null, skip_reason: skip.has(id) ? (BY_ID[id].needsLoss ? 'לא דווח על אובדן' : 'לא דווח על אירוע טראומטי') : null },
      }));
      const { data, error } = await sb.rpc('submit_assignment', { p_token: token, p_results: results });
      if (error || !data) { $('#err').textContent = 'השליחה נכשלה. נא לבדוק חיבור לאינטרנט ולנסות שוב.'; $('#send').disabled = false; return; }
      localStorage.removeItem(LS);
      el.innerHTML = `<div class="card center" style="margin-top:2rem"><h2>תודה רבה 🌿</h2><p>התשובות נשלחו. אפשר לסגור את החלון.</p>
        ${st.safetyShown ? `<div class="alert crit" style="text-align:start">${SAFETY_HTML}</div>` : ''}</div>`;
    };
  },
};

// ---------- טעינה ----------
(async function init() {
  if (!token) { app.innerHTML = `<div class="p-wrap"><div class="card" style="margin-top:2rem">הקישור אינו תקין.</div></div>`; return; }
  app.innerHTML = `<div class="p-wrap"><p class="muted center" style="margin-top:3rem">טוען…</p></div>`;
  const { data, error } = await sb.rpc('get_assignment', { p_token: token });
  if (error || !data || data.error) {
    const msg = { completed: 'השאלונים כבר נשלחו – תודה!', expired: 'תוקף הקישור פג. אפשר לבקש מהמטפל/ת קישור חדש.' }[data?.error] || 'הקישור אינו תקין או שאינו זמין.';
    app.innerHTML = `<div class="p-wrap"><div class="card center" style="margin-top:2rem"><p>${msg}</p></div></div>`; return;
  }
  D = data; D.instruments = D.instruments.filter(i => BY_ID[i] && !BY_ID[i].clinician);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { }
  const server = D.progress && Object.keys(D.progress).length ? D.progress : null;
  st = { ...st, ...(server || {}), ...(saved || {}) };
  if (st.pos && st.pos !== 'welcome') RESUME = st.pos;
  st.pos = 'welcome';
  render();
})();
