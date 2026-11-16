import { sb } from './config.js';
import { BY_ID, INSTRUMENTS, DOMAINS, BATTERIES, PATIENT_IDS, CLINICIAN_IDS, STABLE, STABLE_DAYS, overlapWarnings, minutesFor, sortIds } from './registry.js';
import { scoreAll, latestBy, historyOf, changeOf, allFlags, domainProfile, discrepancies, functionalIndicators, findingsText, riskText, functionalText, changeText, FUNC_DOMAINS, SEV_WORD } from './analysis.js';
import { esc, fmt, fmtDate, daysAgo } from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
let ME = null, PROFILE = null;
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 2600); };
const fillUrl = tok => `${location.origin}/f.html?t=${tok}`;
const ageOf = y => y ? new Date().getFullYear() - y : null;
const sevCls = s => `sev${s ?? 0}`;

// ================== AUTH ==================
async function boot() {
  const { data } = await sb.auth.getSession();
  ME = data.session?.user || null;
  sb.auth.onAuthStateChange((_e, s) => { const was = !!ME; ME = s?.user || null; if (was !== !!ME) route(); });
  route();
}
function loginView(mode = 'in') {
  app.innerHTML = `<div class="p-wrap" style="max-width:420px"><div class="card" style="margin-top:12vh">
    <h1>שאלונים קליניים</h1><p class="muted">ממשק המטפל/ת</p>
    ${mode === 'up' ? `<label class="f">שם לתצוגה (יופיע למטופלים)</label><input type="text" id="dn">` : ''}
    <label class="f">אימייל</label><input type="email" id="em" dir="ltr">
    <label class="f">סיסמה</label><input type="password" id="pw" dir="ltr">
    <div class="row" style="margin-top:1rem"><button class="btn" id="go">${mode === 'up' ? 'יצירת חשבון' : 'כניסה'}</button>
    <button class="link small" id="sw">${mode === 'up' ? 'יש לי חשבון' : 'יצירת חשבון חדש'}</button></div>
    <p id="msg" class="small" style="margin-top:.8rem"></p></div></div>`;
  $('#sw').onclick = () => loginView(mode === 'up' ? 'in' : 'up');
  $('#go').onclick = async () => {
    const email = $('#em').value.trim(), password = $('#pw').value;
    const r = mode === 'up'
      ? await sb.auth.signUp({ email, password, options: { data: { display_name: $('#dn').value.trim() } } })
      : await sb.auth.signInWithPassword({ email, password });
    if (r.error) { $('#msg').textContent = r.error.message; $('#msg').style.color = 'var(--sev3)'; return; }
    if (mode === 'up' && !r.data.session) { $('#msg').textContent = 'נשלח אימייל לאימות. לאחר האימות חזרי לכאן והתחברי.'; return; }
  };
}

// ================== ROUTER ==================
async function route() {
  if (!ME) return loginView();
  if (!PROFILE) PROFILE = (await sb.from('profiles').select('*').eq('id', ME.id).maybeSingle()).data || {};
  const [_, view, id, tab] = location.hash.split('/');
  shell(view || 'patients');
  if (view === 'patient' && id) return patientView(id, tab || 'overview');
  if (view === 'settings') return settingsView();
  return patientsView();
}
window.addEventListener('hashchange', route);
function shell(active) {
  if ($('.t-shell')) { $$('.t-side a').forEach(a => a.classList.toggle('on', a.dataset.v === active)); return; }
  app.innerHTML = `<div class="t-shell"><aside class="t-side no-print">
    <h1>שאלונים קליניים</h1><p class="small" style="opacity:.7">${esc(PROFILE?.display_name || ME.email)}</p>
    <a href="#/patients" data-v="patients">מטופלים</a><a href="#/settings" data-v="settings">הגדרות</a>
    <button class="navlink" id="logout">יציאה</button>
    <p class="small" style="opacity:.55;margin-top:2rem">כלי סינון בלבד – אין לאבחן על סמך שאלונים לדיווח עצמי ללא ראיון קליני.</p>
    </aside><main class="t-main" id="main"></main></div>`;
  $("#logout").onclick = () => sb.auth.signOut();
  shell(active);
}
const main = () => $('#main');

