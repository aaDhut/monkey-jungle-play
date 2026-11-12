// Volcanic wasteland scenery (used by levels with "scenery": "volcano").
// No plants at all: basalt crags and column clusters, obsidian spikes, charred dead trees,
// lava falls pouring off cliffs, lava rivers and pools, glowing floor fissures, steaming
// fumaroles, erupting volcanoes on the horizon, drifting embers and falling ash.
import * as THREE from 'three';
import { mat, part, sphere, geo } from './models.js';
import { Baker, cameraBox } from './bake.js';

const FLOOR_Y = -0.6;
const BASALT = [0x2b2220, 0x352a26, 0x241c1a];
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

// ------------------------------------------------------------ lava texture (shared)

let lavaTex = null;
/** A tiling canvas texture of molten lava: dark cooling crust plates split by glowing cracks. */
export function lavaTexture() {
  if (lavaTex) return lavaTex;
  const S = 256, N = 22;
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cells = [];
  for (let i = 0; i < N; i++) cells.push({ x: r() * S, y: r() * S, molten: r() < 0.3, shade: r() });
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const mix = (a, b, k) => a + (b - a) * k;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Nearest and second-nearest cell centres, wrapping so the texture tiles.
      let d1 = 1e9, d2 = 1e9, best = null;
      for (const p of cells) {
        let dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
        if (dx > S / 2) dx = S - dx;
        if (dy > S / 2) dy = S - dy;
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1; // 0 on a crack
      let R, G, B;
      if (edge < 3) {
        const k = edge / 3; // white-hot crack centre → orange
        R = 255; G = mix(240, 150, k); B = mix(160, 30, k);
      } else {
        const k = Math.min(1, (edge - 3) / 14);
        const crust = best.molten ? [235, 80, 20] : [mix(55, 85, best.shade), 18, 10];
        R = mix(255, crust[0], k); G = mix(120, crust[1], k); B = mix(20, crust[2], k);
      }
      const i = (y * S + x) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  lavaTex = new THREE.CanvasTexture(c);
  lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;
  lavaTex.colorSpace = THREE.SRGBColorSpace;
  lavaTex.anisotropy = 4;
  return lavaTex;
}

/** Glowing lava material with its own copy of the texture so it can scroll independently. */
export function lavaMaterial(repeatX, repeatY, { fog = true } = {}) {
  const tex = lavaTexture().clone();
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  const m = new THREE.MeshBasicMaterial({ map: tex, fog });
  m.userData.own = true;
  return m;
}

// Small per-level material cache: identical glows / smoke share one material.
const levelMats = new Map();
function levelMat(key, make) {
  let m = levelMats.get(key);
  if (!m) { m = make(); m.userData.own = true; levelMats.set(key, m); m.addEventListener('dispose', () => levelMats.delete(key)); }
  return m;
}

// Unlit "hot" materials: magma always glows, whatever the lighting. Cached for the whole session
// (like mat()), so they're never disposed and every platform and prop shares them.
const hotCache = new Map();
export function hot(color, fog = true) {
  const key = `${color}:${fog}`;
  let m = hotCache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, fog }); hotCache.set(key, m); }
  return m;
}

const glow = (color, opacity, fog = false) => levelMat(`glow:${color}:${opacity}:${fog}`, () => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog,
}));

// ------------------------------------------------------------ volcano

/** Ribbon-tube of lava running from the crater down the cone's front face. */
function lavaStream(rand, H, R, rTop, a0, material) {
  const pts = [];
  const steps = 14;
  let a = a0;
  const stop = 0.55 + rand() * 0.4; // how far down the slope it flows
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * stop;
    a += (rand() - 0.5) * 0.035;
    const y = H * (1 - t);
    const rr = rTop + (R - rTop) * t + 0.4;
    pts.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 40, 0.35 + rand() * 0.3, 6, false);
  return new THREE.Mesh(g, material);
}

