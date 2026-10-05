'use strict';
/* ===== Mozaik – block puzzle (vanilla JS + Canvas) ===== */

const N = 8;                                   // grid size (8x8)
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
// Shapes: m = matrix, w = spawn weight (small pieces appear more often)
const SHAPES = [
  { m: [[1]], w: 3 },
  { m: [[1, 1]], w: 3 }, { m: [[1], [1]], w: 3 },
  { m: [[1, 1, 1]], w: 3 }, { m: [[1], [1], [1]], w: 3 },
  { m: [[1, 1, 1, 1]], w: 2 }, { m: [[1], [1], [1], [1]], w: 2 },
  { m: [[1, 1], [1, 1]], w: 3 },
  { m: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], w: 1 },
  // L shapes
  { m: [[1, 0], [1, 0], [1, 1]], w: 2 }, { m: [[0, 1], [0, 1], [1, 1]], w: 2 },
  { m: [[1, 1], [1, 0], [1, 0]], w: 2 }, { m: [[1, 1], [0, 1], [0, 1]], w: 2 },
  // T shapes
  { m: [[1, 1, 1], [0, 1, 0]], w: 2 }, { m: [[0, 1, 0], [1, 1, 1]], w: 2 },
  { m: [[1, 0], [1, 1], [1, 0]], w: 2 }, { m: [[0, 1], [1, 1], [0, 1]], w: 2 },
  // Z / S shapes
  { m: [[1, 1, 0], [0, 1, 1]], w: 2 }, { m: [[0, 1, 1], [1, 1, 0]], w: 2 },
  { m: [[0, 1], [1, 1], [1, 0]], w: 2 }, { m: [[1, 0], [1, 1], [0, 1]], w: 2 },
];

/* ---------- State ---------- */
let board, pieces, score, best, streak, over, selected, hover, drag;
let fx = [];                                   // clear animations
let shownScore = 0, cell = 40, dpr = 1;
let soundOn = localStorage.getItem('mozaik-sound') !== 'off';
try { best = +localStorage.getItem('mozaik-best') || 0; } catch (e) { best = 0; }

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const cvs = $('board'), ctx = cvs.getContext('2d');
const slots = [...document.querySelectorAll('.slot')];
const scoreEl = $('score'), bestEl = $('best'), popup = $('popup');

/* ---------- Audio (Web Audio API, no files) ---------- */
let actx = null;
function tone(f, dur = .12, type = 'sine', vol = .15, delay = 0, slide = 0) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  place: () => tone(260, .12, 'triangle', .2, 0, 150),
  clear: n => [0, 1, 2, 3].slice(0, 2 + Math.min(n, 2)).forEach(i => tone(440 * Math.pow(1.26, i), .18, 'sine', .15, i * .07)),
  combo: s => [0, 1, 2].forEach(i => tone(520 * Math.pow(1.2, i + s), .16, 'square', .08, .15 + i * .07)),
  over: () => [0, 1, 2, 3].forEach(i => tone(380 - i * 60, .3, 'sawtooth', .1, i * .18)),
};

/* ---------- Setup ---------- */
function createBoard() {
  return Array.from({ length: N }, () => Array(N).fill(null));   // null | {color, t}
}

function pickShape() {
  const total = SHAPES.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SHAPES.length; i++) { r -= SHAPES[i].w; if (r <= 0) return i; }
  return 0;
}

function canPlace(m, r, c) {
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m[0].length; x++)
      if (m[y][x]) {
        const R = r + y, C = c + x;
        if (R < 0 || C < 0 || R >= N || C >= N || board[R][C]) return false;
      }
  return true;
}
function fitsAnywhere(m) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (canPlace(m, r, c)) return true;
  return false;
}

// Fair generation: at least one of the three pieces must always fit
function generatePieces() {
  let set;
  for (let tries = 0; tries < 50; tries++) {
    set = [0, 1, 2].map(() => { const i = pickShape(); return { m: SHAPES[i].m, color: i % COLORS.length }; });
    if (set.some(p => fitsAnywhere(p.m))) break;
  }
  pieces = set;
  slots.forEach(s => { s.classList.remove('reveal'); void s.offsetWidth; s.classList.add('reveal'); });
}

/* ---------- Rendering ---------- */
function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// One rounded, glossy cell
function drawCell(c, x, y, s, color, scale = 1, alpha = 1) {
  const p = s * .05, sz = (s - p * 2) * scale, o = (s - sz) / 2;
  c.globalAlpha = alpha;
  const g = c.createLinearGradient(0, y, 0, y + s);
  g.addColorStop(0, '#ffffffaa'); g.addColorStop(.25, color); g.addColorStop(1, color);
  c.fillStyle = color; rr(c, x + o, y + o, sz, sz, s * .22); c.fill();
  c.fillStyle = g; c.globalAlpha = alpha * .55; c.fill();
  c.globalAlpha = 1;
}