// ================== PATIENTS LIST ==================
async function patientsView() {
  main().innerHTML = `<div class="row"><h1 class="grow">מטופלים</h1><input type="text" id="q" placeholder="חיפוש…" style="max-width:220px"><button class="btn" id="add">+ מטופל/ת חדש/ה</button></div><div id="lst" class="card" style="margin-top:1rem">טוען…</div>`;
  const [{ data: pts }, { data: asg }, { data: rsp }] = await Promise.all([
    sb.from('patients').select('*').eq('archived', false).order('created_at', { ascending: false }),
    sb.from('assignments').select('patient_id,status,completed_at,created_at'),
    sb.from('responses').select('patient_id,instrument,answers,completed_at,skipped,meta,source').order('completed_at', { ascending: false }).limit(2000),
  ]);
  const draw = (f = '') => {
    const rows = (pts || []).filter(p => !f || p.name.includes(f) || (p.id_number || '').includes(f));
    $('#lst').innerHTML = rows.length ? `<table class="t"><thead><tr><th>שם</th><th>גיל</th><th>שאלונים</th><th>ממתין</th><th>התראות</th><th>עדכון אחרון</th></tr></thead><tbody>${rows.map(p => {
      const mine = (rsp || []).filter(r => r.patient_id === p.id);
      const flags = allFlags(latestBy(scoreAll(mine, p)));
      const pend = (asg || []).filter(a => a.patient_id === p.id && ['pending', 'in_progress'].includes(a.status)).length;
      const crit = flags.filter(f => f.level === 'critical').length;
      return `<tr class="click" data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td>${ageOf(p.birth_year) ?? ''}</td><td>${new Set(mine.map(m => m.instrument)).size}</td>
        <td>${pend ? `<span class="chip">${pend}</span>` : ''}</td><td>${crit ? `<span class="pill sev3">${crit} קריטי</span>` : flags.length ? `<span class="pill sev1">${flags.length}</span>` : ''}</td><td class="muted">${fmtDate(mine[0]?.completed_at)}</td></tr>`;
    }).join('')}</tbody></table>` : `<p class="muted">אין עדיין מטופלים. לחצי על "+ מטופל/ת חדש/ה" כדי להתחיל.</p>`;
    $$('tr.click').forEach(tr => tr.onclick = () => location.hash = `#/patient/${tr.dataset.id}`);
  };
  draw(); $('#q').oninput = e => draw(e.target.value.trim());
  $('#add').onclick = () => patientForm();
}
function patientForm(p = {}) {
  modal(`<h2>${p.id ? 'עריכת פרטים' : 'מטופל/ת חדש/ה'}</h2>
    <label class="f">שם מלא</label><input type="text" id="n" value="${esc(p.name || '')}">
    <div class="row"><div class="grow"><label class="f">ת.ז. (לא חובה)</label><input type="text" id="idn" value="${esc(p.id_number || '')}"></div>
    <div class="grow"><label class="f">שנת לידה</label><input type="number" id="by" value="${p.birth_year || ''}"></div>
    <div class="grow"><label class="f">מגדר (לנוסח ולנורמות)</label><select id="g"><option value="">—</option><option value="F" ${p.gender === 'F' ? 'selected' : ''}>נקבה</option><option value="M" ${p.gender === 'M' ? 'selected' : ''}>זכר</option><option value="O" ${p.gender === 'O' ? 'selected' : ''}>אחר</option></select></div></div>
    <label class="f">סיבת הפניה / גורם מפנה</label><textarea id="ref">${esc(p.referral || '')}</textarea>
    <label class="f">הערות רקע</label><textarea id="nt">${esc(p.notes || '')}</textarea>
    <div class="row" style="margin-top:1rem"><button class="btn" id="sv">שמירה</button><button class="btn ghost" data-close>ביטול</button>
    ${p.id ? `<span class="grow"></span><button class="link small" id="arc">העברה לארכיון</button>` : ''}</div>`, async m => {
    $('#sv', m).onclick = async () => {
      const row = { name: $('#n', m).value.trim(), id_number: $('#idn', m).value.trim() || null, birth_year: +$('#by', m).value || null, gender: $('#g', m).value || null, referral: $('#ref', m).value, notes: $('#nt', m).value };
      if (!row.name) return toast('נדרש שם');
      const r = p.id ? await sb.from('patients').update(row).eq('id', p.id).select().single() : await sb.from('patients').insert(row).select().single();
      if (r.error) return toast(r.error.message);
      closeModal(); location.hash = `#/patient/${r.data.id}`; route();
    };
    $('#arc', m)?.addEventListener('click', async () => { if (!confirm('להעביר לארכיון?')) return; await sb.from('patients').update({ archived: true }).eq('id', p.id); closeModal(); location.hash = '#/patients'; });
  });
}

// ================== PATIENT ==================
let P = null, SC = [], ASG = [], SES = [], REP = [];
async function loadPatient(id) {
  const [p, r, a, s, rep] = await Promise.all([
    sb.from('patients').select('*').eq('id', id).single(),
    sb.from('responses').select('*').eq('patient_id', id).order('completed_at', { ascending: false }),
    sb.from('assignments').select('*').eq('patient_id', id).order('created_at', { ascending: false }),
    sb.from('sessions').select('*').eq('patient_id', id).order('session_date', { ascending: false }),
    sb.from('reports').select('*').eq('patient_id', id).order('updated_at', { ascending: false }),
  ]);
  P = p.data; SC = scoreAll(r.data || [], P); ASG = a.data || []; SES = s.data || []; REP = rep.data || [];
}
const TABS = [['overview', 'סקירה וניתוח'], ['results', 'תוצאות'], ['send', 'שליחת שאלונים'], ['clinician', 'ראיונות קליניים'], ['sessions', 'פגישות'], ['report', 'דו"ח תפקודי']];
async function patientView(id, tab) {
  main().innerHTML = `<p class="muted">טוען…</p>`;
  await loadPatient(id);
  if (!P) { main().innerHTML = 'לא נמצא'; return; }
  main().innerHTML = `<div class="row no-print"><a href="#/patients" class="small">→ כל המטופלים</a></div>
    <div class="row"><h1 class="grow" style="margin-bottom:0">${esc(P.name)}</h1><button class="btn ghost sm no-print" id="edit">עריכת פרטים</button></div>
    <div class="muted small">${[ageOf(P.birth_year) && `גיל ${ageOf(P.birth_year)}`, P.id_number && `ת.ז. ${esc(P.id_number)}`, P.referral && esc(P.referral.slice(0, 90))].filter(Boolean).join(' · ')}</div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tab"></div>`;
  $('#edit').onclick = () => patientForm(P);
  $$('.tabs button').forEach(b => b.onclick = () => location.hash = `#/patient/${P.id}/${b.dataset.t}`);
  ({ overview, results, send, clinician, sessions, report })[tab]($('#tab'));
}

