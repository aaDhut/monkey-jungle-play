// Monkey Jungle: scene setup, game states and the main loop.
import * as THREE from 'three';
import { buildLevel } from './level.js';
import { remixLevel } from './procgen.js';
import { Player, STAMINA } from './player.js';
import { spawnEnemy, Coconut } from './enemies.js';
import { resolveOverlaps } from './physics.js';
import { Effects } from './effects.js';
import { Burial, BURIAL_TIME } from './coffin.js';
import { Angel } from './angel.js';
import { Input } from './input.js';
import { PadView } from './padview.js';
import { TouchPad } from './touchpad.js';
import { Haptics } from './haptics.js';
import { sound } from './sound.js';
import { SPEAKER_LABEL } from './padspeaker.js';
import * as ui from './ui.js';
import { bakeStats } from './bake.js';

const STEP = 1 / 120;
const START_LIVES = 3;
const CAM_DIST = 17;
const SUPER_TIME = 20;
const LIFE_EVERY = 50; // bananas per extra life
const BANANA_STAMINA = 0.08; // each banana refills 8% of the sprint bar
// Open the page with ?level=3 to start (and restart from the title) on that level.
const START_LEVEL = Math.max(1, parseInt(new URLSearchParams(location.search).get('level'), 10) || 1);

// ------------------------------------------------------------ renderer + scene

// Phones/tablets and weak machines start on a cheaper quality tier (and skip MSAA, which is
// expensive on mobile GPUs); the adaptive scaler below fine-tunes from there on any device.
const LOW_END = matchMedia('(pointer: coarse)').matches
  || (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4;
document.documentElement.classList.toggle('low-end', LOW_END);
// Phone GPUs are tile-based, so MSAA costs them very little and it's what keeps edges smooth;
// only weak desktops/laptops skip it.
const TOUCH = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: TOUCH || !LOW_END, alpha: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // the coffin is clipped at floor level as it rises/sinks
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcdeefc, 35, 100);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);

const hemi = new THREE.HemisphereLight(0xcfefff, 0x6aa84f, 1.6);
const sun = new THREE.DirectionalLight(0xfff3d6, 2.4);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 18, bottom: -12, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
const resizeSoon = () => { resize(); setTimeout(resize, 150); setTimeout(resize, 500); };
addEventListener('orientationchange', resizeSoon);
window.visualViewport?.addEventListener('resize', resizeSoon);

// ------------------------------------------------------------ adaptive quality
// Resolution is by far the biggest GPU cost, then the shadow map. If the game can't hold its
// frame rate, step down a tier; if it has been rock-steady for a while, try stepping back up
// (and never retry a tier that already proved too slow). ?quality=0..5 pins a tier (no scaling).
// soft: PCF soft shadows (more texture taps per pixel) vs plain PCF. shadow 0 = no shadows at all
// (saves the whole shadow pass plus the per-pixel shadow lookups).
// Phones get their own list: their screens are 2-3× density, so 1× looks blurry, but they have
// far less GPU to spare, so resolution matters more than shadow detail there.
const QUALITY = TOUCH ? [
  { pr: 2, shadow: 1024, soft: false },
  { pr: 1.75, shadow: 1024, soft: false },
  { pr: 1.5, shadow: 1024, soft: false },
  { pr: 1.25, shadow: 1024, soft: false },
  { pr: 1, shadow: 0, soft: false },
  { pr: 0.85, shadow: 0, soft: false },
] : [ // best → cheapest
  { pr: 1.5, shadow: 2048, soft: true },
  { pr: 1.25, shadow: 2048, soft: true },
  { pr: 1, shadow: 1536, soft: true },
  { pr: 1, shadow: 1024, soft: false },
  { pr: 0.85, shadow: 1024, soft: false },
  { pr: 0.75, shadow: 0, soft: false },
];
const pinnedQuality = new URLSearchParams(location.search).get('quality');
const perf = {
  level: pinnedQuality !== null ? Math.min(QUALITY.length - 1, Math.max(0, +pinnedQuality || 0)) : TOUCH ? 0 : LOW_END ? 3 : 0,
  ceiling: 0,   // best tier we're still allowed to try
  avg: 16.7,    // smoothed frame time (ms)
  jitter: 0,    // smoothed |frame time − avg|: tiny when the screen's refresh rate is the limit
  slowFor: 0, steadyFor: 0, settle: 1, lastUp: -1e9,
};

