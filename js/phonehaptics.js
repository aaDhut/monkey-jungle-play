// Phone haptics: the same game moments as the controller (haptics.js), redesigned for phone motors.
//
// Phone motors can't do what a controller's rumble motors do: there's no strength control, a
// pulse under ~10 ms is often not felt at all, and a long buzz just feels cheap and rattly.
// So each effect here is made of separated pulses:
//   - "Stronger" means a longer pulse (20 ms = a light tap ... 250 ms = a heavy thud).
//   - Pulses are at least ~35 ms apart, so even slow (ERM) motors stop between them and you
//     feel separate beats instead of one smeared buzz.
//
// Two engines:
//   Android (Chrome, Firefox, Samsung...): navigator.vibrate([on, off, on, ...]).
//   iPhone: Safari has no vibration API. Since iOS 18, toggling a native switch control plays a
//   Taptic "tick", so each pulse becomes ticks: one tick per short pulse, a quick run of ticks
//   for long pulses (that reads as a rumble).

// [on, off, on, off, ..., on] in ms, like navigator.vibrate().
// Every controller effect has a phone version, with the same rhythm. Pulses are long enough to
// hit hard even on cheap motors: ~20 ms is the lightest tap, 250 ms the heaviest thud.
export const PHONE_PATTERNS = {
  banana:      [25],
  jump:        [35],
  step:        [20],                                   // sprint footstep
  sprintStart: [45, 40, 25],
  grab:        [55],
  coconut:     [90, 50, 40],
  shrink:      [60, 60, 30],
  punched:     [140, 40, 80, 50, 40],
  bounce:      [30, 40, 45, 40, 90],
  stomp:       [80, 40, 30],
  grow:        [25, 40, 35, 40, 45, 40, 60, 35, 150],
  checkpoint:  [50, 80, 90],
  oneUp:       [35, 50, 35, 50, 35, 50, 140],
  die:         [250, 50, 150, 60, 90, 80, 40],
  splash:      [100, 30, 200, 60, 100, 80, 40],
  clear:       [40, 60, 40, 60, 40, 50, 40, 40, 50, 30, 300],
  tap:         [18], // touch button press
};

const TICK_EVERY = 45; // ms between ticks inside a long iPhone pulse
const LONG = 60;       // a pulse at least this long becomes a run of ticks on iPhone

/** Tick times (ms from start) for the iPhone engine. */
function ticksFor(pattern) {
  const out = [];
  let t = 0;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) {
      out.push(t);
      if (ms >= LONG) for (let x = TICK_EVERY; x < ms; x += TICK_EVERY) out.push(t + x);
    }
    t += ms;
  });
  return out;
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS shows as a Mac

export class PhoneHaptics {
  constructor() {
    this.timers = [];
    this.kind = typeof navigator.vibrate === 'function' && !isIOS ? 'vibrate' : isIOS ? 'ios' : null;
    if (this.kind === 'ios') this.makeSwitch();
  }

  get supported() { return this.kind !== null; }

  // A hidden native switch. Clicking its label toggles it, and iOS plays a tick for each toggle.
  makeSwitch() {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    // Don't let the click bubble into the game's own tap handling.
    label.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(label);
    this.label = label;
  }

  tick() { this.label?.click(); }

  /** Length of a pattern in ms. */
  duration(name) {
    return (PHONE_PATTERNS[name] ?? []).reduce((a, b) => a + b, 0);
  }

  play(name) {
    const pattern = PHONE_PATTERNS[name];
    if (!pattern || !this.kind) return false;
    this.stop();
    if (this.kind === 'vibrate') {
      try { navigator.vibrate(pattern); } catch { /* blocked until the first tap */ }
    } else {
      for (const t of ticksFor(pattern)) {
        if (t === 0) this.tick(); else this.timers.push(setTimeout(() => this.tick(), t));
      }
    }
    return true;
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.kind === 'vibrate') try { navigator.vibrate(0); } catch { /* ignore */ }
  }
}
