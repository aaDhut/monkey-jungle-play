// Low-poly, hyper-casual models built from simple shapes (no external assets).
import * as THREE from 'three';

const materials = new Map();
export function mat(color, extra) {
  const key = String(color) + (extra ? JSON.stringify(extra) : '');
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });
    materials.set(key, m);
  }
  return m;
}

// Shared geometries are cached and flagged so level cleanup doesn't dispose them.
const geometries = new Map();
export function geo(key, make) {
  let g = geometries.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geometries.set(key, g);
  }
  return g;
}

export function part(geometry, material, cast = true) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export const sphere = (r, ws = 18, hs = 14) =>
  geo(`sphere:${r}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));

const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- monkey

const TAIL_CURVE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0.05, -0.25),
  new THREE.Vector3(0, 0.35, -0.45),
  new THREE.Vector3(0, 0.65, -0.35),
  new THREE.Vector3(0, 0.7, -0.18),
  new THREE.Vector3(0, 0.58, -0.12),
]);

/** A cartoon monkey about 1.57 units tall, standing with its feet at y = 0, facing +z. */
export function makeMonkey({ fur = 0xa0612f, skin = 0xf7d5ad, angry = false, headband = null } = {}) {
  const furM = mat(fur), skinM = mat(skin);
  const dark = mat(0x2b1a10), white = mat(0xffffff, { roughness: 0.4 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = part(sphere(0.36), furM);
  torso.scale.set(1, 1.1, 0.9);
  torso.position.y = 0.62;
  const belly = part(sphere(0.26), skinM);
  belly.scale.set(1, 1.15, 0.6);
  belly.position.set(0, 0.58, 0.17);
  body.add(torso, belly);

  const head = new THREE.Group();
  head.position.y = 1.14;
  body.add(head);
  head.add(part(sphere(0.42, 24, 18), furM));
  const face = part(sphere(0.3), skinM);
  face.scale.set(1.2, 0.95, 0.7);
  face.position.set(0, -0.04, 0.2);
  const muzzle = part(sphere(0.2), skinM);
  muzzle.scale.set(1.25, 0.8, 0.85);
  muzzle.position.set(0, -0.15, 0.33);
  head.add(face, muzzle);

  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = part(sphere(0.085, 12, 10), white, false);
    eye.scale.z = 0.6;
    eye.position.set(sx * 0.12, 0.06, 0.4);
    const pupil = part(sphere(0.05, 10, 8), dark, false);
    pupil.position.set(sx * 0.12, 0.05, 0.46);
    const shine = part(sphere(0.016, 6, 4), white, false);
    shine.position.set(sx * 0.12 + 0.02, 0.08, 0.5);
    eyes.push(eye, pupil, shine);
    head.add(eye, pupil, shine);

    const ear = part(sphere(0.15), furM);
    ear.scale.set(0.5, 1, 1);
    ear.position.set(sx * 0.42, 0.02, 0);
    const inner = part(sphere(0.09), skinM, false);
    inner.scale.set(0.4, 1, 1);
    inner.position.set(sx * 0.47, 0.02, 0.02);
    const nostril = part(sphere(0.025, 6, 4), dark, false);
    nostril.position.set(sx * 0.05, -0.11, 0.49);
    head.add(ear, inner, nostril);

    if (angry) {
      const brow = part(geo('brow', () => new THREE.BoxGeometry(0.17, 0.045, 0.04)), dark, false);
      brow.position.set(sx * 0.12, 0.17, 0.44);
      brow.rotation.z = sx * 0.45;
      head.add(brow);
    }
  }
  const mouth = part(geo('mouth', () => new THREE.TorusGeometry(0.08, 0.016, 6, 12, Math.PI)), dark, false);
  mouth.position.set(0, angry ? -0.25 : -0.2, 0.48);
  mouth.rotation.z = angry ? 0 : Math.PI;
  head.add(mouth);

  if (headband) {
    const bandM = mat(headband);
    const band = part(geo('band', () => new THREE.TorusGeometry(0.37, 0.05, 8, 28)), bandM);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.22;
    head.add(band);
    for (const sx of [-1, 1]) {
      const tie = part(geo('tie', () => new THREE.BoxGeometry(0.06, 0.22, 0.05)), bandM);
      tie.position.set(sx * 0.07, 0.12, -0.4);
      tie.rotation.set(-0.5, 0, sx * 0.5);
      head.add(tie);
    }
  }

  const arms = [], legs = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.33, 0.86, 0);
    const a = part(geo('arm', () => new THREE.CapsuleGeometry(0.085, 0.32, 4, 10)), furM);
    a.position.y = -0.22;
    const hand = part(sphere(0.1, 12, 10), skinM);
    hand.position.y = -0.44;
    arm.add(a, hand);
    arm.userData.hand = hand;
    arm.rotation.z = sx * 0.25;
    body.add(arm);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(sx * 0.16, 0.36, 0);
    const l = part(geo('leg', () => new THREE.CapsuleGeometry(0.1, 0.16, 4, 10)), furM);
    l.position.y = -0.16;
    const foot = part(sphere(0.12, 12, 10), skinM);
    foot.scale.set(0.9, 0.5, 1.3);
    foot.position.set(0, -0.33, 0.05);
    leg.add(l, foot);
    body.add(leg);
    legs.push(leg);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.45, -0.28);
  tail.add(part(geo('tail', () => new THREE.TubeGeometry(TAIL_CURVE, 24, 0.05, 8)), furM));
  body.add(tail);

  return { root, body, head, arms, legs, tail, eyes };
}

/**
 * Animate a monkey. mode: idle | run | sprint | jump | fall | swing | dance | limp | angel | throw | windup | punch
 * For windup/punch, m.punchSide (-1 or 1) picks which arm throws the punch.
 */
export function poseMonkey(m, mode, t, dt, phase = t * 10) {
  // Punches snap fast; m.punchSpeed (set per level) slows them down on early levels.
  const fight = (m.punchSpeed ?? 1);
  const rate = mode === 'punch' ? 45 * fight : mode === 'windup' ? 22 * fight : mode === 'sprint' ? 32 : 16;
  const k = 1 - Math.exp(-dt * rate);
  let armX = [0, 0], armZ = 0.25, legX = [0, 0], bob = 0, tilt = 0, lean = 0;
  let fist = 1, stretch = 1, headX = 0, twist = 0, tailX = 0;
  const pi = (m.punchSide ?? 1) < 0 ? 0 : 1; // index of the punching arm
  const guard = 1 - pi;
  const s = Math.sin(phase);
  switch (mode) {
    case 'run':
      legX = [s * 0.9, -s * 0.9];
      armX = [-s * 0.8, s * 0.8];
      bob = Math.abs(Math.cos(phase)) * 0.08;
      lean = 0.15;
      break;
    case 'sprint': { // full-tilt run: huge strides, pumping arms, deep lean, airborne bounce
      const c = Math.cos(phase);
      // Trailing leg kicks up high behind, leading leg reaches far forward.
      legX = [s * 1.25 + Math.max(0, s) * 0.5, -s * 1.25 + Math.max(0, -s) * 0.5];
      armX = [-s * 1.5 - 0.35, s * 1.5 - 0.35]; // arms pump hard, biased forward
      armZ = 0.1;                                // elbows tucked in to the body
      bob = s * s * 0.19;                        // body lifts off between footfalls (smooth, no kink)
      lean = 0.42 + c * c * 0.06;
      headX = -0.3;                              // chin up, eyes on where he's going
      tilt = s * 0.07;
      twist = s * 0.22;                          // shoulders rotate against the arm swing
      tailX = -0.75 + Math.sin(phase * 2) * 0.12; // tail streams out behind
      break;
    }
    case 'jump':
      armZ = 2.5; legX = [-0.7, 0.35];
      break;
    case 'fall':
      armZ = 1.7 + Math.sin(t * 20) * 0.15; legX = [0.35, -0.35];
      break;
    case 'swing':
      armZ = 2.9; legX = [Math.sin(t * 4) * 0.4, -Math.sin(t * 4) * 0.4];
      break;
    case 'limp': // knocked out: arms dangling, head lolled to one side
      armZ = 0.12; legX = [0.1, -0.1]; tilt = 0.45;
      break;
    case 'angel': // gliding: arms spread gently, legs trailing
      armZ = 1.15 + Math.sin(t * 6) * 0.15; legX = [0.35, 0.15]; bob = Math.sin(t * 4) * 0.04;
      break;
    case 'dance':
      armZ = 2.3 + Math.sin(t * 12) * 0.5;
      bob = Math.abs(Math.sin(t * 6)) * 0.12;
      tilt = Math.sin(t * 6) * 0.25;
      break;
    case 'throw':
      armX = [0, -2.7];
      break;
    case 'windup': // pull the fist back, lean back, shake with anger
      armX[pi] = 1.2; armX[guard] = -0.9;
      lean = -0.25 + Math.sin(t * 40) * 0.03;
      legX = [-0.35, 0.35];
      fist = 1.8;
      break;
    case 'aim': // slingshot arm straight out at the target, other hand pulls the band to the chest
      armX[pi] = -(Math.PI / 2 + (m.aimPitch ?? 0));
      armX[guard] = -1.15;
      armZ = 0.05;
      lean = -0.06;
      legX = [-0.3, 0.3];
      break;
    case 'release': // band let go: pulling hand flies forward
      armX[pi] = -(Math.PI / 2 + (m.aimPitch ?? 0));
      armX[guard] = -0.3;
      armZ = 0.05;
      legX = [-0.3, 0.3];
      break;
    case 'punch': // fist straight out, body thrown forward
      armX[pi] = -1.85; armX[guard] = 0.6;
      lean = 0.4;
      legX = [-0.6, 0.5];
      fist = 2;
      stretch = 1.8; // cartoon stretchy arm
      break;
    default:
      armZ = 0.25 + Math.sin(t * 2) * 0.06;
      bob = Math.sin(t * 2.4) * 0.02;
  }
  m.arms.forEach((a, i) => {
    const side = i === 0 ? -1 : 1;
    a.rotation.x = lerp(a.rotation.x, armX[i], k);
    a.rotation.z = lerp(a.rotation.z, side * armZ, k);
    a.scale.y = lerp(a.scale.y, i === pi ? stretch : 1, k);
    const hand = a.userData.hand;
    const f = lerp(hand.scale.x, i === pi ? fist : 1, k);
    hand.scale.set(f, f / a.scale.y, f); // keep the fist round while the arm stretches
  });
  m.legs.forEach((l, i) => { l.rotation.x = lerp(l.rotation.x, legX[i], k); });
  // Lightly eased (fast enough to keep the stride bounce) so switching run/sprint doesn't pop.
  m.body.position.y = lerp(m.body.position.y, bob, 1 - Math.exp(-dt * 60));
  m.body.rotation.x = lerp(m.body.rotation.x, lean, k);
  m.body.rotation.y = lerp(m.body.rotation.y, twist, k);
  m.head.rotation.x = lerp(m.head.rotation.x, headX, k);
  m.head.rotation.z = lerp(m.head.rotation.z, tilt, k);
  m.tail.rotation.x = lerp(m.tail.rotation.x, tailX, k);
  m.tail.rotation.y = Math.sin(t * (mode === 'sprint' ? 9 : 3)) * (mode === 'sprint' ? 0.25 : 0.5);
  const blink = (t % 3.3) < 0.1 ? 0.15 : 1;
  for (const e of m.eyes) e.scale.y = blink;
}

// ---------------------------------------------------------------- pickups

const BANANA_ARC = Math.PI * 0.7;
const BANANA_R = 0.26;

export function makeBanana(golden = false) {
  const g = new THREE.Group();
  const material = golden
    ? mat(0xffb400, { emissive: 0xff8c00, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.3 })
    : mat(0xffd93b, { roughness: 0.5 });
  const b = part(geo('banana', () => new THREE.TorusGeometry(BANANA_R, 0.085, 8, 18, BANANA_ARC)), material);
  b.rotation.z = -BANANA_ARC / 2 - Math.PI / 2;
  for (const a of [0, BANANA_ARC]) {
    const tip = part(sphere(0.05, 8, 6), mat(0x5a3a1a), false);
    tip.position.set(Math.cos(a) * BANANA_R, Math.sin(a) * BANANA_R, 0);
    b.add(tip);
  }
  g.add(b);
  return g;
}

export function makeSuperBanana() {
  const g = new THREE.Group();
  const b = makeBanana(true);
  b.scale.setScalar(1.7);
  const halo = part(geo('halo', () => new THREE.TorusGeometry(0.62, 0.04, 8, 32)),
    mat(0xfff59d, { emissive: 0xffeb3b, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 }), false);
  g.add(b, halo);
  g.userData.halo = halo;
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

/** Stretch a unit-height cylinder so it spans from point a to point b. */
function spanBetween(mesh, a, b) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(1, Math.max(len, 0.001), 1);
  mesh.quaternion.setFromUnitVectors(UP, _dir.normalize());
}

/**
 * A Y-shaped wooden slingshot. Origin = where the fist grips the handle; forks point up (+y),
 * and the pouch pulls back along -z. setPull(0..1, loaded) animates the rubber bands.
 */
export function makeSlingshot() {
  const root = new THREE.Group();
  const wood = mat(0x7a4a24);
  const handle = part(geo('sl-handle', () => new THREE.CylinderGeometry(0.035, 0.042, 0.32, 8)), wood);
  handle.position.y = -0.1;
  root.add(handle);
  const tips = [];
  for (const sx of [-1, 1]) {
    const fork = part(geo('sl-fork', () => new THREE.CylinderGeometry(0.03, 0.036, 0.3, 8)), wood);
    fork.position.set(sx * 0.07, 0.17, 0);
    fork.rotation.z = -sx * 0.45;
    root.add(fork);
    tips.push(new THREE.Vector3(sx * 0.135, 0.3, 0));
  }
  const bandGeo = geo('sl-band', () => new THREE.CylinderGeometry(0.016, 0.016, 1, 6));
  const bands = tips.map(() => {
    const b = part(bandGeo, mat(0xc0392b), false);
    root.add(b);
    return b;
  });
  const pouch = part(geo('sl-pouch', () => new THREE.BoxGeometry(0.12, 0.08, 0.07)), mat(0x5b3a1e), false);
  root.add(pouch);
  const ammo = makeCoconut();
  ammo.scale.setScalar(0.55);
  pouch.add(ammo);

  const pouchPos = new THREE.Vector3();
  function setPull(p, loaded) {
    pouchPos.set(0, 0.29, -(0.05 + 0.45 * p));
    pouch.position.copy(pouchPos);
    bands.forEach((b, i) => spanBetween(b, tips[i], pouchPos));
    ammo.visible = loaded;
  }
  setPull(0, false);
  return { root, setPull };
}

export function makeCoconut() {
  const g = new THREE.Group();
  g.add(part(sphere(0.24, 14, 10), mat(0x6b4423)));
  for (let i = 0; i < 3; i++) {
    const dot = part(sphere(0.04, 6, 4), mat(0x2b1a10), false);
    dot.position.set(-0.07 + i * 0.07, 0.08, 0.21);
    g.add(dot);
  }
  return g;
}

// ---------------------------------------------------------------- jungle props

// One coconut-palm frond along +x, modelled on the real (pinnate) leaf: an arching rachis with
// leaflets on each side that sweep forward toward the tip and hang down in a V, longest in the
// lower third and short at the base and tip. Stylised: neighbouring leaflets are joined by a web
// for most of their length (WEB), so only short slender points separate at the edge instead of
// deep gaps all the way to the rachis.
// Double-sided as two sheets (top + underside) on a FrontSide material: the GPU only draws the one
// facing the camera, and the baker deletes whichever sheet the game camera can never see (see
// dropHiddenFaces in bake.js). Normals are bent toward +y, a standard foliage trick so the thin
// leaf shades softly instead of flashing like paper.
// 6 leaflets a side, 3 triangles each = 72 triangles, ~36 after culling.
const LEAFLETS = 6;
const WEB = 0.5;  // how far out (0..1 of leaflet length) neighbouring leaflets stay joined
function frondGeometry(droop) {
  const L = 3.4, maxLen = 1.15, fwd = 0.75, hang = 0.65;
  const spine = (t) => new THREE.Vector3(L * t, L * (0.42 * t - droop * t * t), 0);
  // Leaflet length: peak a third of the way along, short near the base and tip.
  const lenAt = (t) => maxLen * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.7) + 0.12;
  const pos = [], nor = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  // Emit a polygon (fan from p[0]) as a top sheet facing +y and an underside facing -y.
  const poly = (pts) => {
    e1.subVectors(pts[1], pts[0]); e2.subVectors(pts[2], pts[0]);
    n.crossVectors(e1, e2).normalize();
    const flip = n.y < 0;
    if (flip) n.negate();
    const o = pos.length / 3, k = pts.length;
    for (const sheet of [1, -1]) {
      const sn = n.clone().multiplyScalar(sheet).addScaledVector(up, 0.8).normalize();
      for (const p of pts) { pos.push(p.x, p.y, p.z); nor.push(sn.x, sn.y, sn.z); }
    }
    for (let i = 1; i < k - 1; i++) {
      const [b, c] = flip ? [i + 1, i] : [i, i + 1];
      idx.push(o, o + b, o + c);         // top
      idx.push(o + k, o + k + c, o + k + b); // underside
    }
  };
  const step = 0.92 / LEAFLETS;
  const dirAt = (t, side) => {
    const along = new THREE.Vector3().subVectors(spine(t + 0.01), spine(t)).normalize();
    return new THREE.Vector3(0, -hang, side).addScaledVector(along, fwd).normalize();
  };
  for (const side of [-1, 1]) {
    // Shared web corners on each leaflet boundary, so neighbours join with no gap.
    const base = [], web = [];
    for (let i = 0; i <= LEAFLETS; i++) {
      const t = 0.06 + i * step;
      base.push(spine(t));
      web.push(spine(t).addScaledVector(dirAt(t, side), lenAt(t) * WEB));
    }
    for (let i = 0; i < LEAFLETS; i++) {
      const tm = 0.06 + (i + 0.5) * step;
      const tip = spine(tm).addScaledVector(dirAt(tm, side), lenAt(tm));
      poly([base[i], base[i + 1], web[i + 1], tip, web[i]]); // web + slender pointed tip
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
const FROND_DROOPS = [0.75, 0.9, 1.05];
const frond = (k) => geo(`frond:${k}`, () => frondGeometry(FROND_DROOPS[k]));

/** castLeaves: background palms leave it off so the baker can strip the hidden frond sheets. */
export function makePalm(rand, height = 7, { castLeaves = false } = {}) {
  const g = new THREE.Group();
  const segs = Math.max(4, Math.round(height / 0.9));
  const lean = (rand() - 0.5) * 0.7;
  const trunkA = mat(0x9b7047), trunkB = mat(0x86603b);
  let x = 0, y = 0;
  for (let i = 0; i < segs; i++) {
    const r = +(0.32 - i * 0.015).toFixed(3);
    // Segments overlap, so only the top one needs a cap.
    const open = i < segs - 1;
    const s = part(geo(`trunk:${r}:${open}`, () => new THREE.CylinderGeometry(r * 0.88, r, 0.95, 7, 1, open)),
      i % 2 ? trunkA : trunkB);
    x = lean * Math.pow(i / segs, 2) * height * 0.45;
    s.position.set(x, y + 0.45, 0);
    s.rotation.z = -lean * (i / segs) * 0.6;
    g.add(s);
    y += 0.88;
  }
  const crown = new THREE.Group();
  crown.position.set(x, y - 0.05, 0);
  g.add(crown);
  const leafA = mat(0x3fae4a), leafB = mat(0x58c95a);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    // Mix of young fronds pointing up and old ones hanging low, so the crown isn't a flat disc.
    const leaf = part(frond(Math.floor(rand() * FROND_DROOPS.length)), i % 2 ? leafA : leafB, castLeaves);
    leaf.rotation.z = i % 2 ? 0.35 + rand() * 0.35 : -0.15 + rand() * 0.25;
    leaf.rotation.x = (rand() - 0.5) * 0.4; // slight twist
    leaf.scale.setScalar(0.85 + rand() * 0.3);
    pivot.add(leaf);
    crown.add(pivot);
  }
  const nutGeo = sphere(0.2, 8, 6);
  for (let i = 0; i < 3; i++) {
    const c = part(nutGeo, mat(0x6b4423), false);
    const a = (i / 3) * Math.PI * 2;
    c.position.set(Math.cos(a) * 0.22, -0.22, Math.sin(a) * 0.22);
    crown.add(c);
  }
  g.userData.crown = crown;
  return g;
}

const BUSH_COLORS = [0x3d9c3f, 0x4fb84a, 0x2f8a3a, 0x66c653];
export function makeBush(rand, size = 1) {
  const g = new THREE.Group();
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const r = (0.5 + rand() * 0.5) * size;
    const b = part(sphere(1, 12, 9), mat(BUSH_COLORS[Math.floor(rand() * BUSH_COLORS.length)]));
    b.scale.setScalar(r);
    b.position.set((i - n / 2) * 0.6 * size + rand() * 0.3, r * 0.6, (rand() - 0.5) * 0.6 * size);
    g.add(b);
  }
  return g;
}

const HILL_COLORS = [0x4f9e3a, 0x5cb246, 0x3f8a32, 0x6abf4f];
export function makeHill(rand) {
  const s = 10 + rand() * 12;
  const h = part(sphere(1, 20, 14), mat(HILL_COLORS[Math.floor(rand() * HILL_COLORS.length)]), false);
  h.scale.set(s, s * (0.5 + rand() * 0.3), s * 0.6);
  return h;
}

export function makeCloud(rand) {
  const g = new THREE.Group();
  const white = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 1 });
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const c = part(sphere(1, 12, 9), white, false);
    const r = 1.2 + rand() * 1.4;
    c.scale.set(r, r * 0.8, r);
    c.position.set(i * 1.6 - n * 0.8, rand() * 0.6, 0);
    g.add(c);
  }
  return g;
}

export function makeMushroom() {
  const g = new THREE.Group();
  const stem = part(geo('mstem', () => new THREE.CylinderGeometry(0.22, 0.3, 0.55, 12)), mat(0xfff1d6));
  stem.position.y = 0.27;
  const cap = new THREE.Group();
  cap.position.y = 0.5;
  const dome = part(geo('mcap', () => new THREE.SphereGeometry(0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), mat(0x9b5de5));
  dome.scale.y = 0.6;
  cap.add(dome);
  const spots = [[0, 0.42, 0], [0.38, 0.26, 0.25], [-0.4, 0.24, 0.2], [0.1, 0.25, 0.5], [-0.15, 0.3, -0.42]];
  for (const [x, y, z] of spots) {
    const s = part(sphere(0.1, 8, 6), mat(0xffe14d), false);
    s.scale.y = 0.4;
    s.position.set(x, y, z);
    cap.add(s);
  }
  g.add(stem, cap);
  return { root: g, cap };
}

export function makeCheckpoint() {
  const g = new THREE.Group();
  const pole = part(geo('bamboo', () => new THREE.CylinderGeometry(0.08, 0.09, 3, 8)), mat(0x9ccf5a));
  pole.position.y = 1.5;
  g.add(pole);
  for (let i = 1; i < 4; i++) {
    const ring = part(geo('bring', () => new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8)), mat(0x6f9e35));
    ring.position.y = i * 0.75;
    g.add(ring);
  }
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.7 });
  flagMat.userData.own = true;
  const flag = part(geo('flag', () => new THREE.BoxGeometry(0.9, 0.55, 0.04)), flagMat);
  flag.position.set(0.47, 2.65, 0);
  g.add(flag);
  return {
    root: g, flag,
    setActive(on) { flagMat.color.set(on ? 0x3ddc84 : 0xff5a5a); },
  };
}

export function makeGoalTree(rand) {
  const g = new THREE.Group();
  const palm = makePalm(rand, 7.5, { castLeaves: true }); // up close: worth a leaf shadow
  g.add(palm);
  const crown = palm.userData.crown;
  for (let i = 0; i < 5; i++) {
    const b = makeBanana(true);
    const a = (i / 5) * Math.PI * 2;
    b.position.set(crown.position.x + Math.cos(a) * 0.4, crown.position.y - 0.45, Math.sin(a) * 0.4);
    b.rotation.y = a;
    g.add(b);
  }
  const prize = makeSuperBanana();
  prize.scale.setScalar(1.4);
  prize.position.set(0, 2.4, 1);
  g.add(prize);
  return { root: g, prize };
}

export function makeVine(len) {
  const root = new THREE.Group();
  const rope = part(new THREE.CylinderGeometry(0.06, 0.06, len, 6), mat(0x4f8a2b));
  rope.position.y = -len / 2;
  root.add(rope);
  const leafM = mat(0x6cc04a);
  for (let y = 0.8, i = 0; y < len - 0.2; y += 0.8, i++) {
    const leaf = part(sphere(1, 8, 6), leafM, false);
    leaf.scale.set(0.2, 0.07, 0.12);
    const side = i % 2 ? 1 : -1;
    leaf.position.set(side * 0.15, -y, 0);
    leaf.rotation.z = side * 0.5;
    root.add(leaf);
  }
  const knot = part(sphere(0.13, 10, 8), mat(0x3f7a22));
  knot.position.y = -len;
  root.add(knot);
  return root;
}

export function makeBranch(rand) {
  const g = new THREE.Group();
  const wood = part(geo('branch', () => new THREE.CylinderGeometry(0.18, 0.24, 6, 8)), mat(0x7a5232));
  wood.rotation.z = Math.PI / 2;
  g.add(wood);
  for (let i = 0; i < 4; i++) {
    const b = makeBush(rand, 0.7);
    b.position.set(-2.4 + i * 1.6, -0.2, -0.2);
    g.add(b);
  }
  return g;
}