function applyQuality() {
  const q = QUALITY[perf.level];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pr));
  const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const shadows = q.shadow > 0;
  const recompile = renderer.shadowMap.type !== type || sun.castShadow !== shadows;
  renderer.shadowMap.type = type;
  sun.castShadow = shadows; // changing this re-keys every lit shader, so they rebuild without shadow code
  if (shadows && sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // re-created at the new size on the next render
  }
  if (!shadows && sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } // free its GPU memory
  if (recompile) scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
  perf.settle = 1.5; // ignore the hitch from reallocating buffers
  perf.slowFor = perf.steadyFor = 0;
}

function trackPerf(ms, seconds) {
  if (pinnedQuality !== null || ms > 250) return; // tab was hidden / loading: not a real frame
  const dt = ms / 1000;
  if (perf.settle > 0) { perf.settle -= dt; return; }
  perf.avg += (ms - perf.avg) * 0.05;
  perf.jitter += (Math.abs(ms - perf.avg) - perf.jitter) * 0.05;
  // A rock-steady ~30 fps is a refresh cap (iPhone Low Power Mode, some Android battery savers),
  // not the GPU struggling: lowering the resolution wouldn't make it faster, only blurrier.
  const capped30 = perf.avg > 31 && perf.avg < 35.5 && perf.jitter < 2.5;
  // Below ~50 fps for over a second → cheaper tier. Phones only give up sharpness below ~25 fps:
  // there a crisp 30 fps looks far better than a blurry 45.
  if (perf.avg > (TOUCH ? 40 : 21) && !capped30) perf.slowFor += dt; else perf.slowFor = 0;
  // Holding 60 fps (or better) steadily → a nicer tier is probably affordable.
  if (perf.avg < 17.6) perf.steadyFor += dt; else perf.steadyFor = 0;
  if (perf.slowFor > 1.2 && perf.level < QUALITY.length - 1) {
    // Fell over soon after stepping up? That tier is too heavy: don't try it again.
    if (seconds - perf.lastUp < 12) perf.ceiling = perf.level + 1;
    perf.level++;
    applyQuality();
  } else if (perf.steadyFor > 8 && perf.level > perf.ceiling) {
    perf.level--;
    perf.lastUp = seconds;
    applyQuality();
  }
}

applyQuality();

// ?stats shows a small performance readout (fps, draw calls, triangles, quality tier).
const statsEl = new URLSearchParams(location.search).has('stats') ? document.createElement('pre') : null;
if (statsEl) {
  statsEl.id = 'perf-stats';
  statsEl.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;z-index:99;'
    + 'background:rgba(0,0,0,.65);color:#9f9;font:12px/1.35 monospace;pointer-events:none;border-radius:6px';
  document.body.appendChild(statsEl);
}
let statsT = 0;
function updateStats(dt) {
  if (!statsEl || (statsT += dt) < 0.5) return;
  statsT = 0;
  const r = renderer.info.render, mem = renderer.info.memory, q = QUALITY[perf.level];
  const mats = new Set();
  scene.traverse((o) => { if (o.material) mats.add(o.material); });
  statsEl.textContent = `fps ${Math.round(1000 / perf.avg)}  tier ${perf.level} (res ×${renderer.getPixelRatio().toFixed(2)}, shadow ${q.shadow || 'off'})\n`
    + `draw calls ${r.calls}  triangles ${r.triangles.toLocaleString()}\n`
    + `materials ${mats.size}  shaders ${renderer.info.programs.length}  geometries ${mem.geometries}  textures ${mem.textures}\n`
    + `baked ${bakeStats.sources} meshes → ${bakeStats.meshes}, hidden faces removed ${bakeStats.removed.toLocaleString()}`;
}

// ------------------------------------------------------------ game state

const input = new Input();
const padView = new PadView(input, document.getElementById('padview'));
const effects = new Effects(scene);
const player = new Player(scene);
player.hidden = true;
const haptics = new Haptics(input);
if (ui.isTouch) new TouchPad(input, document.getElementById('touchpad'), haptics);
const fx = { sound, effects, haptic: (name, side) => haptics.play(name, side) };
const burial = new Burial(scene, {
  effects, sound,
  shake: (v) => { game.shake = Math.max(game.shake, v); },
  haptic: (name) => haptics.play(name),
});
const angel = new Angel(player, { effects, sound, haptic: (name) => haptics.play(name) });

