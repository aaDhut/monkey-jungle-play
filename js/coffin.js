// Death sequence: a coffin rises out of the floor, swallows the monkey, shuts and sinks away.
import * as THREE from 'three';

// Classic six-sided coffin outline (x, y), feet at y = 0, standing upright facing the camera.
const OUTLINE = [[-0.4, 0], [0.4, 0], [0.62, 1.45], [0.46, 2.05], [-0.46, 2.05], [-0.62, 1.45]];
const H = 2.05;      // coffin height
const D = 0.9;       // coffin depth (front to back)
const T = 0.08;      // wood thickness
const CZ = -0.9;     // rises just behind the monkey
const LID_OPEN = -2.0;
const LIE = 1.45;    // how far the monkey tips over (radians)

// Timeline in seconds.
const TL = {
  lie: 0.5,
  riseStart: 0.35, riseEnd: 1.25,
  pullStart: 1.35, pullEnd: 2.15,
  closeEnd: 2.45,
  sinkStart: 2.9, sinkEnd: 4.0,
};
export const BURIAL_TIME = 4.4;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const span = (t, a, b) => clamp01((t - a) / (b - a));

function shape(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function buildCoffin(clip) {
  const m = (color, roughness = 0.75) => new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0, clippingPlanes: [clip], clipShadows: true,
  });
  const wood = m(0x6b4226), edge = m(0x4a2c17), lining = m(0x9c2b3c, 0.95), gold = m(0xffcf4a, 0.35);
  const mesh = (g, mt) => {
    const o = new THREE.Mesh(g, mt);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };

  const root = new THREE.Group();

  // Back panel + red satin lining.
  const back = mesh(new THREE.ExtrudeGeometry(shape(OUTLINE), { depth: T, bevelEnabled: false }), wood);
  back.position.z = -D / 2;
  const inset = OUTLINE.map(([x, y]) => [x * 0.86, 0.1 + y * 0.9]);
  const satin = mesh(new THREE.ExtrudeGeometry(shape(inset), { depth: 0.02, bevelEnabled: false }), lining);
  satin.position.z = -D / 2 + T;
  root.add(back, satin);

  // Side walls along each edge of the outline.
  for (let i = 0; i < OUTLINE.length; i++) {
    const [ax, ay] = OUTLINE[i], [bx, by] = OUTLINE[(i + 1) % OUTLINE.length];
    const len = Math.hypot(bx - ax, by - ay);
    const wall = mesh(new THREE.BoxGeometry(len + 0.07, T, D), edge);
    wall.position.set((ax + bx) / 2, (ay + by) / 2, 0);
    wall.rotation.z = Math.atan2(by - ay, bx - ax);
    root.add(wall);
  }

  // Lid, hinged on the left shoulder so it swings open toward the camera.
  const [hx] = OUTLINE[5];
  const lid = new THREE.Group();
  lid.position.set(hx, 0, D / 2);
  const panel = mesh(new THREE.ExtrudeGeometry(shape(OUTLINE), { depth: T, bevelEnabled: false }), wood);
  panel.position.x = -hx;
  const crossV = mesh(new THREE.BoxGeometry(0.11, 0.85, 0.04), gold);
  crossV.position.set(-hx, 1.2, T + 0.02);
  const crossH = mesh(new THREE.BoxGeometry(0.5, 0.11, 0.04), gold);
  crossH.position.set(-hx, 1.42, T + 0.02);
  const handle = mesh(new THREE.SphereGeometry(0.06, 10, 8), gold);
  handle.position.set(-hx + 0.5, 1.1, T + 0.03);
  lid.add(panel, crossV, crossH, handle);
  root.add(lid);

  root.visible = false;
  return { root, lid };
}

export class Burial {
  /** hooks: { effects, sound, shake(amount), haptic(name) } */
  constructor(scene, hooks) {
    this.hooks = hooks;
    this.clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // hides whatever is below the floor
    const c = buildCoffin(this.clip);
    this.root = c.root;
    this.lid = c.lid;
    scene.add(this.root);
    this.active = false;
  }

  /** Start the sequence for a player who just died. solids/waterY describe the world. */
  start(player, solids, waterY) {
    // Find the floor under the monkey (it may have died mid-air, on a vine, or in the water).
    let floor = waterY, ground = null;
    for (const s of solids) {
      if (s.wall || s.bounce || player.x < s.l || player.x > s.r || s.t > player.y + 0.05) continue;
      if (s.t > floor) { floor = s.t; ground = s; }
    }
    if (player.y < floor) player.y = floor; // fell into the water: pop back up onto the surface

    Object.assign(this, {
      active: true, t: 0, player, floor, ground, fy: player.y, vy: 6,
      cx: player.x, lieDir: player.facing >= 0 ? 1 : -1, lieX: player.x,
      fromY: undefined, landed: false, rose: false, closed: false, sinking: false, dirtT: 0,
    });
    Object.assign(player, { z: 0, deadRotZ: 0, deadScale: 1, buried: false });
    this.root.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.lid.rotation.y = LID_OPEN;
    this.place(-H - 0.2);
  }