// ---------- סקירה וניתוח ----------
function overview(el) {
  const latest = latestBy(SC);
  if (!Object.keys(latest).length) { el.innerHTML = `<div class="card"><p>עדיין אין תוצאות. אפשר <a href="#/patient/${P.id}/send">לשלוח שאלונים</a> או <a href="#/patient/${P.id}/clinician">למלא ראיון קליני</a>.</p></div>`; return; }
  const flags = allFlags(latest), prof = domainProfile(latest), disc = discrepancies(latest), ind = functionalIndicators(latest);
  const changes = [...new Set(SC.map(r => r.instrument))].map(id => [id, changeOf(SC, id)]).filter(x => x[1]);
  const skipped = SC.filter(r => r.skipped && !latest[r.instrument]);
  el.innerHTML = `
    ${flags.length ? `<div class="card" style="margin-bottom:1rem"><h3>התראות</h3>${flags.map(f => `<div class="flag ${f.level}">${esc(f.text)} <span class="muted small">· ${f.id} · ${fmtDate(f.date)}</span></div>`).join('')}</div>` : `<div class="alert ok" style="margin-bottom:1rem">לא עלו התראות קריטיות בשאלונים האחרונים.</div>`}
    <div class="grid2">
      <div class="card"><h3>פרופיל לפי תחומים</h3>${prof.map(d => `<div style="margin:.6rem 0">
        <div class="row"><b class="grow">${d.name}</b><span class="pill ${sevCls(d.max)}">${SEV_WORD[d.max]}</span></div>
        ${d.rs.map(r => `<div class="small"><span class="pill ${sevCls(r.res.level.sev)}" style="font-size:.75rem">${BY_ID[r.instrument].name}</span> ${r.res.total != null ? fmt(r.res.total) + (r.res.max ? '/' + r.res.max : '') + ' – ' : ''}${esc(r.res.level.label)} <span class="muted">(${fmtDate(r.completed_at)})</span></div>`).join('')}
        ${d.note ? `<div class="small muted">${d.note}</div>` : ''}</div>`).join('')}</div>
      <div>
        <div class="card" style="margin-bottom:1rem"><h3>אינדיקטורים תפקודיים</h3>${Object.entries(ind).map(([dom, hits]) => `<div style="margin:.5rem 0"><b>${dom}</b> ${hits.length ? `<span class="pill sev2">${hits.length}</span>` : '<span class="muted small">— לא דווח קושי</span>'}
          ${hits.length ? `<ul class="small" style="margin:.2rem 0;padding-inline-start:1.2em">${hits.map(h => `<li>${esc(h.label)}${h.word ? ' – ' + h.word : ''}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
        ${changes.length ? `<div class="card" style="margin-bottom:1rem"><h3>שינוי לאורך זמן</h3>${changes.map(([id, c]) => `<div style="margin:.5rem 0"><div class="row"><b class="grow">${BY_ID[id].name}</b>${spark(c.series, BY_ID[id])}</div>
          <div class="small">מתחילת המעקב: ${c.overall.text}</div>${c.n > 2 ? `<div class="small muted">מהמדידה הקודמת: ${c.recent.text}</div>` : ''}</div>`).join('')}</div>` : ''}
        ${disc.length ? `<div class="card" style="margin-bottom:1rem"><h3>פערים בין דיווח עצמי להערכת קלינאי</h3>${disc.map(t => `<p class="small">${esc(t)}</p>`).join('')}</div>` : ''}
        ${skipped.length ? `<div class="card"><h3>דולגו אוטומטית</h3>${skipped.map(r => `<div class="small">${BY_ID[r.instrument]?.name} – ${esc(r.meta?.skip_reason || '')} (${fmtDate(r.completed_at)})</div>`).join('')}</div>` : ''}
      </div></div>`;
}
function spark(series, d) {
  if (series.length < 2) return '';
  const w = 120, h = 30, vs = series.map(s => s.v), mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * w},${h - 3 - ((v - mn) / rg) * (h - 6)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="direction:ltr"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>${vs.map((v, i) => `<circle cx="${(i / (vs.length - 1)) * w}" cy="${h - 3 - ((v - mn) / rg) * (h - 6)}" r="2.5" fill="var(--accent)"><title>${fmt(v)}</title></circle>`).join('')}</svg>`;
}

// ---------- תוצאות ----------
function results(el) {
  const ids = sortIds([...new Set(SC.filter(r => !r.skipped).map(r => r.instrument))]);
  if (!ids.length) { el.innerHTML = `<div class="card">אין עדיין תוצאות.</div>`; return; }
  el.innerHTML = `<div class="grid2">${ids.map(id => {
    const h = historyOf(SC, id).reverse(); const r = h[0], res = r.res, d = BY_ID[id];
    return `<div class="card res-card ${sevCls(res?.level?.sev)}">
      <div class="row"><div class="grow"><b>${d.name}</b> <span class="muted small">${esc(d.title)}</span></div><span class="muted small">${fmtDate(r.completed_at)}${r.source === 'clinician' ? ' · קלינאי' : ''}</span></div>
      <div class="row" style="align-items:baseline"><span class="score-big">${res?.total != null ? fmt(res.total) : ''}</span><span class="muted small">${res?.max ? '/ ' + res.max : ''} ${res?.totalLabel || ''}</span></div>
      <div><span class="pill ${sevCls(res?.level?.sev)}">${esc(res?.level?.label || '')}</span></div>
      ${(res?.subscales || []).length ? `<table class="t" style="margin-top:.6rem">${res.subscales.map(s => `<tr><td>${esc(s.name)}</td><td><b>${fmt(s.score)}</b> <span class="muted small">${s.range || ''}</span></td><td class="small">${esc(s.note || '')}</td></tr>`).join('')}</table>` : ''}
      ${(res?.criteria || []).map(c => `<div class="small">${c.met ? '✅' : '⬜'} ${esc(c.name)}</div>`).join('')}
      ${res?.functional ? `<div class="small" style="margin-top:.4rem">${esc(res.functional)}</div>` : ''}
      ${(res?.flags || []).map(f => `<div class="flag ${f.level}">${esc(f.text)}</div>`).join('')}
      ${(res?.extra || []).length ? `<div class="small" style="margin-top:.4rem">${res.extra.map(esc).join('<br>')}</div>` : ''}
      ${r.meta?.event ? `<div class="small muted">אירוע מדווח: ${esc(r.meta.event)}${r.meta.event_when ? ' · ' + esc(r.meta.event_when) : ''}</div>` : ''}
      ${r.meta?.prefill === 'ok' ? `<div class="small muted">אושר מתוך מילוי קודם (ללא שינוי)</div>` : ''}
      ${res?.norms ? `<div class="small muted" style="margin-top:.5rem">${esc(res.norms)}</div>` : ''}
      <div class="row" style="margin-top:.6rem"><button class="link small" data-items="${r.id}">תשובות לפי פריט</button>
      ${h.length > 1 ? `<span class="small muted">· ${h.length} מדידות: ${h.map(x => fmt(x.res?.total)).reverse().join(' → ')}</span>` : ''}
      <span class="grow"></span><button class="link small" data-del="${r.id}" style="color:var(--muted)">מחיקה</button></div></div>`;
  }).join('')}</div>`;
  $$('[data-items]', el).forEach(b => b.onclick = () => itemsModal(SC.find(r => r.id === b.dataset.items)));
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (!confirm('למחוק את התוצאה?')) return; await sb.from('responses').delete().eq('id', b.dataset.del); patientView(P.id, 'results'); });
}
function itemsModal(r) {
  const d = BY_ID[r.instrument], a = r.answers || {};
  const row = it => {
    const sc = it.s || d.scale || []; const v = a[it.id];
    const lab = v === 'NA' ? 'לא רלוונטי' : sc.find(o => o.v === v)?.l ?? (v ?? '—');
    const f = it.follow && a[it.follow.id] != null ? `<div class="small muted">↳ ${esc(it.follow.t)}: ${esc(it.follow.scale ? it.follow.scale.find(o => o.v === a[it.follow.id])?.l : a[it.follow.id])}</div>` : '';
    const nt = a[it.id + '_n'] ? `<div class="small muted">הערה: ${esc(a[it.id + '_n'])}</div>` : '';
    return `<tr><td>${esc(it.id)}${it.r ? '<sup title="פריט הפוך">R</sup>' : ''}</td><td>${esc((P.gender === 'M' && it.tm) || it.t)}${f}${nt}</td><td><b>${esc(lab)}</b></td></tr>`;
  };
  const extra = [...(d.pre || []), ...(d.post || [])].filter(f => a[f.id]).map(f => `<tr><td></td><td>${esc(f.t)}</td><td>${esc(a[f.id])}</td></tr>`).join('');
  modal(`<div class="row"><h2 class="grow">${d.name} – ${fmtDate(r.completed_at)}</h2><button class="btn ghost sm" data-close>סגירה</button></div>
    <table class="t items-tbl">${extra}${d.items.map(row).join('')}</table>`);
}

