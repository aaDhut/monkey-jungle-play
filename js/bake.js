// Static-scenery baking: merges many small meshes into a few big ones (fewer draw calls),
// split into vertical strips along x so camera culling can skip strips that are off-screen,
// and strips triangles that face away from every place the camera can ever be.
import * as THREE from 'three';

/** Width (world units) of each culling strip. About two-thirds of a landscape screen. */
export const CHUNK_W = 16;
const MAX_VERTS = 900000;

/** Switches (used by the culling test page to render a reference without the optimisations). */
export const bakeOptions = { removeHiddenFaces: true, chunk: CHUNK_W, vertexColors: true };

// Plain coloured materials that differ only by colour share one baked material, with the colour
// stored per vertex instead. The jungle uses dozens of greens/browns, so this collapses dozens of
// draw calls per culling strip into a handful.
const sharedMaterials = new Map();
function colorMaterial(m) {
  if (!bakeOptions.vertexColors || !m.isMeshStandardMaterial || m.map || m.vertexColors
    || m.transparent || m.userData.own || m.clippingPlanes?.length) return null;
  const sig = [m.roughness, m.metalness, m.flatShading, m.emissive.getHex(), m.emissiveIntensity,
    m.side, m.fog, m.wireframe].join('|');
  let shared = sharedMaterials.get(sig);
  if (!shared) {
    shared = m.clone();
    shared.color.set(0xffffff);
    shared.vertexColors = true;
    shared.userData = {}; // cached across levels: never disposed by level cleanup
    sharedMaterials.set(sig, shared);
  }
  return shared;
}

/** Running totals for the current level (shown by the ?stats overlay). */
export const bakeStats = { sources: 0, meshes: 0, triangles: 0, removed: 0 };
export function resetBakeStats() { Object.assign(bakeStats, { sources: 0, meshes: 0, triangles: 0, removed: 0 }); }

/**
 * Every position the game camera can reach in a level (see applyCamera in main.js): x is clamped
 * inside the level bounds, y = cam.y + 1.6 with cam.y >= 2.4 on phones, 3.2 otherwise (levels top out around y = 12, plus
 * jumps and mushroom bounces), and z = camDist() which ranges ~11.2..32.3 (phones bring it closer, see phoneZoom).
 * Padded generously so nothing that could ever be seen is removed.
 */
export function cameraBox(minX, maxX) {
  return { x: [minX - 3, maxX + 3], y: [2, 50], z: [9, 34] };
}

/**
 * Drop triangles whose front side can't face the camera from anywhere in `box`. A triangle is
 * visible from camera point c iff (c - v0) · n > 0. That is linear in c, so its maximum over the box
 * is at one of the 8 corners: if every corner says "back-facing", the GPU would cull it from
 * every possible camera position anyway, and it's safe to delete. Returns how many were removed.
 */
function dropHiddenFaces(geometry, box) {
  const p = geometry.attributes.position.array;
  const src = geometry.index.array;
  const keep = new src.constructor(src.length);
  let n = 0;
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i] * 3, b = src[i + 1] * 3, c = src[i + 2] * 3;
    const x0 = p[a], y0 = p[a + 1], z0 = p[a + 2];
    const e1x = p[b] - x0, e1y = p[b + 1] - y0, e1z = p[b + 2] - z0;
    const e2x = p[c] - x0, e2y = p[c + 1] - y0, e2z = p[c + 2] - z0;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    // Best corner per axis: pick the side of the box the normal points toward.
    const cx = nx > 0 ? box.x[1] : box.x[0];
    const cy = ny > 0 ? box.y[1] : box.y[0];
    const cz = nz > 0 ? box.z[1] : box.z[0];
    if ((cx - x0) * nx + (cy - y0) * ny + (cz - z0) * nz > 0) {
      keep[n++] = src[i]; keep[n++] = src[i + 1]; keep[n++] = src[i + 2];
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(keep.slice(0, n), 1));
  return (src.length - n) / 3;
}

