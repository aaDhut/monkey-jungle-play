// Dense tropical-jungle scenery (used by levels with "scenery": "jungle").
// Giant trees with spiral roots, wrapped vines, layered canopy, ferns, ground roots,
// light shafts and pollen. Everything static is baked into a few merged meshes for speed.
import * as THREE from 'three';
import { mat, part, sphere, makePalm, makeBush } from './models.js';
import { Baker, cameraBox } from './bake.js';

const BARK = [0x6b4a2f, 0x5c3f27, 0x7a5636];
const LEAF = [0x2f7d32, 0x3c8f3a, 0x1f6b2c, 0x4a9e3f, 0x2a7040];
const FERN = [0x3fa34d, 0x56b84a, 0x2f8f45];
const VINE = 0x4f8a2b;
const FLOOR_Y = -0.6;
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

// ------------------------------------------------------------ shapes

/** Tube along points that tapers from full radius to endScale × radius. */
function taperedTube(points, radius, color, endScale = 0.3, segs = 28, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const s = 1 - (1 - endScale) * (i / segs);
    curve.getPointAt(i / segs, c);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(s).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return part(g, mat(color));
}

/** A buttress root that spirals out and down from the trunk into the ground. */
function spiralRoot(rand, trunkR, a0, color) {
  const twist = (rand() < 0.5 ? -1 : 1) * (0.8 + rand() * 1.4);
  const spread = 2.0 + rand() * 2.8;
  const h0 = 1.2 + rand() * 1.8;
  const pts = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const a = a0 + twist * t;
    const r = trunkR * 0.75 + spread * Math.pow(t, 0.8);
    const y = h0 * Math.pow(1 - t, 1.6) + Math.sin(t * Math.PI) * 0.35 - 0.25 * t;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  // Curl the tip into a little spiral.
  const end = pts[pts.length - 1], a = a0 + twist;
  for (let i = 1; i <= 4; i++) {
    const ca = a + Math.sign(twist) * i * 0.9, cr = 0.45 * (1 - i / 5);
    pts.push(new THREE.Vector3(end.x + Math.cos(ca) * cr, end.y + 0.05 * i, end.z + Math.sin(ca) * cr));
  }
  return taperedTube(pts, trunkR * 0.52, color, 0.16, 36, 8);
}

function hangingVine(rand, x, y, z, len) {
  const g = new THREE.Group();
  const rope = part(new THREE.CylinderGeometry(0.04, 0.05, len, 5), mat(VINE), false);
  rope.position.set(x, y - len / 2, z);
  g.add(rope);
  for (let d = 0.6; d < len; d += 0.7 + rand() * 0.5) {
    const leaf = part(sphere(1, 8, 6), mat(0x6cc04a), false);
    leaf.scale.set(0.22, 0.06, 0.12);
    leaf.position.set(x + (rand() - 0.5) * 0.2, y - d, z);
    leaf.rotation.z = (rand() - 0.5) * 1.2;
    g.add(leaf);
  }
  return g;
}

export function makeJungleTree(rand, height = 13, { roots = true, vines = true } = {}) {
  const g = new THREE.Group();
  const r = 0.55 + rand() * 0.4;
  const bark = pick(rand, BARK);
  const lean = (rand() - 0.5) * 0.2;

  // Trunk: three tapering sections with a gentle lean.
  let y = 0, x = 0;
  const segs = 3, segH = height / segs;
  for (let i = 0; i < segs; i++) {
    const r0 = r * (1 - i * 0.2), r1 = r * (1 - (i + 1) * 0.2);
    const c = part(new THREE.CylinderGeometry(r1, r0, segH + 0.1, 10), mat(bark));
    c.position.set(x - Math.sin(lean) * segH / 2, y + segH / 2, 0);
    c.rotation.z = lean;
    g.add(c);
    x -= Math.sin(lean) * segH;
    y += segH;
  }
  const top = new THREE.Vector3(x, y, 0);

  if (roots) {
    const n = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) g.add(spiralRoot(rand, r, (i / n) * Math.PI * 2 + rand() * 0.6, bark));
  }

  if (vines) {
    // A vine spiralling up the trunk.
    const turns = 2 + rand() * 1.5, phase = rand() * Math.PI * 2, pts = [];
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const a = phase + t * turns * Math.PI * 2;
      const rr = r * (1 - 0.6 * t) + 0.09;
      pts.push(new THREE.Vector3(Math.cos(a) * rr - Math.sin(lean) * height * t, t * height * 0.85, Math.sin(a) * rr));
    }
    g.add(taperedTube(pts, 0.08, VINE, 0.6, 80, 6));
  }

  // Thick branches reaching out to the canopy.
  const blobs = [];
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2, len = 2 + rand() * 2;
    const start = new THREE.Vector3(top.x, top.y - 1.5 - rand() * 2, 0);
    const end = new THREE.Vector3(top.x + Math.cos(a) * len, start.y + 1.2 + rand() * 1.2, Math.sin(a) * len);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.5, 0));
    g.add(taperedTube([start, mid, end], r * 0.35, bark, 0.5, 10, 7));
    blobs.push(end);
  }
  blobs.push(top);

  // Layered canopy.
  for (const b of blobs) {
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const s = 1.5 + rand() * 1.4;
      const leaf = part(sphere(1, 12, 9), mat(pick(rand, LEAF)));
      leaf.scale.set(s, s * 0.7, s);
      leaf.position.set(b.x + (rand() - 0.5) * 2.4, b.y + 0.4 + rand() * 1.2, b.z + (rand() - 0.5) * 2.4);
      g.add(leaf);
    }
  }

  if (vines) {
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const b = blobs[Math.floor(rand() * blobs.length)];
      g.add(hangingVine(rand, b.x + (rand() - 0.5) * 2, b.y - 0.6, b.z + (rand() - 0.5) * 2, 3 + rand() * 4));
    }
  }
  return g;
}

