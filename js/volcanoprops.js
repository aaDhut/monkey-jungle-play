// Volcanic versions of the gameplay models (used by levels with "scenery": "volcano").
// Same shapes and local coordinates as the jungle models in level.js / models.js, so collision
// is unchanged: only the look differs. Basalt rock, cooling crust, glowing magma veins, lava drips
// and puddles, charred wood, chains instead of rope.
import * as THREE from 'three';
import { mat, part, geo, sphere, makeBanana, makeSuperBanana } from './models.js';
import { lavaMaterial, hot } from './volcano.js';

const DEPTH = 4;
const ROCK = [0x2b211e, 0x33261f, 0x261d1a, 0x3a2b24];
const CRUST = [0x45342b, 0x4d3a2e, 0x3e2f27];
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

const MAGMA = 0xff5a12, MAGMA_HOT = 0xffa63a, MAGMA_WHITE = 0xffe08a;

// One scrolling lava material for every puddle on every platform in the level. Each puddle scales
// its own UVs instead of getting its own texture. Recreated per level (disposed with the level).
let puddleMat = null;
export function platformLavaMaterial() {
  if (!puddleMat) {
    puddleMat = lavaMaterial(1, 1);
    puddleMat.addEventListener('dispose', () => { puddleMat = null; });
  }
  return puddleMat;
}

const rock = (rand) => mat(pick(rand, ROCK), { flatShading: true, roughness: 1 });

/** A jagged chunk of basalt. */
export function makeRock(rand, s, colors = ROCK) {
  const r = part(geo('rock:dodeca', () => new THREE.DodecahedronGeometry(1, 0)),
    mat(pick(rand, colors), { flatShading: true, roughness: 1 }));
  r.scale.set(s * (1 + rand() * 0.5), s * (0.6 + rand() * 0.5), s * (1 + rand() * 0.3));
  r.rotation.set(rand(), rand() * 6, rand());
  return r;
}

/** An obsidian shard sticking out of the ground. */
function makeShard(rand, h) {
  const s = part(geo('shard', () => new THREE.ConeGeometry(0.22, 1, 5)),
    mat(0x15111a, { flatShading: true, roughness: 0.25, metalness: 0.3 }));
  s.scale.set(0.6 + rand() * 0.6, h, 0.6 + rand() * 0.6);
  s.position.y = h * 0.4;
  s.rotation.set((rand() - 0.5) * 0.5, rand() * 6, (rand() - 0.5) * 0.5);
  return s;
}

/** A crooked glowing crack across a face. Points are [x, y] in the face plane; `place` maps them. */
function crack(g, pts, width, color, place) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const seg = part(geo(`crackseg:${width}`, () => new THREE.BoxGeometry(1, width, 0.04)), hot(color), false);
    seg.scale.x = len + width;
    place(seg, (x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(y1 - y0, x1 - x0));
    g.add(seg);
  }
}

/** A flat lava puddle (top surface) with a rim of dark crust stones. */
function puddle(g, rand, x, z, r) {
  const geom = new THREE.CircleGeometry(r, 18);
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r / 1.5 + x * 0.3, uv.getY(i) * r / 1.5 + z * 0.3);
  const p = new THREE.Mesh(geom, platformLavaMaterial());
  p.rotation.x = -Math.PI / 2;
  p.scale.y = 0.6 + rand() * 0.3; // elongated along x
  p.position.set(x, 0.015, z);
  g.add(p);
  const n = 5 + Math.floor(r * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.4;
    const st = makeRock(rand, 0.1 + rand() * 0.08, CRUST);
    st.position.set(x + Math.cos(a) * r, 0.03, z + Math.sin(a) * r * p.scale.y);
    st.castShadow = false;
    g.add(st);
  }
}

// ------------------------------------------------------------ platforms

