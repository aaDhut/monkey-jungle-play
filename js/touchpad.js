// Touch controls for phones and tablets: big, clear buttons drawn as plain DOM on top of the game.
// A joystick bottom-left, ⚡ Sprint and ⤒ Jump bottom-right.
//
// Left thumb: joystick. Put the thumb down anywhere in the lower-left area and the stick jumps
// under it (no need to aim); push left/right to walk, pull down to drop off a vine.
//
// Right thumb: slide between ⚡ and ⤒ without lifting, like holding R2 and pressing ✕ on a
// controller (or the other way round):
//   - Sprint latches on as soon as the thumb touches ⚡ and stays on until the thumb lifts.
//   - Every time the thumb lands on ⤒ (first touch or slid over from ⚡) the monkey jumps.
//     Jump stays held after that, so the jump goes full height even if the thumb slides away.
//   So: ⤒ then slide to ⚡ = jump, then sprint.  ⚡ then slide to ⤒ = sprint jump.
//   Slide back and forth to keep sprint-jumping.
//
// Hidden while a real controller is connected (the 3D controller view takes over then).
//
// iPhone vibration: iOS won't let a web page vibrate by itself, only when your finger flips a
// real switch control. So each button has an invisible switch laid over it (.tp-tick): tapping
// the button flips it and iOS plays its tick.

const GAME_KEYS = new Set(['left', 'right', 'jump', 'down', 'run']);
const RIGHT = new Set(['run', 'jump']);
const REACH = 1.15; // a sliding thumb counts as "on" a right button within this × its radius
const STICK_DEAD = 0.28;  // fraction of the stick's travel before it starts walking
const STICK_DOWN = 0.65;  // pull this far down to drop off a vine

const LAYOUT = `
  <div class="tp-stick-zone" aria-label="Joystick: move left and right">
    <div class="tp-stick"><div class="tp-knob"></div></div>
  </div>
  <div class="tp-group tp-right">
    <div class="tp-btn tp-run" data-a="run" role="button" aria-label="Sprint (slide to Jump for a sprint jump)">⚡<input type="checkbox" switch class="tp-tick" tabindex="-1" aria-hidden="true"></div>
    <div class="tp-btn tp-jump" data-a="jump" role="button" aria-label="Jump (slide to Sprint to start sprinting)">⤒<input type="checkbox" switch class="tp-tick" tabindex="-1" aria-hidden="true"></div>
  </div>`;

