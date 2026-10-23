const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ELEMENTS = [
  { name: 'Ember', color: '#ff6b35', glow: 'rgba(255,107,53,0.35)', glyph: '🔥' },
  { name: 'Tide', color: '#35c7ff', glow: 'rgba(53,199,255,0.35)', glyph: '💧' },
  { name: 'Stone', color: '#b8c0cc', glow: 'rgba(184,192,204,0.35)', glyph: '🪨' },
  { name: 'Zephyr', color: '#a7ff83', glow: 'rgba(167,255,131,0.35)', glyph: '🌬️' }
];

let dpr = Math.max(1, window.devicePixelRatio || 1);
let width = 0, height = 0, cx = 0, cy = 0, arena = 0;

function resize() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = width / 2;
  cy = height / 2;
  arena = Math.min(width, height) * 0.42;
}
resize();
window.addEventListener('resize', resize);

// State
let state = 'title'; // title | playing | paused | gameover
let time = 0;
let score = 0;
let best = Number(localStorage.getItem('elementPebbleBest') || 0);
let lives = 3;
let combo = 0;
let charge = 0;
let shake = 0;
let muted = false;
let spawnTimer = 0;
let invuln = 0;

const player = { x: 0, y: 0, vx: 0, vy: 0, r: 18, element: 0, trail: [] };
const hazards = [];
const particles = [];
const stars = Array.from({ length: 140 }, () => ({
  x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.3, p: Math.random() * Math.PI * 2
}));

const keys = new Set();
const pointer = { down: false, x: 0, y: 0 };

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
  }
}
function tone(freq, dur = 0.08, type = 'sine', gain = 0.05) {
  if (muted || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

// Input
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === 'title' || state === 'gameover') startGame();
    else if (state === 'playing') pulse();
    return;
  }
  if (e.code === 'Enter') {
    if (state === 'title' || state === 'gameover') startGame();
    return;
  }
  if (e.code === 'KeyP') {
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
    syncOverlays();
    return;
  }
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (e.code === 'Digit1') setElement(0);
  if (e.code === 'Digit2') setElement(1);
  if (e.code === 'Digit3') setElement(2);
  if (e.code === 'Digit4') setElement(3);
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  const p = toCanvas(e);
  pointer.down = true;
  pointer.x = p.x; pointer.y = p.y;
  if (state === 'title' || state === 'gameover') startGame();
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointer.down) return;
  const p = toCanvas(e);
  pointer.x = p.x; pointer.y = p.y;
});
window.addEventListener('pointerup', () => { pointer.down = false; });

function toCanvas(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
}

document.querySelectorAll('.element-buttons button').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    setElement(Number(btn.dataset.el));
  });
});

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', () => { state = 'playing'; syncOverlays(); });

function setElement(i) {
  if (i < 0 || i > 3) return;
  player.element = i;
  updateHUD();
  tone(220 + i * 80, 0.06, 'triangle', 0.04);
}

function syncOverlays() {
  document.getElementById('title').classList.toggle('hidden', state !== 'title');
  document.getElementById('gameover').classList.toggle('hidden', state !== 'gameover');
  document.getElementById('paused').classList.toggle('hidden', state !== 'paused');
  document.getElementById('hud').classList.toggle('hidden', state !== 'playing' && state !== 'paused');
  document.getElementById('touchControls').classList.toggle('hidden', state !== 'playing' && state !== 'paused');
}

function resetGame() {
  time = 0;
  score = 0;
  lives = 3;
  combo = 0;
  charge = 0;
  shake = 0;
  invuln = 0;
  hazards.length = 0;
  particles.length = 0;
  player.x = cx; player.y = cy; player.vx = 0; player.vy = 0; player.trail = []; player.element = 0;
  pointer.down = false;
  spawnTimer = 1.0;
}
function startGame() {
  ensureAudio();
  resetGame();
  state = 'playing';
  syncOverlays();
  updateHUD();
}

function spawnHazard() {
  const ang = Math.random() * Math.PI * 2;
  const spawnR = arena + 60;
  const x = cx + Math.cos(ang) * spawnR;
  const y = cy + Math.sin(ang) * spawnR;
  const toCx = cx - x, toCy = cy - y;
  const d = Math.hypot(toCx, toCy) || 1;
  const speed = 110 + time * 2.2 + Math.random() * 40;
  const side = (Math.random() - 0.5) * 0.7;
  const px = -toCy / d, py = toCx / d;
  hazards.push({
    x, y,
    vx: (toCx / d) * speed + px * side * 40,
    vy: (toCy / d) * speed + py * side * 40,
    r: 10 + Math.random() * 6,
    element: Math.floor(Math.random() * 4),
    trail: []
  });
  if (hazards.length > 50) hazards.shift();
}

