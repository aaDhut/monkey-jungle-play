// Little particle bursts: sparkles, stars, dust, splashes, confetti.
import * as THREE from 'three';
import { mat } from './models.js';

const GEO = new THREE.IcosahedronGeometry(0.12, 0);

// Sprint speed lines: tapered streaks left hanging in the air behind the monkey. All of them live in
// ONE InstancedMesh (a single draw call, no per-line material, no allocation after start-up).
const TRAIL_MAX = 14;     // hard cap on live streaks
const TRAIL_RATE = 30;    // streaks spawned per second of sprinting
const TRAIL_LIFE = 0.3;   // seconds each streak lives
const TRAIL_THICK = 0.11; // world units at the thick (front) end; the camera sits ~17 units back
const _m = new THREE.Matrix4();

/** Unit streak from x=0 (thick, opaque) back to x=-1 (a point, fully transparent). */
function streakGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.5, 0,   0, -0.5, 0,   -1, 0.08, 0,   -1, -0.08, 0,
  ], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([
    1, 1, 1, 0.9,   1, 1, 1, 0.9,   1, 1, 1, 0,   1, 1, 1, 0,
  ], 4)); // rgba: three.js uses the alpha channel when the colour attribute has 4 components
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

class SpeedLines {
  constructor(scene) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(streakGeometry(), material, TRAIL_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // it's always next to the player, and bounds would go stale
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    // Fixed slots, swap-removed like the particle list.
    this.lines = Array.from({ length: TRAIL_MAX }, () => ({ x: 0, y: 0, z: 0, dir: 1, len: 1, life: 0, max: 1 }));
    this.n = 0;
    this.acc = 0;
  }

  /** Call every frame while sprinting. (x, y) = feet, h = body height, dir = facing. */
  emit(x, y, h, dir, dt) {
    this.acc += dt * TRAIL_RATE;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (this.n >= TRAIL_MAX) continue;
      const l = this.lines[this.n++];
      l.x = x - dir * (0.1 + Math.random() * 0.3);
      l.y = y + h * (0.12 + Math.random() * 0.8);
      l.z = 0.3 + Math.random() * 0.5; // in front of the body so he never hides them
      l.dir = dir;
      l.len = 1.6 + Math.random() * 1.4;
      l.life = l.max = TRAIL_LIFE * (0.7 + Math.random() * 0.6);
    }
  }

  update(dt) {
    if (this.n === 0) return;
    let i = 0;
    while (i < this.n) {
      const l = this.lines[i];
      l.life -= dt;
      if (l.life <= 0) { // swap-remove: move the last live slot here
        this.lines[i] = this.lines[--this.n];
        this.lines[this.n] = l;
        continue;
      }
      const k = l.life / l.max;                    // 1 → 0
      const len = l.len * Math.min(1, (1 - k) * 5); // shoots out fast, then thins away
      // The front end stays where it spawned; negative x-scale points the tail the other way.
      _m.makeScale(l.dir * len, TRAIL_THICK * k, 1);
      _m.setPosition(l.x, l.y, l.z);
      this.mesh.setMatrixAt(i, _m);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.n = 0; this.acc = 0; this.mesh.count = 0; }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.pool = []; // recycled particle meshes: no allocation / scene-graph churn per burst
    this.speedLines = new SpeedLines(scene);
  }

  /** Speed streaks behind a sprinting body; call each frame while sprinting. */
  trail(x, y, h, dir, dt) { this.speedLines.emit(x, y, h, dir, dt); }

  take(material) {
    const m = this.pool.pop() ?? new THREE.Mesh(GEO, material);
    m.material = material;
    m.visible = true;
    if (!m.parent) this.scene.add(m);
    return m;
  }

  release(m) {
    m.visible = false; // stays in the scene, just hidden, so reusing it is free
    this.pool.push(m);
  }

  burst(x, y, color, n = 10, { speed = 4, up = 4, life = 0.6, size = 1, gravity = 14, z = 0.6 } = {}) {
    const material = mat(color, { roughness: 0.5 });
    for (let i = 0; i < n; i++) {
      const m = this.take(material);
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.list.push({
        m, vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: (Math.random() - 0.5) * speed,
        life, max: life, size: size * (0.6 + Math.random() * 0.8), gravity,
      });
    }
  }

  sparkle(x, y) { this.burst(x, y, 0xfff176, 8, { speed: 3, up: 3, life: 0.5, gravity: 4 }); }
  stars(x, y) {
    this.burst(x, y, 0xffffff, 6, { speed: 6, up: 4, life: 0.5 });
    this.burst(x, y, 0xffd93b, 6, { speed: 6, up: 4, life: 0.5 });
  }
  dust(x, y) { this.burst(x, y + 0.1, 0xe8d5b0, 6, { speed: 3, up: 1.2, life: 0.4, gravity: 2, size: 1.3 }); }
  /** A small puff of dirt flicked backwards from a sprinting foot. dir = -1 (left) or 1 (right). */
  kick(x, y, dir) {
    for (let i = 0; i < 3; i++) {
      this.burst(x, y + 0.08, 0xd9c29a, 1, { speed: 0.8, up: 1.5, life: 0.35, gravity: 6, size: 0.8 });
      this.list[this.list.length - 1].vx += dir * (2 + Math.random() * 1.5);
    }
  }
  splash(x, y, color = 0x9be3ff) { this.burst(x, y, color, 18, { speed: 4, up: 8, life: 0.8, gravity: 18 }); }
  confetti(x, y) {
    for (const c of [0xff5a5a, 0xffd93b, 0x3ddc84, 0x4cc9f0, 0xb980ff]) {
      this.burst(x, y, c, 8, { speed: 7, up: 9, life: 1.4, gravity: 9 });
    }
  }

  update(dt) {
    this.speedLines.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.release(p.m);
        // Swap-remove (O(1)); the last entry was already updated this pass since we iterate backwards.
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      p.vy -= p.gravity * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 6;
      p.m.rotation.y += dt * 4;
      p.m.scale.setScalar(p.size * (p.life / p.max));
    }
  }

  clear() {
    for (const p of this.list) this.release(p.m);
    this.list = [];
    this.speedLines.clear();
  }
}