const game = {
  state: 'boot', level: 1, levelCount: 3, score: 0, lives: START_LIVES, bananas: 0,
  levelBananas: 0, time: 0, timer: 0, timeBonus: 0, world: null, data: null, remix: 0,
  enemies: [], coconuts: [], checkpoint: { x: 0, y: 0 }, clearShown: false, shake: 0,
  throwCoconut(x, y, vx, vy) {
    game.coconuts.push(new Coconut(scene, x, y, vx, vy));
    sound.throw();
  },
  onEnemyWindup() { sound.alert(); },
  onEnemyPunch() { sound.whoosh(); },
  onSlingAim() { sound.stretch(); },
};
const cam = { x: 0, y: 4, lead: 1.5, zoomOut: 0 };
let clock = 0;

const loadName = () => { try { return localStorage.getItem('mj-name') || ''; } catch { return ''; } };
const saveName = (n) => { try { localStorage.setItem('mj-name', n); } catch { /* storage unavailable */ } };

// ------------------------------------------------------------ server API

// Static build (GitHub Pages): no Python server. Levels are plain files; scores stay on this device.
const LEVEL_COUNT = 3;
function readScores() { try { return JSON.parse(localStorage.getItem('mj-scores') || '[]'); } catch { return []; } }
function topScores(all) { return [...all].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 10); }
async function fetchJSON(url, opts) {
  const lv = url.match(/^\/api\/levels\/(\d+)$/);
  if (lv) {
    const res = await fetch(`levels/level${lv[1]}.json`);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }
  if (url === '/api/levels') return { count: LEVEL_COUNT };
  if (url === '/api/scores') {
    const all = readScores();
    if (opts?.method === 'POST') {
      const d = JSON.parse(opts.body);
      const name = String(d.name || '').replace(/[^\w \-]/g, '').trim().slice(0, 12) || 'Monkey';
      const id = all.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      all.push({ id, name, score: Number(d.score) || 0, level: Number(d.level) || 1 });
      try { localStorage.setItem('mj-scores', JSON.stringify(all)); } catch { /* storage unavailable */ }
      return { id, scores: topScores(all) };
    }
    return { scores: topScores(all) };
  }
  throw new Error(`${url} unavailable`);
}
const postScore = (name, score, level) => fetchJSON('/api/scores', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, score, level }),
});

// ------------------------------------------------------------ levels

function applyTheme(t = {}) {
  const th = {
    skyTop: '#5ec8ff', skyBottom: '#d6f4ff', fog: '#cdeefc',
    sun: '#fff3d6', hemiSky: '#cfefff', hemiGround: '#6aa84f', ...t,
  };
  const root = document.documentElement.style;
  root.setProperty('--sky-top', th.skyTop);
  root.setProperty('--sky-bottom', th.skyBottom);
  scene.fog.color.set(th.fog);
  scene.fog.near = th.fogNear ?? 35;
  scene.fog.far = th.fogFar ?? 100;
  sun.color.set(th.sun);
  hemi.color.set(th.hemiSky);
  hemi.groundColor.set(th.hemiGround);
}

function clearLevel() {
  game.world?.dispose();
  game.world = null;
  game.enemies.forEach((e) => e.remove());
  game.enemies = [];
  game.coconuts.forEach((c) => c.remove());
  game.coconuts = [];
  effects.clear();
  burial.reset();
  angel.reset();
}

async function loadLevel(n, { preview = false } = {}) {
  game.state = 'loading';
  if (!preview) ui.message(`Loading level ${n}…`);
  let data;
  try {
    data = await fetchJSON(`/api/levels/${n}`);
  } catch {
    ui.error('Could not load the level. Check your connection, then try again.',
      () => loadLevel(n, { preview }));
    return;
  }
  // A run that starts over gets a freshly generated level 1 (game.remix is that run's seed).
  if (n === 1 && game.remix && !preview) data = remixLevel(data, game.remix);
  clearLevel();
  game.data = data;
  game.level = n;
  game.world = buildLevel(data, scene, data.seed ?? n);
  applyTheme(data.theme);
  game.enemies = game.world.enemyDefs.map((d) => spawnEnemy(d, scene));
  game.levelBananas = 0;
  game.time = 0;
  game.checkpoint = { ...game.world.spawn };
  player.spawn(game.world.spawn.x, game.world.spawn.y);
  input.clear();

  if (preview) {
    player.dead = true; // keeps throwers quiet behind the title screen
    player.hidden = true;
    game.state = 'title';
    snapCamera();
    showTitle();
  } else {
    player.hidden = false;
    game.state = 'playing';
    snapCamera();
    ui.hide();
    ui.showHud(true);
    ui.toast(`Level ${n}: ${data.name}${data.remix ? ' · new trail' : ''}`);
    updateHud();
  }
}