function pulse() {
  if (charge < 100) return;
  charge = 0;
  let cleared = 0;
  for (let i = hazards.length - 1; i >= 0; i--) {
    if (hazards[i].element === player.element) {
      const h = hazards.splice(i, 1)[0];
      burst(h.x, h.y, ELEMENTS[h.element].color, 18);
      score += 25 + combo * 2;
      cleared++;
    }
  }
  combo += cleared;
  shake = Math.min(12, shake + 6);
  tone(180, 0.2, 'sawtooth', 0.06);
  tone(360, 0.25, 'triangle', 0.05);
  updateHUD();
}

function burst(x, y, color, n = 12) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 140;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, max: 0.9, color, size: 1.5 + Math.random() * 3, drag: 0.92 });
  }
}

function damage() {
  if (invuln > 0) return;
  lives--;
  combo = 0;
  charge = Math.max(0, charge - 25);
  invuln = 1.15;
  shake = 14;
  const a = Math.atan2(player.y - cy, player.x - cx);
  player.vx -= Math.cos(a) * 220;
  player.vy -= Math.sin(a) * 220;
  burst(player.x, player.y, '#ff4d6d', 24);
  tone(90, 0.18, 'square', 0.07);
  if (lives <= 0) {
    state = 'gameover';
    if (score > best) { best = score; localStorage.setItem('elementPebbleBest', best); }
    document.getElementById('finalScore').textContent = score;
    document.getElementById('finalBest').textContent = best;
    syncOverlays();
  }
  updateHUD();
}

function update(dt) {
  if (state !== 'playing') return;
  time += dt;

  // difficulty
  const spawnInterval = Math.max(0.32, 1.15 - time * 0.009);
  spawnTimer -= dt;
  if (spawnTimer <= 0) { spawnHazard(); spawnTimer = spawnInterval * (0.7 + Math.random() * 0.6); }

  // player movement
  let ax = 0, ay = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) ax -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) ax += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) ay -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) ay += 1;
  const kl = Math.hypot(ax, ay);
  if (kl > 0) { ax /= kl; ay /= kl; }
  if (pointer.down) {
    const dx = pointer.x - player.x, dy = pointer.y - player.y;
    const dl = Math.hypot(dx, dy);
    if (dl > 6) { ax += dx / dl * 0.9; ay += dy / dl * 0.9; }
  }
  const al = Math.hypot(ax, ay);
  if (al > 1) { ax /= al; ay /= al; }
  const accel = 900;
  player.vx += ax * accel * dt;
  player.vy += ay * accel * dt;
  const friction = Math.pow(0.001, dt);
  player.vx *= friction;
  player.vy *= friction;
  const speed = Math.hypot(player.vx, player.vy);
  const maxSpeed = 300;
  if (speed > maxSpeed) { player.vx = player.vx / speed * maxSpeed; player.vy = player.vy / speed * maxSpeed; }
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // boundary
  const dx = player.x - cx, dy = player.y - cy;
  const dist = Math.hypot(dx, dy);
  const limit = arena - player.r;
  if (dist > limit) {
    const nx = dx / (dist || 1), ny = dy / (dist || 1);
    player.x = cx + nx * limit;
    player.y = cy + ny * limit;
    const dot = player.vx * nx + player.vy * ny;
    if (dot > 0) { player.vx -= 2 * dot * nx * 0.6; player.vy -= 2 * dot * ny * 0.6; }
  }

  player.trail.push({ x: player.x, y: player.y });
  if (player.trail.length > 18) player.trail.shift();

  // hazards
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.trail.push({ x: h.x, y: h.y });
    if (h.trail.length > 10) h.trail.shift();
    const hd = Math.hypot(h.x - cx, h.y - cy);
    if (hd > arena + 140) { hazards.splice(i, 1); continue; }
    const pd = Math.hypot(h.x - player.x, h.y - player.y);
    if (pd < h.r + player.r) {
      if (h.element === player.element) {
        hazards.splice(i, 1);
        combo++;
        score += 10 + Math.min(combo, 20);
        charge = Math.min(100, charge + 6 + Math.min(combo, 10) * 0.4);
        burst(h.x, h.y, ELEMENTS[h.element].color, 14);
        tone(330 + h.element * 90, 0.07, 'sine', 0.05);
        if (charge >= 100 && !window._chargedNotified) { window._chargedNotified = true; }
      } else {
        hazards.splice(i, 1);
        damage();
      }
    }
  }
  if (charge < 100) window._chargedNotified = false;

  // invuln
  if (invuln > 0) invuln -= dt;

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.vy += 30 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (particles.length > 900) particles.splice(0, particles.length - 900);

  // shake decay
  shake = Math.max(0, shake - dt * 18);

  updateHUD();
}

