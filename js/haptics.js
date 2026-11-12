// Controller haptics (PS5 DualSense / any dual-rumble gamepad).
// The two grips are used separately:
//   LEFT motor  (strongMagnitude)  RIGHT motor (weakMagnitude)
// Step sides:
//   'dir'  – the side passed to play(): the way the monkey is moving, or where a hit came from
//   'L'/'R' – always that grip
//   'both' – both grips together (big impacts)
// With no controller connected, the same names play on the phone instead (phonehaptics.js).

import { PhoneHaptics } from './phonehaptics.js';

const P = (priority, ...steps) => ({ priority, steps });
const dir = (v, ms, gap = 0) => ({ side: 'dir', v, ms, gap });
const both = (v, ms, gap = 0) => ({ side: 'both', v, ms, gap });
const L = (v, ms, gap = 0) => ({ side: 'L', v, ms, gap });
const R = (v, ms, gap = 0) => ({ side: 'R', v, ms, gap });

export const PATTERNS = {
  // Movement – felt on the side you're heading.
  banana:      P(0, dir(0.15, 25)),
  jump:        P(0, dir(0.35, 45)),
  step:        P(0, dir(0.2, 35)),                         // sprint footstep
  sprintStart: P(1, dir(0.45, 70, 20), dir(0.25, 45)),
  grab:        P(1, dir(0.5, 70)),
  // Hits – felt on the side they came from.
  coconut:     P(3, dir(0.85, 100, 30), dir(0.35, 80)),
  shrink:      P(3, dir(0.45, 80, 50), dir(0.25, 70)),      // lost the Super Banana: small
  punched:     P(3, dir(1, 150, 40), both(0.45, 110, 30), both(0.2, 80)),
  // Big moments – both grips.
  bounce:      P(2, both(0.3, 45, 20), both(0.5, 55, 20), both(0.8, 100)),
  stomp:       P(2, both(0.65, 70, 20), both(0.25, 50)),
  grow:        P(2, both(0.2, 60, 10), both(0.4, 60, 10), both(0.6, 70, 10), both(0.8, 80, 10), both(1, 160)),
  checkpoint:  P(2, both(0.35, 80, 80), both(0.5, 110)),
  oneUp:       P(2, L(0.5, 60, 50), R(0.5, 60, 50), L(0.6, 60, 50), R(0.6, 60, 50), both(0.8, 150)),
  die:         P(4, both(1, 200), both(0.7, 200), both(0.4, 250), both(0.15, 300)),
  splash:      P(4, both(0.6, 120), both(0.85, 180), both(0.4, 250), both(0.15, 300)),
  clear:       P(4, L(0.5, 90, 60), R(0.5, 90, 60), L(0.55, 80, 50), R(0.55, 80, 40),
    L(0.6, 60, 30), R(0.7, 60, 30), both(1, 300)),
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Haptics {
  constructor(input) {
    this.input = input;
    this.timers = [];
    this.priority = -1;
    this.busyUntil = 0;
    this.phone = new PhoneHaptics();
    try { this.enabled = localStorage.getItem('mj-vibration') !== '0'; } catch { this.enabled = true; }
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('mj-vibration', on ? '1' : '0'); } catch { /* storage unavailable */ }
    if (!on) this.stop();
  }

  /** side < 0: left grip only, side > 0: right grip only, 0: both grips. */
  pulse(side, v, ms) {
    const a = this.input.pad?.vibrationActuator;
    if (!this.enabled || !a?.playEffect) return;
    a.playEffect('dual-rumble', {
      startDelay: 0,
      duration: ms,
      strongMagnitude: side <= 0 ? clamp01(v) : 0,
      weakMagnitude: side >= 0 ? clamp01(v) : 0,
    }).catch(() => {});
  }

  /** A controller that can rumble is connected (it takes over from the phone). */
  get padRumble() { return !!this.input.pad?.vibrationActuator?.playEffect; }

  /** Total length of a pattern in ms. */
  duration(name) {
    if (!this.padRumble && this.phone.supported) return this.phone.duration(name);
    return (PATTERNS[name]?.steps ?? []).reduce((t, s) => t + s.ms + s.gap, 0);
  }

  /** Play a pattern. side: -1 left, +1 right, 0 none (then 'dir' steps use both grips). */
  play(name, side = 0) {
    const pattern = PATTERNS[name];
    if (!pattern || !this.enabled) return;
    const now = performance.now();
    if (now < this.busyUntil && pattern.priority < this.priority) return; // don't cut off something bigger
    if (!this.padRumble) {
      if (!this.phone.play(name)) return; // no phone version (e.g. footsteps)
      this.priority = pattern.priority;
      this.busyUntil = now + this.phone.duration(name);
      return;
    }
    this.clearTimers();
    let t = 0;
    for (const st of pattern.steps) {
      const s = st.side === 'L' ? -1 : st.side === 'R' ? 1 : st.side === 'dir' ? Math.sign(side) : 0;
      const fire = () => this.pulse(s, st.v, st.ms);
      if (t === 0) fire(); else this.timers.push(setTimeout(fire, t));
      t += st.ms + st.gap;
    }
    this.priority = pattern.priority;
    this.busyUntil = now + t;
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** A light tap for touch-button presses; skipped while a game effect is playing. */
  tap() {
    if (!this.enabled || this.padRumble || performance.now() < this.busyUntil) return;
    this.phone.play('tap');
  }

  stop() {
    this.clearTimers();
    this.phone.stop();
    this.busyUntil = 0;
    this.priority = -1;
    this.input.pad?.vibrationActuator?.reset?.().catch?.(() => {});
  }
}