function drawBoard(now = performance.now()) {
  const W = cvs.width / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, W);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    ctx.fillStyle = '#2f2352'; rr(ctx, c * cell + 2, r * cell + 2, cell - 4, cell - 4, cell * .2); ctx.fill();
  }
  // Placement preview (soft ghost)
  const pv = hover && currentPiece();
  if (pv && hover.valid) {
    pv.m.forEach((row, y) => row.forEach((v, x) => v && drawCell(ctx, (hover.c + x) * cell, (hover.r + y) * cell, cell, COLORS[pv.color], 1, .4)));
  }
  // Filled cells (with bounce on placement)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const b = board[r][c]; if (!b) continue;
    const p = Math.min((now - b.t) / 260, 1);
    drawCell(ctx, c * cell, r * cell, cell, b.color, 1 + .18 * Math.sin(Math.PI * p) * (1 - p));
  }
  // Clearing animation: pop up then shrink and fade
  fx = fx.filter(f => now - f.t0 < 420);
  fx.forEach(f => {
    const p = Math.max(0, (now - f.t0) / 420);
    if (p <= 0) return drawCell(ctx, f.c * cell, f.r * cell, cell, f.color);
    drawCell(ctx, f.c * cell, f.r * cell, cell, f.color, p < .3 ? 1 + p : 1.3 * (1 - (p - .3) / .7), 1 - p * p);
  });
}

function drawPieces() {
  slots.forEach((s, i) => {
    const cv = s.firstElementChild, w = s.clientWidth, c = cv.getContext('2d');
    cv.width = w * dpr; cv.height = w * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = pieces[i]; if (!p) return;
    const cs = w / 5, ox = (w - p.m[0].length * cs) / 2, oy = (w - p.m.length * cs) / 2;
    const ok = fitsAnywhere(p.m);
    p.m.forEach((row, y) => row.forEach((v, x) => v && drawCell(c, ox + x * cs, oy + y * cs, cs, COLORS[p.color], 1, ok ? 1 : .35)));
    s.classList.toggle('sel', selected === i);
  });
}

function currentPiece() { const i = drag ? drag.i : selected; return i != null ? pieces[i] : null; }

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cvs.clientWidth;
  cvs.width = w * dpr; cvs.height = w * dpr; cell = w / N;
  drawPieces(); drawBoard();
}

function updateHUD() {
  scoreEl.textContent = Math.round(shownScore); bestEl.textContent = best;
  $('btnSound').textContent = soundOn ? '🔊' : '🔇';
}
function loop(now) {                           // light rAF loop
  if (shownScore !== score) {
    shownScore += (score - shownScore) * .2;
    if (Math.abs(score - shownScore) < 1) shownScore = score;
    updateHUD();
  }
  drawBoard(now); requestAnimationFrame(loop);
}

/* ---------- Game logic ---------- */
function placePiece(i, r, c) {
  const p = pieces[i], now = performance.now(); let n = 0;
  p.m.forEach((row, y) => row.forEach((v, x) => { if (v) { board[r + y][c + x] = { color: COLORS[p.color], t: now }; n++; } }));
  pieces[i] = null; selected = null; hover = null;
  sfx.place();
  const gained = calculateScore(n, clearLines(checkLines()));
  addScore(gained);
  if (pieces.every(x => !x)) generatePieces();
  drawPieces();
  if (checkGameOver()) setTimeout(showGameOver, 600);
}

// Returns lists of full rows and columns
function checkLines() {
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) {
    if (board[i].every(Boolean)) rows.push(i);
    if (board.every(row => row[i])) cols.push(i);
  }
  return { rows, cols, count: rows.length + cols.length };
}

function clearLines(L) {
  if (!L.count) return L;
  const now = performance.now(), set = new Map();
  L.rows.forEach(r => { for (let c = 0; c < N; c++) set.set(r * N + c, [r, c]); });
  L.cols.forEach(c => { for (let r = 0; r < N; r++) set.set(r * N + c, [r, c]); });
  let k = 0;
  set.forEach(([r, c]) => { fx.push({ r, c, color: board[r][c].color, t0: now + (k++ % N) * 18 }); });
  set.forEach(([r, c]) => { board[r][c] = null; });   // clear after copying to fx
  return L;
}

