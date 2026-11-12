// HUD, menus, toasts and score popups (plain DOM on top of the 3D canvas).

const $ = (id) => document.getElementById(id);
const overlay = $('overlay');
const hudEl = $('hud');
const padEl = $('padview');
const toastEl = $('toast');
export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function screen(html, actions = {}) {
  overlay.innerHTML = `<div class="card">${html}</div>`;
  overlay.classList.add('show');
  for (const btn of overlay.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', () => actions[btn.dataset.act]?.());
  }
  overlay.querySelector('[data-focus], [data-primary]')?.focus({ preventScroll: true });
  return overlay;
}

export function hide() {
  overlay.classList.remove('show');
  overlay.innerHTML = '';
}

const PAD_CONTROLS = `<p class="controls pad-controls">🎮 <b>PS5 controller:</b> <kbd>L-stick</kbd>/<kbd>D-pad</kbd> move ·
  <kbd>✕</kbd> jump · <kbd>□</kbd>/<kbd>R2</kbd> sprint · <kbd>○</kbd> drop off vine · <kbd>Options</kbd> pause</p>`;
const CONTROLS = isTouch
  ? '<p class="controls">◀ ▶ move · ⤒ jump (hold = higher) · ⚡ sprint. Jump into a vine to swing, jump again to let go.</p>'
  : `<p class="controls"><kbd>←</kbd><kbd>→</kbd> move · <kbd>Space</kbd> jump (hold = higher) · <kbd>Shift</kbd> sprint (uses ⚡, bananas refill it)<br>
     Jump into a vine to swing, <kbd>Space</kbd> to let go · <kbd>P</kbd> pause · <kbd>M</kbd> sound · <kbd>C</kbd> on-screen controller</p>`;

export const isOpen = () => overlay.classList.contains('show');

const focusables = () => [...overlay.querySelectorAll('button:not([disabled]), input')];

/** Controller menu navigation: move focus between the screen's buttons. */
export function moveFocus(dir) {
  const list = focusables();
  if (!list.length) return;
  let i = list.indexOf(document.activeElement);
  if (i === -1) {
    (overlay.querySelector('[data-primary]') ?? list[0]).focus({ preventScroll: true });
    return;
  }
  i = (i + (dir === 'up' || dir === 'left' ? -1 : 1) + list.length) % list.length;
  list[i].focus({ preventScroll: true });
}

/** Controller ✕: press whatever is focused (or the main button). */
export function pressFocused() {
  const el = overlay.contains(document.activeElement) ? document.activeElement : overlay.querySelector('[data-primary]');
  if (!el) return;
  if (el.tagName === 'INPUT') el.form?.requestSubmit();
  else el.click();
}

/** Controller ○: go back / resume if the screen has such a button. */
export function back() {
  overlay.querySelector('[data-act=resume], [data-act=back], [data-act=title]')?.click();
}

// iPhone Safari can't hide its bars from a web page; only a Home Screen launch is full screen.
const isIOS = /iPhone|iPod/.test(navigator.userAgent);
const isStandalone = navigator.standalone === true
  || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
const HOME_HINT = isIOS && !isStandalone
  ? '<p class="home-hint">📲 For full screen: tap <b>Share</b> → <b>Add to Home Screen</b>, then open Monkey Jungle from its icon.</p>'
  : '';

/** Android phones/tablets: go full screen and lock to landscape when the player taps Play. */
function goFullscreen() {
  if (!isTouch || isStandalone || document.fullscreenElement) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return; // iPhone: not supported, the Home Screen hint covers it
  Promise.resolve(req.call(el, { navigationUI: 'hide' }))
    .then(() => window.screen.orientation?.lock?.('landscape')) // window.: screen() above shadows it
    .catch(() => {});
}

export function title(actions) {
  const play = actions.play;
  actions = { ...actions, play: () => { goFullscreen(); play?.(); } };
  screen(`
    <div class="logo">Monkey<span>Jungle</span></div>
    <p class="tag">Run, jump and swing through the jungle to the golden banana tree!
      Guard monkeys <b>punch</b> if you get too close. Watch for the <b style="color:#e53935">!</b> and jump on their heads.</p>
    <div class="buttons">
      <button class="btn primary" data-primary data-act="play">▶ Play</button>
      <button class="btn" data-act="board">🏆 Leaderboard</button>
    </div>
    ${HOME_HINT}${CONTROLS}${PAD_CONTROLS}
    <p class="credit">Controller model: <a href="https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936" target="_blank" rel="noopener">“Playstation 5 Dualsense”</a> by AHarmlessPotato, <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> (textures removed, split into parts)</p>`, actions);
}

export function message(text) {
  screen(`<p class="msg">${esc(text)}</p>`);
}

export function error(text, retry) {
  screen(`<h2>Oops!</h2><p class="msg">${esc(text)}</p>
    <div class="buttons"><button class="btn primary" data-primary data-act="retry">Try again</button></div>`, { retry });
}

