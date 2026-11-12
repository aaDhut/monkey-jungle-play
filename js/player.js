// The hero monkey: running, variable-height jumps, vine swinging.
import { makeMonkey, poseMonkey } from './models.js';
import { moveBody, resolveOverlaps, overlapsAny, GRAVITY } from './physics.js';

const WALK = 7, RUN = 11, JUMP_V = 16, BOUNCE_V = 24, MAX_FALL = 26;

// Sprint stamina (0..1). Bananas refill it (see main.js); it also trickles back slowly.
export const STAMINA = {
  drainTime: 2,     // seconds of sprinting on a full bar (short bursts only)
  regenTime: 30,    // seconds to refill from empty without bananas
  regenDelay: 1.5,  // no trickle refill until you've stopped sprinting this long
  recoverAt: 0.3,   // once emptied, sprint unlocks again at this level
};
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  constructor(scene) {
    this.model = makeMonkey({ fur: 0xa0612f, skin: 0xf7d5ad, headband: 0xff7a1a });
    scene.add(this.model.root);
    this.big = false;
    this.bigTimer = 0;
    this.scale = 0.9;
    this.runPhase = 0;
    this.spawn(0, 0);
  }

  get w() { return this.big ? 1.0 : 0.8; }
  get h() { return this.big ? 1.9 : 1.4; }

  spawn(x, y) {
    Object.assign(this, {
      x, y, prevY: y, vx: 0, vy: 0, carryVx: 0, carrier: null, ground: null, onGround: false, coyote: 0, jumpBuf: 0, jumping: false,
      swing: null, vineCooldown: 0, invuln: 0, dead: false, celebrating: false, deathT: 0, knockT: 0,
      stamina: 1, exhausted: false, sprinting: false, regenWait: 0,
      squash: 1, spin: 0, animT: 0, facing: 1,
    });
    this.model.root.rotation.set(0, 0.95, 0);
  }

  releaseVine() {
    if (!this.swing) return;
    this.swing.vine.attachLen = null;
    this.swing.vine.pump = 0;
    this.swing = null;
    this.vineCooldown = 0.4;
  }

  update(dt, input, world, fx) {
    this.prevY = this.y;
    this.invuln = Math.max(0, this.invuln - dt);
    this.vineCooldown = Math.max(0, this.vineCooldown - dt);
    this.jumpBuf = input.consume('jump') ? 0.13 : Math.max(0, this.jumpBuf - dt);
    const dir = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    if (dir) this.facing = dir;

    if (this.swing) { this.updateSwing(input, dir, world, fx); return; }

    if (this.knockT > 0) {
      this.knockT -= dt; // knocked back by a punch: ignore steering for a moment
    } else {
      const wasSprinting = this.sprinting;
      this.sprinting = input.held('run') && dir !== 0 && !this.exhausted && this.stamina > 0;
      if (this.sprinting && !wasSprinting) {
        fx.haptic?.('sprintStart', this.facing);
        fx.sound.sprintWhoosh?.();
      }
      if (this.sprinting) {
        this.regenWait = STAMINA.regenDelay;
        this.stamina -= dt / STAMINA.drainTime;
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.exhausted = true;
          this.sprinting = false;
          fx.sound.tired?.();
        }
      } else if (this.regenWait > 0) {
        this.regenWait -= dt;
      } else {
        this.stamina = Math.min(1, this.stamina + dt / STAMINA.regenTime);
        if (this.exhausted && this.stamina >= STAMINA.recoverAt) this.exhausted = false;
      }
      const target = dir * (this.sprinting ? RUN : WALK);
      let accel = this.onGround ? (dir ? 60 : 50) : 32;
      // Above walking speed (getting into / out of a sprint), ramp gently so the speed-up
      // reads as a build-up and the camera can follow without a lurch.
      if (dir && Math.sign(this.vx) === dir && Math.abs(this.vx) > WALK - 0.01) accel = this.onGround ? 24 : 16;
      this.vx = approach(this.vx, target, accel * dt);
    }

    let g = GRAVITY;
    if (this.vy <= 0) this.jumping = false;
    if (this.vy > 0 && this.jumping && !input.held('jump')) g *= 2.4; // short hop when jump is released
    else if (this.vy < 0) g *= 1.3;                   // snappier fall
    this.vy = Math.max(this.vy - g * dt, -MAX_FALL);

    this.coyote = this.onGround ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP_V + Math.abs(this.vx) * 0.15;
      // The ride link stays on for this one step (moveBody clears it) so a rising log can't push
      // into his feet and shove him sideways off the edge as he leaves it.
      const g0 = this.ground;
      if (g0?.moving) {
        this.carrier = g0; // jumping off a moving log: keep moving with it while above it
        this.vy += Math.max(0, g0.dy / dt);
      }
      this.jumpBuf = 0;
      this.coyote = 0;
      this.squash = 1.3;
      this.jumping = true;
      fx.sound.jump();
      fx.haptic?.('jump', this.facing);
    }

    // In the air after jumping off a moving log: while still over it, move with it step by step
    // (it speeds up, slows and turns around mid-jump), so a jump straight up lands back on it.
    // Steer off its ends and he keeps its last speed instead, like a real leap off a raft.
    const c = this.carrier;
    if (c && !this.ground) {
      const hw = this.w / 2;
      if (this.x + hw > c.l && this.x - hw < c.r) this.carryVx = c.dx / dt;
      else this.carrier = null;
    }

    const wasGround = this.onGround, fall = this.vy;
    moveBody(this, dt, world.solids);
    if ((this.carryVx || this.carrier) && ((this.onGround && !this.jumping) || this.hitWall)) {
      this.carryVx = 0;
      this.carrier = null;
    }

    if (this.onGround && this.ground.bounce) {
      this.ground.owner.squish = 1;
      this.vy = input.held('jump') ? BOUNCE_V + 3 : BOUNCE_V;
      this.onGround = false;
      this.ground = null;
      this.squash = 1.35;
      fx.sound.boing();
      fx.haptic?.('bounce');
    } else if (this.onGround && !wasGround) {
      this.squash = fall < -12 ? 0.7 : 0.85;
      if (fall < -12) fx.effects.dust(this.x, this.y);
    }

    if (!this.onGround && this.vineCooldown <= 0) {
      for (const v of world.vines) {
        const len = v.grabLength(this.x, this.y + this.h * 0.8);
        if (len) { this.grab(v, len, fx); break; }
      }
    }
  }

  grab(vine, len, fx) {
    const tangential = this.vx * Math.cos(vine.theta) + this.vy * Math.sin(vine.theta);
    vine.omega = vine.omega * 0.3 + (tangential / len) * 0.7;
    vine.attachLen = len;
    this.swing = { vine, len };
    this.vx = this.vy = this.carryVx = 0;
    this.carrier = null;
    fx.sound.grab();
    fx.haptic?.('grab', this.facing);
  }

  updateSwing(input, dir, world, fx) {
    const { vine, len } = this.swing;
    vine.pump = dir;
    const p = vine.pointAt(len);
    const prevX = this.x, prevY = this.y;
    this.x = p.x;
    this.y = p.y - this.h * 0.8;
    // Never let the swing carry the monkey into a platform: let go instead.
    if (overlapsAny(this, world.solids)) {
      this.x = prevX;
      this.y = prevY;
      this.vx = this.vy = 0;
      this.releaseVine();
      resolveOverlaps(this, world.solids);
      return;
    }
    const jumped = this.jumpBuf > 0;
    if (jumped || input.held('down')) {
      const speed = vine.omega * len;
      this.vx = clamp(speed * Math.cos(vine.theta) * 1.1, -13, 13);
      this.vy = speed * Math.sin(vine.theta) + (jumped ? 11 : 0);
      this.jumpBuf = 0;
      this.releaseVine();
      if (jumped) fx.sound.jump();
    }
  }

  startDying() {
    this.releaseVine();
    this.dead = true;
    this.big = false;
    this.bigTimer = 0;
    this.vx = 0;
    this.carryVx = 0;
    this.carrier = null;
    this.vy = 0;
    this.deathT = 0;
    // Death animations (coffin.js / angel.js) pose the body through these.
    Object.assign(this, { z: 0, deadRotZ: 0, deadRotY: 0, deadScale: 1, deadMode: 'limp', buried: false });
  }

  updateDying(dt) {
    this.deathT += dt;
  }

  updateCelebrate(dt, world) {
    this.vx = approach(this.vx, 0, 30 * dt);
    this.vy = Math.max(this.vy - GRAVITY * dt, -MAX_FALL);
    moveBody(this, dt, world.solids);
    if (this.onGround) { this.vy = 9; this.squash = 0.8; this.carryVx = 0; this.carrier = null; }
  }

  render(dt, fx) {
    const m = this.model;
    this.animT += dt;
    this.scale += ((this.big ? 1.22 : 0.9) - this.scale) * Math.min(1, dt * 10);
    const deadScale = this.dead ? this.deadScale ?? 1 : 1;
    m.root.scale.setScalar(this.scale * deadScale);
    m.root.position.set(this.drawX ?? this.x, this.drawY ?? this.y, this.dead ? this.z ?? 0 : 0);

    this.squash += (1 - this.squash) * Math.min(1, dt * 12);
    const s = this.squash, side = 1 / Math.sqrt(s);
    m.body.scale.set(side, s, side);

    const targetRot = this.dead ? this.deadRotY ?? 0 : this.celebrating ? 0 : this.facing * 0.95;
    m.root.rotation.y += (targetRot - m.root.rotation.y) * Math.min(1, dt * 14);
    m.root.rotation.z = this.dead ? this.deadRotZ ?? 0 : 0;

    let mode = 'idle';
    if (this.dead) mode = this.deadMode ?? 'limp';
    else if (this.celebrating) mode = 'dance';
    else if (this.swing) mode = 'swing';
    else if (!this.onGround) mode = this.vy > 0 ? 'jump' : 'fall';
    else if (this.sprinting && Math.abs(this.vx) > WALK) mode = 'sprint';
    else if (Math.abs(this.vx) > 0.5) mode = 'run';
    const before = Math.floor(this.runPhase / Math.PI);
    this.runPhase += dt * 14 * Math.max(0.6, Math.abs(this.vx) / WALK);
    // Sprint footsteps, timed off the same stride phase the legs use so the rumble and the dust
    // land exactly when a foot comes down (the low point of the bounce).
    const stepped = Math.floor(this.runPhase / Math.PI) !== before;
    if ((mode === 'sprint' || mode === 'run') && fx && stepped) fx.sound.stride?.(mode === 'sprint');
    if (mode === 'sprint' && fx && stepped) {
      fx.haptic?.('step', this.facing);
      fx.effects.kick?.((this.drawX ?? this.x) - this.facing * 0.35, this.y, -this.facing);
    }
    if (mode === 'sprint' && fx) {
      fx.effects.trail?.(this.drawX ?? this.x, this.drawY ?? this.y, this.h, this.facing, dt);
    }
    poseMonkey(m, mode, this.animT, dt, this.runPhase);

    m.root.visible = this.hidden || (this.dead && this.buried) ? false
      : this.invuln > 0 ? Math.floor(this.animT * 16) % 2 === 0 : true;
  }
}
