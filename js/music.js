// Tropical orchestral score, synthesized with the Web Audio API (no audio files).
//
// The score is not played note by note during the game: building thousands of audio nodes a minute
// alongside the 3D scene eventually overloads the browser's audio thread, and then every sound stops.
// Instead, Soundtrack (at the bottom) renders the score once, in the background, into a seamless
// ~2 minute loop, and plays that as a single looping buffer that costs almost nothing.
//
// 132 BPM. A 4-bar intro plays once, then four 8-bar sections loop, each in its own key and mode:
//   Sunrise  C Lydian            marimba, harp, birds and a high pad waking up
//   Canopy   C major             the main groove: flute melody, steel pan, congas, clave, strings
//   River    A Dorian            dembow-style beat, pizzicato strings, brass stabs, steel pan lead
//   Summit   D major/Mixolydian  key change up: soaring violins, full brass, crashes, timbales
//   Lagoon   F Lydian            breakdown: harp, flute and birds, then a drum build back to Canopy
// Every second time round, Canopy hands its melody from the flute to the steel pan.
//
// The mix is laid out like a 3D sound stage (HRTF binaural panning, best on headphones):
// marimba front-left, steel pan front-right, flute and violins up front, congas left and right,
// pizzicato strings and harp behind you, a pad in the height layer overhead, the shaker
// circling your head and birds calling from above. Strings and brass are spread wide in stereo.

const BPM = 132;
const STEP = 60 / BPM / 4; // a 16th note
const BAR = STEP * 16;
const INTRO_BARS = 4;
const LOOP = ['canopy', 'river', 'summit', 'lagoon'];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const human = (v) => v * rand(0.9, 1.08);

// Each section: one chord per bar as [bass note, voicing], and a melody per bar as [step, note, length in 16ths].
const SECTIONS = {
  sunrise: {
    chords: [
      [36, [60, 64, 67, 71]], // Cmaj7
      [36, [62, 66, 69, 72]], // D/C, the Lydian #4
      [36, [60, 64, 67, 71]], // Cmaj7
      [43, [55, 60, 62, 65]], // G7sus4
    ],
  },
  canopy: {
    chords: [
      [36, [60, 64, 67, 71]], // Cmaj7
      [45, [57, 60, 64, 67]], // Am7
      [41, [53, 57, 60, 64]], // Fmaj7
      [43, [55, 59, 62, 65]], // G7
      [36, [60, 64, 67, 71]], // Cmaj7
      [40, [55, 59, 62, 64]], // Em7
      [41, [53, 57, 60, 64]], // Fmaj7
      [43, [55, 59, 62, 65]], // G7
    ],
    melody: [
      [[0, 76, 3], [3, 79, 3], [6, 81, 2], [8, 79, 4], [12, 76, 2], [14, 74, 2]],
      [[0, 72, 3], [3, 76, 3], [6, 81, 6], [12, 79, 4]],
      [[0, 81, 3], [3, 84, 3], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 4]],
      [[0, 74, 3], [3, 79, 3], [6, 83, 2], [8, 81, 4], [12, 79, 4]],
      [[0, 76, 3], [3, 79, 3], [6, 84, 2], [8, 86, 4], [12, 84, 2], [14, 81, 2]],
      [[0, 83, 6], [6, 79, 2], [8, 76, 4], [12, 79, 4]],
      [[0, 81, 3], [3, 79, 3], [6, 77, 2], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
      [[0, 74, 8], [12, 71, 2], [14, 74, 2]],
    ],
  },
  river: {
    chords: [
      [45, [55, 57, 60, 64]], // Am7
      [38, [54, 57, 60, 62]], // D7, the Dorian IV
      [45, [55, 57, 60, 64]], // Am7
      [38, [54, 57, 60, 62]], // D7
      [36, [55, 59, 60, 64]], // Cmaj7
      [43, [55, 59, 62, 67]], // G
      [42, [54, 57, 62, 66]], // D/F#
      [45, [55, 57, 61, 64]], // A7, pivot into D major
    ],
    melody: [
      [[0, 81, 2], [2, 84, 2], [4, 83, 2], [6, 81, 2], [10, 76, 2], [12, 78, 4]],
      [[0, 81, 4], [4, 78, 2], [6, 76, 2], [8, 74, 4], [12, 72, 2], [14, 74, 2]],
      [[0, 76, 2], [2, 81, 2], [4, 84, 2], [6, 88, 4], [10, 86, 2], [12, 84, 2], [14, 83, 2]],
      [[0, 81, 6], [6, 78, 2], [8, 81, 8]],
      [[0, 79, 3], [3, 76, 3], [6, 79, 2], [8, 84, 4], [12, 83, 4]],
      [[0, 86, 3], [3, 83, 3], [6, 79, 2], [8, 74, 4], [12, 79, 4]],
      [[0, 78, 3], [3, 81, 3], [6, 86, 2], [8, 81, 4], [12, 78, 4]],
      [[0, 76, 3], [3, 79, 3], [6, 85, 4], [10, 88, 2], [12, 85, 2], [14, 81, 2]],
    ],
  },
  summit: {
    chords: [
      [38, [57, 62, 66, 69]], // D
      [47, [54, 59, 62, 66]], // Bm
      [43, [55, 59, 62, 67]], // G
      [45, [57, 61, 64, 69]], // A
      [38, [57, 62, 66, 69]], // D
      [36, [55, 60, 64, 67]], // C, the Mixolydian bVII
      [43, [55, 59, 62, 67]], // G
      [45, [55, 61, 64, 69]], // A7
    ],
    melody: [
      [[0, 78, 4], [4, 81, 4], [8, 86, 6], [14, 88, 2]],
      [[0, 90, 6], [6, 88, 2], [8, 86, 4], [12, 83, 4]],
      [[0, 86, 3], [3, 83, 3], [6, 79, 2], [8, 83, 4], [12, 86, 4]],
      [[0, 85, 6], [6, 88, 2], [8, 81, 8]],
      [[0, 78, 3], [3, 81, 3], [6, 86, 2], [8, 90, 4], [12, 88, 2], [14, 86, 2]],
      [[0, 88, 3], [3, 84, 3], [6, 79, 2], [8, 84, 4], [12, 88, 4]],
      [[0, 86, 4], [4, 83, 4], [8, 79, 4], [12, 83, 4]],
      [[0, 81, 8], [8, 85, 4], [12, 88, 4]],
    ],
  },
  lagoon: {
    chords: [
      [41, [57, 60, 64, 71]], // Fmaj7#11
      [41, [55, 59, 62, 67]], // G/F, Lydian colour
      [41, [57, 60, 64, 69]], // Fmaj7
      [41, [55, 59, 62, 67]], // G/F
      [38, [57, 60, 62, 65]], // Dm7
      [45, [55, 60, 64, 67]], // Am7
      [46, [57, 58, 62, 65]], // Bbmaj7
      [43, [53, 59, 62, 65]], // G7, back to C
    ],
    melody: [
      [[0, 84, 4], [4, 83, 4], [8, 81, 8]],
      [[0, 83, 4], [4, 86, 4], [8, 88, 8]],
      [[0, 89, 4], [4, 88, 2], [6, 84, 2], [8, 81, 8]],
      [[0, 79, 4], [4, 83, 4], [8, 86, 8]],
      [[0, 86, 6], [6, 84, 2], [8, 81, 8]],
      [[0, 84, 6], [6, 83, 2], [8, 76, 8]],
      [[0, 86, 4], [4, 89, 4], [8, 81, 4], [12, 82, 4]],
      [[0, 83, 4], [4, 86, 4], [8, 89, 4], [12, 91, 4]],
    ],
  },
};