function makeVolcano(rand, H, R, streamMat, craterMat) {
  const g = new THREE.Group();
  const rTop = R * 0.14;
  // Lumpy cone: jitter the vertices so it doesn't look machine-made.
  const cone = new THREE.CylinderGeometry(rTop, R, H, 28, 8, true);
  cone.translate(0, H / 2, 0);
  const p = cone.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.y > 0.1 && v.y < H - 0.1) {
      const k = 1 + (rand() - 0.5) * 0.12;
      v.x *= k; v.z *= k; v.y += (rand() - 0.5) * H * 0.03;
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  cone.computeVertexNormals();
  g.add(part(cone, mat(pick(rand, BASALT), { flatShading: true, roughness: 1 }), false));

  // Ash-grey lower slopes strewn with basalt lumps (no vegetation).
  const skirt = new THREE.CylinderGeometry(R * 0.72, R * 1.04, H * 0.3, 28, 1, true);
  skirt.translate(0, H * 0.15 - 0.2, 0);
  g.add(part(skirt, mat(0x3a302c, { flatShading: true, roughness: 1 }), false));
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, s = R * (0.08 + rand() * 0.08);
    const t = rand() * 0.25;
    const rr = R * (1 - t) * 0.95;
    const lump = part(geo('rock:dodeca', () => new THREE.DodecahedronGeometry(1, 0)), mat(pick(rand, BASALT), { flatShading: true, roughness: 1 }), false);
    lump.scale.set(s * 1.3, s * 0.7, s);
    lump.position.set(Math.cos(a) * rr, H * t, Math.sin(a) * rr);
    g.add(lump);
  }

  // Glowing crater.
  const crater = new THREE.Mesh(new THREE.CircleGeometry(rTop * 1.02, 20), craterMat);
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = H - 0.3;
  g.add(crater);

  const n = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    g.add(lavaStream(rand, H, R, rTop, Math.PI / 2 + (rand() - 0.5) * 1.6, streamMat));
  }
  return g;
}

