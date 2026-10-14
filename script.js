/* ==========================================================================
   Flappy Bird — script.js
   Passt zu index.html und style.css (gleiche Element-IDs).
   Keine externen Dateien: Grafik wird per Canvas gezeichnet, Sound per WebAudio.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     1. Konstanten
     ------------------------------------------------------------------------ */
  const H = 640;                       // logische Höhe (Breite passt sich dem Bildschirm an)
  const GROUND_H = 92;
  const GY = H - GROUND_H;             // Oberkante des Bodens
  const STEP = 1 / 120;                // feste Physik-Schrittweite (framerate-unabhängig)
  const TAU = Math.PI * 2;
  const INK = '#1b1740';
  const FONT = '"Fredoka", "Arial Rounded MT Bold", ui-rounded, "Trebuchet MS", system-ui, sans-serif';

  const PHYS = { gravity: 1500, flap: -410, maxFall: 720 };
  const PIPE = { w: 66, cap: 30, ex: 6, spacing: 232, speed: 150, maxSpeed: 195 };
  const BIRD_R = 13;                   // Trefferkreis (etwas kleiner als die Grafik)
  const TOD_LEN = 6;                   // Punkte pro Tageszeit-Wechsel
  const STORE = { best: 'flappy.best', muted: 'flappy.muted' };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------------
     2. DOM
     ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const canvas = $('game');
  const ctx = canvas && canvas.getContext('2d');
  if (!stage || !canvas || !ctx) throw new Error('Flappy Bird: #stage oder #game nicht gefunden.');

  const el = {
    pauseBtn: $('pauseBtn'), muteBtn: $('muteBtn'), retryBtn: $('retryBtn'),
    intro: $('intro'), introBest: $('introBest'), introBestVal: $('introBestVal'),
    over: $('over'), paused: $('paused'), flash: $('flash'),
    finalScore: $('finalScore'), bestScore: $('bestScore'),
    medal: $('medal'), newBadge: $('newBadge'),
  };

  /* ------------------------------------------------------------------------
     3. Hilfsfunktionen
     ------------------------------------------------------------------------ */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const mod = (a, n) => ((a % n) + n) % n;
  const ease = (t) => t * t * (3 - 2 * t);
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const shade = (c, amt) => (amt < 0 ? mixC(c, [0, 0, 20], -amt) : mixC(c, [255, 255, 255], amt));

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* Privatmodus o. ä. */ } },
  };

  function circle(x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  /* ------------------------------------------------------------------------
     4. Farbpaletten für die Tageszeiten (Morgenrot → Tag → Abend → Nacht)
     ------------------------------------------------------------------------ */
  const COLOR_KEYS = ['skyTop', 'skyBot', 'sun', 'far', 'mid', 'near', 'cloud', 'pipe', 'grass', 'soil'];

  const PHASES = [
    { skyTop: '#86A2EA', skyBot: '#FFD2AA', sun: '#FFE9B8', far: '#C79BC9', mid: '#A885BE', near: '#7A6EAE',
      cloud: '#FFEBDD', pipe: '#5CC48F', grass: '#7FC088', soil: '#EDCBA6', stars: 0.18, sunY: 0.52 },
    { skyTop: '#46AEF0', skyBot: '#C3EBFF', sun: '#FFF7CF', far: '#8BCFC8', mid: '#5DBF9D', near: '#3FA57F',
      cloud: '#FFFFFF', pipe: '#4CC76E', grass: '#6CCB5B', soil: '#E6D199', stars: 0, sunY: 0.20 },
    { skyTop: '#4A3D8F', skyBot: '#FF8F6E', sun: '#FFC48C', far: '#B4588F', mid: '#7D4084', near: '#4D2F70',
      cloud: '#FFB7A2', pipe: '#3FB08E', grass: '#559A6E', soil: '#C99C88', stars: 0.4, sunY: 0.50 },
    { skyTop: '#0A0F2E', skyBot: '#2C2F6E', sun: '#EAEEFF', far: '#2B3068', mid: '#202657', near: '#151A43',
      cloud: '#3A4082', pipe: '#2FB3A6', grass: '#2F6563', soil: '#3A3B64', stars: 1, sunY: 0.19 },
  ].map((p) => {
    const o = { stars: p.stars, sunY: p.sunY };
    for (const k of COLOR_KEYS) o[k] = hex(p[k]);
    return o;
  });

  const pal = {};
  function updatePalette(t) {
    const n = PHASES.length;
    const m = mod(t, n);
    const i = Math.floor(m);
    const f = ease(m - i);
    const a = PHASES[i], b = PHASES[(i + 1) % n];
    for (const k of COLOR_KEYS) pal[k] = mixC(a[k], b[k], f);
    pal.stars = lerp(a.stars, b.stars, f);
    pal.sunY = lerp(a.sunY, b.sunY, f);
  }

  /* ------------------------------------------------------------------------
     5. Sound (synthetisch, keine Dateien)
     ------------------------------------------------------------------------ */
  const Sound = (() => {
    let ac = null, master = null;
    let muted = store.get(STORE.muted) === '1';

    function unlock() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.5;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return true;
    }

    function tone(f0, f1, dur, type, vol, delay = 0) {
      if (muted || !ac) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.03);
    }

    function noise(dur, vol, freq, delay = 0) {
      if (muted || !ac) return;
      const t = ac.currentTime + delay;
      const len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = freq;
      const g = ac.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t);
    }

    return {
      unlock,
      get muted() { return muted; },
      setMuted(v) { muted = v; store.set(STORE.muted, v ? '1' : '0'); },
      flap()   { tone(330, 620, 0.11, 'triangle', 0.35); noise(0.05, 0.05, 3000); },
      score()  { tone(988, 988, 0.09, 'square', 0.12); tone(1319, 1319, 0.16, 'square', 0.12, 0.08); },
      hit()    { noise(0.22, 0.6, 1200); tone(180, 50, 0.22, 'sine', 0.5); },
      fall()   { tone(420, 110, 0.5, 'sawtooth', 0.12, 0.12); },
      record() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.25, i * 0.1)); },
    };
  })();

  /* ------------------------------------------------------------------------
     6. Spielzustand
     ------------------------------------------------------------------------ */
  let W = 400;                         // logische Breite (hängt vom Seitenverhältnis ab)
  let scale = 1;
  let vignette = null;

  let mode = 'ready';                  // ready | playing | dying | over
  let isPaused = false;

  let score = 0;
  let best = parseInt(store.get(STORE.best), 10) || 0;
  let newBest = false;

  let time = 0, acc = 0, last = 0;
  let bgScroll = 0;
  let tod = 0, todBase = 0;            // Tageszeit (kontinuierlich) und ihr Basiswert
  let shake = 0, hitStop = 0, popT = 0, overT = 0, deathT = 0, resumeDelay = 0;
  let landed = false;
  let lastGapC = null;

  const pipes = [];
  const particles = [];
  const bird = { x: 120, y: 280, baseY: 280, vy: 0, rot: 0, wing: 0, flapT: 0, stretch: 0 };

  const stars = Array.from({ length: 80 }, () => ({
    x: Math.random(), y: rand(0, 0.62), r: rand(0.6, 1.8), p: rand(0, TAU), sp: rand(0.8, 2.4),
  }));
  const clouds = Array.from({ length: 8 }, (_, i) => ({
    x: i * 95 + rand(-20, 20), y: rand(40, 300), s: rand(0.6, 1.3), v: rand(0.12, 0.3),
  }));
  const CLOUD_W = 760;
  const meteor = { on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, wait: 4 };

  /* ------------------------------------------------------------------------
     7. Größe / Skalierung
     ------------------------------------------------------------------------ */
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    W = Math.round(H * clamp(vw / vh, 0.45, 0.8));
    scale = Math.min(vw / W, vh / H);

    const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    stage.style.setProperty('--u', `${scale}px`);

    bird.x = Math.round(W * 0.3);

    vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.82);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(10,8,30,0.22)');
  }

  /* ------------------------------------------------------------------------
     8. Partikel
     ------------------------------------------------------------------------ */
  const FEATHERS = ['#FFE98A', '#FFC73A', '#FFF4CF'];
  const CONFETTI = ['#FFC93C', '#FF6B5B', '#5CC48F', '#86A2EA', '#FFFFFF'];

  function addParticle(o) {
    if (particles.length >= 320) particles.shift();
    const p = { vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, size: 3, color: '#fff', kind: 'dust', life: 1 };
    Object.assign(p, o);
    p.max = p.life;
    particles.push(p);
  }

  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  function flapFeathers() {
    for (let i = 0; i < 3; i++) {
      addParticle({
        kind: 'feather', x: bird.x - 14, y: bird.y + 4 + rand(-3, 3),
        vx: -rand(30, 90), vy: rand(10, 70), g: 220, drag: 1.5,
        rot: rand(0, TAU), vr: rand(-6, 6), life: rand(0.5, 0.9), size: rand(2.5, 4), color: pick(FEATHERS),
      });
    }
  }

  function scoreSparks() {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rand(-0.3, 0.3), sp = rand(70, 150);
      addParticle({
        kind: 'spark', x: bird.x + 16, y: bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        drag: 3, life: rand(0.35, 0.6), size: rand(3, 5.5), color: '#FFE27A',
      });
    }
  }

  function deathBurst() {
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU), sp = rand(120, 320);
      addParticle({
        kind: 'feather', x: bird.x, y: bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        g: 520, drag: 1.2, rot: rand(0, TAU), vr: rand(-10, 10), life: rand(0.6, 1.1),
        size: rand(3, 5), color: pick(FEATHERS),
      });
    }
  }

  function landDust() {
    for (let i = 0; i < 10; i++) {
      addParticle({
        kind: 'dust', x: bird.x + rand(-14, 14), y: GY, vx: rand(-110, 110), vy: rand(-70, -15),
        g: 120, drag: 2, life: rand(0.4, 0.7), size: rand(3, 6), color: rgba(shade(pal.soil, 0.25), 0.9),
      });
    }
  }

  function confettiRain() {
    for (let i = 0; i < 70; i++) {
      addParticle({
        kind: 'confetti', x: rand(0, W), y: rand(-60, 40), vx: rand(-40, 40), vy: rand(60, 170),
        g: 80, drag: 0.3, rot: rand(0, TAU), vr: rand(-8, 8), life: rand(2.4, 4), size: rand(3, 5.5), color: pick(CONFETTI),
      });
    }
  }

  /* ------------------------------------------------------------------------
     9. Spiellogik
     ------------------------------------------------------------------------ */
  function currentSpeed() { return Math.min(PIPE.maxSpeed, PIPE.speed + score); }

  function spawnPipe(x) {
    const gap = Math.max(138, 170 - score * 0.8);
    const margin = 64;
    const minC = margin + gap / 2;
    const maxC = GY - margin - gap / 2;
    let c;
    if (lastGapC === null) c = (minC + maxC) / 2 + rand(-40, 40);
    else c = clamp(lastGapC + rand(-150, 150), minC, maxC);   // erreichbarer Höhenunterschied
    lastGapC = c;
    pipes.push({ x, c, gap, scored: false });
  }

  function hitsPipe(p) {
    const top = p.c - p.gap / 2;
    const bot = p.c + p.gap / 2;
    const { w, cap, ex } = PIPE;
    const { x, y } = bird;
    return (
      circleRect(x, y, BIRD_R, p.x, -300, w, top - cap + 300) ||
      circleRect(x, y, BIRD_R, p.x - ex, top - cap, w + ex * 2, cap) ||
      circleRect(x, y, BIRD_R, p.x, bot + cap, w, H) ||
      circleRect(x, y, BIRD_R, p.x - ex, bot, w + ex * 2, cap)
    );
  }

  function flap() {
    bird.vy = PHYS.flap;
    bird.flapT = 0.28;
    bird.stretch = 1;
    Sound.flap();
    flapFeathers();
  }

  function addScore() {
    score++;
    popT = 1;
    Sound.score();
    scoreSparks();
  }

  function die(cause) {
    if (mode !== 'playing') return;
    mode = 'dying';
    deathT = 0;
    landed = false;
    stage.dataset.mode = 'dying';

    Sound.hit();
    Sound.fall();
    flashScreen();
    if (!reduceMotion) { shake = 9; hitStop = 0.07; }
    deathBurst();

    if (cause === 'pipe') {
      bird.vy = -120;
    } else {
      bird.y = GY - BIRD_R;
      landed = true;
      landDust();
    }

    newBest = score > 0 && score > best;
    if (newBest) {
      best = score;
      store.set(STORE.best, String(best));
    }
  }

  function tierFor(s) {
    if (s >= 40) return 'platinum';
    if (s >= 30) return 'gold';
    if (s >= 20) return 'silver';
    if (s >= 10) return 'bronze';
    return 'none';
  }

  function countUp(node, to) {
    if (to === 0 || reduceMotion) { node.textContent = to; return; }
    const t0 = performance.now();
    const dur = clamp(to * 45, 250, 900);
    const tick = (now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      node.textContent = Math.round(to * ease(k));
      if (k < 1 && mode === 'over') requestAnimationFrame(tick);
      else node.textContent = to;
    };
    requestAnimationFrame(tick);
  }

  function toOver() {
    mode = 'over';
    overT = 0;
    stage.dataset.mode = 'over';

    el.finalScore.textContent = '0';
    el.bestScore.textContent = best;
    el.medal.dataset.tier = tierFor(score);
    el.newBadge.hidden = !newBest;
    el.over.hidden = false;

    countUp(el.finalScore, score);
    if (newBest) { confettiRain(); Sound.record(); }
    el.retryBtn.focus({ preventScroll: true });
  }

  function updateIntroBest() {
    el.introBest.hidden = best <= 0;
    el.introBestVal.textContent = best;
  }

  function resetWorld() {
    mode = 'ready';
    score = 0;
    newBest = false;
    pipes.length = 0;
    lastGapC = null;
    landed = false;
    resumeDelay = 0;

    bird.baseY = Math.round(H * 0.44);
    bird.y = bird.baseY;
    bird.vy = 0; bird.rot = 0; bird.flapT = 0; bird.stretch = 0;

    // Himmel läuft vorwärts zum nächsten Morgenrot, statt rückwärts zu spulen
    todBase = Math.ceil(tod / PHASES.length - 0.02) * PHASES.length;

    stage.dataset.mode = 'ready';
    el.intro.hidden = false;
    el.over.hidden = true;
    updateIntroBest();
  }

  function start() {
    mode = 'playing';
    stage.dataset.mode = 'playing';
    el.intro.hidden = true;
    flap();
  }

  function restart() {
    el.over.hidden = true;
    resetWorld();
  }

  function pause() {
    if (mode !== 'playing' || isPaused) return;
    isPaused = true;
    el.paused.hidden = false;
    syncPauseBtn();
  }

  function resume() {
    if (!isPaused) return;
    isPaused = false;
    el.paused.hidden = true;
    resumeDelay = 0.6;                 // kurze Schonfrist, damit der Vogel nicht sofort fällt
    last = performance.now();
    syncPauseBtn();
  }

  function action() {
    Sound.unlock();
    if (isPaused) { resume(); return; }
    if (mode === 'ready') start();
    else if (mode === 'playing') { if (resumeDelay <= 0) flap(); }
    else if (mode === 'over') { if (overT > 0.55) restart(); }
  }

  /* ------------------------------------------------------------------------
     10. Update (feste Schrittweite)
     ------------------------------------------------------------------------ */
  function step(dt) {
    stepParticles(dt);
    bird.flapT = Math.max(0, bird.flapT - dt);
    bird.stretch = Math.max(0, bird.stretch - dt * 5);

    let wingRate = 0;
    if (bird.flapT > 0) wingRate = 34;
    else if (mode === 'ready') wingRate = 11;
    else if (mode === 'playing') wingRate = bird.vy < 80 ? 14 : 4;
    bird.wing += dt * wingRate;

    if (mode === 'ready') {
      bgScroll += 70 * dt;
      bird.vy = 0;
      bird.y = bird.baseY + Math.sin(time * 5) * 7;
      bird.rot = Math.cos(time * 5) * 0.12;
      return;
    }

    if (mode === 'playing') {
      if (resumeDelay > 0) { resumeDelay -= dt; return; }

      const sp = currentSpeed();
      bgScroll += sp * dt;

      bird.vy = Math.min(PHYS.maxFall, bird.vy + PHYS.gravity * dt);
      bird.y += bird.vy * dt;
      const targetRot = bird.vy < 0 ? (bird.vy / 410) * 0.5 : Math.min(1.25, (bird.vy / 650) * 1.25);
      bird.rot += (targetRot - bird.rot) * Math.min(1, dt * (bird.vy < 0 ? 20 : 7));

      if (bird.y < BIRD_R) { bird.y = BIRD_R; if (bird.vy < 0) bird.vy = 0; }

      for (const p of pipes) p.x -= sp * dt;
      if (pipes.length && pipes[0].x < -(PIPE.w + PIPE.ex + 10)) pipes.shift();
      const lastPipe = pipes[pipes.length - 1];
      if (!lastPipe || lastPipe.x <= W + 30 - PIPE.spacing) spawnPipe(W + 30);

      for (const p of pipes) {
        if (!p.scored && p.x + PIPE.w / 2 < bird.x) { p.scored = true; addScore(); }
        if (hitsPipe(p)) { die('pipe'); return; }
      }
      if (bird.y + BIRD_R >= GY) { bird.y = GY - BIRD_R; die('ground'); }
      return;
    }

    if (mode === 'dying') {
      bird.vy = Math.min(PHYS.maxFall, bird.vy + PHYS.gravity * dt);
      bird.y += bird.vy * dt;
      bird.rot += (1.5 - bird.rot) * Math.min(1, dt * 6);
      if (!landed && bird.y + BIRD_R >= GY) {
        bird.y = GY - BIRD_R + 3;
        landed = true;
        landDust();
        if (!reduceMotion) shake = Math.max(shake, 4);
      }
      if (landed) {
        deathT += dt;
        if (deathT > 0.45) toOver();
      }
    }
  }

  // Alles, was nur "Atmosphäre" ist und nicht in festen Schritten laufen muss
  function ambient(dt) {
    time += dt;

    tod += (todBase + score / TOD_LEN - tod) * (1 - Math.exp(-dt * 1.3));
    updatePalette(tod);

    shake *= Math.exp(-dt * 9);
    if (shake < 0.15) shake = 0;
    popT = Math.max(0, popT - dt * 4.5);
    if (mode === 'over') overT += dt;

    // Sternschnuppen in der Nacht
    if (!meteor.on) {
      if (pal.stars > 0.8) {
        meteor.wait -= dt;
        if (meteor.wait <= 0) {
          const sp = rand(380, 560);
          meteor.on = true;
          meteor.x = rand(W * 0.4, W * 1.1);
          meteor.y = rand(20, 160);
          meteor.vx = -sp * 0.8;
          meteor.vy = sp * 0.45;
          meteor.life = 1.1;
        }
      }
    } else {
      meteor.x += meteor.vx * dt;
      meteor.y += meteor.vy * dt;
      meteor.life -= dt;
      if (meteor.life <= 0) { meteor.on = false; meteor.wait = rand(5, 11); }
    }
  }

  /* ------------------------------------------------------------------------
     11. Zeichnen: Hintergrund
     ------------------------------------------------------------------------ */
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, GY);
    g.addColorStop(0, rgba(pal.skyTop));
    g.addColorStop(1, rgba(pal.skyBot));
    ctx.fillStyle = g;
    ctx.fillRect(-30, -30, W + 60, H + 60);
  }

  function drawStars() {
    if (pal.stars < 0.02) return;
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = pal.stars * (0.55 + 0.45 * Math.sin(time * s.sp + s.p));
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (meteor.on) {
      const tx = meteor.x - meteor.vx * 0.14, ty = meteor.y - meteor.vy * 0.14;
      const g = ctx.createLinearGradient(meteor.x, meteor.y, tx, ty);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = Math.min(1, meteor.life * 2) * clamp(pal.stars, 0, 1);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(meteor.x, meteor.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawCelestial() {
    const sx = W * 0.74, sy = H * pal.sunY;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 170);
    glow.addColorStop(0, rgba(pal.sun, 0.55));
    glow.addColorStop(1, rgba(pal.sun, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 180, sy - 180, 360, 360);

    ctx.fillStyle = rgba(pal.sun);
    ctx.beginPath();
    ctx.arc(sx, sy, 34, 0, TAU);
    ctx.fill();

    // Mondkrater, wenn es dunkel wird
    const craters = clamp((pal.stars - 0.5) * 2, 0, 1) * 0.16;
    if (craters > 0.005) {
      ctx.fillStyle = `rgba(120,130,190,${craters})`;
      ctx.beginPath();
      circle(sx - 10, sy - 8, 7);
      circle(sx + 11, sy + 5, 9);
      circle(sx - 4, sy + 15, 4.5);
      ctx.fill();
    }
  }

  function drawClouds() {
    ctx.fillStyle = rgba(pal.cloud, 0.92);
    for (const c of clouds) {
      const cx = mod(c.x - (bgScroll * c.v + time * 8 * c.v), CLOUD_W) - 140;
      ctx.save();
      ctx.translate(cx, c.y);
      ctx.scale(c.s, c.s);
      ctx.beginPath();
      circle(0, 0, 22); circle(26, -10, 28); circle(56, 0, 22); circle(28, 8, 24);
      ctx.fill();
      ctx.restore();
    }
  }

  const LAYERS = [
    { speed: 0.06, key: 'far',  haze: 0.25,
      h: (x) => 60 + 70 * (1 - Math.abs(Math.sin(x * 0.0125))) + 24 * Math.abs(Math.sin(x * 0.034 + 2)) },
    { speed: 0.15, key: 'mid',  haze: 0.10,
      h: (x) => 44 + 26 * Math.sin(x * 0.012 + 1) + 14 * Math.sin(x * 0.031) },
    { speed: 0.32, key: 'near', haze: 0, trees: true,
      h: (x) => 22 + 12 * Math.sin(x * 0.018 + 3) + 6 * Math.sin(x * 0.047 + 0.5) },
  ];

  function drawHills() {
    for (const L of LAYERS) {
      const off = bgScroll * L.speed;
      const col = L.haze ? mixC(pal[L.key], pal.skyBot, L.haze) : pal[L.key];

      ctx.fillStyle = rgba(col);
      ctx.beginPath();
      ctx.moveTo(-20, H);
      for (let x = -20; x <= W + 26; x += 6) ctx.lineTo(x, GY - L.h(x + off));
      ctx.lineTo(W + 26, H);
      ctx.closePath();
      ctx.fill();

      if (L.trees) {
        const TS = 46;
        const i0 = Math.floor(off / TS) - 1;
        const i1 = Math.floor((off + W) / TS) + 1;
        ctx.fillStyle = rgba(shade(col, -0.18));
        for (let i = i0; i <= i1; i++) {
          if (hash(i) < 0.5) continue;
          const wx = i * TS + hash(i + 9) * 20;
          const sx = wx - off;
          const yb = GY - L.h(wx) + 3;
          const r = 7 + hash(i + 3) * 7;
          ctx.beginPath();
          circle(sx, yb - r - 3, r);
          ctx.fill();
          ctx.fillRect(sx - 1.5, yb - r, 3, r + 2);
        }
      }
    }
  }

  /* ------------------------------------------------------------------------
     12. Zeichnen: Röhren, Boden
     ------------------------------------------------------------------------ */
  function drawPipes() {
    if (!pipes.length) return;
    const base = pal.pipe;
    const { w, cap, ex } = PIPE;

    const addStops = (g) => {
      g.addColorStop(0, rgba(shade(base, -0.12)));
      g.addColorStop(0.14, rgba(shade(base, 0.38)));
      g.addColorStop(0.38, rgba(base));
      g.addColorStop(0.78, rgba(shade(base, -0.16)));
      g.addColorStop(1, rgba(shade(base, -0.34)));
    };
    const gBody = ctx.createLinearGradient(0, 0, w, 0);
    const gCap = ctx.createLinearGradient(-ex, 0, w + ex, 0);
    addStops(gBody); addStops(gCap);

    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(shade(base, -0.6));

    for (const p of pipes) {
      const top = p.c - p.gap / 2;
      const bot = p.c + p.gap / 2;
      ctx.save();
      ctx.translate(p.x, 0);

      // Körper
      ctx.fillStyle = gBody;
      ctx.fillRect(0, -10, w, top - cap + 10);
      ctx.strokeRect(0, -10, w, top - cap + 10);
      ctx.fillRect(0, bot + cap, w, H - bot - cap);
      ctx.strokeRect(0, bot + cap, w, H - bot - cap);

      // Kappen
      ctx.fillStyle = gCap;
      roundRect(-ex, top - cap, w + ex * 2, cap, 7); ctx.fill(); ctx.stroke();
      roundRect(-ex, bot, w + ex * 2, cap, 7); ctx.fill(); ctx.stroke();

      // Glanzstreifen
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(10, -10, 6, top - cap + 10);
      ctx.fillRect(10, bot + cap, 6, H - bot - cap);
      ctx.fillRect(-ex + 8, top - cap + 5, 6, cap - 10);
      ctx.fillRect(-ex + 8, bot + 5, 6, cap - 10);

      ctx.restore();
    }
  }

  function drawGround() {
    const gh = 18;
    ctx.fillStyle = rgba(pal.soil);
    ctx.fillRect(-30, GY, W + 60, GROUND_H + 30);

    // Gras mit laufenden Streifen
    ctx.fillStyle = rgba(pal.grass);
    ctx.fillRect(-30, GY, W + 60, gh);

    ctx.save();
    ctx.beginPath();
    ctx.rect(-30, GY, W + 60, gh);
    ctx.clip();
    ctx.fillStyle = rgba(shade(pal.grass, -0.14));
    const P = 28, o = bgScroll % P;
    for (let x = -gh - P - o; x < W + P; x += P) {
      ctx.beginPath();
      ctx.moveTo(x, GY);
      ctx.lineTo(x + P / 2, GY);
      ctx.lineTo(x + P / 2 - gh, GY + gh);
      ctx.lineTo(x - gh, GY + gh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = rgba(shade(pal.grass, 0.35));
    ctx.fillRect(-30, GY, W + 60, 3);
    ctx.fillStyle = rgba(shade(pal.grass, -0.5));
    ctx.fillRect(-30, GY + gh, W + 60, 3);

    // Kieselsteine, die mit dem Boden wandern
    ctx.fillStyle = rgba(shade(pal.soil, -0.12));
    const base = Math.floor(bgScroll / 60);
    for (let i = base - 1; i < base + Math.ceil(W / 60) + 2; i++) {
      const x = i * 60 + hash(i) * 40 - bgScroll;
      const y = GY + gh + 14 + hash(i + 5) * 40;
      ctx.beginPath();
      ctx.ellipse(x, y, 2 + hash(i + 2) * 3, 1.6 + hash(i + 7) * 1.4, 0, 0, TAU);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------------
     13. Zeichnen: Vogel, Partikel, Punktestand
     ------------------------------------------------------------------------ */
  function drawBird() {
    const sx = 1 - 0.1 * bird.stretch;
    const sy = 1 + 0.14 * bird.stretch;
    const dead = mode === 'dying' || mode === 'over';

    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    ctx.scale(sx, sy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = INK;

    // Schwanz
    ctx.fillStyle = '#F29A1F';
    ctx.beginPath();
    ctx.moveTo(-14, -2); ctx.lineTo(-27, -7); ctx.lineTo(-25, 1); ctx.lineTo(-28, 7); ctx.lineTo(-14, 6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Körper
    const g = ctx.createRadialGradient(-5, -8, 2, 0, 0, 22);
    g.addColorStop(0, '#FFE98A');
    g.addColorStop(1, '#FFB820');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 15, 0, 0, TAU);
    ctx.fill();

    // Bauch (auf den Körper begrenzt)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 15, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#FFF4CF';
    ctx.beginPath();
    ctx.ellipse(4, 12, 15, 8, 0.1, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 15, 0, 0, TAU);
    ctx.stroke();

    // Wange
    ctx.fillStyle = 'rgba(255,107,91,0.45)';
    ctx.beginPath();
    ctx.ellipse(8, 5, 4.5, 3, 0, 0, TAU);
    ctx.fill();

    // Flügel
    ctx.save();
    ctx.translate(-5, 2);
    ctx.rotate(Math.sin(bird.wing) * 0.75 - 0.15);
    ctx.fillStyle = '#FFC73A';
    ctx.beginPath();
    ctx.ellipse(-6, 1, 11, 6.5, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // Schnabel
    ctx.fillStyle = '#FF7A2F';
    ctx.beginPath();
    ctx.moveTo(13, -2); ctx.quadraticCurveTo(25, -4, 28, 1); ctx.quadraticCurveTo(24, 4, 13, 3);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#E8561C';
    ctx.beginPath();
    ctx.moveTo(13, 3); ctx.quadraticCurveTo(23, 3.5, 25, 7); ctx.quadraticCurveTo(20, 10, 12, 8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Auge (nach dem Aufprall: Kreuz)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(7, -5, 6.2, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.stroke();
    if (dead) {
      ctx.beginPath();
      ctx.moveTo(4.5, -7.5); ctx.lineTo(9.5, -2.5);
      ctx.moveTo(9.5, -7.5); ctx.lineTo(4.5, -2.5);
      ctx.stroke();
    } else {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(9, -5, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(10, -6.2, 1.1, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp((p.life / p.max) * 1.6, 0, 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;

      if (p.kind === 'feather') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.6, p.size * 0.7, 0, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'dust') {
        const r = p.size * (1 + (1 - p.life / p.max) * 1.2);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'spark') {
        const s = p.size;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(0, 0, s, 0);
        ctx.quadraticCurveTo(0, 0, 0, s);
        ctx.quadraticCurveTo(0, 0, -s, 0);
        ctx.quadraticCurveTo(0, 0, 0, -s);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    if (mode === 'ready' || mode === 'over') return;
    const s = 1 + popT * 0.3;
    ctx.save();
    ctx.translate(W / 2, 92);
    ctx.scale(s, s);
    ctx.font = `700 60px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = INK;
    ctx.strokeText(score, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillText(score, 0, 0);
    ctx.restore();
  }

  /* ------------------------------------------------------------------------
     14. Render
     ------------------------------------------------------------------------ */
  function render() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    drawSky();
    drawStars();
    drawCelestial();
    drawClouds();
    drawHills();
    drawPipes();
    drawGround();
    drawParticles();
    drawBird();
    drawHud();

    ctx.restore();

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  /* ------------------------------------------------------------------------
     15. Oberfläche (DOM)
     ------------------------------------------------------------------------ */
  function flashScreen() {
    if (reduceMotion) return;
    el.flash.classList.remove('on');
    void el.flash.offsetWidth;          // Animation neu starten
    el.flash.classList.add('on');
  }

  function syncPauseBtn() {
    el.pauseBtn.dataset.state = isPaused ? 'paused' : 'playing';
    el.pauseBtn.setAttribute('aria-label', isPaused ? 'Продолжить' : 'Пауза');
  }

  function syncMuteBtn() {
    const m = Sound.muted;
    el.muteBtn.dataset.state = m ? 'off' : 'on';
    el.muteBtn.setAttribute('aria-pressed', String(m));
    el.muteBtn.setAttribute('aria-label', m ? 'Включить звук' : 'Выключить звук');
  }

  /* ------------------------------------------------------------------------
     16. Eingaben
     ------------------------------------------------------------------------ */
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    action();
  });

  // Mausklick auf einen Button soll den Fokus abgeben, sonst löst die Leertaste ihn erneut aus
  const blurAfterPointer = (e) => { if (e.detail > 0) e.currentTarget.blur(); };

  el.pauseBtn.addEventListener('click', (e) => {
    blurAfterPointer(e);
    if (isPaused) resume(); else pause();
  });

  el.muteBtn.addEventListener('click', (e) => {
    blurAfterPointer(e);
    Sound.setMuted(!Sound.muted);
    syncMuteBtn();
    if (!Sound.muted) { Sound.unlock(); Sound.score(); }
  });

  el.retryBtn.addEventListener('click', () => {
    if (mode === 'over' && overT > 0.3) restart();
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof Element && e.target.closest('button');

    switch (e.code) {
      case 'Space':
      case 'Enter':
      case 'ArrowUp':
      case 'KeyW':
        // Fokussierter Button behält Leertaste/Enter für sich (Tastaturbedienung)
        if (onButton && (e.code === 'Space' || e.code === 'Enter')) return;
        e.preventDefault();
        if (!e.repeat) action();
        break;
      case 'KeyP':
      case 'Escape':
        if (isPaused) resume(); else pause();
        break;
      case 'KeyM':
        Sound.setMuted(!Sound.muted);
        syncMuteBtn();
        break;
      default:
    }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ------------------------------------------------------------------------
     17. Hauptschleife
     ------------------------------------------------------------------------ */
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0));
    last = now;

    if (!isPaused) {
      if (hitStop > 0) {
        hitStop -= dt;                 // kurzes Einfrieren beim Aufprall
      } else {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n++ < 12) { step(STEP); acc -= STEP; }
        if (acc > STEP) acc = 0;
      }
      ambient(dt);
    }

    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
     18. Start
     ------------------------------------------------------------------------ */
  updatePalette(0);
  resetWorld();
  resize();
  syncMuteBtn();
  syncPauseBtn();
  last = performance.now();
  requestAnimationFrame(frame);
})();