// ---------- שליחת שאלונים ----------
function send(el) {
  const lastDone = id => SC.find(r => r.instrument === id && !r.skipped);
  el.innerHTML = `<div class="grid2" style="grid-template-columns:1.3fr 1fr"><div class="card">
      <h3>בחירת שאלונים</h3>
      <div class="row small">סוללות מוכנות: ${BATTERIES.map((b, i) => `<button class="btn ghost sm" data-bat="${i}">${b.name}</button>`).join('')}</div>
      <div id="picks">${DOMAINS.map(([name, ids]) => {
        const pids = ids.filter(i => PATIENT_IDS.includes(i)); if (!pids.length) return '';
        return `<div class="domain-h">${name}</div>${pids.map(id => { const d = BY_ID[id], ld = lastDone(id);
          const stable = STABLE.includes(id) && ld && daysAgo(ld.completed_at) < STABLE_DAYS;
          return `<label class="pick"><input type="checkbox" value="${id}"><div><b>${d.name}</b> <span class="small">${esc(d.title)}</span> <span class="muted small">· ${d.minutes} דק׳ · ${esc(d.frame || '')}</span>
            ${ld ? `<div class="small muted">מולא לאחרונה ${fmtDate(ld.completed_at)} (${daysAgo(ld.completed_at)} ימים)${stable ? ' – שאלון יציב: יוצג למטופל/ת לאישור במקום מילוי מחדש' : ''}</div>` : ''}</div></label>`; }).join('')}`;
      }).join('')}</div></div>
    <div><div class="card" style="position:sticky;top:1rem">
      <h3>סיכום</h3><div id="sum" class="small muted">לא נבחרו שאלונים</div><div id="warn"></div>
      <label class="f">הודעה אישית למטופל/ת (לא חובה)</label><textarea id="msg" placeholder="לדוגמה: לקראת הפגישה שלנו ביום שלישי…"></textarea>
      <label class="f">תוקף הקישור</label><select id="exp"><option value="7">שבוע</option><option value="30" selected>חודש</option><option value="90">3 חודשים</option></select>
      <button class="btn" id="mk" style="margin-top:1rem" disabled>יצירת קישור</button><div id="out" style="margin-top:1rem"></div></div></div></div>
    <div class="card" style="margin-top:1rem"><h3>קישורים שנשלחו</h3>${ASG.length ? `<table class="t"><tr><th>נוצר</th><th>שאלונים</th><th>סטטוס</th><th></th></tr>${ASG.map(a => `<tr>
      <td>${fmtDate(a.created_at)}</td><td class="small">${a.instruments.map(i => BY_ID[i]?.name || i).join(', ')}</td>
      <td>${{ pending: a.opened_at ? 'נפתח, טרם התחיל' : 'טרם נפתח', in_progress: 'בתהליך מילוי', completed: '✅ הושלם ' + fmtDate(a.completed_at), cancelled: 'בוטל' }[a.status]}${['pending', 'in_progress'].includes(a.status) && new Date(a.expires_at) < new Date() ? ' (פג תוקף)' : ''}</td>
      <td>${['pending', 'in_progress'].includes(a.status) ? `<button class="link small" data-copy="${a.token}">העתקת קישור</button> · <button class="link small" data-cancel="${a.id}">ביטול</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted small">עדיין לא נשלחו קישורים.</p>'}</div>`;
  const sel = () => $$('#picks input:checked').map(i => i.value);
  const upd = () => {
    const ids = sel();
    $('#sum').innerHTML = ids.length ? `${ids.length} שאלונים · כ-<b>${minutesFor(ids)}</b> דקות מילוי<br>${sortIds(ids).map(i => BY_ID[i].name).join(' · ')}` : 'לא נבחרו שאלונים';
    const w = overlapWarnings(ids);
    const recent = ids.filter(i => !STABLE.includes(i)).map(i => [i, lastDone(i)]).filter(([, r]) => r && daysAgo(r.completed_at) < 7);
    $('#warn').innerHTML = [...w.map(t => `<div class="alert small" style="margin-top:.6rem">⚠ ${esc(t)}</div>`),
      ...recent.map(([i, r]) => `<div class="alert small" style="margin-top:.6rem">${BY_ID[i].name} מולא לפני ${daysAgo(r.completed_at)} ימים – ייתכן שאין צורך לחזור עליו.</div>`)].join('');
    $('#mk').disabled = !ids.length;
  };
  $$('#picks input').forEach(i => i.onchange = upd);
  $$('[data-bat]').forEach(b => b.onclick = () => { const ids = BATTERIES[b.dataset.bat].ids; $$('#picks input').forEach(i => i.checked = ids.includes(i.value)); upd(); });
  $('#mk').onclick = async () => {
    const ids = sortIds(sel());
    const prefill = ids.filter(i => STABLE.includes(i) && lastDone(i) && daysAgo(lastDone(i).completed_at) < STABLE_DAYS);
    const exp = new Date(Date.now() + +$('#exp').value * 864e5).toISOString();
    const { data, error } = await sb.from('assignments').insert({ patient_id: P.id, instruments: ids, prefill, message: $('#msg').value.trim() || null, expires_at: exp }).select().single();
    if (error) return toast(error.message);
    const url = fillUrl(data.token);
    const wa = `https://wa.me/?text=${encodeURIComponent(`שלום${P.name ? ' ' + P.name.split(' ')[0] : ''}, לפני הפגישה הבאה אבקש למלא כמה שאלונים קצרים (כ-${minutesFor(ids)} דקות):\n${url}`)}`;
    $('#out').innerHTML = `<div class="alert ok"><b>הקישור מוכן</b><div class="linkbox" style="margin-top:.5rem"><input type="text" value="${url}" readonly id="lk"><button class="btn sm" id="cp">העתקה</button></div>
      <div class="row small" style="margin-top:.5rem"><a href="${wa}" target="_blank" rel="noopener">שליחה בווטסאפ</a> · <a href="mailto:?subject=${encodeURIComponent('שאלונים לקראת הפגישה')}&body=${encodeURIComponent(url)}">שליחה במייל</a> · <a href="${url}" target="_blank">תצוגה מקדימה</a></div></div>`;
    $('#cp').onclick = () => { navigator.clipboard.writeText(url); toast('הקישור הועתק'); };
    ASG.unshift(data);
  };
  $$('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(fillUrl(b.dataset.copy)); toast('הקישור הועתק'); });
  $$('[data-cancel]').forEach(b => b.onclick = async () => { await sb.from('assignments').update({ status: 'cancelled' }).eq('id', b.dataset.cancel); patientView(P.id, 'send'); });
}

// ---------- ראיונות קליניים ----------
function clinician(el) {
  el.innerHTML = `<div class="grid2">${CLINICIAN_IDS.concat(['C-SSRS-S']).filter((v, i, a) => a.indexOf(v) === i).map(id => {
    const d = BY_ID[id]; const h = historyOf(SC, id);
    return `<div class="card"><h3>${d.name}</h3><p class="small">${esc(d.title)}</p><p class="small muted">${h.length ? `מילוי אחרון ${fmtDate(h[h.length - 1].completed_at)}: ${esc(h[h.length - 1].res.level?.label || '')}` : 'טרם מולא'}</p>
      <button class="btn sm" data-fill="${id}">מילוי ${d.clinician ? 'ראיון' : 'בפגישה'}</button></div>`;
  }).join('')}</div>
  <p class="small muted" style="margin-top:1rem">ניתן גם למלא כל שאלון לדיווח עצמי יחד עם המטופל/ת בפגישה:</p>
  <select id="any" style="max-width:360px"><option value="">בחירת שאלון…</option>${PATIENT_IDS.map(i => `<option value="${i}">${BY_ID[i].name} – ${esc(BY_ID[i].title)}</option>`).join('')}</select>`;
  $$('[data-fill]', el).forEach(b => b.onclick = () => clinicianForm(b.dataset.fill));
  $('#any').onchange = e => e.target.value && clinicianForm(e.target.value);
}
function clinicianForm(id) {
  const d = BY_ID[id]; const a = {};
  const optBlock = (sc, key) => `<div class="opts">${sc.map(o => `<button class="opt" data-k="${key}" data-v="${o.v}">${esc(o.l)}</button>`).join('')}</div>`;
  const fields = [...(d.pre || []), ...(d.post || [])];
  modal(`<div class="row"><h2 class="grow">${d.name} – ${esc(d.title)}</h2><button class="btn ghost sm" data-close>סגירה</button></div>
    <p class="small muted">${esc(d.intro || '')}</p>
    <label class="f">תאריך</label><input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}" style="max-width:200px">
    ${(d.pre || []).map(f => `<label class="f">${esc(f.t)}</label>${f.s ? optBlock(f.s, f.id) : f.type === 'textarea' ? `<textarea data-tk="${f.id}"></textarea>` : `<input type="text" data-tk="${f.id}">`}`).join('')}
    ${d.items.map(it => `<div class="cl-item">${it.sec ? `<div class="domain-h">${esc(it.sec)}</div>` : ''}<div>${/^\d+$/.test(it.id) ? `<b>${it.id}.</b> ` : ""}${esc(it.t)}</div>
      ${it.q ? `<div class="small muted">שאלות מנחות: ${esc(it.q)}</div>` : ''}
      ${it.type === 'number' || it.type === 'text' ? `<input type="${it.type}" data-tk="${it.id}" style="max-width:200px">` : optBlock(it.s || d.scale, it.id)}
      ${it.follow ? `<div class="small" style="margin-top:.3rem">${esc(it.follow.t)}</div>${it.follow.scale ? optBlock(it.follow.scale, it.follow.id) : `<input type="text" data-tk="${it.follow.id}">`}` : ''}
      ${it.note ? `<input type="text" data-tk="${it.id}_n" placeholder="הערה / תיאור (לא חובה)" style="margin-top:.4rem">` : ''}</div>`).join('')}
    ${(d.post || []).map(f => `<label class="f">${esc(f.t)}</label><textarea data-tk="${f.id}"></textarea>`).join('')}
    <div class="row" style="margin-top:1rem"><button class="btn" id="sv">שמירה</button><span id="live" class="small muted"></span></div>`, m => {
    const live = () => { const r = d.score(a, d, { gender: P.gender }); $('#live', m).textContent = r?.level ? `ציון: ${fmt(r.total)} · ${r.level.label}` : ''; };
    $$('.opt', m).forEach(b => b.onclick = () => { const k = b.dataset.k; a[k] = +b.dataset.v; $$(`.opt[data-k="${k}"]`, m).forEach(x => x.classList.toggle('sel', x === b)); live(); });
    $$('[data-tk]', m).forEach(i => i.oninput = () => { const k = i.dataset.tk; a[k] = i.type === 'number' ? +i.value : i.value; live(); });
    $('#sv', m).onclick = async () => {
      const { error } = await sb.from('responses').insert({ therapist_id: ME.id, patient_id: P.id, instrument: id, answers: a, source: 'clinician', completed_at: new Date($('#dt', m).value + 'T12:00').toISOString(), meta: { gender: P.gender } });
      if (error) return toast(error.message);
      closeModal(); toast('נשמר'); patientView(P.id, 'overview');
    };
  });
}

// ---------- פגישות ----------
function sessions(el) {
  el.innerHTML = `<div class="row"><h3 class="grow">תיעוד פגישות</h3><button class="btn sm" id="new">+ פגישה</button></div>
    ${SES.length ? SES.map(s => `<div class="card" style="margin:.7rem 0"><div class="row"><b class="grow">${fmtDate(s.session_date)}</b><button class="link small" data-ed="${s.id}">עריכה</button></div>
      <div style="white-space:pre-wrap">${esc(s.notes || '')}</div>
      ${Object.entries(s.domains || {}).filter(([, v]) => v?.text || v?.rating != null).map(([k, v]) => `<div class="small"><b>${k}</b>${v.rating != null ? ` <span class="pill ${sevCls(Math.min(3, v.rating))}">${v.rating}/4</span>` : ''} ${esc(v.text || '')}</div>`).join('')}</div>`).join('') : '<p class="muted">אין עדיין תיעוד. תיעוד תחומי התפקוד כאן נכנס אוטומטית לדו"ח התפקודי.</p>'}`;
  $('#new').onclick = () => sessionForm();
  $$('[data-ed]', el).forEach(b => b.onclick = () => sessionForm(SES.find(s => s.id === b.dataset.ed)));
}
function sessionForm(s = {}) {
  const dm = s.domains || {};
  modal(`<div class="row"><h2 class="grow">${s.id ? 'עריכת פגישה' : 'פגישה חדשה'}</h2><button class="btn ghost sm" data-close>סגירה</button></div>
    <label class="f">תאריך</label><input type="date" id="dt" value="${s.session_date || new Date().toISOString().slice(0, 10)}" style="max-width:200px">
    <label class="f">סיכום הפגישה</label><textarea id="nt" style="min-height:8em">${esc(s.notes || '')}</textarea>
    <h3 style="margin-top:1rem">תפקוד לפי תחומים <span class="small muted">(0 = ללא פגיעה, 4 = פגיעה חמורה)</span></h3>
    ${FUNC_DOMAINS.map(k => `<div class="cl-item"><div class="row"><b class="grow">${k}</b><select data-r="${k}" style="max-width:150px"><option value="">—</option>${[0, 1, 2, 3, 4].map(v => `<option ${dm[k]?.rating === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <input type="text" data-x="${k}" value="${esc(dm[k]?.text || '')}" placeholder="תיאור קצר (למשל: חזר לעבודה במשרה חלקית, נמנע מאירועים משפחתיים)"></div>`).join('')}
    <div class="row" style="margin-top:1rem"><button class="btn" id="sv">שמירה</button>${s.id ? `<span class="grow"></span><button class="link small" id="del">מחיקה</button>` : ''}</div>`, m => {
    $('#sv', m).onclick = async () => {
      const domains = {};
      FUNC_DOMAINS.forEach(k => { const r = $(`[data-r="${k}"]`, m).value, x = $(`[data-x="${k}"]`, m).value.trim(); if (r !== '' || x) domains[k] = { rating: r === '' ? null : +r, text: x }; });
      const row = { patient_id: P.id, session_date: $('#dt', m).value, notes: $('#nt', m).value, domains };
      const r = s.id ? await sb.from('sessions').update(row).eq('id', s.id) : await sb.from('sessions').insert(row);
      if (r.error) return toast(r.error.message);
      closeModal(); patientView(P.id, 'sessions');
    };
    $('#del', m)?.addEventListener('click', async () => { if (!confirm('למחוק?')) return; await sb.from('sessions').delete().eq('id', s.id); closeModal(); patientView(P.id, 'sessions'); });
  });
}

// ---------- דו"ח תפקודי ----------
const REPORT_SECS = [
  ['id', 'פרטים מזהים'], ['referral', 'סיבת ההפניה'], ['sources', 'מקורות מידע'], ['background', 'רקע ומהלך הטיפול'],
  ['findings', 'ממצאי השאלונים וההערכה'], ['change', 'שינוי לאורך הטיפול'], ['functional', 'תפקוד לפי תחומים'], ['risk', 'הערכת סיכון'],
  ['summary', 'התרשמות קלינית וסיכום'], ['recs', 'המלצות'],
];
function draftReport() {
  const latest = latestBy(SC);
  const used = sortIds(Object.keys(latest));
  const dates = [...SES].reverse();
  return {
    id: [`שם: ${P.name}`, P.id_number && `ת.ז.: ${P.id_number}`, P.birth_year && `גיל: ${ageOf(P.birth_year)}`, `תאריך הדו"ח: ${fmtDate(new Date())}`, `שם המטפל/ת: ${PROFILE?.display_name || ''}`].filter(Boolean).join('\n'),
    referral: P.referral || '',
    sources: [dates.length ? `${dates.length} פגישות טיפוליות (${fmtDate(dates[0].session_date)}–${fmtDate(dates[dates.length - 1].session_date)}).` : null,
      used.length ? `שאלונים וכלי הערכה: ${used.map(i => `${BY_ID[i].name} (${fmtDate(latest[i].completed_at)})`).join(', ')}.` : null].filter(Boolean).join('\n'),
    background: [P.notes, ...dates.filter(s => s.notes).map(s => `${fmtDate(s.session_date)}: ${s.notes}`)].filter(Boolean).join('\n'),
    findings: findingsText(latest) + '\n\nיש לציין כי שאלונים לדיווח עצמי משמשים לסינון ומשקפים את התמונה המודעת של המטופל/ת; הממצאים שולבו עם הראיון הקליני.',
    change: changeText(SC) || 'מדידה יחידה – אין עדיין נתוני שינוי.',
    functional: functionalText(latest, SES[0]),
    risk: riskText(latest),
    summary: '', recs: '',
  };
}
function report(el) {
  const cur = REP[0];
  const c = cur?.content || draftReport();
  el.innerHTML = `<div class="row no-print" style="margin-bottom:1rem"><b class="grow">${cur ? `טיוטה שמורה · עודכנה ${fmtDate(cur.updated_at)}` : 'טיוטה חדשה – מולאה אוטומטית מהשאלונים ומתיעוד הפגישות'}</b>
      <button class="btn ghost sm" id="regen">מילוי אוטומטי מחדש</button><button class="btn ghost sm" id="doc">הורדה ל-Word</button><button class="btn ghost sm" id="pr">הדפסה / PDF</button><button class="btn sm" id="sv">שמירה</button></div>
    <div class="card" id="rep"><div class="print-only"><h1 style="text-align:center">דו"ח תפקודי</h1></div>
      <label class="f no-print">כותרת</label><input type="text" id="ttl" class="no-print" value="${esc(cur?.title || 'דו"ח תפקודי')}">
      ${REPORT_SECS.map(([k, l]) => `<div class="report-sec"><h3>${l}</h3><textarea data-s="${k}" rows="${Math.min(18, Math.max(4, (c[k] || '').split('\n').length + 2))}">${esc(c[k] || '')}</textarea><div class="print-text" data-p="${k}"></div></div>`).join('')}
      <div class="print-only" style="margin-top:2rem">חתימה: ____________________ &nbsp;&nbsp; ${esc(PROFILE?.display_name || '')} &nbsp;&nbsp; תאריך: ${fmtDate(new Date())}</div></div>`;
  const collect = () => Object.fromEntries($$('[data-s]', el).map(t => [t.dataset.s, t.value]));
  const sync = () => $$('[data-s]', el).forEach(t => $(`[data-p="${t.dataset.s}"]`, el).textContent = t.value);
  $('#sv').onclick = async () => {
    const row = { patient_id: P.id, title: $('#ttl').value, content: collect(), updated_at: new Date().toISOString() };
    const r = cur ? await sb.from('reports').update(row).eq('id', cur.id).select().single() : await sb.from('reports').insert(row).select().single();
    if (r.error) return toast(r.error.message);
    if (!cur) REP.unshift(r.data); else REP[0] = r.data; toast('הדו"ח נשמר');
  };
  $('#regen').onclick = () => {
    if (!confirm('למלא מחדש את הסעיפים האוטומטיים? (סיכום והמלצות לא ישתנו)')) return;
    const d = draftReport(); $$('[data-s]', el).forEach(t => { if (!['summary', 'recs'].includes(t.dataset.s)) t.value = d[t.dataset.s]; });
  };
  $('#pr').onclick = () => { sync(); window.print(); };
  $('#doc').onclick = () => {
    const c = collect();
    const html = `<html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:David,Arial;direction:rtl;font-size:12pt}h1{text-align:center}h2{font-size:14pt;margin-top:16pt}p{white-space:pre-wrap;margin:0}</style></head><body>
      <h1>${esc($('#ttl').value)}</h1>${REPORT_SECS.map(([k, l]) => `<h2>${l}</h2><p>${esc(c[k]).replace(/\n/g, '<br>')}</p>`).join('')}<p><br>חתימה: ____________ ${esc(PROFILE?.display_name || '')}</p></body></html>`;
    const b = new Blob(['﻿' + html], { type: 'application/msword' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `דוח תפקודי - ${P.name}.doc`; a.click();
  };
}

// ================== SETTINGS ==================
function settingsView() {
  main().innerHTML = `<h1>הגדרות</h1><div class="card" style="max-width:560px">
    <label class="f">שם לתצוגה (מופיע למטופלים בקישור)</label><input type="text" id="dn" value="${esc(PROFILE?.display_name || '')}">
    <button class="btn" id="sv" style="margin-top:1rem">שמירה</button></div>
    <div class="card" style="max-width:760px;margin-top:1rem"><h3>השאלונים בכלי</h3><table class="t">${INSTRUMENTS.map(d => `<tr><td><b>${d.name}</b></td><td class="small">${esc(d.title)}</td><td class="small muted">${d.clinician ? 'מילוי מטפל/ת' : 'דיווח עצמי'} · ${esc(d.domain)}</td></tr>`).join('')}</table></div>`;
  $('#sv').onclick = async () => { const display_name = $('#dn').value.trim(); await sb.from('profiles').upsert({ id: ME.id, display_name }); PROFILE.display_name = display_name; toast('נשמר'); };
}

// ================== MODAL ==================
function modal(html, init) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.matches('[data-close]')) closeModal(); });
  document.body.append(bg); init?.(bg);
}
function closeModal() { $('.modal-bg')?.remove(); }

boot();
