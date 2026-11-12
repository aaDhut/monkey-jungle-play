// Builds a playable jungle level (collision + 3D scenery) from level JSON.
import * as THREE from 'three';
import {
  mat, part, geo, sphere, makeBanana, makeSuperBanana, makePalm, makeBush, makeHill, makeCloud,
  makeMushroom, makeCheckpoint, makeGoalTree, makeVine, makeBranch,
} from './models.js';
import { buildJungle } from './jungle.js';
import { Baker, bakeGroup, cameraBox, resetBakeStats } from './bake.js';
import { buildVolcanoScenery, lavaMaterial } from './volcano.js';
import {
  makeVolcanicGround, makeVolcanicLedge, makeVolcanicLog, makeMagmaVent, makeVolcanicCheckpoint,
  makeVolcanicGoal, makeCharredBranch, makeScorchedVine,
} from './volcanoprops.js';
import { buildWater, WATER_PALETTES } from './water.js';

const DEPTH = 4;
const WATER_Y = -1;
const VINE_G = 25;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLOWER_COLORS = [0xff7eb6, 0xffe14d, 0xffffff, 0xff9f43];

// Platform meshes use local coords: origin at the platform's top-left corner.
function makeGround(w, h, rand) {
  const g = new THREE.Group();
  // The dirt starts below the grass slab (no faces share a plane, so nothing flickers)
  // and sinks slightly past its bottom so a block resting on ground doesn't touch the grass top.
  const dirtH = h - 0.25;
  const dirt = part(new THREE.BoxGeometry(w, dirtH, DEPTH), mat(0xa0683a));
  dirt.position.set(w / 2, -0.3 - dirtH / 2, 0);
  const grassM = mat(0x72d145);
  const grass = part(new THREE.BoxGeometry(w + 0.2, 0.5, DEPTH + 0.2), grassM);
  grass.position.set(w / 2, -0.25, 0);
  g.add(dirt, grass);

  for (let x = 0.3; x < w; x += 0.7 + rand() * 0.7) {
    const drip = part(sphere(1, 10, 8), grassM, false);
    drip.scale.set(0.32, 0.22 + rand() * 0.18, 0.12);
    drip.position.set(x, -0.48, DEPTH / 2 + 0.08);
    g.add(drip);
  }
  const visibleDepth = Math.min(h, 2.2);
  for (let i = 0; i < w / 2.2; i++) {
    const stone = part(sphere(1, 8, 6), mat(0x8a5a32), false);
    stone.scale.set(0.26, 0.17, 0.06);
    stone.position.set(0.3 + rand() * (w - 0.6), -0.75 - rand() * Math.max(0, visibleDepth - 0.9), DEPTH / 2 + 0.03);
    g.add(stone);
  }
  for (let i = 0; i < w / 1.6; i++) {
    const z = (rand() - 0.5) * DEPTH * 0.9;
    if (rand() < 0.6) {
      const tuft = part(geo('tuft', () => new THREE.ConeGeometry(0.08, 0.32, 5)), mat(0x4caf3c), false);
      tuft.position.set(rand() * w, 0.13, z);
      g.add(tuft);
    } else {
      const flower = part(sphere(0.08, 8, 6), mat(FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)]), false);
      flower.position.set(rand() * w, 0.08, z);
      g.add(flower);
    }
  }
  if (w > 5) {
    for (let x = 1.5 + rand() * 3; x < w - 1; x += 6 + rand() * 5) {
      const bush = makeBush(rand, 0.55);
      bush.position.set(x, 0, -DEPTH / 2 + 0.4);
      g.add(bush);
    }
  }
  return g;
}

function makeLedge(w, h) {
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(w / 0.8));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const plank = part(geo(`plank:${pw.toFixed(2)}:${h}`, () => new THREE.BoxGeometry(pw - 0.06, h, 2.2)),
      mat(i % 2 ? 0xc98d4f : 0xb87a3e));
    plank.position.set((i + 0.5) * pw, -h / 2, 0);
    g.add(plank);
  }
  for (const x of [0.15, w - 0.15]) {
    const rope = part(geo(`rope:${h}`, () => new THREE.BoxGeometry(0.1, h + 0.06, 2.3)), mat(0x5d8a2f), false);
    rope.position.set(x, -h / 2, 0);
    g.add(rope);
  }
  return g;
}