/** Background filler tree: trunk + canopy only. */
function makeFarTree(rand, height) {
  const g = new THREE.Group();
  const r = 0.5 + rand() * 0.5;
  const trunk = part(new THREE.CylinderGeometry(r * 0.6, r, height, 7), mat(pick(rand, BARK)), false);
  trunk.position.y = height / 2;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const s = 2.5 + rand() * 2;
    const leaf = part(sphere(1, 10, 8), mat(pick(rand, LEAF)), false);
    leaf.scale.set(s, s * 0.75, s);
    leaf.position.set((rand() - 0.5) * 3, height + rand() * 1.5, (rand() - 0.5) * 3);
    g.add(leaf);
  }
  return g;
}

export function makeFern(rand, size = 1) {
  const g = new THREE.Group();
  const n = 7 + Math.floor(rand() * 4);
  const color = pick(rand, FERN);
  for (let i = 0; i < n; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / n) * Math.PI * 2 + rand() * 0.3;
    const tilt = new THREE.Group();
    tilt.rotation.z = 0.35 + rand() * 0.55;
    const frond = part(sphere(1, 10, 6), mat(color));
    frond.scale.set(1.1 * size, 0.05, 0.22 * size);
    frond.position.x = 1.0 * size;
    tilt.add(frond);
    pivot.add(tilt);
    g.add(pivot);
  }
  return g;
}

/** Monstera-style plant: a few big broad leaves on stems. */
export function makeBigLeafPlant(rand, size = 1) {
  const g = new THREE.Group();
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.5;
    const h = (0.8 + rand() * 0.8) * size;
    const reach = (0.5 + rand() * 0.4) * size;
    const stem = part(new THREE.CylinderGeometry(0.03, 0.04, h, 5), mat(0x3d7a2a), false);
    stem.position.set(Math.cos(a) * reach * 0.5, h / 2, Math.sin(a) * reach * 0.5);
    stem.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    g.add(stem);
    const leaf = part(sphere(1, 12, 8), mat(pick(rand, [0x2e8b3a, 0x3a9d40, 0x267a33])));
    leaf.scale.set(0.85 * size, 0.05, 0.6 * size);
    leaf.position.set(Math.cos(a) * reach, h, Math.sin(a) * reach);
    leaf.rotation.set(0, -a, -0.35);
    g.add(leaf);
  }
  return g;
}

/** A giant root snaking along the floor, arching up and curling into a spiral at one end. */
export function makeGroundRoot(rand, length = 9) {
  const pts = [];
  const phase = rand() * Math.PI;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push(new THREE.Vector3(
      (t - 0.5) * length,
      Math.max(-0.35, Math.sin(t * Math.PI * 2 + phase) * 0.9 + 0.15),
      Math.sin(t * Math.PI * 3 + phase) * 1.1,
    ));
  }
  // Spiral curl at the end.
  const end = pts[pts.length - 1];
  for (let i = 1; i <= 8; i++) {
    const a = i * 0.8, cr = 1.0 * (1 - i / 9);
    pts.push(new THREE.Vector3(end.x + Math.sin(a) * cr, end.y + (1 - Math.cos(a)) * cr, end.z));
  }
  return taperedTube(pts, 0.32, pick(rand, BARK), 0.2, 70, 9);
}

// ------------------------------------------------------------ the whole jungle

