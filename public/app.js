// FlashStudy: cliente (SPA con rutas por hash). La lógica de datos vive en el servidor.
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const date = d => new Date(d).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
const toast = m => { const t = $('#toast'); t.textContent = m; t.className = 'show'; setTimeout(() => t.className = '', 2600); };
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Error'); return d;
}

let S, run, tick, editing = null, pendingStudyId = null;
const getRun = () => { try { return JSON.parse(localStorage.getItem('fc_run')); } catch { return null; } };
const setRun = r => r ? localStorage.setItem('fc_run', JSON.stringify(r)) : localStorage.removeItem('fc_run');
const cardsOf = id => S.flashcards.filter(c => c.sessionId === id);
const cardById = id => S.flashcards.find(c => c.id === id);
const sessName = id => (S.sessions.find(s => s.id === id) || {}).name;
const isPending = c => S.failed.some(f => f.flashcardId === c.id && !f.resolved);
const runName = r => r.sessionId ? (sessName(r.sessionId) || 'Sesión eliminada') : 'Repaso de preguntas fallidas';
const stat = (n, l, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
const qa = c => `<div class="item"><div><b>${esc(c.question)}</b><p>${esc(c.answer)}</p></div></div>`;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const modal = $('#modal');
function openStudyChoice(id) {
  const ids = cardsOf(id).map(c => c.id);
  if (!ids.length) return toast('No hay preguntas para estudiar');
  pendingStudyId = id;
  modal.innerHTML = `<div class="modal" data-act="closeStudy"><div class="box"><h3>¿Cómo quieres estudiar?</h3><p>Elige el orden de las preguntas. En ambos casos se preguntarán todas.</p><div class="actions"><button class="btn ghost" data-act="closeStudy">Cancelar</button><button class="btn" data-act="beginStudy" data-order="normal">Orden normal</button><button class="btn primary" data-act="beginStudy" data-order="random">Aleatorio</button></div></div></div>`;
}
function closeStudyChoice() { pendingStudyId = null; modal.innerHTML = ''; }
function beginStudy(order) {
  const id = pendingStudyId; closeStudyChoice();
  if (!id) return;
  let ids = cardsOf(id).map(c => c.id);
  if (order === 'random') ids = shuffle(ids);
  startRun(id, 'study', ids, order);
}

// ---------- Router ----------
async function route() {
  clearInterval(tick);
  const [, page, arg] = location.hash.slice(1).split('/');
  try { S = await api('GET', '/api/all'); }
  catch (e) { app.innerHTML = `<p class="empty">No se pudo conectar con el servidor: ${esc(e.message)}</p>`; return; }
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + (page || '')));
  const views = { '': dashboard, sessions, session: () => session(arg), study, results: () => results(arg), failed };
  (views[page || ''] || dashboard)();
}
addEventListener('hashchange', route);

// ---------- Vistas ----------
function dashboard() {
  const total = S.reviews.reduce((a, r) => a + r.durationSec, 0), pend = S.failed.filter(f => !f.resolved).length, cur = getRun();
  app.innerHTML = `<h1>Dashboard</h1>
    ${cur ? `<div class="banner"><span>Tienes una sesión en curso (${cur.idx}/${cur.cardIds.length})</span><a class="btn" href="#/study">Continuar</a></div>` : ''}
    <div class="stats">${stat(S.sessions.length, 'Sesiones')}${stat(S.flashcards.length, 'Flashcards')}${stat(S.reviews.length, 'Repasos realizados')}${stat(S.failed.length, 'Preguntas fallidas')}${stat(fmt(total * 1000), 'Tiempo de estudio')}</div>
    <div class="row"><h2>Últimas sesiones</h2><a class="btn" href="#/failed">Preguntas fallidas (${pend} pendientes)</a></div>
    ${S.reviews.slice(-5).reverse().map(r => `<a class="item" href="#/results/${r.id}"><span>${r.type === 'review' ? '🔁' : '📖'} ${esc(runName(r))}</span><small>${r.correct}/${r.totalQuestions} · ${fmt(r.durationSec * 1000)} · ${date(r.date)}</small></a>`).join('') || '<p class="empty">Aún no has realizado sesiones.</p>'}`;
}

function sessions() {
  app.innerHTML = `<h1>Sesiones</h1>
    <form class="panel" data-form="session"><input name="name" placeholder="Nombre de la sesión" maxlength="80" required><input name="description" placeholder="Descripción (opcional)" maxlength="300"><button class="btn primary">Crear sesión</button></form>
    <input id="q" class="search" type="search" placeholder="🔍 Buscar sesiones por nombre"><div id="list" class="grid"></div>`;
  drawList();
}
function drawList() {
  const q = $('#q').value.trim().toLowerCase(), l = S.sessions.filter(s => s.name.toLowerCase().includes(q));
  $('#list').innerHTML = l.map(s => `<article class="card sess"><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><small>${cardsOf(s.id).length} preguntas · ${date(s.createdAt)}</small>
    <div class="actions"><a class="btn" href="#/session/${s.id}">Abrir</a><button class="btn primary" data-act="study" data-id="${s.id}">Estudiar</button><button class="btn ghost" data-act="delSession" data-id="${s.id}" title="Eliminar">🗑</button></div></article>`).join('') || '<p class="empty">No hay sesiones.</p>';
}