/** Volcanic ground block: basalt body, cooled crust on top, magma veins and drips down the front. */
export function makeVolcanicGround(w, h, rand) {
  const g = new THREE.Group();
  const bodyH = h - 0.25;
  const body = part(new THREE.BoxGeometry(w, bodyH, DEPTH), mat(0x2a201c, { roughness: 1 }));
  body.position.set(w / 2, -0.3 - bodyH / 2, 0);
  const crustM = mat(0x4a382d, { roughness: 1, flatShading: true });
  const crustTop = part(new THREE.BoxGeometry(w + 0.2, 0.5, DEPTH + 0.2), crustM);
  crustTop.position.set(w / 2, -0.25, 0);
  g.add(body, crustTop);

  const front = DEPTH / 2 + 0.02;
  const onFront = (o, x, y, rot) => { o.position.set(x, y, front); o.rotation.z = rot; };
  const visible = Math.min(h, 3.2);

  // Lumpy crust overhang along the front edge (instead of grass drips).
  for (let x = 0.2; x < w; x += 0.5 + rand() * 0.6) {
    const lump = makeRock(rand, 0.2 + rand() * 0.12, CRUST);
    lump.position.set(x, -0.42 - rand() * 0.08, DEPTH / 2 + 0.08);
    lump.castShadow = false;
    g.add(lump);
  }

  // Glowing magma veins zig-zagging across the front face.
  for (let x = 0.6 + rand() * 1.5; x < w - 0.4; x += 1.6 + rand() * 2.4) {
    const pts = [[x, -0.55]];
    let cx = x, cy = -0.55;
    const bottom = -0.55 - (0.8 + rand() * (visible - 0.8));
    while (cy > bottom) {
      cx = Math.max(0.15, Math.min(w - 0.15, cx + (rand() - 0.5) * 0.9));
      cy -= 0.35 + rand() * 0.45;
      pts.push([cx, cy]);
      if (rand() < 0.3) { // a short side branch
        crack(g, [[cx, cy], [cx + (rand() - 0.5) * 1.1, cy - 0.2 - rand() * 0.3]], 0.04, MAGMA, onFront);
      }
    }
    crack(g, pts, 0.07, MAGMA, onFront);
    crack(g, pts, 0.025, MAGMA_WHITE, (o, a, b, r) => { onFront(o, a, b, r); o.position.z += 0.02; });
  }

  // Lava dripping over the front edge here and there.
  for (let x = 0.8 + rand() * 2; x < w - 0.5; x += 2.2 + rand() * 3.5) {
    const len = 0.4 + rand() * 1.1;
    const streak = part(geo('dripstreak', () => new THREE.BoxGeometry(0.16, 1, 0.08)), hot(MAGMA_HOT), false);
    streak.scale.y = len;
    streak.position.set(x, -0.45 - len / 2, DEPTH / 2 + 0.14);
    const blob = part(sphere(0.13, 10, 8), hot(MAGMA_HOT), false);
    blob.scale.set(1, 1.35, 0.8);
    blob.position.set(x, -0.45 - len, DEPTH / 2 + 0.15);
    const lip = part(sphere(0.2, 10, 8), hot(MAGMA), false);
    lip.scale.set(1.3, 0.5, 0.9);
    lip.position.set(x, -0.03, DEPTH / 2 + 0.04);
    g.add(streak, blob, lip);
  }

  // Top surface: thin glowing fissures, lava puddles toward the back, scattered rubble.
  const onTop = (o, x, z, rot) => { o.position.set(x, 0.012, z); o.rotation.set(-Math.PI / 2, 0, rot); };
  for (let i = 0; i < w / 3; i++) {
    const x0 = rand() * w, z0 = (rand() - 0.5) * DEPTH * 0.8;
    const pts = [[x0, z0]];
    let px = x0, pz = z0;
    for (let k = 0; k < 3; k++) {
      px = Math.max(0.1, Math.min(w - 0.1, px + 0.3 + rand() * 0.6));
      pz = Math.max(-DEPTH / 2 + 0.1, Math.min(DEPTH / 2 - 0.1, pz + (rand() - 0.5) * 0.8));
      pts.push([px, pz]);
    }
    // In the top plane, the face's "y" axis is world -z after the -90° x rotation.
    crack(g, pts.map(([a, b]) => [a, -b]), 0.05, MAGMA, (o, a, b, r) => onTop(o, a, -b, r));
  }
  if (w >= 4) {
    for (let x = 1.2 + rand() * 3; x < w - 1; x += 5 + rand() * 6) {
      puddle(g, rand, x, -DEPTH / 2 + 0.8 + rand() * 0.6, 0.45 + rand() * 0.4);
    }
  }
  for (let i = 0; i < w / 1.4; i++) {
    const z = (rand() - 0.5) * DEPTH * 0.9;
    const x = rand() * w;
    if (rand() < 0.75) {
      const r = makeRock(rand, 0.07 + rand() * 0.1);
      r.position.set(x, 0.04, z);
      r.castShadow = false;
      g.add(r);
    } else {
      const ember = part(sphere(0.06, 6, 5), hot(MAGMA_HOT), false);
      ember.position.set(x, 0.03, z);
      g.add(ember);
    }
  }
  // Rock piles and obsidian shards along the back edge (instead of bushes).
  if (w > 5) {
    for (let x = 1.5 + rand() * 3; x < w - 1; x += 4 + rand() * 5) {
      const pile = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const r = makeRock(rand, 0.3 + rand() * 0.3);
        r.position.set((i - 1) * 0.5, 0.15, (rand() - 0.5) * 0.4);
        pile.add(r);
      }
      if (rand() < 0.6) {
        const s = makeShard(rand, 0.9 + rand() * 0.9);
        s.position.x += 0.3;
        pile.add(s);
      }
      pile.position.set(x, 0, -DEPTH / 2 + 0.4);
      g.add(pile);
    }
  }
  return g;
}

