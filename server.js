// FlashStudy: servidor sin dependencias (Node >= 18). API REST + estáticos + persistencia JSON.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data'), PUB = path.join(__dirname, 'public');
const FILES = { flashcards: 'flashcards.json', sessions: 'study_sessions.json', reviews: 'review_sessions.json', failed: 'failed_questions.json' };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const db = {};
let queue = Promise.resolve();
const uid = () => crypto.randomUUID(), now = () => new Date().toISOString();
const err = (code, msg) => Object.assign(new Error(msg), { code });

// ---------- Persistencia ----------
function load() {
  fs.mkdirSync(DATA, { recursive: true });
  for (const [k, f] of Object.entries(FILES)) {
    const p = path.join(DATA, f);
    try {
      db[k] = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!Array.isArray(db[k])) throw new Error('formato inválido');
    } catch (e) {
      if (e.code !== 'ENOENT') { fs.renameSync(p, `${p}.corrupt-${Date.now()}`); console.warn(`⚠ ${f} corrupto: respaldado y recreado`); }
      db[k] = []; fs.writeFileSync(p, '[]');
    }
  }
}
// Escrituras en cola + archivo temporal con rename atómico: sin pérdidas por escritura simultánea.
const save = keys => queue = queue.then(async () => {
  for (const k of keys) {
    const p = path.join(DATA, FILES[k]), tmp = p + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(db[k], null, 2));
    await fs.promises.rename(tmp, p);
  }
}).catch(e => console.error('Error al guardar:', e));

// ---------- Validación ----------
const text = (v, max, required = true) => {
  v = String(v ?? '').trim();
  if (required && !v) throw err(400, 'Hay campos obligatorios vacíos');
  if (v.length > max) throw err(400, `Máximo ${max} caracteres`);
  return v;
};
const find = (k, id) => { const x = db[k].find(i => i.id === id); if (!x) throw err(404, 'No encontrado'); return x; };
const dupQ = (sessionId, q, exceptId) => db.flashcards.some(c => c.id !== exceptId && c.sessionId === sessionId && c.question.toLowerCase() === q.toLowerCase());

// ---------- Rutas: [método, regex, handler(body, id) => [resultado, archivosAGuardar]] ----------
const routes = [
  ['GET', /^\/api\/all$/, () => [db]],
  ['POST', /^\/api\/sessions$/, b => {
    const s = { id: uid(), name: text(b.name, 80), description: text(b.description, 300, false), createdAt: now() };
    db.sessions.push(s); return [s, ['sessions']];
  }],
  ['DELETE', /^\/api\/sessions\/([\w-]+)$/, (b, id) => {
    find('sessions', id);
    const ids = db.flashcards.filter(c => c.sessionId === id).map(c => c.id);
    db.sessions = db.sessions.filter(s => s.id !== id);
    db.flashcards = db.flashcards.filter(c => c.sessionId !== id);
    db.failed = db.failed.filter(f => !ids.includes(f.flashcardId));
    return [{ ok: true }, ['sessions', 'flashcards', 'failed']]; // el historial de repasos se conserva
  }],
  ['POST', /^\/api\/cards$/, b => {
    find('sessions', b.sessionId);
    const q = text(b.question, 500), a = text(b.answer, 1000);
    if (dupQ(b.sessionId, q)) throw err(409, 'Ya existe esa pregunta en la sesión');
    const c = { id: uid(), sessionId: b.sessionId, question: q, answer: a, createdAt: now() };
    db.flashcards.push(c); return [c, ['flashcards']];
  }],
  ['PUT', /^\/api\/cards\/([\w-]+)$/, (b, id) => {
    const c = find('flashcards', id), q = text(b.question, 500), a = text(b.answer, 1000);
    if (dupQ(c.sessionId, q, id)) throw err(409, 'Ya existe esa pregunta en la sesión');
    Object.assign(c, { question: q, answer: a, updatedAt: now() }); return [c, ['flashcards']];
  }],
  ['DELETE', /^\/api\/cards\/([\w-]+)$/, (b, id) => {
    find('flashcards', id);
    db.flashcards = db.flashcards.filter(c => c.id !== id);
    db.failed = db.failed.filter(f => f.flashcardId !== id);
    return [{ ok: true }, ['flashcards', 'failed']];
  }],
  // Guarda una sesión de repaso (type: 'study' | 'review') y actualiza el registro de fallidas.
  ['POST', /^\/api\/reviews$/, b => {
    const runId = text(b.runId, 100);
    const dup = db.reviews.find(r => r.runId === runId);
    if (dup) return [dup]; // idempotente: no se contabiliza dos veces
    if (!['study', 'review'].includes(b.type)) throw err(400, 'Tipo de repaso inválido');
    const seen = new Set(), results = [];
    for (const r of Array.isArray(b.results) ? b.results : []) { // una pregunta = un resultado por sesión
      if (seen.has(r.flashcardId) || !db.flashcards.some(c => c.id === r.flashcardId)) continue;
      seen.add(r.flashcardId); results.push({ flashcardId: r.flashcardId, correct: r.correct === true });
    }
    if (!results.length) throw err(400, 'No hay respuestas que guardar');
    const correct = results.filter(r => r.correct).length;
    const rev = {
      id: uid(), runId, sessionId: b.sessionId || null, type: b.type, date: now(), startedAt: b.startedAt || null,
      durationSec: Math.max(0, Math.round(Number(b.durationSec) || 0)),
      totalQuestions: results.length, correct, incorrect: results.length - correct, results
    };
    db.reviews.push(rev);
    for (const r of results) {
      let f = db.failed.find(x => x.flashcardId === r.flashcardId);
      if (!f && r.correct) continue;
      if (!f) db.failed.push(f = { id: uid(), flashcardId: r.flashcardId, errorCount: 0, reviewSessionIds: [], history: [], resolved: false });
      if (!r.correct) { f.errorCount++; f.reviewSessionIds.push(rev.id); } // el contador nunca baja
      f.resolved = r.correct;
      f.history.push({ reviewSessionId: rev.id, correct: r.correct, date: rev.date });
    }
    return [rev, ['reviews', 'failed']];
  }]
];

// ---------- HTTP ----------
const readBody = req => new Promise((res, rej) => {
  let d = '';
  req.on('data', c => { d += c; if (d.length > 1e6) { rej(err(413, 'Cuerpo demasiado grande')); req.destroy(); } });
  req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch { rej(err(400, 'JSON inválido')); } });
});
const send = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

load();
http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      const r = routes.find(([m, re]) => m === req.method && re.test(pathname));
      if (!r) throw err(404, 'Ruta no encontrada');
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const [result, keys] = r[2](body, pathname.match(r[1])[1]);
      if (keys) await save(keys);
      return send(res, 200, result);
    }
    const file = path.join(PUB, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
    if (!file.startsWith(PUB)) return res.writeHead(403).end();
    fs.readFile(file, (e, d) => e
      ? res.writeHead(404).end('No encontrado')
      : res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(d));
  } catch (e) { send(res, Number.isInteger(e.code) ? e.code : 500, { error: e.message }); }
}).listen(PORT, () => console.log(`FlashStudy en http://localhost:${PORT}`));