function mergeSimple(geos, colors = null) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  const col = colors ? new Float32Array(vCount * 3) : null;
  let vo = 0, io = 0;
  for (let gi = 0; gi < geos.length; gi++) {
    const g = geos[gi];
    const count = g.attributes.position.count;
    if (col) {
      const { r, g: gr, b } = colors[gi];
      for (let k = vo * 3, end = (vo + count) * 3; k < end; k += 3) { col[k] = r; col[k + 1] = gr; col[k + 2] = b; }
    }
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) idx[io + k] = src[k] + vo;
      io += src.length;
    } else {
      for (let k = 0; k < count; k++) idx[io + k] = vo + k;
      io += count;
    }
    vo += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export class Baker {
  /**
   * chunk: strip width for culling (0 = one strip, e.g. for a moving platform baked in local space).
   * box:   camera reach (see cameraBox); when given, never-visible faces are stripped from meshes
   *        that don't cast shadows (the shadow pass draws back faces, so casters keep theirs).
   */
  constructor({ chunk = bakeOptions.chunk, box = null } = {}) {
    this.chunk = chunk;
    this.box = box;
    this.buckets = new Map();
    this.vertices = 0;
    this.triangles = 0;
    this.removed = 0;
    this.sources = 0;
  }

  add(obj, layer = 'static') {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.computeBoundingSphere();
      const strip = this.chunk ? Math.floor(g.boundingSphere.center.x / this.chunk) : 0;
      const shared = colorMaterial(o.material);
      const material = shared ?? o.material;
      const key = `${layer}|${material.uuid}|${o.castShadow ? 1 : 0}|${strip}`;
      let b = this.buckets.get(key);
      if (!b) this.buckets.set(key, (b = { material, vc: !!shared, layer, cast: o.castShadow, geos: [], colors: [] }));
      b.geos.push(g);
      b.colors.push(o.material.color); // kept alongside (geometry.clone() shares userData with the source)
      this.sources++;
      if (!o.geometry.userData.shared) o.geometry.dispose();
    });
  }

  /** castLayers / receiveLayers: optional Sets overriding each mesh's own shadow flags by layer. */
  finish(target, { castLayers = null, receiveLayers = null } = {}) {
    let meshes = 0;
    for (const b of this.buckets.values()) {
      const cast = castLayers ? castLayers.has(b.layer) : b.cast;
      for (let start = 0; start < b.geos.length;) {
        const chunk = [], colors = [];
        let verts = 0;
        while (start < b.geos.length && (verts < MAX_VERTS || !chunk.length)) {
          verts += b.geos[start].attributes.position.count;
          colors.push(b.colors[start]);
          chunk.push(b.geos[start++]);
        }
        const geometry = mergeSimple(chunk, b.vc ? colors : null);
        if (bakeOptions.removeHiddenFaces && this.box && !cast && b.material.side === THREE.FrontSide && !b.material.transparent) {
          this.removed += dropHiddenFaces(geometry, this.box);
        }
        if (!geometry.index.count) { geometry.dispose(); continue; }
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        const mesh = new THREE.Mesh(geometry, b.material);
        mesh.castShadow = cast;
        mesh.receiveShadow = receiveLayers ? receiveLayers.has(b.layer) : true;
        // Baked geometry is already in world space and never moves: skip per-frame matrix updates.
        mesh.matrixAutoUpdate = false;
        target.add(mesh);
        this.vertices += verts;
        this.triangles += geometry.index.count / 3;
        meshes++;
      }
      b.geos.forEach((g) => g.dispose());
    }
    this.buckets.clear();
    bakeStats.sources += this.sources;
    bakeStats.meshes += meshes;
    bakeStats.triangles += this.triangles;
    bakeStats.removed += this.removed;
    this.sources = this.triangles = this.removed = 0;
    return meshes;
  }
}

/** Merge a (detached, origin-placed) group's meshes by material into a new group, in local space. */
export function bakeGroup(group) {
  const baker = new Baker({ chunk: 0 });
  baker.add(group);
  const out = new THREE.Group();
  baker.finish(out);
  for (const m of out.children) m.matrixAutoUpdate = false;
  return out;
}