// Every run (first play, game over, play again) gets a brand-new procedural level 1, so coming back
// to level 1 after losing on a later level never shows the same layout twice in a row. The title
// screen backdrop still shows the hand-made level 1.
function newGame(level = START_LEVEL) {
  sound.unlock();
  const prev = game.remix;
  do game.remix = 1 + Math.floor(Math.random() * 1e9); while (game.remix === prev);
  game.score = 0;
  game.lives = START_LIVES;
  game.bananas = 0;
  player.big = false;
  player.bigTimer = 0;
  loadLevel(level);
}

function goTitle() {
  haptics.stop();
  ui.showHud(false);
  sound.setMusicVolume(0.22);
  loadLevel(START_LEVEL, { preview: true });
}

function showTitle() {
  ui.showHud(false);
  ui.title({ play: newGame, board: () => showBoard() });
}

async function showBoard() {
  ui.message('Loading scores…');
  try {
    const { scores } = await fetchJSON('/api/scores');
    ui.leaderboard(scores, null, { back: showTitle });
  } catch {
    ui.error("Couldn't load the leaderboard.", showTitle);
  }
}

// ------------------------------------------------------------ gameplay events

const _screen = new THREE.Vector3();
function addScore(n, x, y) {
  game.score += n;
  if (x !== undefined) {
    const v = _screen.set(x, y, 0).project(camera);
    ui.popup(`+${n}`, (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight);
  }
}

// hit: the vibration for what hit you ('punched', 'coconut', ...).
// side: -1 = the hit came from the left, +1 = from the right (that grip vibrates).
function hurtPlayer(hit = 'shrink', side = 0) {
  if (player.invuln > 0 || game.state !== 'playing') return;
  if (player.big) {
    player.big = false;
    player.bigTimer = 0;
    player.invuln = 1.6;
    sound.shrink();
    haptics.play('shrink', side); // losing the Super Banana: a small buzz on the hit side
  } else {
    killPlayer(hit, side);
  }
}

function killPlayer(hit = 'die', side = 0) {
  if (game.state !== 'playing') return;
  game.state = 'dying';
  game.lives--;
  player.startDying();
  if (game.lives <= 0) {
    // Out of lives: the coffin rises, takes the monkey and sinks — then Game Over.
    burial.start(player, game.world.solids, game.world.waterY);
    game.timer = BURIAL_TIME;
  } else {
    // Lives left: become an angel and fly back to the last checkpoint.
    game.timer = angel.start(player, game.checkpoint, game.world.waterY);
  }
  sound.die();
  haptics.play(hit, side);
  // A punch/coconut is felt on its side first, then the death rumble on both grips.
  if (hit !== 'die' && hit !== 'splash') {
    setTimeout(() => { if (game.state === 'dying') haptics.play('die'); }, haptics.duration(hit));
  }
  updateHud();
}

function afterDeath() {
  burial.reset();
  angel.reset();
  if (game.lives <= 0) { showEnd(false); return; }
  player.spawn(game.checkpoint.x, game.checkpoint.y);
  player.invuln = 1.5;
  game.state = 'playing';
  input.clear();
}

function levelClear() {
  game.state = 'clear';
  game.timer = 2.2;
  game.clearShown = false;
  player.releaseVine();
  player.celebrating = true;
  player.vx *= 0.3;
  game.timeBonus = Math.max(0, Math.round((game.data.par ?? 120) - game.time)) * 10;
  addScore(1000 + game.timeBonus);
  sound.clear();
  haptics.play('clear');
  effects.confetti(game.world.goal.x, game.world.goal.y + 4);
  updateHud();
}

function showClear() {
  if (game.level >= game.levelCount) { showEnd(true); return; }
  ui.showHud(false);
  ui.levelClear({
    level: game.level, bananas: game.levelBananas, total: game.world.bananas.length,
    timeBonus: game.timeBonus, score: game.score,
  }, nextLevel);
}

// Every new level starts with a full set of hearts (extra lives from bananas are kept).
function nextLevel() {
  game.lives = Math.max(game.lives, START_LIVES);
  loadLevel(game.level + 1);
}

function showEnd(win) {
  game.state = win ? 'win' : 'over';
  ui.showHud(false);
  const level = game.level;
  // Out of hearts: the run starts over from level 1.
  const again = win ? () => newGame() : () => newGame(1);
  ui.endScreen({ win, score: game.score, defaultName: loadName() }, {
    submit: async (name) => {
      saveName(name);
      const res = await postScore(name, game.score, level);
      ui.leaderboard(res.scores, res.id, { back: goTitle, again });
    },
    again,
    title: goTitle,
  });
}

function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  sound.setMusicVolume(0.06);
  haptics.stop();
  showPauseMenu();
}