export class TouchPad {
  constructor(input, root, haptics) {
    this.input = input;
    this.haptics = haptics; // light taps on presses (Jump skips it: the jump has its own)
    this.root = root;
    // finger id -> { side: 'left' | 'right', on: button under the thumb (or null), held: Set }
    this.fingers = new Map();
    root.innerHTML = LAYOUT;
    root.classList.remove('hidden');
    this.buttons = {};
    for (const b of root.querySelectorAll('.tp-btn')) this.buttons[b.dataset.a] = b;
    this.zone = root.querySelector('.tp-stick-zone');
    this.stick = root.querySelector('.tp-stick');
    this.knob = root.querySelector('.tp-knob');

    // Phones: native touch events, claimed with preventDefault on touchstart. With pointer events
    // iOS starts its own long-press gesture after ~0.5 s and cancels the touch for the page.
    const each = (e, fn) => { for (const t of e.changedTouches) fn({ id: 't' + t.identifier, x: t.clientX, y: t.clientY }); };
    root.addEventListener('touchstart', (e) => {
      let ours = false;
      each(e, (t) => { ours = this.down(t) || ours; });
      if (ours) e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', (e) => { e.preventDefault(); each(e, (t) => this.move(t)); }, { passive: false });
    root.addEventListener('touchend', (e) => {
      // Let a tap on an invisible switch through so it flips (that's the iPhone tick).
      if (!e.target.classList?.contains('tp-tick')) e.preventDefault();
      each(e, (t) => this.up(t));
    }, { passive: false });
    root.addEventListener('touchcancel', (e) => each(e, (t) => this.up(t)));
    // Mouse / pen (and touch on browsers without touch events).
    const fromPointer = (e) => ({ id: 'p' + e.pointerId, x: e.clientX, y: e.clientY });
    const skip = (e) => e.pointerType === 'touch' && 'ontouchstart' in window;
    root.addEventListener('pointerdown', (e) => { if (!skip(e) && this.down(fromPointer(e))) e.preventDefault(); });
    addEventListener('pointermove', (e) => { if (!skip(e)) this.move(fromPointer(e)); }, { passive: true });
    addEventListener('pointerup', (e) => { if (!skip(e)) this.up(fromPointer(e)); });
    addEventListener('pointercancel', (e) => { if (!skip(e)) this.up(fromPointer(e)); });

    addEventListener('blur', () => this.releaseAll());
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    const onPad = () => this.setPadConnected([...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected));
    addEventListener('gamepadconnected', onPad);
    addEventListener('gamepaddisconnected', onPad);
  }

  /** The button directly under a point (used for the first touch). */
  buttonAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.tp-btn');
    return el && this.root.contains(el) ? el.dataset.a : null;
  }

  /** For a sliding right thumb: the nearest of ⚡/⤒ if the thumb is within reach of it. */
  rightButtonNear(x, y) {
    let best = null, bestD = Infinity;
    for (const a of RIGHT) {
      const r = this.buttons[a].getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) / (r.width / 2);
      if (d < REACH && d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  down(t) {
    const hit = document.elementFromPoint(t.x, t.y);
    if (hit && this.zone.contains(hit)) return this.stickDown(t);
    const a = this.buttonAt(t.x, t.y);
    if (!a) return false;
    const f = { side: RIGHT.has(a) ? 'right' : 'left', on: null, held: new Set() };
    this.fingers.set(t.id, f);
    this.enter(f, a);
    return true;
  }

  move(t) {
    const f = this.fingers.get(t.id);
    if (!f) return;
    if (f.side === 'stick') { this.stickMove(f, t); return; }
    if (f.side === 'right') {
      const a = this.rightButtonNear(t.x, t.y);
      if (a !== f.on) this.enter(f, a); // null = thumb is between/off the buttons: keep what's held
      return;
    }
  }

  // ---- joystick
  stickDown(t) {
    if ([...this.fingers.values()].some((f) => f.side === 'stick')) return true; // one thumb only
    // Float the stick under the thumb (clamped so it stays fully on screen).
    const r = this.stick.offsetWidth / 2;
    const cx = Math.min(innerWidth - r, Math.max(r, t.x)), cy = Math.min(innerHeight - r, Math.max(r, t.y));
    this.stick.style.left = `${cx - r}px`;
    this.stick.style.top = `${cy - r}px`;
    this.stick.classList.add('active');
    const f = { side: 'stick', on: null, held: new Set(), cx, cy, r };
    this.fingers.set(t.id, f);
    this.stickMove(f, t);
    return true;
  }

  stickMove(f, t) {
    let dx = (t.x - f.cx) / f.r, dy = (t.y - f.cy) / f.r;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.knob.style.transform = `translate(${dx * 75}%, ${dy * 75}%)`;
    const held = new Set();
    if (dx < -STICK_DEAD) held.add('left');
    if (dx > STICK_DEAD) held.add('right');
    if (dy > STICK_DOWN && Math.abs(dx) < 0.7) held.add('down');
    const same = held.size === f.held.size && [...held].every((a) => f.held.has(a));
    if (!same) {
      if (held.size && !f.held.size) this.haptics?.tap();
      f.held = held;
      this.sync();
    }
  }

  stickReset() {
    this.stick.style.left = this.stick.style.top = '';
    this.knob.style.transform = '';
    this.stick.classList.remove('active');
  }

  /** The thumb arrives on button `a` (or leaves all buttons when `a` is null). */
  enter(f, a) {
    f.on = a;
    if (!a) { this.sync(); return; }
    f.held.add(a); // right side: sprint and jump both latch until the thumb lifts
    // Each arrival on Jump is a fresh press, even if Jump is still held from an earlier visit.
    if (a === 'jump') this.input.queue.add('jump');
    this.sync();
    if (a !== 'jump') this.haptics?.tap();
  }

  up(t) {
    const f = this.fingers.get(t.id);
    if (!f) return;
    this.fingers.delete(t.id);
    if (f.side === 'stick') this.stickReset();
    this.sync();
  }

  releaseAll() {
    this.fingers.clear();
    this.stickReset();
    this.sync();
  }

  setPadConnected(on) {
    this.root.classList.toggle('pad-on', on);
    if (on) this.releaseAll();
  }

  /** Turn the fingers on screen into held actions; a newly held action also queues a press. */
  sync() {
    const now = new Set();
    for (const f of this.fingers.values()) for (const a of f.held) now.add(a);
    const input = this.input;
    for (const a of now) {
      if (input.touchHeld.has(a)) continue;
      if (GAME_KEYS.has(a)) input.queue.add(a);
      input.onAction?.(a, 'pad');
    }
    input.touchHeld = now;

    const under = new Set();
    for (const f of this.fingers.values()) if (f.on) under.add(f.on);
    this.stick.classList.toggle('left', now.has('left'));
    this.stick.classList.toggle('right', now.has('right'));
    for (const [a, btn] of Object.entries(this.buttons)) {
      btn.classList.toggle('on', now.has(a));      // active (latched sprint stays lit)
      btn.classList.toggle('thumb', under.has(a)); // the thumb is on it right now
    }
  }
}
