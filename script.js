(() => {
  'use strict';

  // --- Config ---
  const GRID = 24;                  // cells per side
  const BASE_TPS = 9;               // ticks per second (base speed)
  const SPEEDUP_EVERY = 6;          // score interval to increase speed
  const MAX_TPS = 18;               // cap speed
  const START_LEN = 4;

  // --- DOM ---
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  let dprNow = window.devicePixelRatio || 1;
  function logicalSize(){
    // After scaling the context, coordinates are in CSS pixels.
    return { w: canvas.width / dprNow, h: canvas.height / dprNow };
  }
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const speedEl = document.getElementById('speed');
  const btnPause = document.getElementById('btnPause');
  const btnRestart = document.getElementById('btnRestart');
  const btnShare = document.getElementById('btnShare');

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const btnOverlayPrimary = document.getElementById('btnOverlayPrimary');
  const btnOverlaySecondary = document.getElementById('btnOverlaySecondary');

  // --- Helpers ---
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const eq = (a, b) => a.x === b.x && a.y === b.y;
  const randInt = (min, maxInclusive) =>
    Math.floor(Math.random() * (maxInclusive - min + 1)) + min;

  function cellSize() {
    // Use logical (CSS pixel) size so DPR scaling doesn't break math.
    const { w } = logicalSize();
    return Math.floor(w / GRID);
  }

  function clear() {
    const { w, h } = logicalSize();
    ctx.clearRect(0, 0, w, h);
  }

  function drawRoundedRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    ctx.fill();
  }

  function setCanvasResolution() {
    // Size canvas in CSS pixels, but render sharply with DPR.
    dprNow = window.devicePixelRatio || 1;

    // Canvas is styled by CSS to a square; read its current CSS width.
    // If it's 0 (rare during initial layout), fall back to viewport.
    const rect = canvas.getBoundingClientRect();
    const css = Math.max(280, Math.min((rect.width || (window.innerWidth * 0.9)), 600));

    canvas.style.width = css + 'px';
    canvas.style.height = css + 'px';

    canvas.width = Math.floor(css * dprNow);
    canvas.height = Math.floor(css * dprNow);

    // Reset transform, then scale so we can draw in CSS pixel units.
    ctx.setTransform(dprNow, 0, 0, dprNow, 0, 0);
  }

  // --- Game state ---
  let snake = [];
  let dir = { x: 1, y: 0 };
  let pendingDir = { x: 1, y: 0 };
  let food = { x: 0, y: 0 };
  let score = 0;
  let best = Number(localStorage.getItem('snake_best') || '0');
  let paused = false;
  let gameOver = false;

  let tps = BASE_TPS;
  let accumulator = 0;
  let lastTs = 0;

  bestEl.textContent = String(best);

  function reset() {
    score = 0;
    tps = BASE_TPS;
    paused = false;
    gameOver = false;
    accumulator = 0;
    lastTs = 0;

    // Start near center, moving right.
    const startX = Math.floor(GRID / 2) - Math.floor(START_LEN / 2);
    const startY = Math.floor(GRID / 2);

    snake = Array.from({ length: START_LEN }, (_, i) => ({ x: startX + i, y: startY }));
    dir = { x: 1, y: 0 };
    pendingDir = { x: 1, y: 0 };

    spawnFood();
    updateHud();
    hideOverlay();
  }

  function spawnFood() {
    // Find a spot not on the snake.
    let tries = 0;
    while (tries++ < 5000) {
      const p = { x: randInt(0, GRID - 1), y: randInt(0, GRID - 1) };
      if (!snake.some(s => eq(s, p))) {
        food = p;
        return;
      }
    }
    // Fallback: if full grid (unlikely), end game.
    gameOver = true;
    showOverlay('You Win!', 'No space left to spawn food. Press R to restart.', 'Restart', 'Close');
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    const mult = (tps / BASE_TPS).toFixed(2).replace(/\.00$/, '');
    speedEl.textContent = mult + 'x';
    btnPause.textContent = paused ? 'Resume' : 'Pause';
  }

  function speedForScore(s) {
    const inc = Math.floor(s / SPEEDUP_EVERY);
    return clamp(BASE_TPS + inc, BASE_TPS, MAX_TPS);
  }

  function setDirection(nx, ny) {
    // Prevent reversing into yourself.
    if (nx === -dir.x && ny === -dir.y) return;
    pendingDir = { x: nx, y: ny };
  }

  function step() {
    if (paused || gameOver) return;

    dir = pendingDir;

    const head = snake[snake.length - 1];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    // Wall collision
    if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
      endGame('Crashed!', 'You hit the wall.');
      return;
    }

    // Tail collision (allow moving into the cell that will be removed)
    const tailWillMove = !eq(next, food);
    const body = tailWillMove ? snake.slice(1) : snake;
    if (body.some(s => eq(s, next))) {
      endGame('Oops!', 'You ran into your tail.');
      return;
    }

    snake.push(next);

    // Eat
    if (eq(next, food)) {
      score += 1;
      tps = speedForScore(score);
      if (score > best) {
        best = score;
        localStorage.setItem('snake_best', String(best));
      }
      spawnFood();
    } else {
      snake.shift(); // move tail
    }

    updateHud();
  }

  function endGame(title, reason) {
    gameOver = true;
    const msg = `${reason} Final score: ${score}.`;
    showOverlay(title, msg, 'Restart', 'Close');
  }

  // --- Rendering ---
  function draw() {
    clear();

    const cs = cellSize();
    const { w, h } = logicalSize();

    // Board background gradient
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(18,26,51,0.9)');
    g.addColorStop(1, 'rgba(10,14,28,0.9)');
    ctx.fillStyle = g;
    drawRoundedRect(0, 0, w, h, 18);

    // Subtle grid
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      const p = i * cs;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
    }
    ctx.restore();

    // Food
    const fx = food.x * cs;
    const fy = food.y * cs;
    ctx.fillStyle = 'rgba(70,211,154,0.95)';
    drawRoundedRect(fx + 2, fy + 2, cs - 4, cs - 4, 10);

    // Snake
    for (let i = 0; i < snake.length; i++) {
      const s = snake[i];
      const x = s.x * cs;
      const y = s.y * cs;

      const isHead = i === snake.length - 1;
      const alpha = 0.30 + (i / (snake.length - 1)) * 0.65;
      ctx.fillStyle = isHead
        ? 'rgba(122,167,255,0.98)'
        : `rgba(122,167,255,${alpha.toFixed(3)})`;

      drawRoundedRect(x + 2, y + 2, cs - 4, cs - 4, isHead ? 12 : 10);

      // Eyes
      if (isHead) {
        ctx.fillStyle = 'rgba(11,16,32,0.9)';
        const ex = x + cs * 0.30;
        const ey = y + cs * 0.32;
        const ex2 = x + cs * 0.62;
        const r = Math.max(2, cs * 0.08);
        ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex2, ey, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Pause hint
    if (paused && !gameOver) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      drawRoundedRect(0, 0, w, h, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8ecff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Paused', w / 2, h / 2 - 6);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,236,255,0.85)';
      ctx.fillText('Press Space to resume', w / 2, h / 2 + 18);
      ctx.restore();
    }
  }

  // --- Loop ---
  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    accumulator += dt;
    const stepTime = 1 / tps;
    while (accumulator >= stepTime) {
      step();
      accumulator -= stepTime;
    }

    draw();
    requestAnimationFrame(frame);
  }

  // --- Overlay ---
  function showOverlay(title, text, primaryLabel, secondaryLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    btnOverlayPrimary.textContent = primaryLabel;
    btnOverlaySecondary.textContent = secondaryLabel;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // --- Input ---
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') { e.preventDefault(); setDirection(0, -1); }
    else if (k === 'arrowdown' || k === 's') { e.preventDefault(); setDirection(0, 1); }
    else if (k === 'arrowleft' || k === 'a') { e.preventDefault(); setDirection(-1, 0); }
    else if (k === 'arrowright' || k === 'd') { e.preventDefault(); setDirection(1, 0); }
    else if (k === ' ' ) { e.preventDefault(); togglePause(); }
    else if (k === 'r') { e.preventDefault(); reset(); }
  }, { passive: false });

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    updateHud();
    if (paused) {
      showOverlay('Paused', 'Press Space (or Resume) to continue.', 'Resume', 'Restart');
    } else {
      hideOverlay();
    }
  }

  btnPause.addEventListener('click', () => togglePause());
  btnRestart.addEventListener('click', () => reset());

  btnOverlayPrimary.addEventListener('click', () => {
    if (gameOver) {
      reset();
    } else {
      paused = false;
      updateHud();
      hideOverlay();
    }
  });
  btnOverlaySecondary.addEventListener('click', () => reset());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !gameOver) {
      paused = false;
      updateHud();
      hideOverlay();
    }
  });

  // tap-to-pause (helps on mobile without keyboard)
  canvas.addEventListener('click', () => {
    if (!gameOver) togglePause();
  });

  // Touch buttons
  document.querySelectorAll('.dpad-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-dir');
      if (d === 'up') setDirection(0, -1);
      if (d === 'down') setDirection(0, 1);
      if (d === 'left') setDirection(-1, 0);
      if (d === 'right') setDirection(1, 0);
    });
  });

  // Swipe
  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    // Prevent the page from scrolling while playing.
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!t) return;

    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - touchStart.time;
    touchStart = null;

    if (dist < 24 || dt > 1000) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      setDirection(dx > 0 ? 1 : -1, 0);
    } else {
      setDirection(0, dy > 0 ? 1 : -1);
    }
  }, { passive: true });

  // Share
  async function shareScore() {
    const text = `I scored ${score} in Snake! 🐍 (Best: ${best})`;
    try {
      await navigator.clipboard.writeText(text);
      btnShare.textContent = 'Copied!';
      setTimeout(() => (btnShare.textContent = 'Share'), 900);
    } catch {
      // Fallback prompt
      window.prompt('Copy this text:', text);
    }
  }
  btnShare.addEventListener('click', shareScore);

  // Resize
  window.addEventListener('resize', () => {
    setCanvasResolution();
  });

  // Init
  setCanvasResolution();
  reset();
  requestAnimationFrame(frame);
})();