function showPauseMenu() {
  ui.pause({
    resume: resumeGame,
    restart: () => { sound.setMusicVolume(0.22); loadLevel(game.level); },
    quit: goTitle,
    vibe: () => {
      haptics.setEnabled(!haptics.enabled);
      if (haptics.enabled) haptics.play('checkpoint'); // a little buzz so you feel it's on
      showPauseMenu();
      ui.focusAct('vibe');
    },
    speaker: async () => {
      const pad = sound.pad;
      if (!pad.supported) { ui.toast('🔊 The controller speaker needs Chrome or Edge'); return; }
      // Chrome only shows its "pick a device" list after a real click or key press. Pressing ✕ on
      // the controller doesn't count, so the list would silently never appear.
      const clicked = navigator.userActivation?.isActive ?? true;
      if (navigator.hid && !clicked && !(await pad.hidDevices()).length) {
        ui.toast('🔊 Click this button with the mouse or trackpad (or press Enter) so Chrome can ask for the controller');
        return;
      }
      sound.unlock();
      // Pressing again after a failed attempt (access refused) tries again instead of switching off.
      await pad.setEnabled(!pad.wanted || pad.status === 'no-hid' || pad.status === 'blocked');
      if (pad.status === 'on') sound.banana(); // a test "ding" from the controller
      else if (pad.status === 'no-usb') ui.toast('🔊 Connect the controller with a USB cable to use its speaker');
    },
  }, haptics.enabled, SPEAKER_LABEL[sound.pad.status], haptics.padRumble || !ui.isTouch);
}

// Keep the pause menu label current and say when the speaker comes or goes.
sound.pad.onChange = (status, prev) => {
  if (status === 'on') ui.toast('🔊 Sound effects now play from the controller too');
  else if (prev === 'on' && status === 'no-usb') ui.toast('🔊 Controller speaker unplugged: sound effects stay on the main speakers');
  else if (status === 'blocked') ui.toast('🔊 Allow microphone access so the game can find the controller');
  else if (status === 'no-hid') ui.toast('🔊 Pick the DualSense in the browser\'s list so the game can switch its speaker on');
  if (game.state === 'paused') {
    const focused = document.activeElement?.dataset?.act;
    showPauseMenu();
    if (focused) ui.focusAct(focused);
  }
};

function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  sound.setMusicVolume(0.22);
  ui.hide();
  input.clear();
}

function toggleMute() {
  sound.unlock();
  sound.setMuted(!sound.muted);
  ui.setMuted(sound.muted);
}

// ------------------------------------------------------------ simulation

function checkPickups() {
  const w = game.world;
  const cy = player.y + player.h / 2, reachX = player.w / 2 + 0.35, reachY = player.h / 2 + 0.3;

  for (const b of w.bananas) {
    if (b.taken || Math.abs(b.x - player.x) > reachX || Math.abs(b.y - cy) > reachY) continue;
    b.taken = true;
    b.mesh.visible = false;
    game.bananas++;
    game.levelBananas++;
    addScore(10);
    sound.banana();
    haptics.play('banana', player.facing);
    effects.sparkle(b.x, b.y);
    refillStamina(BANANA_STAMINA);
    if (game.bananas % LIFE_EVERY === 0) {
      game.lives++;
      sound.oneUp();
      haptics.play('oneUp');
      ui.toast('Extra life! 🐵');
    }
  }

  for (const p of w.powerups) {
    if (p.taken || Math.abs(p.x - player.x) > reachX + 0.2 || Math.abs(p.y - cy) > reachY + 0.2) continue;
    p.taken = true;
    p.mesh.visible = false;
    player.big = true;
    player.bigTimer = SUPER_TIME;
    refillStamina(1);
    addScore(200, p.x, p.y + 0.8);
    sound.powerup();
    haptics.play('grow');
    effects.confetti(p.x, p.y);
    ui.toast('Super Banana! You got big 💪');
  }

  for (const c of w.checkpoints) {
    if (c.active || player.x < c.x - 0.5) continue;
    c.active = true;
    c.cp.setActive(true);
    game.checkpoint = { x: c.x, y: c.y };
    sound.checkpoint();
    haptics.play('checkpoint');
    ui.toast('Checkpoint!');
  }

  const g = w.goal;
  if (Math.abs(player.x - g.x) < 1.2 && player.y > g.y - 1 && player.y < g.y + 5) levelClear();
}