function session(id) {
  const s = S.sessions.find(x => x.id === id); if (!s) { location.hash = '#/sessions'; return; }
  editing = null;
  const cs = cardsOf(id), pend = cs.filter(isPending);
  app.innerHTML = `<a href="#/sessions" class="link">← Sesiones</a><h1>${esc(s.name)}</h1><p>${esc(s.description)}</p>
    <div class="actions"><button class="btn primary" data-act="study" data-id="${id}">Estudiar (${cs.length})</button><button class="btn" data-act="reviewSess" data-id="${id}" ${pend.length ? '' : 'disabled'}>Repasar fallidas (${pend.length})</button></div>
    <form class="panel" id="cardForm" data-form="card" data-session="${id}"><textarea name="question" placeholder="Pregunta" maxlength="500" required></textarea><textarea name="answer" placeholder="Respuesta" maxlength="1000" required></textarea>
      <div class="actions"><button class="btn primary" id="save">Agregar flashcard</button><button type="button" class="btn ghost" id="cancel" data-act="cancel" hidden>Cancelar</button></div></form>
    ${cs.map(c => `<div class="item"><div><b>${esc(c.question)}</b><p>${esc(c.answer)}</p></div><div class="actions"><button class="btn" data-act="editCard" data-id="${c.id}">Editar</button><button class="btn ghost" data-act="delCard" data-id="${c.id}" title="Eliminar">🗑</button></div></div>`).join('') || '<p class="empty">Sin flashcards todavía.</p>'}`;
}

function study() {
  run = getRun(); if (!run) { location.hash = '#/'; return; }
  drawStudy();
  tick = setInterval(() => { const t = $('#timer'); if (t) t.textContent = fmt(Date.now() - run.startedAt); }, 500); // tiempo real = ahora - inicio
}
function drawStudy() {
  if (run.idx >= run.cardIds.length) return finish(run);
  const c = cardById(run.cardIds[run.idx]);
  if (!c) { run.idx++; setRun(run); return drawStudy(); } // tarjeta eliminada: se omite
  const mode = run.type === 'study' ? (run.order === 'random' ? ' · Aleatorio' : ' · Orden normal') : '';
  app.innerHTML = `<section class="study"><div class="bar"><div style="width:${run.idx / run.cardIds.length * 100}%"></div></div>
    <div class="meta"><span>${run.type === 'review' ? '🔁 Repaso' : '📖 Estudio'}${mode} · Pregunta ${run.idx + 1} de ${run.cardIds.length}</span><span id="timer" class="timer">${fmt(Date.now() - run.startedAt)}</span></div>
    <div class="card flip"><small>Pregunta</small><h2>${esc(c.question)}</h2>${run.revealed ? `<hr><small>Respuesta</small><p class="ans">${esc(c.answer)}</p>` : ''}</div>
    <div class="actions">${run.revealed
      ? `<button class="btn ok" data-act="ok" data-id="${c.id}">✔ Correcto</button><button class="btn ko" data-act="ko" data-id="${c.id}">✘ Incorrecto</button>`
      : '<button class="btn primary" data-act="reveal">Mostrar respuesta</button>'}</div>
    <div class="actions"><button class="link" data-act="finish">Finalizar ahora</button></div></section>`;
}
function answer(id, correct) {
  if (id !== run.cardIds[run.idx] || run.results.some(r => r.flashcardId === id)) return; // una sola vez por pregunta
  run.results.push({ flashcardId: id, correct }); run.idx++; run.revealed = false; setRun(run); drawStudy();
}
async function finish(r) {
  clearInterval(tick);
  if (!r.results.length) { setRun(null); location.hash = '#/'; return; }
  app.innerHTML = '<p class="empty">Guardando resultados…</p>';
  try {
    const rev = await api('POST', '/api/reviews', { runId: r.runId, sessionId: r.sessionId, type: r.type, startedAt: new Date(r.startedAt).toISOString(), durationSec: Math.round((Date.now() - r.startedAt) / 1000), results: r.results });
    setRun(null); location.hash = '#/results/' + rev.id;
  } catch (e) { toast(e.message); }
}
function startRun(sessionId, type, cardIds, order) {
  if (!cardIds.length) return toast('No hay preguntas para estudiar');
  if (getRun() && !confirm('Hay una sesión en curso. ¿Descartarla e iniciar una nueva?')) return;
  setRun({ runId: crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random(), sessionId, type, order: order || 'normal', cardIds, idx: 0, results: [], revealed: false, startedAt: Date.now() });
  location.hash = '#/study';
}