// sparse: fewer big trees and no far tree wall, so a backdrop (e.g. volcanoes) shows through.
export function buildJungle(target, rand, minX, maxX, { sparse = false } = {}) {
  const baker = new Baker({ box: cameraBox(minX, maxX) });
  const place = (obj, x, y, z, layer, ry = rand() * Math.PI * 2) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    baker.add(obj, layer);
  };

  // Near layer: giant trees with spiral roots, just behind the play area.
  for (let x = minX - 15; x < maxX + 15; x += sparse ? 13 + rand() * 9 : 7 + rand() * 6) {
    place(makeJungleTree(rand, 12 + rand() * 5), x, FLOOR_Y, -7.8 - rand() * 3, "near");
  }
  // Dense undergrowth along the back of the play area.
  for (let x = minX - 15; x < maxX + 15; x += 1.1 + rand() * 1.5) {
    const r = rand(), z = -4.8 - rand() * 3.5;
    const plant = r < 0.4 ? makeFern(rand, 0.8 + rand() * 0.6)
      : r < 0.75 ? makeBigLeafPlant(rand, 0.9 + rand() * 0.7)
      : makeBush(rand, 0.7 + rand() * 0.5);
    place(plant, x, FLOOR_Y, z, 'near');
  }
  // Giant roots snaking across the jungle floor.
  for (let x = minX - 10; x < maxX + 10; x += 9 + rand() * 8) {
    place(makeGroundRoot(rand, 7 + rand() * 5), x, FLOOR_Y, -9 - rand() * 6, 'near', (rand() - 0.5) * 0.8);
  }
  // Mid layer: more big trees, a few coconut palms, more ferns.
  for (let x = minX - 20; x < maxX + 20; x += sparse ? 11 + rand() * 8 : 5 + rand() * 4) {
    place(makeJungleTree(rand, (sparse ? 9 : 14) + rand() * 6, { vines: rand() < 0.6 }), x, FLOOR_Y, -14 - rand() * 9, 'mid');
  }
  for (let x = minX - 10; x < maxX + 10; x += sparse ? 7 + rand() * 6 : 16 + rand() * 10) {
    place(makePalm(rand, 8 + rand() * 4), x, FLOOR_Y, -11 - rand() * 8, 'mid');
  }
  for (let x = minX - 20; x < maxX + 20; x += 2 + rand() * 2) {
    place(rand() < 0.5 ? makeFern(rand, 1.2 + rand()) : makeBigLeafPlant(rand, 1.3 + rand()), x, FLOOR_Y, -12 - rand() * 10, 'mid');
  }
  // Far wall of trees and canopy, fading into the mist.
  for (let x = minX - 50; x < maxX + 50; x += sparse ? 1e9 : 3 + rand() * 3) {
    place(makeFarTree(rand, 12 + rand() * 12), x, FLOOR_Y, -28 - rand() * 16, 'far');
  }
  for (let x = minX - 60; x < maxX + 60; x += sparse ? 1e9 : 6 + rand() * 5) {
    const s = 5 + rand() * 4;
    const blob = part(sphere(1, 14, 10), mat(pick(rand, LEAF)), false);
    blob.scale.set(s * 1.3, s, s);
    place(blob, x, 10 + rand() * 10, -46 - rand() * 10, 'far', 0);
  }
  // Only the near layer casts shadows; the far layer is beyond any shadow, so skip receiving there too.
  const meshes = baker.finish(target, { castLayers: new Set(['near']), receiveLayers: new Set(['near', 'mid']) });

  // Sunbeams through the canopy (soft additive planes).
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c0, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  beamMat.userData.own = true;
  for (let x = minX; x < maxX; x += 14 + rand() * 12) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + rand() * 2.5, 34), beamMat);
    beam.position.set(x, 9, -9 - rand() * 10);
    beam.rotation.z = 0.35 + rand() * 0.15;
    target.add(beam);
  }

  // Drifting pollen / fireflies.
  const count = Math.round((maxX - minX) * 2.5);
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3] = minX + rand() * (maxX - minX);
    p[i * 3 + 1] = rand() * 11;
    p[i * 3 + 2] = -2.5 - rand() * 12;
  }
  const pollenGeo = new THREE.BufferGeometry();
  pollenGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pollenMat = new THREE.PointsMaterial({
    color: 0xfff7a8, size: 0.12, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  pollenMat.userData.own = true;
  const pollen = new THREE.Points(pollenGeo, pollenMat);
  target.add(pollen);

  return {
    meshes,
    vertices: baker.vertices,
    triangles: baker.triangles,
    removedFaces: baker.removed,
    animate(t) {
      pollen.position.y = Math.sin(t * 0.4) * 0.35;
      pollen.position.x = Math.sin(t * 0.23) * 0.5;
      pollenMat.opacity = 0.55 + Math.sin(t * 1.7) * 0.25;
      beamMat.opacity = 0.08 + Math.sin(t * 0.5) * 0.02;
    },
  };
}