  place(yOff, jitter = 0) {
    this.root.position.set(this.cx + jitter, this.floor + yOff, CZ);
    this.clip.constant = -this.floor;
  }

  dirt(n = 6) {
    const { effects } = this.hooks;
    effects.burst(this.cx + (Math.random() - 0.5) * 1.2, this.floor + 0.05, 0x7a4a26, n,
      { speed: 3, up: 4, life: 0.6, gravity: 16, size: 1.2, z: CZ + D / 2 + 0.1 });
  }

  /** Focus point for the camera. */
  get focus() { return { x: this.cx, y: this.floor + 1.2 }; }

  update(dt) {
    if (!this.active) return;
    const p = this.player, { sound, effects, shake, haptic } = this.hooks;
    this.t += dt;
    const t = this.t;

    // Ride along with a moving platform.
    if (this.ground) {
      const { dx, dy } = this.ground;
      this.cx += dx; this.lieX += dx; p.x += dx;
      this.floor += dy; this.fy += dy; p.y += dy;
    }

    if (t < TL.pullStart) {
      // 1. Drop to the floor and keel over.
      this.vy -= 40 * dt;
      this.fy = Math.max(this.floor, this.fy + this.vy * dt);
      if (this.fy <= this.floor && !this.landed) {
        this.landed = true;
        this.vy = 0;
        effects.dust(p.x, this.floor);
      }
      const lie = easeOut(span(t, 0, TL.lie));
      p.deadRotZ = this.lieDir * LIE * lie;
      p.y = this.fy + 0.3 * lie; // keep the tipped-over body above the ground
      this.lieX = p.x;
    }

    // 2. The coffin bursts up out of the floor, lid open.
    if (t >= TL.riseStart && !this.rose) {
      this.rose = true;
      sound.rumble?.(0.9);
      sound.creak?.();
      shake(0.25);
      this.dirt(10);
    }
    if (t < TL.sinkStart) {
      const k = easeOut(span(t, TL.riseStart, TL.riseEnd));
      const wobble = t < TL.riseEnd ? Math.sin(t * 50) * 0.03 * (1 - k) : 0;
      this.place(lerp(-H - 0.2, 0, k), wobble);
      if (t < TL.riseEnd && (this.dirtT -= dt) <= 0) { this.dirtT = 0.1; this.dirt(3); }
    }

    // 3. The monkey floats up and into the coffin.
    if (t >= TL.pullStart && t < TL.closeEnd) {
      if (this.fromY === undefined) this.fromY = p.y - this.floor; // may still be falling
      const k = easeInOut(span(t, TL.pullStart, TL.pullEnd));
      p.x = lerp(this.lieX, this.cx, k);
      p.y = lerp(this.floor + this.fromY, this.floor + 0.1, k) + Math.sin(k * Math.PI) * 0.7;
      p.z = lerp(0, CZ, k);
      p.deadRotZ = lerp(this.lieDir * LIE, 0, k);
      p.deadScale = lerp(1, 0.85, k);
      if ((this.dirtT -= dt) <= 0 && k < 1) {
        this.dirtT = 0.08;
        effects.burst(p.x, p.y + 0.6, 0xe9d8ff, 2, { speed: 1.5, up: 1.5, life: 0.5, gravity: -2, z: p.z + 0.5 });
      }
    }

    // 4. Lid slams shut.
    if (t >= TL.pullEnd && t < TL.sinkStart) {
      const k = easeIn(span(t, TL.pullEnd, TL.closeEnd));
      this.lid.rotation.y = lerp(LID_OPEN, 0, k);
      if (k >= 1 && !this.closed) {
        this.closed = true;
        p.buried = true;
        sound.thud?.();
        sound.toll?.();
        shake(0.4);
        haptic('stomp');
        effects.dust(this.cx, this.floor);
      }
    }

    // 5. Down it goes.
    if (t >= TL.sinkStart) {
      if (!this.sinking) {
        this.sinking = true;
        sound.rumble?.(1.2);
        haptic('die');
      }
      const k = easeIn(span(t, TL.sinkStart, TL.sinkEnd));
      this.place(-k * (H + 0.25), Math.sin(t * 70) * 0.04);
      this.root.rotation.z = Math.sin(t * 23) * 0.03;
      if (k < 1 && (this.dirtT -= dt) <= 0) { this.dirtT = 0.09; this.dirt(4); }
      if (k >= 1 && this.root.visible) {
        this.root.visible = false;
        this.dirt(12);
      }
    }
  }

  reset() {
    this.active = false;
    this.root.visible = false;
    if (this.player) Object.assign(this.player, { z: 0, deadRotZ: 0, deadScale: 1, buried: false });
  }
}