function makeLog(w, h) {
  const g = new THREE.Group();
  const r = h / 2;
  for (const z of [-0.85, 0, 0.85]) {
    const log = part(new THREE.CylinderGeometry(r, r, w, 14), mat(0x8b5a2b));
    log.rotation.z = Math.PI / 2;
    log.position.set(w / 2, -r, z);
    g.add(log);
    for (const x of [0, w]) {
      const cap = part(geo(`logcap:${r}`, () => new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.04, 14)), mat(0xe0b07a), false);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x, -r, z);
      g.add(cap);
    }
  }
  return g;
}

export function buildLevel(data, scene, seed) {
  resetBakeStats();
  const group = new THREE.Group();
  scene.add(group);
  const rand = rng(seed * 9973 + 7);
  const [minX, maxX] = data.bounds ?? [-8, 160];
  const solids = [], movers = [], vines = [], mushrooms = [];
  const islands = []; // land poking through the water surface (gets shore foam)
  // Everything that never moves goes through the baker: merged into a few meshes per culling strip.
  const baker = new Baker({ box: cameraBox(minX, maxX) });
  // The volcano level swaps every jungle model (grass, planks, rope, mushrooms, palm) for a volcanic one.
  const volcanoMode = data.scenery === 'volcano';
  const M = volcanoMode
    ? { ground: makeVolcanicGround, ledge: makeVolcanicLedge, log: makeVolcanicLog, mushroom: makeMagmaVent,
      checkpoint: makeVolcanicCheckpoint, goal: makeVolcanicGoal, branch: makeCharredBranch, vine: makeScorchedVine }
    : { ground: makeGround, ledge: makeLedge, log: makeLog, mushroom: makeMushroom,
      checkpoint: makeCheckpoint, goal: makeGoalTree, branch: makeBranch, vine: makeVine };

  // --- platforms
  for (const p of data.platforms) {
    const type = p.type ?? 'ground';
    const h = p.h ?? (type === 'ground' ? p.y + 8 : type === 'log' ? 0.8 : 0.5);
    let mesh = type === 'log' ? M.log(p.w, h)
      : type === 'ledge' ? M.ledge(p.w, h)
      : M.ground(p.w, h, rand);
    if (p.move) {
      mesh = bakeGroup(mesh); // one draw call per material instead of one per pebble/tuft
      mesh.position.set(p.x, p.y, 0);
      group.add(mesh);
    } else {
      mesh.position.set(p.x, p.y, 0);
      baker.add(mesh);
    }
    const solid = { l: p.x, r: p.x + p.w, t: p.y, b: p.y - h, dx: 0, dy: 0, moving: !!p.move };
    solids.push(solid);
    if (!p.move && solid.b < WATER_Y && solid.t > WATER_Y) islands.push([solid.l, solid.r, -DEPTH / 2, DEPTH / 2]);
    if (p.move) {
      movers.push({ solid, mesh, x0: p.x, y0: p.y, w: p.w, h, ax: p.move[0], ay: p.move[1], speed: p.speed ?? 0.5, phase: 0 });
    }
  }

  // --- bouncy mushrooms (solid, and launch you when you land on top)
  for (const [x, y] of data.mushrooms ?? []) {
    const m = M.mushroom();
    m.root.position.set(x, y, 0);
    group.add(m.root);
    const mu = { x, y, cap: m.cap, squish: 0 };
    mushrooms.push(mu);
    solids.push({ l: x - 0.7, r: x + 0.7, b: y, t: y + 0.9, dx: 0, dy: 0, bounce: true, owner: mu });
  }

  // Invisible walls at both ends of the level.
  solids.push({ l: minX - 5, r: minX, b: -30, t: 60, dx: 0, dy: 0, wall: true });
  solids.push({ l: maxX, r: maxX + 5, b: -30, t: 60, dx: 0, dy: 0, wall: true });

  // --- swinging vines
  for (const v of data.vines ?? []) {
    const branch = M.branch(rand);
    branch.position.set(v.x, v.y + 0.15, -0.4);
    baker.add(branch);
    const root = M.vine(v.len);
    root.position.set(v.x, v.y, 0);
    group.add(root);
    vines.push({
      ax: v.x, ay: v.y, L: v.len, theta: (rand() - 0.5) * 0.4, omega: 0, pump: 0, attachLen: null, root,
      pointAt(len) {
        return { x: this.ax + Math.sin(this.theta) * len, y: this.ay - Math.cos(this.theta) * len };
      },
      // How far down the vine a hand at (px, py) can grab it, or 0 if it can't.
      grabLength(px, py) {
        const bx = Math.sin(this.theta) * this.L, by = -Math.cos(this.theta) * this.L;
        let u = ((px - this.ax) * bx + (py - this.ay) * by) / (this.L * this.L);
        if (u < 0.35) return 0;
        u = Math.min(u, 1);
        const d = Math.hypot(px - (this.ax + bx * u), py - (this.ay + by * u));
        return d < 0.6 ? Math.max(u * this.L, 1.5) : 0;
      },
    });
  }

  // --- bananas
  const bananas = [];
  const addBanana = (x, y) => {
    const mesh = makeBanana();
    mesh.position.set(x, y, 0);
    group.add(mesh);
    bananas.push({ x, y, mesh, taken: false });
  };
  for (const [x, y] of data.bananas ?? []) addBanana(x, y);
  for (const [x, y, n, dx = 1] of data.bananaLines ?? []) for (let i = 0; i < n; i++) addBanana(x + i * dx, y);

  const powerups = (data.powerups ?? []).map(([x, y]) => {
    const mesh = makeSuperBanana();
    mesh.position.set(x, y, 0);
    group.add(mesh);
    return { x, y, mesh, taken: false };
  });

  const checkpoints = (data.checkpoints ?? []).map(([x, y]) => {
    const cp = M.checkpoint();
    cp.root.position.set(x, y, -1.2);
    group.add(cp.root);
    return { x, y, active: false, cp };
  });

  const goalTree = M.goal(rand);
  const [gx, gy] = data.goal;
  goalTree.root.position.set(gx, gy, -0.8);
  group.add(goalTree.root);
  const goal = { x: gx, y: gy, prize: goalTree.prize };

  // --- scenery
  const span = maxX - minX + 140;
  const cx = (minX + maxX) / 2;
  const jungleMode = data.scenery === 'jungle';
  // In the volcano level the "water" you fall into is molten lava; elsewhere it's a stylized
  // water volume with fish. Override the colours with "theme": { "water": { "shallow": "#..." } }.
  let lava = null, waterFx = null;
  if (volcanoMode) {
    lava = part(new THREE.PlaneGeometry(span, 14), lavaMaterial(span / 10, 1.4), false);
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(cx, WATER_Y, 0);
    group.add(lava);
  } else {
    const palette = { ...WATER_PALETTES[jungleMode ? 'jungle' : 'lagoon'], ...data.theme?.water };
    waterFx = buildWater(group, { cx, span, minX, maxX, y: WATER_Y, islands, rand, palette });
  }

  const floorColor = volcanoMode ? 0x2a1f1b : jungleMode ? 0x3d7a33 : 0x5aa845;
  const floor = part(new THREE.PlaneGeometry(span, 90), mat(floorColor), false);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, -0.6, -6 - 45);
  group.add(floor);

  const clouds = [];
  let jungle = null;
  if (volcanoMode) {
    // Volcanic wasteland: crags, lava falls and rivers, erupting volcanoes (level 3).
    jungle = buildVolcanoScenery(group, rand, minX, maxX);
  } else if (jungleMode) {
    // Dense tropical rainforest backdrop (level 2).
    jungle = buildJungle(group, rand, minX, maxX);
  } else {
    for (let x = minX - 20; x < maxX + 20; x += 3 + rand() * 4) {
      const palm = makePalm(rand, 6 + rand() * 5);
      palm.position.set(x, -0.6, -8 - rand() * 14);
      palm.rotation.y = rand() * Math.PI * 2;
      baker.add(palm);
    }
    for (let x = minX - 20; x < maxX + 20; x += 2.5 + rand() * 3) {
      const bush = makeBush(rand, 0.8 + rand() * 0.6);
      bush.position.set(x, -0.6, -6.5 - rand() * 3);
      baker.add(bush);
    }
    for (let x = minX - 40; x < maxX + 40; x += 14 + rand() * 10) {
      const hill = makeHill(rand);
      hill.position.set(x, -4, -60 - rand() * 20);
      baker.add(hill, 'far');
    }
    for (let x = minX - 40; x < maxX + 40; x += 18 + rand() * 14) {
      const c = makeCloud(rand);
      c.position.set(x, 16 + rand() * 9, -50 - rand() * 15);
      group.add(c);
      clouds.push(c);
    }
  }

  baker.finish(group, { receiveLayers: new Set(['static']) }); // far hills are beyond any shadow

  let time = 0;

  return {
    group, solids, vines, bananas, powerups, checkpoints, goal, jungle, lava: volcanoMode,
    enemyDefs: data.enemies ?? [],
    spawn: { x: data.spawn[0], y: data.spawn[1] },
    minX, maxX,
    waterY: WATER_Y,
    killY: WATER_Y - 1.2,

    // Fixed-step simulation: moving platforms and vine pendulums.
    update(dt) {
      time += dt;
      for (const m of movers) {
        m.phase += dt * m.speed * Math.PI;
        const off = (1 - Math.cos(m.phase)) / 2;
        const l = m.x0 + m.ax * off, t = m.y0 + m.ay * off;
        const s = m.solid;
        s.dx = l - s.l; s.dy = t - s.t;
        s.l = l; s.r = l + m.w; s.t = t; s.b = t - m.h;
        m.mesh.position.set(l, t, 0);
      }
      for (const v of vines) {
        const len = v.attachLen ?? v.L;
        let a = -(VINE_G / len) * Math.sin(v.theta);
        if (v.attachLen) {
          // Pushing in the direction you're already swinging pumps the swing higher.
          if (v.pump) a += v.pump * (Math.sign(v.omega) === v.pump ? 4.5 : 1.2);
          a -= v.omega * 0.05;
        } else {
          a += -v.omega * 0.6 + Math.sin(time * 0.8 + v.ax) * 0.3;
        }
        v.omega += a * dt;
        v.theta += v.omega * dt;
        if (Math.abs(v.theta) > 1.3) { v.theta = Math.sign(v.theta) * 1.3; v.omega = 0; }
        v.root.rotation.z = v.theta;
      }
    },

    // Per-frame cosmetic animation.
    animate(t, dt) {
      for (const b of bananas) {
        if (b.taken) continue;
        b.mesh.rotation.y = t * 2.5 + b.x;
        b.mesh.position.y = b.y + Math.sin(t * 3 + b.x) * 0.08;
      }
      for (const p of powerups) {
        if (p.taken) continue;
        p.mesh.rotation.y = t * 2;
        p.mesh.position.y = p.y + Math.sin(t * 2.5) * 0.15;
        p.mesh.userData.halo.rotation.x = t * 1.5;
      }
      goal.prize.rotation.y = t * 1.5;
      goal.prize.position.y = 2.4 + Math.sin(t * 2) * 0.2;
      if (lava) {
        lava.position.y = WATER_Y + Math.sin(t * 1.4) * 0.04;
        lava.material.map.offset.set(t * 0.03, t * 0.02);
        lava.material.color.setScalar(0.88 + Math.sin(t * 2.4) * 0.12);
      }
      waterFx?.animate(t, dt);
      for (const mu of mushrooms) {
        mu.squish = Math.max(0, mu.squish - dt * 2.5);
        const wob = Math.sin(mu.squish * 14) * mu.squish * 0.4;
        mu.cap.scale.set(1 - wob * 0.5, 1 + wob, 1 - wob * 0.5);
      }
      for (const c of checkpoints) c.cp.flag.rotation.y = Math.sin(t * 4 + c.x) * 0.25;
      jungle?.animate(t);
      for (const c of clouds) {
        c.position.x += dt * 0.4;
        if (c.position.x > maxX + 45) c.position.x = minX - 45;
      }
    },

    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose(); // frees its per-instance GPU buffer
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        if (o.material?.userData?.own) o.material.dispose();
      });
    },
  };
}