function refillStamina(amount) {
  player.stamina = Math.min(1, player.stamina + amount);
  if (player.stamina >= STAMINA.recoverAt) player.exhausted = false;
  ui.flashStamina();
}

function checkEnemyHits() {
  for (const e of game.enemies) {
    if (!e.alive) continue;
    const touching = Math.abs(player.x - e.x) < (player.w + e.w) / 2 && player.y < e.y + e.h && player.y + player.h > e.y;
    if (!touching) continue;
    if (player.vy < 0 && player.prevY >= e.y + e.h * 0.45) {
      e.stomp();
      player.vy = input.held('jump') ? 15 : 10;
      player.squash = 1.25;
      player.jumping = true;
      sound.stomp();
      haptics.play('stomp');
      effects.stars(e.x, e.y + 0.8);
      addScore(100, e.x, e.y + 1.6);
    } else if (!player.swing) {
      // Bumping into an enemy doesn't hurt: just push the monkey back out of its body.
      const dir = player.x < e.x ? -1 : 1;
      player.x = e.x + dir * ((player.w + e.w) / 2);
      if (Math.sign(player.vx) === -dir) player.vx = 0;
      resolveOverlaps(player, game.world.solids);
    }
  }

  // Only a landed punch hurts.
  for (const e of game.enemies) {
    if (e.punchHits(player)) { punchPlayer(e); break; }
  }
}

function punchPlayer(e) {
  if (player.invuln > 0 || game.state !== 'playing') return;
  const hx = (player.x + e.x) / 2, hy = player.y + player.h * 0.6;
  effects.stars(hx, hy);
  sound.punch();
  game.shake = 0.35;
  const side = e.x < player.x ? -1 : 1; // feel the hit on the side it came from
  const v = _screen.set(hx, hy + 0.6, 0).project(camera);
  ui.popup('POW!', (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight);
  if (player.big) {
    // Super monkey survives the punch: shrink and get knocked back.
    player.releaseVine();
    hurtPlayer('punched', side);
    player.vx = e.facing * 9;
    player.vy = 7;
    player.knockT = 0.3;
  } else {
    killPlayer('punched', side); // heavy directional hit first, then the death fade
  }
}

function updateEnemies(dt) {
  const w = game.world;
  for (const e of game.enemies) e.update(dt, w, player, game);
  compact(game.enemies, (e) => !e.gone);
  for (const c of game.coconuts) {
    c.update(dt, w);
    if (c.alive && game.state === 'playing' && c.hits(player)) {
      c.alive = false;
      hurtPlayer('coconut', c.vx > 0 ? -1 : 1);
    }
    if (!c.alive) {
      effects.burst(c.x, c.y, 0x6b4423, 6, { speed: 3, up: 3, life: 0.4 });
      c.remove();
    }
  }
  compact(game.coconuts, (c) => c.alive);
}

/** Remove failing items in place (no new array 120 times a second). */
function compact(list, keep) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (keep(list[i])) list[n++] = list[i];
  list.length = n;
}

function step(dt) {
  const w = game.world;
  if (!w) return;
  w.update(dt);

  switch (game.state) {
    case 'playing':
      game.time += dt;
      player.update(dt, input, w, fx);
      if (player.big && (player.bigTimer -= dt) <= 0) {
        player.big = false;
        player.invuln = 1;
        sound.shrink();
      }
      updateEnemies(dt);
      if (game.state !== 'playing') break;
      checkEnemyHits();
      if (game.state !== 'playing') break;
      checkPickups();
      if (game.state === 'playing' && player.y < w.killY) {
        effects.splash(player.x, w.waterY, w.lava ? 0xff7a20 : 0x9be3ff);
        sound.splash();
        killPlayer('splash');
      }
      break;
    case 'dying':
      player.updateDying(dt);
      burial.update(dt);
      angel.update(dt);
      updateEnemies(dt);
      if ((game.timer -= dt) <= 0) afterDeath();
      break;
    case 'clear':
      player.updateCelebrate(dt, w);
      if ((game.timer -= dt) <= 0 && !game.clearShown) {
        game.clearShown = true;
        showClear();
      }
      break;
    case 'title':
      updateEnemies(dt);
      break;
  }
}

