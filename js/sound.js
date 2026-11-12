// All sound is synthesized with the Web Audio API: no audio files.

import { Soundtrack } from './music.js';
import { PadSpeaker } from './padspeaker.js';

// Which background music plays:
//   'original'  the bouncy jungle chiptune below
//   'music-one' the tropical orchestral score in music.js
const MUSIC = 'music-one';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const _ = null;
// 32 eighth-note steps of a bouncy jungle tune.
const BASS = [48, _, 55, _, 52, _, 55, _, 45, _, 52, _, 48, _, 52, _, 41, _, 48, _, 45, _, 48, _, 43, _, 50, _, 47, _, 43, _];
const MELODY = [72, _, 76, 79, _, 76, 74, _, 72, _, 69, 72, _, 74, _, _, 69, _, 72, 74, _, 72, 69, _, 67, _, 71, 74, _, 72, _, _];
const STEP = 60 / 116 / 2;

function loadMuted() {
  try { return localStorage.getItem('mj-muted') === '1'; } catch { return false; }
}

class Sound {
  constructor() {
    this.ctx = null;
    this.muted = loadMuted();
    this.score = null;
    this.musicTimer = null;
    // The DualSense's built-in speaker (USB only). When it's on, every sound effect plays there
    // as well as on the main speakers, at the same time (music stays on the main speakers).
    this.pad = new PadSpeaker();
    this.pad.setMuted(this.muted);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.22;
      this.music.connect(this.master);
      this.startMusic();
      // Browsers can suspend audio on their own (headphones plugged in or out, a phone call,
      // the tab in the background). Keep nudging it back so music and SFX never stay silent.
      setInterval(() => this.resume(), 1000);
    }
    this.resume();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    this.pad.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    this.pad.setMuted(m);
    try { localStorage.setItem('mj-muted', m ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // Where sound effects go: always the main mix, plus the controller's speaker when it's in use.
  get outs() { return this.pad.out ? [this.sfx, this.pad.out] : [this.sfx]; }

  setMusicVolume(v) {
    if (this.music) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  note(freq, at, dur, { type = 'square', vol = 0.2, slide = null, attack = 0.005, dest = this.sfx } = {}) {
    const ctx = dest.context; // the main AudioContext, or the controller speaker's
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  tone(freq, dur, opts = {}) {
    if (!this.ctx) return;
    for (const dest of opts.dest ? [opts.dest] : this.outs) {
      this.note(freq, dest.context.currentTime + (opts.delay ?? 0), dur, { ...opts, dest });
    }
  }

  // One second of white noise per AudioContext (the controller speaker has its own context).
  getNoiseBuf(ctx = this.ctx) {
    this.noiseBufs ??= new WeakMap();
    let buf = this.noiseBufs.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBufs.set(ctx, buf);
    }
    return buf;
  }

  // `sweep` glides the filter to that frequency over the sound; `attack` fades it in
  // (0 = starts at full volume) so a burst can swell like air rushing past instead of clicking.
  noise(dur, opts = {}) {
    if (!this.ctx) return;
    for (const dest of opts.dest ? [opts.dest] : this.outs) this.noiseTo(dest, dur, opts);
  }

  noiseTo(dest, dur, { vol = 0.2, freq = 1000, type = 'bandpass', delay = 0, at = null, sweep = null, q = 1, attack = 0 } = {}) {
    const ctx = dest.context;
    const t = at ?? ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuf(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain();
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
    } else {
      g.gain.setValueAtTime(vol, t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  arp(freqs, gap, opts) { freqs.forEach((f, i) => this.tone(f, opts.dur ?? 0.12, { ...opts, delay: i * gap })); }

  // A springy "boing-up": a bright rising sine with a quiet octave on top, plus a puff of air
  // sweeping upward as the monkey leaves the ground. No low end, so it never reads as a thump.
  jump() {
    this.tone(420, 0.2, { type: 'sine', vol: 0.2, slide: 1150, attack: 0.008 });
    this.tone(840, 0.13, { type: 'triangle', vol: 0.045, slide: 2100, attack: 0.008 });
    this.noise(0.17, { vol: 0.07, freq: 1100, sweep: 4200, q: 1.4, attack: 0.03 });
  }

  // Soft padded footfall on jungle ground: a low muffled tap, no hiss. Feet alternate slightly.
  stride(sprint) {
    if (!this.ctx) return;
    this.strideFlip = !this.strideFlip;
    const k = (this.strideFlip ? 1 : 0.88) * (0.95 + Math.random() * 0.1);
    this.tone(150 * k, 0.06, { type: 'sine', vol: sprint ? 0.13 : 0.06, slide: 80 * k, attack: 0.003 });
    this.noise(0.045, { vol: sprint ? 0.06 : 0.025, freq: 520 * k, type: 'lowpass', q: 0.7 });
  }

  // The speed rush when a sprint kicks in: air swelling past and falling away, like something
  // whipping by. Deep and smooth (lowpassed, slow attack) so it reads as wind, not a scrape.
  sprintWhoosh() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - (this.lastWhoosh ?? -9e9) < 800) return;
    this.lastWhoosh = now;
    for (const dest of this.outs) this.whooshTo(dest);
  }

  whooshTo(dest) {
    const ctx = dest.context;
    const t = ctx.currentTime;
    const dur = 0.55;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuf(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2.5; // a gentle resonant peak gives the "whoo" its tone
    f.frequency.setValueAtTime(220, t);
    f.frequency.exponentialRampToValueAtTime(1300, t + 0.18);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }
  banana() {
    this.tone(988, 0.08, { type: 'sine', vol: 0.2 });
    this.tone(1480, 0.12, { type: 'sine', vol: 0.18, delay: 0.06 });
  }
  stomp() { this.tone(220, 0.15, { type: 'triangle', vol: 0.35, slide: 70 }); this.noise(0.08, { vol: 0.15, freq: 400 }); }
  boing() { this.tone(160, 0.32, { type: 'sine', vol: 0.35, slide: 760 }); }
  grab() { this.noise(0.08, { vol: 0.12, freq: 2500, type: 'highpass' }); }
  shrink() { this.arp([784, 587, 440, 330], 0.06, { type: 'square', vol: 0.08 }); }
  powerup() { this.arp([523, 659, 784, 1047, 1319], 0.07, { type: 'square', vol: 0.09 }); }
  oneUp() { this.arp([659, 784, 1319, 1047, 1175, 1568], 0.08, { type: 'square', vol: 0.08 }); }
  checkpoint() { this.arp([784, 1175], 0.09, { type: 'triangle', vol: 0.25, dur: 0.2 }); }
  die() { this.arp([659, 523, 440, 330, 262], 0.12, { type: 'triangle', vol: 0.3, dur: 0.18 }); }
  clear() { this.arp([523, 659, 784, 1047, 784, 1047, 1319], 0.11, { type: 'square', vol: 0.09, dur: 0.18 }); }
  // Coffin burial.
  rumble(dur = 1) {
    this.noise(dur, { vol: 0.4, freq: 160, type: 'lowpass' });
    this.tone(55, dur, { type: 'triangle', vol: 0.3, slide: 38, attack: 0.08 });
  }
  creak() { this.tone(240, 0.5, { type: 'sawtooth', vol: 0.035, slide: 150, attack: 0.15, delay: 0.5 }); }
  thud() {
    this.noise(0.3, { vol: 0.55, freq: 320, type: 'lowpass' });
    this.tone(95, 0.3, { type: 'triangle', vol: 0.5, slide: 40 });
  }
  toll() {
    this.tone(196, 1.6, { type: 'sine', vol: 0.22, attack: 0.01, delay: 0.15 });
    this.tone(392, 1.0, { type: 'sine', vol: 0.08, attack: 0.01, delay: 0.15 });
  }
  // Angel respawn: harp sweep when the halo appears, a soft chime on landing.
  angel() {
    this.arp([523, 659, 784, 988, 1047, 1319, 1568, 2093], 0.06, { type: 'sine', vol: 0.16, dur: 0.5 });
    this.tone(1047, 1.2, { type: 'triangle', vol: 0.05, attack: 0.3, delay: 0.1 });
  }
  chime() {
    this.tone(1568, 0.6, { type: 'sine', vol: 0.16 });
    this.tone(2093, 0.8, { type: 'sine', vol: 0.12, delay: 0.09 });
  }
  splash() { this.noise(0.5, { vol: 0.35, freq: 900, type: 'lowpass' }); }
  // Slingshot: rubber creaks while pulled back, then a "thwip" on release.
  stretch() { this.tone(150, 0.55, { type: 'sawtooth', vol: 0.04, slide: 420, attack: 0.2 }); }
  throw() {
    this.tone(900, 0.12, { type: 'triangle', vol: 0.18, slide: 180 });
    this.noise(0.1, { vol: 0.1, freq: 2200 });
  }
  tired() { this.tone(330, 0.25, { type: 'triangle', vol: 0.18, slide: 160 }); }
  alert() { this.tone(520, 0.08, { type: 'square', vol: 0.08 }); this.tone(780, 0.1, { type: 'square', vol: 0.08, delay: 0.07 }); }
  whoosh() { this.noise(0.14, { vol: 0.12, freq: 1400 }); }
  punch() {
    this.noise(0.16, { vol: 0.5, freq: 500, type: 'lowpass' });
    this.tone(140, 0.18, { type: 'triangle', vol: 0.45, slide: 45 });
  }

  startMusic() {
    if (!this.ctx) return;
    if (MUSIC === 'music-one') {
      if (this.score) return;
      this.score = new Soundtrack(this.ctx, this.music);
      this.score.start().catch((e) => console.warn('Music failed to start', e));
      return;
    }
    if (this.musicTimer) return;
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => {
      const now = this.ctx.currentTime;
      if (next < now - 0.1) next = now + 0.05; // tab was in the background
      while (next < now + 0.2) {
        const b = BASS[step], m = MELODY[step];
        if (b) this.note(midi(b), next, 0.3, { type: 'triangle', vol: 0.35, dest: this.music });
        if (m) {
          this.note(midi(m), next, 0.25, { type: 'sine', vol: 0.25, dest: this.music });
          this.note(midi(m) * 2, next, 0.08, { type: 'square', vol: 0.03, dest: this.music });
        }
        if (step % 2 === 1) this.noise(0.04, { vol: 0.05, freq: 7000, type: 'highpass', dest: this.music, at: next });
        next += STEP;
        step = (step + 1) % BASS.length;
      }
    }, 50);
  }
}

export const sound = new Sound();
