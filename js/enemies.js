// Enemy monkeys: walkers patrol, hoppers jump at you, throwers lob coconuts.
import * as THREE from 'three';
import { makeMonkey, poseMonkey, makeCoconut, makeSlingshot, part, geo, sphere, mat } from './models.js';
import { moveBody, solidAt, GRAVITY } from './physics.js';

export const COCO_G = 20;

// Close-range punch. Windup is the player's warning window (the red "!" shows).
export const MELEE = {
  range: 1.3,     // gap between bodies that triggers a punch
  reach: 2.0,     // how far in front of the enemy the fist hits
  lunge: 8,
};

// Punch speed per level: slow and readable on level 1, full speed from
// MELEE_FULL_AT on. Levels in between blend smoothly.
const MELEE_EASY = { windup: 0.45, punch: 0.22, recover: 0.55, cooldown: 0.9, anim: 0.45 };
const MELEE_HARD = { windup: 0.1, punch: 0.12, recover: 0.3, cooldown: 0.35, anim: 1 };
const MELEE_FULL_AT = 3;

export function meleeTiming(level = 1) {
  const k = clamp((level - 1) / (MELEE_FULL_AT - 1), 0, 1);
  const out = {};
  for (const key in MELEE_EASY) out[key] = MELEE_EASY[key] + (MELEE_HARD[key] - MELEE_EASY[key]) * k;
  return out;
}