/** Floating basalt slab (replaces the plank ledge): stone blocks with glowing seams, hung on chains. */
export function makeVolcanicLedge(w, h) {
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(w / 1));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const block = part(geo(`slab:${pw.toFixed(2)}:${h}`, () => new THREE.BoxGeometry(pw - 0.07, h, 2.2)),
      mat(i % 2 ? 0x3d2e27 : 0x33271f, { flatShading: true, roughness: 1 }));
    block.position.set((i + 0.5) * pw, -h / 2, 0);
    g.add(block);
  }
  // Magma glowing through the joints between blocks.
  for (let i = 1; i < n; i++) {
    const seam = part(geo(`seam:${h}`, () => new THREE.BoxGeometry(0.07, h * 0.8, 2.15)), hot(MAGMA), false);
    seam.position.set(i * pw, -h / 2, 0);
    g.add(seam);
  }
  const under = part(geo(`slabglow:${w.toFixed(2)}`, () => new THREE.BoxGeometry(w - 0.3, 0.06, 1.8)), hot(MAGMA), false);
  under.position.set(w / 2, -h - 0.02, 0);
  g.add(under);
  // Iron chains instead of vine ropes.
  const iron = mat(0x2a2a2e, { metalness: 0.7, roughness: 0.45 });
  for (const x of [0.15, w - 0.15]) {
    const band = part(geo(`band:${h}`, () => new THREE.BoxGeometry(0.12, h + 0.08, 2.3)), iron, false);
    band.position.set(x, -h / 2, 0);
    g.add(band);
    for (let k = 0; k < 4; k++) {
      const link = part(geo('chainlink', () => new THREE.TorusGeometry(0.1, 0.03, 5, 10)), iron, false);
      link.position.set(x, 0.12 + k * 0.17, DEPTH / 2 - 0.85);
      link.rotation.y = k % 2 ? Math.PI / 2 : 0;
      g.add(link);
    }
  }
  return g;
}