/** Rising smoke puffs above a point (crater or vent): one instanced draw per column. Returns an animator. */
const _puff = new THREE.Object3D();
function makeSmoke(target, rand, x, y, z, scale, color = 0x4a4040, count = 9) {
  const m = levelMat(`smoke:${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
  const puffs = new THREE.InstancedMesh(sphere(1, 10, 8), m, count);
  puffs.frustumCulled = false; // instances move outside the base sphere's bounds
  target.add(puffs);
  const drift = Array.from({ length: count }, () => (rand() - 0.5) * 0.6);
  return (t) => {
    for (let i = 0; i < count; i++) {
      const k = (t * 0.06 + i / count) % 1; // 0 → 1 over its life
      const s = scale * (0.4 + k * 1.6);
      _puff.scale.set(s, s * 0.8, s);
      _puff.position.set(x + (k * 2 + drift[i] * k) * scale * 2, y + k * scale * 9, z);
      _puff.updateMatrix();
      puffs.setMatrixAt(i, _puff.matrix);
    }
    puffs.instanceMatrix.needsUpdate = true;
  };
}

/** Lava bombs shot out of a crater on ballistic arcs. */
function makeEruption(target, x, y, z, scale, count = 60) {
  const pos = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    vel.push({
      vx: (Math.random() - 0.5) * 1.4 * scale, vy: (1.2 + Math.random()) * scale * 1.3,
      vz: (Math.random() - 0.5) * 0.6 * scale, t0: Math.random() * 2.5,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const size = Math.round(0.18 * scale * 20) / 20; // rounded so similar volcanoes share a material
  const m = levelMat(`bomb:${size}`, () => new THREE.PointsMaterial({
    color: 0xffa040, size, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  target.add(pts);
  const G = 1.6 * scale;
  return (t) => {
    for (let i = 0; i < count; i++) {
      const v = vel[i];
      const life = (v.vy * 2) / G;
      const k = ((t + v.t0) % 2.5) * (life / 2.5);
      pos[i * 3] = x + v.vx * k;
      pos[i * 3 + 1] = y + v.vy * k - 0.5 * G * k * k;
      pos[i * 3 + 2] = z + v.vz * k;
    }
    geo.attributes.position.needsUpdate = true;
  };
}

// ------------------------------------------------------------ props

const MAGMA = 0xff5a12, MAGMA_HOT = 0xffa63a;
const rockMat = (rand) => mat(pick(rand, BASALT), { flatShading: true, roughness: 1 });

/** Jitter a geometry's vertices sideways (keeps the very top and bottom rings in place). */
function roughen(g, rand, amount, yMin, yMax) {
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.y > yMin && v.y < yMax) {
      const k = 1 + (rand() - 0.5) * amount;
      p.setXYZ(i, v.x * k, v.y + (rand() - 0.5) * amount * 0.6, v.z * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

function makeBoulder(rand, s) {
  const r = part(geo('rock:dodeca', () => new THREE.DodecahedronGeometry(1, 0)), rockMat(rand));
  r.scale.set(s * (1 + rand() * 0.5), s * (0.6 + rand() * 0.4), s * (1 + rand() * 0.3));
  r.rotation.set(rand(), rand() * 6, rand());
  return r;
}

/** A dead, scorched tree trunk with broken branches and embers smouldering at the base. */
function makeCharredTree(rand, h) {
  const g = new THREE.Group();
  const black = mat(0x1c1614, { roughness: 1 });
  const trunk = part(new THREE.CylinderGeometry(0.18, 0.45, h, 7), black);
  trunk.position.y = h / 2;
  trunk.rotation.z = (rand() - 0.5) * 0.15;
  g.add(trunk);
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const len = 1.2 + rand() * 1.6;
    const b = part(new THREE.CylinderGeometry(0.05, 0.13, len, 5), black);
    const side = rand() < 0.5 ? -1 : 1;
    b.position.set(side * len * 0.35, h * (0.45 + rand() * 0.4), 0);
    b.rotation.z = side * -(0.7 + rand() * 0.5);
    g.add(b);
  }
  // Glowing burn scars up the trunk.
  for (let i = 0; i < 2; i++) {
    const scar = part(geo('treescar', () => new THREE.BoxGeometry(0.08, 0.5, 0.08)), hot(MAGMA), false);
    scar.position.set((rand() - 0.5) * 0.3, 0.4 + rand() * h * 0.4, 0.32);
    scar.rotation.z = (rand() - 0.5) * 0.6;
    g.add(scar);
  }
  const embers = part(geo('treeembers', () => new THREE.TorusGeometry(0.5, 0.08, 4, 10)), hot(MAGMA_HOT), false);
  embers.rotation.x = Math.PI / 2;
  embers.position.y = 0.05;
  g.add(embers);
  return g;
}

/** A cluster of hexagonal basalt columns with flat, lighter tops. */
function makeBasaltColumns(rand, n, hMax) {
  const g = new THREE.Group();
  const topM = mat(0x4a3b33, { flatShading: true, roughness: 1 });
  for (let i = 0; i < n; i++) {
    const r = 0.5 + rand() * 0.5, h = hMax * (0.35 + rand() * 0.65);
    const x = (rand() - 0.5) * n * 0.7, z = (rand() - 0.5) * n * 0.5, ry = rand();
    const col = part(new THREE.CylinderGeometry(r * 0.95, r, h, 6), rockMat(rand));
    col.position.set(x, h / 2, z);
    col.rotation.y = ry;
    const top = part(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.1, 6), topM, false);
    top.position.set(x, h + 0.05, z);
    top.rotation.y = ry;
    g.add(col, top);
    if (rand() < 0.35) { // magma glowing in a crack up the column
      const seam = part(geo('colseam', () => new THREE.BoxGeometry(0.07, 1, 0.07)), hot(MAGMA), false);
      seam.scale.y = h * 0.5;
      seam.position.set(x, h * 0.3, z + r * 0.92);
      g.add(seam);
    }
  }
  return g;
}

/** A jagged rock spire. */
function makeSpire(rand, h) {
  const cone = new THREE.ConeGeometry(h * 0.2, h, 7, 5);
  cone.translate(0, h / 2, 0);
  return part(roughen(cone, rand, 0.35, 0.1, h * 0.9), rockMat(rand));
}

/** A low steaming fumarole: a rock ring with a hot throat. */
function makeFumarole(rand) {
  const g = new THREE.Group();
  const cone = new THREE.CylinderGeometry(0.5, 1.2, 0.8, 8, 1, true);
  cone.translate(0, 0.4, 0);
  g.add(part(roughen(cone, rand, 0.25, 0.05, 0.75), rockMat(rand)));
  const throat = part(geo('fumthroat', () => new THREE.CircleGeometry(0.5, 10)), hot(MAGMA_HOT), false);
  throat.rotation.x = -Math.PI / 2;
  throat.position.y = 0.7;
  g.add(throat);
  return g;
}

/** A cliff with a lava fall pouring over its lip into a pool at its foot. */
function makeLavaCliff(rand, H, W, fallMat, poolMat) {
  const g = new THREE.Group();
  const rTop = W * 0.4, rBot = W * 0.55;
  const cliff = new THREE.CylinderGeometry(rTop, rBot, H, 9, 5);
  cliff.translate(0, H / 2, 0);
  g.add(part(roughen(cliff, rand, 0.18, 0.2, H - 0.2), rockMat(rand), false));
  const cap = part(new THREE.CylinderGeometry(rTop * 0.95, rTop, 0.6, 9), mat(0x2f2521, { flatShading: true, roughness: 1 }), false);
  cap.position.y = H;
  g.add(cap);
  // The fall: a plane leaning back along the cliff face, UVs scaled so the shared texture tiles.
  const fw = W * (0.3 + rand() * 0.15);
  const fall = new THREE.PlaneGeometry(fw, H + 0.6);
  const uv = fall.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * fw / 2.5, uv.getY(i) * H / 14); // stretched tall: reads as flowing streaks
  const fm = new THREE.Mesh(fall, fallMat);
  const lean = Math.atan((rBot - rTop) / H);
  fm.rotation.x = -lean;
  fm.position.set(0, H / 2, (rTop + rBot) / 2 + 0.35);
  g.add(fm);
  // Glowing lip where it spills over, and a splash pool below.
  const lip = part(sphere(1, 10, 8), hot(MAGMA_HOT, false), false);
  lip.scale.set(fw * 0.5, 0.18, 0.5);
  lip.position.set(0, H + 0.05, rTop + 0.15);
  g.add(lip);
  const pr = fw * 0.75;
  const pool = new THREE.CircleGeometry(pr, 20);
  const puv = pool.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * pr / 2, puv.getY(i) * pr / 2);
  const pm = new THREE.Mesh(pool, poolMat);
  pm.rotation.x = -Math.PI / 2;
  pm.position.set(0, 0.06, rBot + pr * 0.4);
  g.add(pm);
  return { group: g, poolZ: rBot + pr * 0.4 };
}

/** A crooked glowing fissure across the ground (flat segments on the floor). */
function makeFissure(rand, x0, z0, steps) {
  const g = new THREE.Group();
  let x = x0, z = z0;
  for (let i = 0; i < steps; i++) {
    const nx = x + 0.8 + rand() * 1.6, nz = z + (rand() - 0.5) * 1.6;
    const len = Math.hypot(nx - x, nz - z);
    const w = 0.08 + rand() * 0.12;
    const seg = part(geo(`fissure:${w.toFixed(2)}`, () => new THREE.BoxGeometry(1, 0.03, w)), hot(MAGMA), false);
    seg.scale.x = len + w;
    seg.position.set((x + nx) / 2, FLOOR_Y + 0.02, (z + nz) / 2);
    seg.rotation.y = -Math.atan2(nz - z, nx - x);
    g.add(seg);
    x = nx; z = nz;
  }
  return g;
}

// ------------------------------------------------------------ the whole scene

export function buildVolcanoScenery(target, rand, minX, maxX) {
  const animators = [];
  const scrolls = []; // [material, speedX, speedY]

  const streamMat = new THREE.MeshBasicMaterial({ color: 0xff6a14, fog: false });
  streamMat.userData.own = true;
  const craterMat = lavaMaterial(1, 1, { fog: false });
  scrolls.push([craterMat, 0.05, 0.03]);
  const fallMat = lavaMaterial(1, 1);
  scrolls.push([fallMat, 0.0, 0.35]);
  const poolMat = lavaMaterial(1, 1);
  scrolls.push([poolMat, 0.02, 0.03]);

  // Everything static is baked into a few culled strips instead of hundreds of meshes.
  const baker = new Baker({ box: cameraBox(minX, maxX) });
  const place = (obj, x, y, z, layer, ry = rand() * Math.PI * 2) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    baker.add(obj, layer);
  };

  // Volcanoes on the horizon, two rows for depth.
  const rows = [
    { z: -95, step: 46, H: [17, 23], R: [13, 17] },
    { z: -150, step: 115, H: [30, 38], R: [22, 28] },
  ];
  for (const row of rows) {
    for (let x = minX - 60 + rand() * 20; x < maxX + 60; x += row.step * (0.8 + rand() * 0.5)) {
      const H = row.H[0] + rand() * (row.H[1] - row.H[0]);
      const R = row.R[0] + rand() * (row.R[1] - row.R[0]);
      const z = row.z - rand() * 10;
      const v = makeVolcano(rand, H, R, streamMat, craterMat);
      v.position.set(x, FLOOR_Y - 2, z);
      v.rotation.y = (rand() - 0.5) * 0.3;
      baker.add(v, 'far'); // cone, slopes, crater and lava streams never move: bake them
      const topY = FLOOR_Y - 2 + H;
      const sc = R / 16;
      animators.push(makeSmoke(target, rand, x, topY + 1, z, 1.6 * sc, 0x3d3434, 10));
      animators.push(makeEruption(target, x, topY, z, 1.8 * sc));
      const halo = new THREE.Mesh(sphere(1, 12, 10), glow(0xff6a20, 0.22));
      halo.scale.set(R * 0.4, R * 0.25, 1);
      halo.position.set(x, topY + 1.5, z + 2);
      target.add(halo);
    }
  }

  // A jagged ridge of dark crags between the play area and the volcanoes.
  for (let x = minX - 50; x < maxX + 50; x += 5 + rand() * 6) {
    place(makeSpire(rand, 14 + rand() * 18), x, FLOOR_Y - 1, -55 - rand() * 18, 'far');
  }

  // Cliffs with lava falls pouring toward the river.
  for (let x = minX + 4 + rand() * 10; x < maxX + 10; x += 30 + rand() * 22) {
    const H = 7 + rand() * 5, W = 13 + rand() * 6;
    const z = -38 - rand() * 4;
    const c = makeLavaCliff(rand, H, W, fallMat, poolMat);
    place(c.group, x, FLOOR_Y, z, 'mid', (rand() - 0.5) * 0.3);
    animators.push(makeSmoke(target, rand, x, FLOOR_Y + 0.8, z + c.poolZ, 0.7, 0x8a7a72, 7));
  }

  // A winding lava river glowing between the mid ground and the cliffs.
  const riverMat = lavaMaterial((maxX - minX + 120) / 12, 1);
  scrolls.push([riverMat, 0.04, 0.0]);
  {
    const len = maxX - minX + 120, segs = Math.ceil(len / 2);
    const g = new THREE.PlaneGeometry(len, 4, segs, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setY(i, p.getY(i) + Math.sin(x * 0.07) * 2.2 + Math.sin(x * 0.19) * 0.8);
    }
    const river = new THREE.Mesh(g, riverMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set((minX + maxX) / 2, FLOOR_Y + 0.04, -26);
    target.add(river);
  }

  // Mid ground: basalt column clusters and rock spires.
  for (let x = minX - 15; x < maxX + 15; x += 7 + rand() * 7) {
    if (rand() < 0.55) place(makeBasaltColumns(rand, 4 + Math.floor(rand() * 5), 4 + rand() * 6), x, FLOOR_Y, -14 - rand() * 9, 'mid');
    else place(makeSpire(rand, 6 + rand() * 9), x, FLOOR_Y, -15 - rand() * 8, 'mid');
  }

  // Near ground: charred dead trees, boulders, obsidian rubble, fissures and fumaroles.
  for (let x = minX - 10; x < maxX + 10; x += 6 + rand() * 7) {
    place(makeCharredTree(rand, 4 + rand() * 5), x, FLOOR_Y, -8.5 - rand() * 3, 'near', (rand() - 0.5) * 0.4);
  }
  for (let x = minX - 10; x < maxX + 10; x += 2 + rand() * 3) {
    place(makeBoulder(rand, 0.4 + rand() * 1.1), x, FLOOR_Y + 0.1, -5.5 - rand() * 16, 'near');
  }
  for (let x = minX - 8; x < maxX + 8; x += 9 + rand() * 6) {
    place(makeBasaltColumns(rand, 2 + Math.floor(rand() * 3), 1.5 + rand() * 2), x, FLOOR_Y, -6.5 - rand() * 2, 'near');
  }
  for (let x = minX - 10; x < maxX + 10; x += 3 + rand() * 4) {
    place(makeFissure(rand, x, -6 - rand() * 16, 3 + Math.floor(rand() * 4)), 0, 0, 0, 'near', 0);
  }
  for (let x = minX + 6; x < maxX; x += 18 + rand() * 14) {
    const z = -10 - rand() * 8;
    if (rand() < 0.5) {
      place(makeFumarole(rand), x, FLOOR_Y, z, 'near');
      animators.push(makeSmoke(target, rand, x, FLOOR_Y + 1, z, 0.45, 0xb9aaa0, 6));
    } else {
      // A lava pool ringed with rocks.
      const r = 1.2 + rand() * 1.2;
      const poolGeo = new THREE.CircleGeometry(r, 20);
      const uv = poolGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r / 2, uv.getY(i) * r / 2);
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, FLOOR_Y + 0.05, z);
      target.add(pool);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        place(makeBoulder(rand, 0.35 + rand() * 0.3), x + Math.cos(a) * r, FLOOR_Y + 0.1, z + Math.sin(a) * r, 'near');
      }
      animators.push(makeSmoke(target, rand, x, FLOOR_Y + 0.8, z, 0.45, 0xb9aaa0, 6));
    }
  }

  const meshes = baker.finish(target, {
    castLayers: new Set(['near']), receiveLayers: new Set(['near', 'mid']), // far layer is beyond any shadow
  });

  // Heat glow rising off the river.
  const heatMat = glow(0xff5a1a, 0.12, true);
  const heat = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 120, 6), heatMat);
  heat.position.set((minX + maxX) / 2, FLOOR_Y + 2.5, -24);
  target.add(heat);

  // Embers drifting up and ash drifting down through the whole scene.
  const count = Math.round((maxX - minX) * 3);
  const ep = new Float32Array(count * 3), seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ep[i * 3] = minX - 10 + rand() * (maxX - minX + 20);
    ep[i * 3 + 2] = -1.5 - rand() * 26;
    seeds[i] = rand();
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const emberMat = new THREE.PointsMaterial({
    color: 0xff8a3a, size: 0.13, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  emberMat.userData.own = true;
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  target.add(embers);

  const ashCount = Math.round((maxX - minX) * 2);
  const ap = new Float32Array(ashCount * 3), aSeeds = new Float32Array(ashCount);
  for (let i = 0; i < ashCount; i++) {
    ap[i * 3] = minX - 10 + rand() * (maxX - minX + 20);
    ap[i * 3 + 2] = -1 - rand() * 22;
    aSeeds[i] = rand();
  }
  const ashGeo = new THREE.BufferGeometry();
  ashGeo.setAttribute('position', new THREE.BufferAttribute(ap, 3));
  const ashMat = new THREE.PointsMaterial({ color: 0x8c8580, size: 0.09, transparent: true, opacity: 0.7, depthWrite: false });
  ashMat.userData.own = true;
  const ash = new THREE.Points(ashGeo, ashMat);
  ash.frustumCulled = false;
  target.add(ash);

  return {
    meshes,
    vertices: baker.vertices,
    animate(t) {
      for (const a of animators) a(t);
      for (const [m, sx, sy] of scrolls) {
        m.map.offset.x = t * sx;
        m.map.offset.y = t * sy;
      }
      const pulse = 0.85 + Math.sin(t * 2.1) * 0.15;
      riverMat.color.setScalar(pulse);
      fallMat.color.setScalar(0.9 + Math.sin(t * 3.1) * 0.1);
      craterMat.color.setScalar(0.9 + Math.sin(t * 3.3) * 0.1);
      streamMat.color.setRGB(1, 0.38 + Math.sin(t * 2.7) * 0.08, 0.06);
      heatMat.opacity = 0.1 + Math.sin(t * 1.3) * 0.04;
      for (let i = 0; i < count; i++) {
        const s = seeds[i];
        ep[i * 3 + 1] = ((t * (0.4 + s * 0.6) + s * 14) % 14) - 0.5;
        ep[i * 3] += Math.sin(t * 1.3 + s * 40) * 0.004;
      }
      emberGeo.attributes.position.needsUpdate = true;
      emberMat.opacity = 0.7 + Math.sin(t * 5) * 0.2;
      for (let i = 0; i < ashCount; i++) {
        const s = aSeeds[i];
        ap[i * 3 + 1] = 15 - ((t * (0.3 + s * 0.4) + s * 16) % 16);
        ap[i * 3] += Math.sin(t * 0.7 + s * 30) * 0.006;
      }
      ashGeo.attributes.position.needsUpdate = true;
    },
  };
}