function results(id) {
  const r = S.reviews.find(x => x.id === id); if (!r) { location.hash = '#/'; return; }
  const bad = r.results.filter(x => !x.correct).map(x => cardById(x.flashcardId)).filter(Boolean);
  app.innerHTML = `<h1>${r.type === 'review' ? '🔁' : '📖'} ${esc(runName(r))}</h1><p><span class="badge">${r.type === 'review' ? 'Repaso' : 'Sesión de estudio'}</span> <small>${date(r.date)}</small></p>
    <div class="stats">${stat(r.totalQuestions, 'Respondidas')}${stat(r.correct, 'Correctas', 'ok')}${stat(r.incorrect, 'Incorrectas', 'ko')}${stat(Math.round(r.correct / r.totalQuestions * 100) + '%', 'Aciertos')}${stat(fmt(r.durationSec * 1000), 'Tiempo total')}</div>
    <div class="actions"><a class="btn" href="#/">Menú principal</a><button class="btn primary" data-act="retry" data-id="${r.id}" ${bad.length ? '' : 'disabled'}>Repasar fallidas (${bad.length})</button></div>
    <h2>Preguntas incorrectas</h2>${bad.map(qa).join('') || '<p class="empty">¡Sin errores! 🎉</p>'}`;
}

function failed() {
  const rows = [...S.failed].sort((a, b) => b.errorCount - a.errorCount).filter(f => cardById(f.flashcardId)), pend = rows.filter(f => !f.resolved).length;
  app.innerHTML = `<div class="row"><h1>Preguntas fallidas</h1><button class="btn primary" data-act="reviewFailed" ${pend ? '' : 'disabled'}>Repasar pendientes (${pend})</button></div>
    ${rows.map(f => { const c = cardById(f.flashcardId); return `<div class="item"><div><b>${esc(c.question)}</b><p>${esc(c.answer)}</p><small>${esc(sessName(c.sessionId))} · Historial: ${f.history.map(h => h.correct ? '✔' : '✘').join(' ')}</small></div>
      <div class="side"><span class="badge ${f.resolved ? 'okb' : 'kob'}">${f.resolved ? 'Resuelta' : 'Pendiente'}</span><b>${f.errorCount} ${f.errorCount === 1 ? 'error' : 'errores'}</b></div></div>`; }).join('') || '<p class="empty">No hay preguntas fallidas.</p>'}`;
}

// ---------- Acciones y formularios (delegación de eventos) ----------
const acts = {
  async delSession(id) { if (!confirm('¿Eliminar la sesión y todas sus flashcards?')) return; await api('DELETE', '/api/sessions/' + id); toast('Sesión eliminada'); route(); },
  async delCard(id) { if (!confirm('¿Eliminar esta flashcard?')) return; await api('DELETE', '/api/cards/' + id); route(); },
  editCard(id) {
    const c = cardById(id), f = $('#cardForm'); editing = id;
    f.elements.question.value = c.question; f.elements.answer.value = c.answer;
    $('#save').textContent = 'Guardar cambios'; $('#cancel').hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  },
  cancel() { editing = null; $('#cardForm').reset(); $('#save').textContent = 'Agregar flashcard'; $('#cancel').hidden = true; },
  study: id => openStudyChoice(id),
  reviewSess: id => startRun(id, 'review', cardsOf(id).filter(isPending).map(c => c.id)),
  reviewFailed: () => startRun(null, 'review', S.failed.filter(f => !f.resolved && cardById(f.flashcardId)).map(f => f.flashcardId)),
  retry(id) { const r = S.reviews.find(x => x.id === id); startRun(r.sessionId, 'review', r.results.filter(x => !x.correct && cardById(x.flashcardId)).map(x => x.flashcardId)); },
  reveal() { run.revealed = true; setRun(run); drawStudy(); },
  ok: id => answer(id, true),
  ko: id => answer(id, false),
  finish: () => finish(run)
};
const forms = {
  async session(f) {
    await api('POST', '/api/sessions', { name: f.elements.name.value, description: f.elements.description.value });
    toast('Sesión creada'); route();
  },
  async card(f) {
    const body = { question: f.elements.question.value, answer: f.elements.answer.value, sessionId: f.dataset.session };
    if (!body.question.trim() || !body.answer.trim()) throw new Error('Completa la pregunta y la respuesta');
    const wasEditing = editing;
    wasEditing ? await api('PUT', '/api/cards/' + wasEditing, body) : await api('POST', '/api/cards', body);
    toast(wasEditing ? 'Flashcard actualizada' : 'Flashcard agregada'); route();
  }
};
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  try {
    if (act === 'closeStudy') { if (b.classList.contains('modal') && e.target !== b) return; return closeStudyChoice(); }
    if (act === 'beginStudy') return beginStudy(b.dataset.order);
    if (acts[act]) await acts[act](b.dataset.id);
  } catch (x) { toast(x.message); }
});
app.addEventListener('submit', async e => {
  e.preventDefault();
  try { await forms[e.target.dataset.form]?.(e.target); } catch (x) { toast(x.message); }
});
app.addEventListener('input', e => { if (e.target.id === 'q') drawList(); });

// ---------- Tema claro/oscuro ----------
const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('fc_theme', t); };
setTheme(localStorage.getItem('fc_theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
$('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

route();