/** Charred logs with glowing ember rings and hot cores (replaces the wooden log raft). */
export function makeVolcanicLog(w, h) {
  const g = new THREE.Group();
  const r = h / 2;
  for (const z of [-0.85, 0, 0.85]) {
    const log = part(new THREE.CylinderGeometry(r, r, w, 9), mat(0x1d1714, { flatShading: true, roughness: 1 }));
    log.rotation.z = Math.PI / 2;
    log.position.set(w / 2, -r, z);
    g.add(log);
    for (const x of [0, w]) {
      const cap = part(geo(`clogcap:${r}`, () => new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.04, 9)), hot(MAGMA), false);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x, -r, z);
      g.add(cap);
      const core = part(geo(`clogcore:${r}`, () => new THREE.CylinderGeometry(r * 0.4, r * 0.4, 0.06, 8)), hot(MAGMA_WHITE), false);
      core.rotation.z = Math.PI / 2;
      core.position.set(x, -r, z);
      g.add(core);
    }
    // Glowing burn rings along the log.
    for (let x = 0.7; x < w - 0.3; x += 1.1) {
      const ring = part(geo(`clogring:${r}`, () => new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.06, 9)), hot(MAGMA), false);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(x + (z * 0.2), -r, z);
      g.add(ring);
    }
  }
  return g;
}

// ------------------------------------------------------------ props

/** Bounce pad: a magma blister on a rock cone (same root/cap interface as makeMushroom). */
export function makeMagmaVent() {
  const g = new THREE.Group();
  const stem = part(geo('ventstem', () => new THREE.CylinderGeometry(0.3, 0.55, 0.55, 7)),
    mat(0x2e231e, { flatShading: true, roughness: 1 }));
  stem.position.y = 0.27;
  const cap = new THREE.Group();
  cap.position.y = 0.5;
  const dome = part(geo('mcap', () => new THREE.SphereGeometry(0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), hot(MAGMA));
  dome.scale.y = 0.6;
  cap.add(dome);
  // Dark crust plates floating on the molten dome.
  const plates = [[0, 0.42, 0], [0.38, 0.26, 0.25], [-0.4, 0.24, 0.2], [0.1, 0.25, 0.5], [-0.15, 0.3, -0.42], [0.42, 0.22, -0.2]];
  for (const [x, y, z] of plates) {
    const s = part(sphere(0.13, 6, 4), mat(0x2a1d18, { flatShading: true }), false);
    s.scale.set(1.2, 0.35, 1);
    s.position.set(x, y, z);
    cap.add(s);
  }
  const ring = part(geo('ventring', () => new THREE.TorusGeometry(0.66, 0.08, 6, 18)), hot(MAGMA_HOT), false);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  cap.add(ring);
  g.add(stem, cap);
  return { root: g, cap };
}

/** Checkpoint: a stone totem with a brazier and a flag (same interface as makeCheckpoint). */
export function makeVolcanicCheckpoint() {
  const g = new THREE.Group();
  const stoneM = mat(0x3a2d26, { flatShading: true, roughness: 1 });
  const pole = part(geo('cpstone', () => new THREE.CylinderGeometry(0.11, 0.16, 3, 6)), stoneM);
  pole.position.y = 1.5;
  g.add(pole);
  const base = part(geo('cpbase', () => new THREE.CylinderGeometry(0.35, 0.45, 0.3, 6)), stoneM);
  base.position.y = 0.15;
  g.add(base);
  const bowl = part(geo('cpbowl', () => new THREE.CylinderGeometry(0.3, 0.16, 0.22, 8)), mat(0x2a2a2e, { metalness: 0.6, roughness: 0.5 }));
  bowl.position.y = 3.08;
  g.add(bowl);
  const coals = part(geo('cpcoals', () => new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), hot(MAGMA_HOT), false);
  coals.position.y = 3.17;
  coals.scale.y = 0.6;
  g.add(coals);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.7 });
  flagMat.userData.own = true;
  const flag = part(geo('flag', () => new THREE.BoxGeometry(0.9, 0.55, 0.04)), flagMat);
  flag.position.set(0.47, 2.55, 0);
  g.add(flag);
  return {
    root: g, flag,
    setActive(on) { flagMat.color.set(on ? 0x3ddc84 : 0xff5a5a); },
  };
}