function updateHUD() {
  document.getElementById('score').textContent = score;
  document.getElementById('best').textContent = best;
  document.getElementById('lives').textContent = '❤'.repeat(Math.max(0, lives));
  document.getElementById('charge').style.width = charge + '%';
  document.getElementById('combo').textContent = combo;
  document.getElementById('ready').classList.toggle('hidden', charge < 100);
  document.getElementById('elementName').textContent = ELEMENTS[player.element].name;
  document.getElementById('elementGlyph').textContent = ELEMENTS[player.element].glyph;
}

function draw() {
  ctx.save();
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;
  ctx.translate(sx, sy);

  // background
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height));
  g.addColorStop(0, '#0b1230');
  g.addColorStop(0.5, '#06091c');
  g.addColorStop(1, '#02030a');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, width + 40, height + 40);

  // nebula blobs
  const t = time;
  const blobs = [
    { x: cx + Math.cos(t * 0.12) * arena * 0.5, y: cy + Math.sin(t * 0.09) * arena * 0.4, r: arena * 1.1, c: 'rgba(80,120,255,0.08)' },
    { x: cx + Math.cos(t * 0.07 + 2) * arena * 0.6, y: cy + Math.sin(t * 0.11 + 1) * arena * 0.5, r: arena * 0.9, c: 'rgba(255,100,180,0.06)' },
    { x: cx + Math.cos(t * 0.15 + 4) * arena * 0.4, y: cy + Math.sin(t * 0.08 + 3) * arena * 0.6, r: arena * 1.0, c: 'rgba(100,255,200,0.05)' }
  ];
  blobs.forEach(b => {
    const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    rg.addColorStop(0, b.c);
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, width, height);
  });

  // stars
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  stars.forEach(s => {
    const tw = 0.5 + 0.5 * Math.sin(t * 1.3 + s.p);
    ctx.globalAlpha = 0.2 + tw * 0.8;
    ctx.beginPath();
    ctx.arc(s.x * width, s.y * height, s.s * tw, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // arena ring
  ctx.strokeStyle = 'rgba(122,167,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, arena, 0, Math.PI * 2);
  ctx.stroke();
  const ringGrad = ctx.createRadialGradient(cx, cy, arena - 8, cx, cy, arena + 8);
  ringGrad.addColorStop(0, 'transparent');
  ringGrad.addColorStop(0.5, 'rgba(122,167,255,0.18)');
  ringGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, arena + 8, 0, Math.PI * 2);
  ctx.arc(cx, cy, arena - 8, 0, Math.PI * 2, true);
  ctx.fill();

  // hazards trails
  hazards.forEach(h => {
    const col = ELEMENTS[h.element].color;
    for (let i = 1; i < h.trail.length; i++) {
      const a = i / h.trail.length;
      ctx.strokeStyle = col;
      ctx.globalAlpha = a * 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(h.trail[i - 1].x, h.trail[i - 1].y);
      ctx.lineTo(h.trail[i].x, h.trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const hg = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r * 2.2);
    hg.addColorStop(0, ELEMENTS[h.element].glow.replace('0.35', '0.9'));
    hg.addColorStop(1, 'transparent');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(h.x - h.r * 0.25, h.y - h.r * 0.25, h.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // player trail
  const pc = ELEMENTS[player.element].color;
  for (let i = 1; i < player.trail.length; i++) {
    const a = i / player.trail.length;
    ctx.strokeStyle = pc;
    ctx.globalAlpha = a * 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.trail[i - 1].x, player.trail[i - 1].y);
    ctx.lineTo(player.trail[i].x, player.trail[i].y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // player glow
  const pg = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, player.r * 3.2);
  pg.addColorStop(0, ELEMENTS[player.element].glow.replace('0.35', '0.95'));
  pg.addColorStop(1, 'transparent');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  // invuln ring
  if (invuln > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // player core
  const core = ctx.createRadialGradient(player.x - player.r * 0.3, player.y - player.r * 0.3, 2, player.x, player.y, player.r);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.4, pc);
  core.addColorStop(1, ELEMENTS[player.element].glow.replace('0.35', '0.8'));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
  ctx.fill();

  // rotating ring
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r + 5, t * 2, t * 2 + Math.PI * 1.2);
  ctx.stroke();

  // particles
  particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  ctx.restore();
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (state === 'playing') update(dt);
  else time += dt * 0.2;
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Initial
best = Number(localStorage.getItem('elementPebbleBest') || 0);
document.getElementById('best').textContent = best;
document.getElementById('finalBest').textContent = best;
syncOverlays();
updateHUD();
window._chargedNotified = false;