function makeAlert() {
  const g = new THREE.Group();
  const red = mat(0xff3b3b, { emissive: 0xff2020, emissiveIntensity: 0.6 });
  const bar = part(geo('alertbar', () => new THREE.BoxGeometry(0.14, 0.42, 0.14)), red, false);
  bar.position.y = 0.3;
  const dot = part(sphere(0.085, 10, 8), red, false);
  g.add(bar, dot);
  g.position.y = 2.15;
  g.visible = false;
  return g;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const LOOKS = {
  walker: { fur: 0x7d7f8c, skin: 0xe0c3a8, angry: true },
  hopper: { fur: 0xd9572b, skin: 0xffd3a6, angry: true },
  thrower: { fur: 0x6c4a9e, skin: 0xe8c6b0, angry: true },
};

class Enemy {
  constructor(def, scene) {
    this.type = def.type;
    this.x = def.x;
    this.y = def.y ?? 0;
    this.w = 0.8;
    this.h = 1.3;
    this.vx = 0; this.vy = 0;
    this.ground = null; this.onGround = false; this.hitWall = 0;
    const range = def.range ?? [def.x - 3, def.x + 3];
    this.min = range[0]; this.max = range[1];
    this.facing = -1;
    this.alive = true;
    this.gone = false;
    this.deadT = 0;
    this.t = Math.random() * 10;
    this.phase = 0;
    this.scene = scene;
    this.model = makeMonkey(LOOKS[this.type]);
    this.model.root.scale.setScalar(0.82);
    this.alert = makeAlert();
    this.model.root.add(this.alert);
    scene.add(this.model.root);
    this.melee = null;      // { phase: 'windup' | 'punch' | 'recover', t, landed }
    this.meleeCool = 0;
  }

  update(dt, world, player, game) {
    if (this.gone) return;
    if (!this.alive) {
      this.deadT += dt;
      if (this.deadT > 0.6) this.remove();
      return;
    }
    this.t += dt;
    this.vy = Math.max(this.vy - GRAVITY * dt, -26);
    this.meleeCool = Math.max(0, this.meleeCool - dt);
    if (this.melee) {
      this.updateMelee(dt, world, player, game);
    } else {
      this.think(dt, world, player, game);
      this.tryStartMelee(player, game);
    }
    moveBody(this, dt, world.solids);
    if (this.y < world.killY) { this.alive = false; this.remove(); }
  }

  tryStartMelee(player, game) {
    if (this.meleeCool > 0 || !this.onGround || player.dead || player.hidden || player.celebrating) return;
    const dx = player.x - this.x, dy = player.y - this.y;
    const gap = Math.abs(dx) - (player.w + this.w) / 2;
    if (gap < MELEE.range && dy > -0.8 && dy < 1.1) {
      this.facing = dx < 0 ? -1 : 1;
      this.vx = 0;
      this.aiming = false; // a slingshot monkey drops its shot to punch
      const time = meleeTiming(game.level);
      this.melee = { phase: 'windup', t: 0, landed: false, time };
      this.model.punchSpeed = time.anim;
      game.onEnemyWindup?.(this);
    }
  }

  updateMelee(dt, world, player, game) {
    const m = this.melee;
    const time = m.time;
    m.t += dt;
    this.vx = 0;
    if (m.phase === 'windup') {
      // Keep turning to face the player while winding up.
      if (Math.abs(player.x - this.x) > 0.3) this.facing = player.x < this.x ? -1 : 1;
      if (m.t >= time.windup) {
        m.phase = 'punch';
        m.t = 0;
        game.onEnemyPunch?.(this);
      }
    } else if (m.phase === 'punch') {
      // Small lunge forward, but never off a ledge.
      const ahead = this.x + this.facing * (this.w / 2 + 0.15);
      if (solidAt(ahead, this.y - 0.2, world.solids)) this.vx = this.facing * MELEE.lunge;
      if (m.t >= time.punch) { m.phase = 'recover'; m.t = 0; }
    } else if (m.t >= time.recover) {
      this.melee = null;
      this.meleeCool = time.cooldown;
    }
  }

  /** True once per punch, when the fist connects with the player. */
  punchHits(p) {
    const m = this.melee;
    if (!this.alive || !m || m.phase !== 'punch' || m.landed) return false;
    const a = this.x + this.facing * 0.2, b = this.x + this.facing * MELEE.reach;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const hit = p.x + p.w / 2 > lo && p.x - p.w / 2 < hi && p.y < this.y + 1.25 && p.y + p.h > this.y + 0.35;
    if (hit) m.landed = true;
    return hit;
  }

  think() {}
  mode() { return 'idle'; }

  stomp() { this.alive = false; this.deadT = 0; }

  remove() {
    if (this.gone) return;
    this.gone = true;
    this.scene.remove(this.model.root);
  }

  render(dt) {
    if (this.gone) return;
    const m = this.model;
    m.root.position.set(this.drawX ?? this.x, this.drawY ?? this.y, 0);
    // Turn fully side-on while fighting so the punch reads clearly.
    const turn = this.melee ? 1.45 : 0.95;
    m.root.rotation.y += (this.facing * turn - m.root.rotation.y) * Math.min(1, dt * (this.melee ? 20 : 10));
    const winding = this.alive && this.melee?.phase === 'windup';
    this.alert.visible = winding;
    if (winding) {
      const pop = Math.min(1, this.melee.t / (this.melee.time.windup * 0.4));
      this.alert.scale.setScalar(pop * (1 + Math.sin(this.t * 30) * 0.08));
      this.alert.rotation.y = -m.root.rotation.y; // keep facing the camera
    }
    if (!this.alive) {
      m.body.scale.y += (0.2 - m.body.scale.y) * Math.min(1, dt * 20);
      m.body.scale.x = m.body.scale.z = 1.3;
      return;
    }
    // Punch with the arm nearest the camera.
    m.punchSide = -this.facing;
    const mode = this.melee
      ? (this.melee.phase === 'windup' ? 'windup' : this.melee.phase === 'punch' ? 'punch' : 'idle')
      : this.mode();
    poseMonkey(m, mode, this.t, dt, this.phase);
  }
}

class Walker extends Enemy {
  think(dt, world) {
    if (this.hitWall) this.facing = -this.hitWall;
    const ahead = this.x + this.facing * (this.w / 2 + 0.15);
    if (this.onGround && !solidAt(ahead, this.y - 0.2, world.solids)) this.facing *= -1;
    if (this.x < this.min) this.facing = 1;
    else if (this.x > this.max) this.facing = -1;
    this.vx = this.facing * 2.2;
    this.phase += dt * 9;
  }
  mode() { return 'run'; }
}

class Hopper extends Enemy {
  constructor(def, scene) {
    super(def, scene);
    this.cool = 1 + Math.random();
  }
  think(dt, world, player) {
    if (!this.onGround) return;
    this.vx = 0;
    this.cool -= dt;
    const dx = player.x - this.x;
    if (Math.abs(dx) < 10 && !player.dead) this.facing = Math.sign(dx) || this.facing;
    if (this.cool <= 0) {
      let dir = this.facing;
      const landing = this.x + dir * 2.4;
      if (landing > this.max || landing < this.min) dir = 0;
      this.vy = 12;
      this.vx = dir * 3;
      this.cool = 1.3 + Math.random() * 0.6;
    }
  }
  mode() { return this.onGround ? 'idle' : this.vy > 0 ? 'jump' : 'fall'; }
}

// Slingshot shooter: raises the slingshot, pulls the band back while tracking the player, then fires.
const SLING = {
  aimTime: 0.6,      // pull-back time (the player's warning)
  minRange: 2.8,     // closer than this it punches instead
  maxRange: 16,
  cooldown: [1.6, 2.2],
};
const _v = new THREE.Vector3();

class Thrower extends Enemy {
  constructor(def, scene) {
    super(def, scene);
    this.cool = 1.2;
    this.aiming = false;
    this.aimT = 0;
    this.pitch = 0;
    this.snap = 0;
    this.sling = makeSlingshot();
    this.sling.root.scale.setScalar(1.4);
    this.model.root.add(this.sling.root);
  }

  inRange(player) {
    const adx = Math.abs(player.x - this.x), dy = player.y - this.y;
    return !player.dead && !player.hidden && adx > SLING.minRange && adx < SLING.maxRange && Math.abs(dy) < 8;
  }

  // Coconut launch: a fast, fairly flat arc that leads a moving target a little.
  solveShot(player) {
    const sx = this.x + this.facing * 0.55, sy = this.y + 1.2;
    const dist = Math.abs(player.x - sx);
    const T = clamp(dist / 13, 0.35, 0.9);
    const tx = player.x + player.vx * T * 0.5, ty = player.y + player.h * 0.5;
    return { sx, sy, vx: (tx - sx) / T, vy: (ty - sy + 0.5 * COCO_G * T * T) / T };
  }

  think(dt, world, player, game) {
    this.vx = 0;
    this.snap = Math.max(0, this.snap - dt);
    if (Math.abs(player.x - this.x) > 0.2) this.facing = player.x < this.x ? -1 : 1;
    if (this.aiming) {
      if (!this.inRange(player)) { this.aiming = false; this.cool = 0.5; return; }
      this.aimT += dt;
      const shot = this.solveShot(player);
      this.pitch = clamp(Math.atan2(shot.vy, Math.abs(shot.vx)), -0.6, 1.1);
      if (this.aimT >= SLING.aimTime) {
        game.throwCoconut(shot.sx, shot.sy, shot.vx, shot.vy);
        this.aiming = false;
        this.snap = 0.3;
        this.cool = SLING.cooldown[0] + Math.random() * (SLING.cooldown[1] - SLING.cooldown[0]);
      }
    } else {
      this.cool -= dt;
      if (this.cool <= 0 && this.inRange(player)) {
        this.aiming = true;
        this.aimT = 0;
        game.onSlingAim?.(this);
      }
    }
  }

  mode() { return this.aiming ? 'aim' : this.snap > 0 ? 'release' : 'idle'; }

  render(dt) {
    if (this.gone) return;
    this.model.aimPitch = this.pitch;
    super.render(dt);
    // Where the slingshot sits: out in the front fist while shooting, lowered at the side otherwise.
    const shooting = this.alive && !this.melee && (this.aiming || this.snap > 0);
    const side = -this.facing; // arm nearest the camera (same one poseMonkey uses)
    const k = 1 - Math.exp(-dt * 16);
    const s = this.sling.root;
    if (shooting) {
      const p = this.pitch;
      _v.set(side * 0.31, 0.86 + 0.6 * Math.sin(p), 0.62 * Math.cos(p));
      s.rotation.x += (-p - s.rotation.x) * k;
    } else {
      _v.set(-side * 0.42, 0.42, 0.14);
      s.rotation.x += (0.35 - s.rotation.x) * k;
    }
    s.position.lerp(_v, k);
    const pull = this.aiming ? Math.min(1, this.aimT / SLING.aimTime) ** 0.7 : 0;
    this.sling.setPull(pull, this.aiming);
  }
}

const TYPES = { walker: Walker, hopper: Hopper, thrower: Thrower };

export function spawnEnemy(def, scene) {
  const Type = TYPES[def.type] ?? Walker;
  return new Type(def, scene);
}

export class Coconut {
  constructor(scene, x, y, vx, vy) {
    this.scene = scene;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = 4;
    this.alive = true;
    this.mesh = makeCoconut();
    this.mesh.position.set(x, y, 0);
    scene.add(this.mesh);
  }

  update(dt, world) {
    if (!this.alive) return;
    this.vy -= COCO_G * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || this.y < world.killY) this.alive = false;
    for (const s of world.solids) {
      if (this.x > s.l && this.x < s.r && this.y - 0.2 < s.t && this.y > s.b) {
        this.alive = false;
        break;
      }
    }
  }

  hits(p) {
    const cx = clamp(this.x, p.x - p.w / 2, p.x + p.w / 2);
    const cy = clamp(this.y, p.y, p.y + p.h);
    return Math.hypot(this.x - cx, this.y - cy) < 0.3;
  }

  render(dt) {
    this.mesh.position.set(this.drawX ?? this.x, this.drawY ?? this.y, 0);
    this.mesh.rotation.z -= dt * 10 * Math.sign(this.vx || 1);
  }

  remove() { this.scene.remove(this.mesh); }
}