/** Goal: a basalt altar in a lava moat, crowned with golden bananas (same interface as makeGoalTree). */
export function makeVolcanicGoal(rand) {
  const g = new THREE.Group();
  const stoneM = mat(0x3a2b24, { flatShading: true, roughness: 1 });
  // Stepped hexagonal altar.
  let y = 0;
  for (const [r, hh] of [[1.5, 0.35], [1.15, 0.35], [0.8, 1.6]]) {
    const step = part(new THREE.CylinderGeometry(r * 0.92, r, hh, 6), stoneM);
    step.position.y = y + hh / 2;
    g.add(step);
    y += hh;
  }
  // Glowing runes down the pillar.
  for (let i = 0; i < 3; i++) {
    const rune = part(geo('rune', () => new THREE.BoxGeometry(0.28, 0.1, 0.05)), hot(MAGMA_HOT), false);
    rune.position.set(0, 1.0 + i * 0.4, 0.74);
    g.add(rune);
  }
  // Lava bowl on top, golden bananas around its rim.
  const bowl = part(new THREE.CylinderGeometry(0.85, 0.6, 0.3, 10), mat(0x2a2a2e, { metalness: 0.6, roughness: 0.5 }));
  bowl.position.y = y + 0.15;
  g.add(bowl);
  const lava = part(geo('goallava', () => new THREE.CircleGeometry(0.75, 16)), hot(MAGMA), false);
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = y + 0.31;
  g.add(lava);
  for (let i = 0; i < 5; i++) {
    const b = makeBanana(true);
    const a = (i / 5) * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.8, y + 0.45, Math.sin(a) * 0.8);
    b.rotation.y = a;
    g.add(b);
  }
  // Obsidian spikes flanking the altar.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const s = makeShard(rand, 1.4 + rand() * 1.4);
      s.position.set(side * (1.7 + i * 0.5), 0, -0.4 - i * 0.4);
      g.add(s);
    }
  }
  const prize = makeSuperBanana();
  prize.scale.setScalar(1.4);
  prize.position.set(0, 2.4, 1);
  g.add(prize);
  return { root: g, prize };
}

/** A scorched branch over a basalt outcrop that a vine hangs from (replaces makeBranch). */
export function makeCharredBranch(rand) {
  const g = new THREE.Group();
  const wood = part(geo('branch', () => new THREE.CylinderGeometry(0.18, 0.24, 6, 8)), mat(0x1d1714, { roughness: 1 }));
  wood.rotation.z = Math.PI / 2;
  g.add(wood);
  for (let x = -2.2; x < 2.4; x += 1.5) {
    const ring = part(geo('branchring', () => new THREE.CylinderGeometry(0.235, 0.235, 0.05, 8)), hot(MAGMA), false);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = x + rand() * 0.4;
    g.add(ring);
  }
  for (const side of [-1, 1]) {
    const stub = part(geo('branchstub', () => new THREE.CylinderGeometry(0.04, 0.1, 1.1, 5)), mat(0x1d1714, { roughness: 1 }));
    stub.position.set(side * (1.6 + rand() * 0.8), 0.45, -0.1);
    stub.rotation.z = side * -0.6;
    g.add(stub);
  }
  return g;
}

/** A swinging vine, scorched: dark ashen rope with a few glowing embers caught in it. */
export function makeScorchedVine(len) {
  const root = new THREE.Group();
  const rope = part(new THREE.CylinderGeometry(0.06, 0.06, len, 6), mat(0x3b2f27, { roughness: 1 }));
  rope.position.y = -len / 2;
  root.add(rope);
  for (let y = 0.9, i = 0; y < len - 0.2; y += 0.9, i++) {
    const knot = part(sphere(0.09, 8, 6), i % 2 ? hot(MAGMA) : mat(0x2a221d), false);
    knot.position.set(0, -y, 0);
    root.add(knot);
  }
  const end = part(sphere(0.13, 10, 8), mat(0x2a221d));
  end.position.y = -len;
  root.add(end);
  return root;
}