export function pause(actions, vibrationOn = true, speakerLabel = 'Off', controller = true) {
  screen(`<h2>Paused</h2>
    <div class="buttons col">
      <button class="btn primary" data-primary data-act="resume">▶ Resume</button>
      <button class="btn" data-act="restart">↻ Restart level</button>
      <button class="btn" data-act="vibe">📳 ${controller ? 'Controller vibration' : 'Vibration'}: ${vibrationOn ? 'On' : 'Off'}</button>
      <button class="btn" data-act="speaker">🔊 Sound effects from controller: ${esc(speakerLabel)}</button>
      <button class="btn" data-act="quit">⌂ Quit to title</button>
    </div>`, actions);
}

/** Re-focus a button after a screen re-renders (keeps controller navigation in place). */
export function focusAct(act) {
  overlay.querySelector(`[data-act="${act}"]`)?.focus({ preventScroll: true });
}

export function levelClear({ level, bananas, total, timeBonus, score }, next) {
  screen(`<h2>Level ${level} clear! 🎉</h2>
    <div class="stats">
      <div><span>🍌 Bananas</span><b>${bananas} / ${total}</b></div>
      <div><span>⏱ Time bonus</span><b>+${timeBonus}</b></div>
      <div><span>⭐ Score</span><b>${score}</b></div>
    </div>
    <div class="buttons"><button class="btn primary" data-primary data-act="next">Next level ▶</button></div>`, { next });
}

export function endScreen({ win, score, defaultName }, actions) {
  const el = screen(`
    <h2>${win ? 'You beat the jungle! 🏆' : 'Game over'}</h2>
    ${win ? '' : '<p>Out of hearts! Back to Level 1 with ❤️❤️❤️</p>'}
    <p class="big-score">⭐ ${score}</p>
    <form class="name-form" id="score-form">
      <input id="name-input" maxlength="12" placeholder="Your name" autocomplete="off" ${isTouch ? '' : 'data-focus'}>
      <button class="btn primary" type="submit">Save score</button>
    </form>
    <p class="form-msg" id="form-msg"></p>
    <div class="buttons">
      <button class="btn" data-act="again" ${isTouch ? 'data-primary' : ''}>${win ? '↻ Play again' : '↻ Back to Level 1'}</button>
      <button class="btn" data-act="title">⌂ Title</button>
    </div>`, actions);
  const input = el.querySelector('#name-input');
  const btn = el.querySelector('#score-form button');
  const msg = el.querySelector('#form-msg');
  input.value = defaultName || '';
  el.querySelector('#score-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim() || 'Monkey'; // controller players can save without typing
    btn.disabled = true;
    msg.textContent = 'Saving…';
    try {
      await actions.submit(name);
    } catch {
      msg.textContent = "Couldn't save your score. Is the Python server running?";
      btn.disabled = false;
    }
  });
}

export function leaderboard(scores, highlightId, actions) {
  const el = screen(`<h2>🏆 Top monkeys</h2>
    <ol class="board" id="board"></ol>
    <div class="buttons">
      ${actions.again ? '<button class="btn primary" data-primary data-act="again">↻ Play again</button>' : ''}
      <button class="btn ${actions.again ? '' : 'primary'}" ${actions.again ? '' : 'data-primary'} data-act="back">⌂ Title</button>
    </div>`, actions);
  const list = el.querySelector('#board');
  if (!scores.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No scores yet. Be the first!';
    list.appendChild(li);
  }
  for (const s of scores) {
    const li = document.createElement('li');
    if (s.id === highlightId) li.className = 'me';
    const name = document.createElement('span');
    name.textContent = s.name;
    const score = document.createElement('b');
    score.textContent = s.score;
    li.append(name, score);
    list.appendChild(li);
  }
}

// ------------------------------------------------------------ HUD

const shown = {};
export function hud(values) {
  for (const k in values) {
    if (shown[k] !== values[k]) {
      shown[k] = values[k];
      $(`hud-${k}`).textContent = values[k];
    }
  }
}

const staminaPill = $('hud-stamina-pill');
const staminaFill = $('hud-stamina');
let shownStamina = -1;
/** Sprint bar: v is 0..1. Turns red when low, greys out while exhausted, glows while sprinting. */
export function stamina(v, exhausted, sprinting) {
  const pct = Math.round(v * 200) / 2;
  if (pct !== shownStamina) {
    shownStamina = pct;
    staminaFill.style.width = `${pct}%`;
    staminaPill.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  staminaPill.classList.toggle('low', v < 0.25);
  staminaPill.classList.toggle('empty', exhausted);
  staminaPill.classList.toggle('active', sprinting);
}

export function flashStamina() {
  staminaPill.classList.remove('refill');
  void staminaPill.offsetWidth; // restart the CSS animation
  staminaPill.classList.add('refill');
}

export function showHud(on) {
  hudEl.classList.toggle('hidden', !on);
  padEl.classList.toggle('hidden', !on);
}

export function bindHud({ mute, pause: onPause }) {
  $('btn-mute').addEventListener('click', (e) => { mute(); e.currentTarget.blur(); });
  $('btn-pause').addEventListener('click', (e) => { onPause(); e.currentTarget.blur(); });
}

export function setMuted(m) {
  $('btn-mute').textContent = m ? '🔇' : '🔊';
}

export function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // restart the CSS animation
  toastEl.classList.add('show');
}

export function popup(text, x, y) {
  const d = document.createElement('div');
  d.className = 'pop';
  d.textContent = text;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 900);
}