function updateHud() {
  const t = Math.floor(game.time);
  ui.hud({
    bananas: game.bananas, score: game.score, lives: game.lives, level: game.level,
    time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
  });
  ui.stamina(player.stamina, player.exhausted, player.sprinting);
}

// ------------------------------------------------------------ camera

/** Phones: the monkey looks tiny on a small screen, so the camera sits closer (about 50% bigger
 * at rest on a typical phone). Tablets and anything with a short side of 600px+ keep the normal distance. */
function phoneZoom() {
  if (!TOUCH) return 1;
  return Math.min(1, Math.max(0.66, Math.min(innerWidth, innerHeight) / 600));
}

function camDist() {
  // Pull back on narrow (portrait) screens so you can see ahead.
  return CAM_DIST * Math.min(1.9, Math.max(1, 1.5 / camera.aspect)) * phoneZoom() + cam.zoomOut;
}

/** On phones the close-up camera eases back out when the monkey runs, sprints or flies high,
 * so you can still see what's coming, then drifts back in once things calm down. */
function zoomOutTarget() {
  if (phoneZoom() >= 1 || game.state !== 'playing') return 0;
  const speed = Math.min(1, Math.abs(player.vx) / 11);   // 11 = sprint speed (player.js RUN)
  const air = player.onGround ? 0 : Math.min(1, Math.abs(player.vy) / 20);
  return speed * 2 + air * 1.2;
}

function camTarget() {
  const w = game.world;
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camDist() * camera.aspect - 0.5;
  let x, y;
  if (game.state === 'title') {
    const range = Math.max(0, w.maxX - w.minX - 2 * halfW);
    x = w.minX + halfW + (0.5 - 0.5 * Math.cos(clock * 0.06)) * range;
    y = 4;
  } else if (game.state === 'dying' && burial.active) {
    ({ x, y } = burial.focus); // keep the coffin in frame
    y = Math.max(y + 1, 3.2);
  } else {
    x = (player.drawX ?? player.x) + cam.lead;
    // Phones: aim lower (and let the camera drop lower near the ground) so the monkey sits
    // above the touch buttons and the close-up view isn't mostly sky.
    const phone = phoneZoom() < 1;
    y = Math.max((player.drawY ?? player.y) + (phone ? 1.0 : 2.2), phone ? 2.4 : 3.2);
  }
  const lo = w.minX + halfW, hi = w.maxX - halfW;
  x = lo > hi ? (w.minX + w.maxX) / 2 : Math.min(hi, Math.max(lo, x));
  return { x, y };
}

function applyCamera() {
  const d = camDist();
  const sh = game.shake;
  camera.position.set(cam.x + (Math.random() - 0.5) * sh, cam.y + 1.6 + (Math.random() - 0.5) * sh, d);
  camera.lookAt(cam.x, cam.y - 0.6, 0);
  // Move the sun in whole shadow-map texels along x (the light faces straight along -z/-y,
  // so its x axis is the world x axis). This stops shadows shimmering as the camera scrolls.
  const sc = sun.shadow.camera;
  const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
  const sx = Math.round(cam.x / texel) * texel;
  sun.position.set(sx, 22, 14);
  sun.target.position.set(sx, 0, 0);
}

function snapCamera() {
  cam.lead = leadTarget();
  cam.zoomOut = zoomOutTarget();
  Object.assign(cam, camTarget());
  applyCamera();
}

/** How far ahead of the monkey the camera looks: more when running faster, so the
 * follow lag at sprint speed doesn't leave the monkey drifting off-centre. */
function leadTarget() {
  return player.facing * 1.5 + player.vx * 0.18;
}

function updateCamera(dt) {
  if (!game.world) return;
  game.shake = Math.max(0, game.shake - dt * 1.2);
  // Ease the look-ahead instead of snapping it, so turning around or kicking into a sprint
  // glides the view rather than jerking it.
  cam.lead += (leadTarget() - cam.lead) * (1 - Math.exp(-dt * 2.5));
  const z = zoomOutTarget();  // out fairly quickly, back in slowly so it doesn't pump
  cam.zoomOut += (z - cam.zoomOut) * (1 - Math.exp(-dt * (z > cam.zoomOut ? 1.8 : 0.7)));
  const t = camTarget();
  cam.x += (t.x - cam.x) * (1 - Math.exp(-dt * 5));
  cam.y += (t.y - cam.y) * (1 - Math.exp(-dt * 3));
  applyCamera();
}

// ------------------------------------------------------------ main loop