// marimba arpeggio: indexes into the chord plus the chord an octave up
const ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 1, 3, 2, 4, 3, 5];
// harp, rising in 8ths
const HARP = [0, 1, 2, 3, 4, 5, 6, 7];
// tresillo bass (3+3+2): [step, interval, length]
const BASS_LINE = [[0, 'root', 3], [3, 'root', 2], [6, 'fifth', 2], [8, 'oct', 3], [11, 'fifth', 2], [14, 'root', 2]];
// son clave across one bar
const CLAVE = [0, 3, 6, 10, 12];
// conga tumbao: step -> [drum, velocity, slap]
const CONGA = { 2: ['hi', 0.6, true], 6: ['lo', 0.9], 7: ['lo', 0.65], 10: ['hi', 0.7], 13: ['hi', 0.5, true], 14: ['lo', 0.9], 15: ['lo', 0.6] };
// syncopated brass stabs: [step, velocity, length]
const BRASS = [[0, 1, 3], [6, 0.75, 2], [10, 0.9, 4]];
// the reggaeton-style dembow snare
const DEMBOW = [3, 6, 11, 14];

export class TropicalScore {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.step = 0;
    this.next = 0;
    this.timer = null;
    this.prevLead = null;
    this.build(destination);
  }

  start() {
    if (this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  schedule() {
    const now = this.ctx.currentTime;
    if (this.next < now - 0.1) this.next = now + 0.05; // the tab was in the background
    while (this.next < now + 0.12) {
      this.playStep(this.step, this.next);
      this.next += STEP;
      this.step++;
    }
  }

  // --- the mixing desk ---

  build(destination) {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0.8;
    out.connect(destination);
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(out);
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.02;
    glue.release.value = 0.2;
    glue.connect(limiter);
    this.mix = c.createGain();
    this.mix.connect(glue);

    // a warm, wide hall: decorrelated left and right tails with early reflections
    this.verb = c.createGain();
    const hp = this.filter('highpass', 220);
    const pre = c.createDelay(0.1);
    pre.delayTime.value = 0.025;
    const conv = c.createConvolver();
    conv.buffer = this.impulse(2.8);
    const lp = this.filter('lowpass', 8000);
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.verb.connect(hp).connect(pre).connect(conv).connect(lp).connect(wet).connect(this.mix);

    // dotted-8th ping-pong echo that bounces left, right, left...
    this.echo = c.createGain();
    this.echo.channelCount = 1;
    this.echo.channelCountMode = 'explicit';
    const left = c.createDelay(2);
    const right = c.createDelay(2);
    left.delayTime.value = STEP * 3;
    right.delayTime.value = STEP * 3;
    const tone = this.filter('lowpass', 3200);
    const feedback = c.createGain();
    feedback.gain.value = 0.33;
    const merger = c.createChannelMerger(2);
    this.echo.connect(left).connect(tone);
    tone.connect(merger, 0, 0);
    tone.connect(right);
    right.connect(merger, 0, 1);
    right.connect(feedback).connect(left);
    merger.connect(this.mix);
    this.send(merger, this.verb, 0.25);

    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.warmth = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) this.warmth[i] = Math.tanh(((i / 1023) * 2 - 1) * 2.5) / Math.tanh(2.5);
    // single-oscillator timbres, built from harmonic weights
    const wave = (h) => c.createPeriodicWave(new Float32Array(h.length + 1), new Float32Array([0, ...h]));
    this.waves = {
      pan: wave([0, 0.8, 0.45, 0.15]),
      harp: wave([1, 0.3, 0.12, 0.04, 0.03]),
    };

    // the stage. Listener at the origin facing -z: x is right, y is up, +z is behind you.
    const b = (o) => this.bus(o);
    this.b = {
      kick: b({ gain: 0.8 }),
      clap: b({ pan: 0.1, gain: 0.5, rev: 0.35 }),
      shaker: b({ pos: [1.5, 0.3, 0], gain: 0.55, rev: 0.15 }),
      congaHi: b({ pos: [-1.6, 0, -0.8], gain: 0.75, rev: 0.2 }),
      congaLo: b({ pos: [1.6, 0, -0.8], gain: 0.75, rev: 0.2 }),
      clave: b({ pan: 0.35, gain: 0.35, rev: 0.3, dly: 0.15 }),
      timbaleHi: b({ pan: -0.6, gain: 0.5, rev: 0.3 }),
      timbaleLo: b({ pan: 0.6, gain: 0.5, rev: 0.3 }),
      cymbal: b({ gain: 0.4, rev: 0.5 }),
      bass: b({ gain: 0.6 }),
      marimba: b({ pos: [-2, 0, -1.6], gain: 0.55, rev: 0.3, dly: 0.12 }),
      steelpan: b({ pos: [2, 0.4, -1.6], gain: 0.6, rev: 0.35, dly: 0.18 }),
      flute: b({ pos: [0, 0.6, -2], gain: 0.6, rev: 0.4, dly: 0.2 }),
      violins: b({ pos: [-0.6, 0.8, -2.2], gain: 0.55, rev: 0.5, dly: 0.1 }),
      stringsL: b({ pan: -0.85, gain: 0.5, rev: 0.45 }),
      stringsR: b({ pan: 0.85, gain: 0.5, rev: 0.45 }),
      brassL: b({ pan: -0.7, gain: 0.45, rev: 0.4 }),
      brassR: b({ pan: 0.7, gain: 0.45, rev: 0.4 }),
      pizz: b({ pos: [-2.2, 0, 1.4], gain: 0.5, rev: 0.35 }),
      harp: b({ pos: [2.2, 0.8, 1.4], gain: 0.5, rev: 0.45, dly: 0.2 }),
      sky: b({ pos: [0, 3.5, 0.3], gain: 0.45, rev: 0.6 }),
    };
    this.birds = [0, 1].map(() => b({ pos: [0, 2, 0], gain: 0.3, rev: 0.5, dly: 0.2 }));
    this.birdIdx = 0;
  }

  // An instrument's channel: gain -> 3D (HRTF) or stereo panner -> mix, with reverb and echo sends.
  bus({ pos = null, pan = 0, gain = 1, rev = 0, dly = 0 }) {
    const c = this.ctx;
    const input = c.createGain();
    input.gain.value = gain;
    let node;
    if (pos && c.createPanner) {
      node = c.createPanner();
      node.panningModel = 'HRTF';
      node.distanceModel = 'inverse';
      node.refDistance = 1.5;
      node.rolloffFactor = 0.25;
      this.place(node, pos, c.currentTime);
    } else if (c.createStereoPanner) {
      node = c.createStereoPanner();
      node.pan.value = pan;
    } else {
      node = c.createGain();
    }
    input.connect(node).connect(this.mix);
    if (rev) this.send(input, this.verb, rev);
    if (dly) this.send(input, this.echo, dly);
    return { input, node };
  }

  place(p, [x, y, z], t, glide = false) {
    if (p.positionX) {
      const set = glide ? 'linearRampToValueAtTime' : 'setValueAtTime';
      p.positionX[set](x, t);
      p.positionY[set](y, t);
      p.positionZ[set](z, t);
    } else if (p.setPosition) {
      p.setPosition(x, y, z);
    }
  }

  send(from, to, amount) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    from.connect(g).connect(to);
  }

  impulse(seconds) {
    const c = this.ctx;
    const sr = c.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      [0.011, 0.017, 0.023, 0.031, 0.043, 0.057].forEach((at, k) => {
        d[Math.floor((at + ch * 0.0037) * sr)] += (k % 2 ? -0.6 : 0.6) * (1 - k * 0.12);
      });
    }
    return buf;
  }

  // --- building blocks ---

  amp(bus, dest = null) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(dest ?? bus.input);
    return g;
  }

  osc(type, freq, t, end, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  lfo(t, end, rate, depth) {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    this.osc('sine', rate, t, end, g);
    return g;
  }

  noise(t, end) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(end);
    return src;
  }

  // fast attack, exponential decay
  pluck(param, t, peak, decay, attack = 0.003) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // attack, hold, release
  env(param, t, attack, peak, hold, release) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + attack + Math.max(0, hold));
    param.linearRampToValueAtTime(0, t + attack + Math.max(0, hold) + release);
  }

  // one decaying oscillator. It stops at 70% of the decay, by which point it is ~-50 dB and inaudible.
  partial(bus, type, freq, t, peak, decay, attack = 0.002) {
    const g = this.amp(bus);
    const o = this.osc(type, freq, t, t + attack + decay * 0.7, g);
    this.pluck(g.gain, t, peak, decay, attack);
    return o;
  }

  // --- percussion ---

  kick(t, vel) {
    const g = this.amp(this.b.kick);
    const o = this.osc('sine', 160, t, t + 0.5, g);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    this.pluck(g.gain, t, 0.9 * vel, 0.38, 0.002);
    const click = this.amp(this.b.kick);
    this.noise(t, t + 0.03).connect(this.filter('highpass', 3000)).connect(click);
    this.pluck(click.gain, t, 0.12 * vel, 0.012, 0.001);
  }

  clap(t, vel) {
    const g = this.amp(this.b.clap);
    this.noise(t, t + 0.3).connect(this.filter('bandpass', 1400, 0.8)).connect(g);
    g.gain.setValueAtTime(0, t);
    for (const at of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(0.5 * vel, t + at);
      g.gain.exponentialRampToValueAtTime(0.05 * vel, t + at + 0.009);
    }
    g.gain.setValueAtTime(0.45 * vel, t + 0.031);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  }

  shaker(t, vel) {
    const g = this.amp(this.b.shaker);
    this.noise(t, t + 0.08).connect(this.filter('highpass', 5500)).connect(g);
    this.pluck(g.gain, t, 0.22 * vel, 0.045, 0.008);
  }

  conga(t, drum, vel, slap = false) {
    const bus = drum === 'hi' ? this.b.congaHi : this.b.congaLo;
    const f = drum === 'hi' ? 330 : 220;
    const g = this.amp(bus);
    const o = this.osc('sine', f * 1.4, t, t + 0.4, g);
    o.frequency.setValueAtTime(f * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
    this.pluck(g.gain, t, 0.45 * vel, slap ? 0.08 : 0.24);
    if (slap) {
      const s = this.amp(bus);
      this.noise(t, t + 0.06).connect(this.filter('bandpass', 2400, 1.5)).connect(s);
      this.pluck(s.gain, t, 0.35 * vel, 0.04, 0.001);
    }
  }

  clave(t, vel) {
    this.partial(this.b.clave, 'sine', 2500, t, 0.3 * vel, 0.05, 0.001);
    this.partial(this.b.clave, 'triangle', 1250, t, 0.12 * vel, 0.04, 0.001);
  }

  timbale(t, hi, vel) {
    const bus = hi ? this.b.timbaleHi : this.b.timbaleLo;
    const f = hi ? 620 : 430;
    const g = this.amp(bus);
    const o = this.osc('triangle', f * 1.15, t, t + 0.4, g);
    o.frequency.setValueAtTime(f * 1.15, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    this.pluck(g.gain, t, 0.35 * vel, 0.25);
    this.partial(bus, 'sine', f * 2.3, t, 0.08 * vel, 0.2);
    const ring = this.amp(bus);
    this.noise(t, t + 0.25).connect(this.filter('bandpass', 3500, 3)).connect(ring);
    this.pluck(ring.gain, t, 0.3 * vel, 0.16, 0.001);
  }

  cymbal(t, vel, dur = 2.2) {
    const g = this.amp(this.b.cymbal);
    const hp = this.filter('highpass', 5000);
    hp.connect(g);
    this.noise(t, t + dur * 0.7).connect(hp);
    // inharmonic square partials give it a metallic shimmer
    for (const r of [1, 1.342, 1.6532, 2.1523]) this.osc('square', 420 * r, t, t + dur * 0.7, hp);
    this.pluck(g.gain, t, 0.18 * vel, dur, 0.002);
  }

  // noise rising into the next downbeat
  swell(t, dur, vel) {
    const g = this.amp(this.b.cymbal);
    const bp = this.filter('bandpass', 400, 1);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    this.noise(t, t + dur + 0.05).connect(bp).connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
  }

  // --- pitched instruments ---

  bass(t, note, len, vel) {
    const f = mtof(note);
    const g = this.amp(this.b.bass);
    const body = this.ctx.createGain();
    body.gain.value = 0.8;
    body.connect(g);
    this.osc('sine', f, t, t + len + 0.2, body);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.warmth;
    const lp = this.filter('lowpass', 1200, 4);
    lp.frequency.setValueAtTime(1300 * vel + 200, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.08, len));
    const growl = this.ctx.createGain();
    growl.gain.value = 0.3;
    shaper.connect(lp).connect(growl).connect(g);
    this.osc('sawtooth', f, t, t + len + 0.2, shaper);
    this.env(g.gain, t, 0.005, 0.5 * vel, len * 0.7, 0.09);
  }

  marimba(t, note, vel) {
    const f = mtof(note);
    this.partial(this.b.marimba, 'sine', f, t, 0.32 * vel, 0.55);
    this.partial(this.b.marimba, 'sine', f * 3.93, t, 0.12 * vel, 0.1, 0.001); // the bar's bright overtone and mallet
  }

  steelpan(t, note, vel) {
    const f = mtof(note);
    const o = this.partial(this.b.steelpan, 'sine', f, t, 0.28 * vel, 1.1, 0.004);
    o.frequency.setValueAtTime(f * 1.006, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    // the bright metallic ring (2nd, 3rd and a touch of 4th harmonic) fades faster than the body
    this.partial(this.b.steelpan, this.waves.pan, f, t, 0.16 * vel, 0.45, 0.002);
  }

  harp(t, note, vel) {
    this.partial(this.b.harp, this.waves.harp, mtof(note), t, 0.22 * vel, 1.5);
  }

  glissando(t, chord, vel) {
    const tones = [...chord, ...chord.map((m) => m + 12), chord[0] + 24];
    tones.forEach((m, i) => this.harp(t + i * 0.045, m, vel * (0.6 + i * 0.05)));
  }

  pizz(t, note, vel) {
    const f = mtof(note);
    const g = this.amp(this.b.pizz);
    const lp = this.filter('lowpass', 1600, 2);
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.15);
    lp.connect(g);
    this.osc('triangle', f, t, t + 0.35, lp);
    this.osc('sawtooth', f, t, t + 0.35, lp, 6);
    this.pluck(g.gain, t, 0.26 * vel, 0.22);
  }

  flute(t, note, len, vel) {
    const f = mtof(note);
    const prev = this.prevLead;
    this.prevLead = note;
    const from = prev && Math.abs(prev - note) <= 7 ? mtof(prev) : f; // slur small steps
    const end = t + len + 0.2;
    const g = this.amp(this.b.flute);
    const vib = this.lfo(t, end, 5.4, 0);
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(0, t + 0.15);
    vib.gain.linearRampToValueAtTime(16, t + 0.15 + Math.min(0.5, len));
    for (const [type, ratio, w] of [['sine', 1, 1], ['triangle', 1, 0.25], ['sine', 2, 0.08]]) {
      const w8 = this.ctx.createGain();
      w8.gain.value = w;
      w8.connect(g);
      const o = this.osc(type, from * ratio, t, end, w8);
      o.frequency.setValueAtTime(from * ratio, t);
      o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.06);
      vib.connect(o.detune);
    }
    const breath = this.ctx.createGain();
    breath.gain.value = 0.05;
    this.noise(t, end).connect(this.filter('bandpass', f * 1.5, 1.5)).connect(breath).connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.05);
    g.gain.linearRampToValueAtTime(0.17 * vel, t + Math.max(0.06, len * 0.8));
    g.gain.linearRampToValueAtTime(0, t + len + 0.12);
  }

  violins(t, note, len, vel) {
    const f = mtof(note);
    const end = t + len + 0.4;
    const g = this.amp(this.b.violins);
    const lp = this.filter('lowpass', 3800);
    lp.connect(g);
    const vib = this.lfo(t, end, 5.8, 0);
    vib.gain.setValueAtTime(0, t + 0.12);
    vib.gain.linearRampToValueAtTime(14, t + 0.12 + Math.min(0.4, len));
    for (const d of [-9, 0, 9]) vib.connect(this.osc('sawtooth', f, t, end, lp, d).detune);
    this.env(g.gain, t, 0.07, 0.06 * vel, len - 0.05, 0.28);
  }

  strings(t, chord, dur, vel) {
    [this.b.stringsL, this.b.stringsR].forEach((bus, side) => {
      const g = this.amp(bus);
      const lp = this.filter('lowpass', 600);
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.exponentialRampToValueAtTime(2200 * vel + 400, t + dur * (side ? 0.4 : 0.6));
      lp.frequency.exponentialRampToValueAtTime(800, t + dur + 0.6);
      lp.connect(g);
      const vib = this.lfo(t, t + dur + 0.6, side ? 5.1 : 4.7, 6);
      // left and right sections are detuned against each other, so they chorus across the stereo field
      for (const note of chord) vib.connect(this.osc('sawtooth', mtof(note), t, t + dur + 0.6, lp, side ? 7 : -7).detune);
      this.env(g.gain, t, 0.35, 0.04 * vel, dur - 0.35, 0.5);
    });
  }

  brass(t, chord, len, vel, bright = false) {
    const all = bright ? [...chord, chord[3] + 12] : chord;
    [this.b.brassL, this.b.brassR].forEach((bus, side) => {
      // the chord is split between the left and right horn sections, with the root on both
      const notes = all.filter((_, i) => i === 0 || i % 2 === side);
      const g = this.amp(bus);
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.warmth;
      const lp = this.filter('lowpass', 400, 1.2);
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(3200 * vel, t + 0.04);
      lp.frequency.exponentialRampToValueAtTime(1300, t + len);
      shaper.connect(lp).connect(g);
      for (const note of notes) this.osc('sawtooth', mtof(note), t, t + len + 0.2, shaper, side ? 8 : -8);
      this.env(g.gain, t, 0.015, 0.065 * vel, len - 0.05, 0.12);
    });
  }

  // a soft pad from overhead
  sky(t, chord, dur, vel) {
    const g = this.amp(this.b.sky);
    for (const note of chord) this.osc('triangle', mtof(note + 12), t, t + dur + 1.3, g, 5);
    this.env(g.gain, t, Math.min(1.2, dur * 0.5), 0.035 * vel, dur - Math.min(1.2, dur * 0.5), 1.2);
  }

  // a few quick chirps from a random spot above and around you
  bird(t) {
    const bus = this.birds[this.birdIdx++ % this.birds.length];
    const a = Math.random() * Math.PI * 2;
    this.place(bus.node, [Math.cos(a) * 2.5, rand(1.5, 3.5), Math.sin(a) * 2.5], t);
    const base = rand(2600, 3800);
    const count = 2 + Math.floor(Math.random() * 3);
    let at = t;
    for (let k = 0; k < count; k++) {
      const o = this.partial(bus, 'sine', base, at, 0.12, 0.07, 0.01);
      o.frequency.setValueAtTime(base, at);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, at + 0.03);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, at + 0.07);
      at += rand(0.09, 0.14);
    }
  }

  // --- the arrangement ---

  playBass(t, s, root, chord, vel) {
    const pcs = chord.map((m) => m % 12);
    for (const [at, kind, len] of BASS_LINE) {
      if (s !== at) continue;
      let note = root;
      if (kind === 'oct') note = root + 12;
      if (kind === 'fifth') note = pcs.includes((root + 7) % 12) ? root + 7 : root + 12;
      this.bass(t, note, len * STEP, human(at === 0 ? vel : vel * 0.8));
    }
  }

  groove(t, s, { kick = true, snare = 'back', congas = true, clave = true, vel = 1 }) {
    if (kick && s % 4 === 0) this.kick(t, human(s === 0 ? vel : vel * 0.9));
    if (snare === 'back' && (s === 4 || s === 12)) this.clap(t, human(vel));
    if (snare === 'dembow' && DEMBOW.includes(s)) this.clap(t, human(vel * (s === 3 || s === 11 ? 0.75 : 0.95)));
    this.shaker(t, human((s % 4 === 2 ? 1 : s % 2 ? 0.55 : 0.7) * vel));
    if (congas && CONGA[s]) {
      const [drum, v, slap] = CONGA[s];
      this.conga(t + rand(0, 0.006), drum, human(v * vel), slap);
    }
    if (clave && CLAVE.includes(s)) this.clave(t, human(0.8 * vel));
  }

  fill(t, s) {
    if (s < 8) return;
    if (s === 8) this.swell(t, BAR / 2, 1);
    this.timbale(t, s % 2 === 0, human(0.45 + (s - 8) * 0.07));
  }

  lead(t, s, melody, play) {
    for (const [at, note, len] of melody) if (s === at) play(note, len * STEP);
  }

  playStep(n, t) {
    const s = n % 16;
    const bar = Math.floor(n / 16);
    let name = 'sunrise';
    let barIn = bar;
    let round = 0;
    if (bar >= INTRO_BARS) {
      const lb = bar - INTRO_BARS;
      name = LOOP[Math.floor(lb / 8) % LOOP.length];
      barIn = lb % 8;
      round = Math.floor(lb / (8 * LOOP.length));
    }
    const sec = SECTIONS[name];
    const [root, chord] = sec.chords[barIn];
    const tones = [...chord, ...chord.map((m) => m + 12)];
    const melody = sec.melody?.[barIn] ?? [];
    const last = barIn === sec.chords.length - 1;

    // the shaker circles your head once every 4 bars
    if (s % 4 === 0) {
      const a = ((n + 4) / 64) * Math.PI * 2;
      this.place(this.b.shaker.node, [Math.sin(a) * 1.6, 0.3, -Math.cos(a) * 1.6], t + STEP * 4, true);
    }

    if (name === 'sunrise') {
      if (s === 0) {
        this.sky(t, chord, BAR, 0.8 + barIn * 0.1);
        if (barIn === 0) this.glissando(t, chord, 0.7);
      }
      if (barIn > 0 || s % 2 === 0) this.marimba(t, tones[ARP[s]] + 12, human(0.35 + barIn * 0.08));
      if (barIn >= 2) {
        this.shaker(t, human(s % 4 === 2 ? 0.7 : 0.35));
        if (s === 0) this.bass(t, root, BAR * 0.9, 0.7);
      }
      if (barIn === 3) {
        if (s === 0) this.swell(t, BAR, 1);
        if (s >= 8) this.conga(t, s % 2 ? 'lo' : 'hi', human(0.4 + (s - 8) * 0.07));
      }
      if (Math.random() < 0.05) this.bird(t);
      return;
    }

    if (name === 'canopy') {
      if (barIn === 0 && s === 0) {
        this.cymbal(t, 1);
        this.glissando(t, chord, 0.8);
      }
      this.groove(t, s, {});
      this.playBass(t, s, root, chord, 1);
      this.marimba(t, tones[ARP[s]] + 12, human(s % 4 === 0 ? 0.5 : 0.35));
      if (s % 4 === 2) {
        this.steelpan(t, chord[2] + 12, human(0.35));
        this.steelpan(t, chord[3] + 12, human(0.3));
      }
      if (s === 0) {
        this.strings(t, chord, BAR, 0.8);
        if (round > 0) this.sky(t, chord, BAR, 0.6);
      }
      this.lead(t, s, melody, (note, len) => {
        if (round % 2 === 0) this.flute(t, note, len, human(1));
        else {
          this.steelpan(t, note, human(0.9));
          this.marimba(t, note - 12, human(0.5));
        }
      });
      if (last) this.fill(t, s);
      if (Math.random() < 0.015) this.bird(t);
      return;
    }

    if (name === 'river') {
      if (barIn === 0 && s === 0) this.cymbal(t, 0.8);
      this.groove(t, s, { snare: 'dembow' });
      if (s % 2 === 1 && !CONGA[s]) this.conga(t, 'hi', human(0.25));
      this.playBass(t, s, root, chord, 1);
      if (s % 2 === 0) this.pizz(t, tones[[0, 2, 1, 3, 0, 2, 1, 3][s / 2]], human(s % 4 === 0 ? 0.9 : 0.65));
      for (const [at, v, len] of BRASS) if (s === at && !(last && at > 0)) this.brass(t, chord, len * STEP, human(v));
      if (s === 0) this.strings(t, chord, BAR, 0.6);
      this.lead(t, s, melody, (note) => {
        this.steelpan(t, note, human(1));
        this.marimba(t, note - 12, human(0.35));
      });
      if (last) this.fill(t, s);
      return;
    }

    if (name === 'summit') {
      if (s === 0 && barIn % 4 === 0) this.cymbal(t, 1.2);
      this.groove(t, s, { vel: 1.05 });
      if (s === 14) this.clap(t, human(0.4));
      this.playBass(t, s, root, chord, 1.05);
      this.marimba(t, tones[ARP[s]] + 12, human(s % 4 === 0 ? 0.45 : 0.3));
      if (s % 4 === 2) this.steelpan(t, chord[3] + 12, human(0.3));
      for (const [at, v, len] of BRASS) if (s === at && !(last && at > 0)) this.brass(t, chord, len * STEP, human(v * 1.1), true);
      if (s === 0) {
        this.strings(t, chord, BAR, 1);
        this.sky(t, chord, BAR, 0.8);
      }
      if (barIn % 2 === 1 && s === 14) this.timbale(t, true, human(0.6));
      this.lead(t, s, melody, (note, len) => {
        this.violins(t, note, len, human(1));
        this.violins(t, note - 12, len, human(0.6));
        this.flute(t, note, len, human(0.55));
      });
      if (last) this.fill(t, s);
      return;
    }

    // lagoon: breakdown, then a build back into the groove
    if (barIn === 0 && s === 0) this.cymbal(t, 0.5, 3);
    if (s === 0) {
      this.sky(t, chord, BAR, 1);
      this.strings(t, chord, BAR, 0.5);
      if (barIn < 6) this.bass(t, root, BAR * 0.9, 0.6);
    }
    if (s % 2 === 0) this.harp(t, tones[HARP[s / 2]], human(0.55));
    if ([0, 6, 10].includes(s)) this.marimba(t, tones[(s + barIn) % 8] + 12, human(0.35));
    if (barIn < 6) {
      if (s % 4 === 2) this.shaker(t, human(0.5));
      if (s === 6 || s === 14) this.conga(t, 'lo', human(0.35));
    } else {
      this.shaker(t, human(s % 4 === 2 ? 0.8 : 0.45));
      if (s % (barIn === 6 ? 8 : 4) === 0) this.kick(t, human(0.85));
      this.playBass(t, s, root, chord, 0.85);
      if (barIn === 7) {
        this.marimba(t, tones[ARP[s]] + 12, human(0.3 + s * 0.02));
        if (s === 0) this.swell(t, BAR, 1.1);
        if (s >= 4) this.clap(t, human(0.2 + (s - 4) * 0.05)); // snare roll
      }
    }
    this.lead(t, s, melody, (note, len) => this.flute(t, note - 12, len, human(0.8)));
    if (Math.random() < 0.04) this.bird(t);
  }
}

