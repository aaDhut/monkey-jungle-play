// Keyboard, on-screen controller and gamepad (PS5 DualSense) input.
// Movement is "held"; one-shot presses are queued and consumed by the game step.

const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'run', ShiftRight: 'run', KeyX: 'run',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
  KeyC: 'controls',
};
const GAME_KEYS = new Set(['left', 'right', 'jump', 'down', 'run']);

// Standard Gamepad layout, which Chrome, Edge, Firefox and Safari use for the DualSense.
export const BTN = {
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  create: 8, options: 9,
  up: 12, down: 13, left: 14, right: 15,
};
const STICK_X = 0.35;  // left-stick deadzone for walking
const STICK_Y = 0.6;   // stronger push needed for up/down

const isFormTarget = (e) => e.target instanceof Element && e.target.closest('input, textarea, button, select');

export class Input {
  constructor() {
    this.codes = new Set();
    this.screenHeld = new Set(); // set by the on-screen controller (padview.js)
    this.touchHeld = new Set();  // set by the phone touch buttons (touchpad.js)
    this.padHeld = new Set();
    this.queue = new Set();
    this.pad = null;
    this.onAction = null;      // (action, source: 'key' | 'pad')
    this.onPadChange = null;   // (gamepad | null)

    addEventListener('keydown', (e) => {
      const action = MAP[e.code];
      if (!action) return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      if (GAME_KEYS.has(action) && !isFormTarget(e)) e.preventDefault();
      this.codes.add(e.code);
      if (!e.repeat) {
        this.queue.add(action);
        this.onAction?.(action, 'key');
      }
    });
    addEventListener('keyup', (e) => this.codes.delete(e.code));
    addEventListener('blur', () => { this.codes.clear(); });
    addEventListener('gamepadconnected', (e) => this.onPadChange?.(e.gamepad));
    addEventListener('gamepaddisconnected', () => {
      this.pad = null;
      this.padHeld.clear();
      this.onPadChange?.(null);
    });
  }

  held(action) {
    return this.screenHeld.has(action) || this.touchHeld.has(action) || this.padHeld.has(action) || this.keyHeld(action);
  }

  keyHeld(action) {
    for (const c of this.codes) if (MAP[c] === action) return true;
    return false;
  }

  consume(action) {
    const had = this.queue.has(action);
    this.queue.delete(action);
    return had;
  }

  clear() { this.queue.clear(); this.touchHeld.clear(); }

  /** Read the controller once per frame and turn button changes into actions. */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.pad = gp;
    const now = new Set();
    if (gp) {
      const b = (i) => !!gp.buttons[i]?.pressed;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (b(BTN.left) || ax < -STICK_X) now.add('left');
      if (b(BTN.right) || ax > STICK_X) now.add('right');
      if (b(BTN.up) || ay < -STICK_Y) now.add('up');
      if (b(BTN.down) || ay > STICK_Y) now.add('down');
      if (b(BTN.cross)) now.add('jump');
      if (b(BTN.square) || b(BTN.r1) || b(BTN.r2)) now.add('run');
      if (b(BTN.circle)) { now.add('back'); now.add('down'); } // ○ also drops off a vine
      if (b(BTN.options)) now.add('pause');
      if (b(BTN.create)) now.add('mute');
    }
    for (const a of now) {
      if (this.padHeld.has(a)) continue;
      if (GAME_KEYS.has(a)) this.queue.add(a);
      this.onAction?.(a, 'pad');
    }
    this.padHeld = now;
  }
}