// Physics runs at a fixed 120 Hz but screens refresh at 60/90/144/165 Hz, so frames see a varying
// number of steps (0, 1 or 2). Drawing the raw physics position makes fast motion stutter;
// drawing a blend of the previous and current step positions makes it perfectly even.
function snapshot(b) { b.lastX = b.x; b.lastY = b.y; }
function interpolate(b, a) {
  // Teleports (spawn, checkpoint, vine grab snap) shouldn't be smeared across a frame.
  const far = b.lastX === undefined || Math.abs(b.x - b.lastX) + Math.abs(b.y - b.lastY) > 1.5;
  b.drawX = far ? b.x : b.lastX + (b.x - b.lastX) * a;
  b.drawY = far ? b.y : b.lastY + (b.y - b.lastY) * a;
}

const SIM_STATES = new Set(['playing', 'dying', 'clear', 'title']);
let last = performance.now(), acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  trackPerf(now - last, now / 1000);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  clock += dt;
  input.poll();
  padView.update(dt);

  if (SIM_STATES.has(game.state)) {
    acc += dt;
    while (acc >= STEP) {
      snapshot(player);
      for (const e of game.enemies) snapshot(e);
      for (const c of game.coconuts) snapshot(c);
      step(STEP);
      acc -= STEP;
    }
  } else {
    acc = 0;
  }
  // Draw everything between its last two physics positions, so motion is even on any refresh rate.
  const alpha = acc / STEP;
  interpolate(player, alpha);
  for (const e of game.enemies) interpolate(e, alpha);
  for (const c of game.coconuts) interpolate(c, alpha);

  if (game.world) game.world.animate(clock, dt);
  // Paused / menus: the monkey still draws, but the running whoosh shouldn't keep blowing.
  player.render(dt, SIM_STATES.has(game.state) ? fx : { ...fx, sound: {} });
  // Enemies well off-screen skip posing (35-odd limbs each) and are hidden, so the renderer doesn't
  // walk their parts either. 40 units is past the widest view (portrait) on either side.
  for (const e of game.enemies) {
    const on = Math.abs((e.drawX ?? e.x) - cam.x) < 40;
    e.model.root.visible = on;
    if (on) e.render(dt);
  }
  for (const c of game.coconuts) c.render(dt);
  effects.update(dt);
  updateCamera(dt);
  if (game.state === 'playing') updateHud();
  renderer.render(scene, camera);
  updateStats(dt);
}

// ------------------------------------------------------------ boot

input.onAction = (a, source) => {
  sound.unlock();
  if (source === 'pad') document.body.classList.add('using-pad');
  if (a === 'mute') { toggleMute(); return; }
  if (a === 'controls') { ui.toast(padView.toggle() ? '🎮 On-screen controller shown' : '🎮 On-screen controller hidden (C to show)'); return; }
  // Controller drives the menus: D-pad/stick moves focus, ✕ presses, ○ goes back.
  if (source === 'pad' && ui.isOpen()) {
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') ui.moveFocus(a);
    else if (a === 'jump') ui.pressFocused();
    else if (a === 'back') ui.back();
    else if (a === 'pause' && game.state === 'paused') resumeGame();
    return;
  }
  if (a === 'pause') game.state === 'paused' ? resumeGame() : pauseGame();
};
input.onPadChange = (gp) => {
  ui.toast(gp ? '🎮 Controller connected' : '🎮 Controller disconnected');
  sound.pad.refresh();
  if (!gp) pauseGame();
};
addEventListener('pointerdown', () => sound.unlock());
addEventListener('mousemove', () => document.body.classList.remove('using-pad'));
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// iOS Safari ignores user-scalable=no and, on some elements, touch-action, so a quick double tap
// or a pinch still zoomed the page (and there was no way back). Block both gestures in code.
if (TOUCH) {
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - lastTouchEnd < 350 && !(e.target instanceof Element && e.target.closest('input, textarea'))) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale ?? 1) !== 1) e.preventDefault(); }, { passive: false });
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

  // The game is landscape-only on phones: turning to portrait pauses it behind a "rotate" notice.
  const portrait = matchMedia('(orientation: portrait)');
  portrait.addEventListener('change', () => { if (portrait.matches) pauseGame(); resizeSoon(); });
}

ui.bindHud({ mute: toggleMute, pause: () => (game.state === 'paused' ? resumeGame() : pauseGame()) });
ui.setMuted(sound.muted);

fetchJSON('/api/levels').then((d) => { if (d.count) game.levelCount = d.count; }).catch(() => {});
loadLevel(START_LEVEL, { preview: true });
requestAnimationFrame(frame);