// --- the looping soundtrack ---

// Render bars [startBar, startBar + bars) of the score offline. The buffer includes `tail` seconds of
// reverb and echo after the last bar. Setting up the notes yields every bar so the game never stutters.
async function renderBars(startBar, bars, sampleRate, tail = 3) {
  const ctx = new OfflineAudioContext(2, Math.ceil((bars * BAR + tail) * sampleRate), sampleRate);
  const score = new TropicalScore(ctx, ctx.destination);
  for (let n = 0; n < bars * 16; n++) {
    score.playStep(startBar * 16 + n, n * STEP);
    if (n % 16 === 15) await new Promise((r) => setTimeout(r, 0));
  }
  return ctx.startRendering();
}

const CHUNK_BARS = 8;
const LOOP_BARS = 8 * LOOP.length * 2; // two full rounds: flute-led, then steel-pan-led Canopy

export class Soundtrack {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = destination;
    this.sources = [];
  }

  // The intro plays first (and repeats if the first chunk isn't ready yet). Each 8-bar chunk of the
  // loop is rendered in order and played as soon as it's ready. Once every chunk exists they are
  // stitched into one seamless buffer that loops forever.
  async start() {
    const c = this.ctx;
    const sr = c.sampleRate;
    if (!window.OfflineAudioContext) { // very old browsers: fall back to live playback
      new TropicalScore(c, this.out).start();
      return;
    }
    const chunkDur = Math.round(CHUNK_BARS * BAR * sr) / sr;
    const count = LOOP_BARS / CHUNK_BARS;
    // render two chunks at a time, in playing order
    const pending = [];
    const render = (k) => renderBars(INTRO_BARS + k * CHUNK_BARS, CHUNK_BARS, sr);
    const intro = await renderBars(0, INTRO_BARS, sr);
    pending[0] = render(0);
    pending[1] = render(1);

    const period = Math.round(INTRO_BARS * BAR * sr) / sr;
    const introStart = c.currentTime + 0.05;
    const introSrc = this.play(intro, introStart, { loopEnd: period });

    const chunks = [];
    let cursor = 0;
    for (let k = 0; k < count; k++) {
      chunks[k] = await pending[k];
      if (k + 2 < count) pending[k + 2] = render(k + 2);
      if (k === 0) {
        // switch from the intro at the end of its current repeat; its reverb rings on into the groove
        cursor = introStart + Math.ceil((c.currentTime + 0.25 - introStart) / period) * period;
        introSrc.stop(cursor);
        this.play(intro, cursor, { offset: period });
      }
      const at = Math.max(cursor, c.currentTime + 0.1);
      // the last chunk's tail is left off here: the stitched loop wraps it onto its own start
      this.play(chunks[k], at, { duration: k === count - 1 ? chunkDur : 0 });
      cursor = at + chunkDur;
    }
    const loop = await this.assemble(chunks, sr);
    this.play(loop, Math.max(cursor, c.currentTime + 0.1), { loopEnd: loop.duration });
  }

  play(buffer, at, { loopEnd = 0, offset = 0, duration = 0 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    if (loopEnd) {
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = loopEnd;
    }
    src.connect(this.out);
    if (duration) src.start(at, offset, duration);
    else src.start(at, offset);
    this.sources.push(src);
    src.onended = () => { this.sources = this.sources.filter((x) => x !== src); };
    return src;
  }

  // Lay the chunks end to end. Each chunk's tail overlaps the next one, and the last chunk's tail
  // wraps onto the start, so the loop point is seamless. Done a slice at a time so the game never stutters.
  async assemble(buffers, sr) {
    const length = Math.round(LOOP_BARS * BAR * sr);
    const loop = this.ctx.createBuffer(2, length, sr);
    const slice = sr; // one second of audio per frame
    for (let ch = 0; ch < 2; ch++) {
      const out = loop.getChannelData(ch);
      for (let k = 0; k < buffers.length; k++) {
        const data = buffers[k].getChannelData(ch);
        const offset = Math.round(k * CHUNK_BARS * BAR * sr);
        for (let from = 0; from < data.length; from += slice) {
          const to = Math.min(data.length, from + slice);
          for (let i = from; i < to; i++) out[(offset + i) % length] += data[i];
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
    return loop;
  }
}