// Placement points + line points with multi-line bonus and combo multiplier
function calculateScore(cells, L) {
  let pts = cells;
  if (L.count) {
    streak++;
    const base = L.count * 10 + (L.count - 1) * L.count * 5;     // 10, 30, 60, 100...
    pts += base * streak;
    sfx.clear(L.count);
    if (streak > 1) sfx.combo(streak);
    showPopup(L.count > 1 ? `${L.count} LINES!` : '', streak > 1 ? `COMBO x${streak}` : `+${base}`);
  } else streak = 0;
  return pts;
}
function addScore(p) {
  score += p;
  if (score > best) { best = score; try { localStorage.setItem('mozaik-best', best); } catch (e) {} }
  scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump');
  updateHUD();
}
function showPopup(a, b) {
  popup.innerHTML = (a ? a + '<br>' : '') + `<small>${b}</small>`;
  popup.classList.remove('show'); void popup.offsetWidth; popup.classList.add('show');
}

function checkGameOver() {
  over = !pieces.some(p => p && fitsAnywhere(p.m));
  return over;
}
function showGameOver() {
  sfx.over();
  $('finalScore').textContent = score; $('finalBest').textContent = best;
  $('over').classList.remove('hidden');
}
function restartGame() {
  board = createBoard(); score = 0; shownScore = 0; streak = 0; over = false;
  selected = null; hover = null; drag = null; fx = [];
  $('over').classList.add('hidden');
  generatePieces(); updateHUD(); drawPieces();
}

/* ---------- Input: drag & drop + tap-to-place (mouse and touch) ---------- */
function targetFromPoint(left, top) {          // top-left of piece in screen px -> grid cell
  const rect = cvs.getBoundingClientRect();
  return { r: Math.round((top - rect.top) / cell), c: Math.round((left - rect.left) / cell) };
}
function setHover(r, c) {
  const p = currentPiece();
  hover = p ? { r, c, valid: canPlace(p.m, r, c) } : null;
}

slots.forEach((s, i) => s.addEventListener('pointerdown', e => {
  if (over || !pieces[i]) return;
  e.preventDefault();
  drag = { i, sx: e.clientX, sy: e.clientY, moved: false, el: null, id: e.pointerId };
}));

window.addEventListener('pointermove', e => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) {
      drag.moved = true;
      const p = pieces[drag.i], f = document.createElement('canvas');
      f.width = p.m[0].length * cell * dpr; f.height = p.m.length * cell * dpr;
      f.style.width = f.width / dpr + 'px'; f.style.height = f.height / dpr + 'px'; f.className = 'float';
      const c = f.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      p.m.forEach((row, y) => row.forEach((v, x) => v && drawCell(c, x * cell, y * cell, cell, COLORS[p.color])));
      document.body.appendChild(f); drag.el = f; slots[drag.i].classList.add('drag');
    }
    if (drag.moved) {
      const w = drag.el.width / dpr, h = drag.el.height / dpr;
      const lift = e.pointerType === 'touch' ? cell * 1.8 : cell * .5;   // keep finger from covering the piece
      const left = e.clientX - w / 2, top = e.clientY - h / 2 - lift;
      drag.el.style.transform = `translate(${left}px,${top}px) scale(1.05)`;
      const t = targetFromPoint(left, top); setHover(t.r, t.c);
    }
  } else if (selected != null && e.pointerType === 'mouse') {          // hover preview for tap mode
    hoverAtPointer(e);
  }
});

function hoverAtPointer(e) {
  const rect = cvs.getBoundingClientRect(), p = currentPiece();
  if (!p) return;
  const c = Math.floor((e.clientX - rect.left) / cell) - Math.floor(p.m[0].length / 2);
  const r = Math.floor((e.clientY - rect.top) / cell) - Math.floor(p.m.length / 2);
  setHover(r, c);
}

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  slots[d.i].classList.remove('drag');
  if (d.el) d.el.remove();
  if (d.moved) {
    if (hover && hover.valid) placePiece(d.i, hover.r, hover.c);
    hover = null;
  } else {                                      // a simple tap selects / deselects
    selected = selected === d.i ? null : d.i; hover = null; drawPieces();
  }
});
window.addEventListener('pointercancel', () => {
  if (drag) { slots[drag.i].classList.remove('drag'); drag.el && drag.el.remove(); drag = null; hover = null; }
});

// Tap-to-place on the board
cvs.addEventListener('pointerdown', e => {
  if (over || selected == null) return;
  hoverAtPointer(e);
  if (hover && hover.valid) placePiece(selected, hover.r, hover.c);
});
cvs.addEventListener('pointerleave', () => { if (!drag) hover = null; });

/* ---------- Buttons ---------- */
$('btnNew').onclick = restartGame;
$('btnRestart').onclick = restartGame;
$('btnSound').onclick = () => {
  soundOn = !soundOn; localStorage.setItem('mozaik-sound', soundOn ? 'on' : 'off');
  updateHUD(); tone(500, .1);
};
window.addEventListener('resize', resize);

/* ---------- Start ---------- */
restartGame(); resize(); requestAnimationFrame(loop);
