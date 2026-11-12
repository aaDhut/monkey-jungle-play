// Lightweight stylized water. Toon wave bands (light / mid / dark) whose shapes are bent and
// reshaped by two small scrolling noise textures, foam around the islands, sky tint at grazing
// angles and sparse glints. Everything expensive is precomputed: the shore distance is baked into
// a texture once per level and the noise is one tiny tiling texture, so the per-pixel cost is
// three texture reads and a handful of sin/cos. Plus a sandy bottom, a front cross-section face,
// fish, seaweed and ripple rings.
import * as THREE from 'three';
import { mat, part, geo, sphere } from './models.js';

const FRONT_Z = 7;      // the water slab runs from z = -7 to z = +7
const BED_DEPTH = 1.8;  // sand bottom sits this far below the surface

export const WATER_PALETTES = {
  lagoon: { shallow: 0x3ad8ea, deep: 0x1767c4, foam: 0xffffff, sky: 0xc4f1ff, sand: 0xe8d29a },
  jungle: { shallow: 0x36d8b0, deep: 0x0d7a8f, foam: 0xf2fff9, sky: 0xc8f5e0, sand: 0xd6c98e },
};

// ------------------------------------------------------------------ GLSL

// Vertex swell (also used by the front face so its top edge rides the same waves).
const WAVES = /* glsl */ `
  float waveH(vec2 p, float t) {
    return sin(p.x * 0.45 + p.y * 0.2 - t * 1.4) * 0.07
         + sin(p.x * 0.9 - p.y * 0.4 + t * 1.7) * 0.03
         + sin(-p.x * 0.3 + p.y * 0.9 + t * 1.1) * 0.03;
  }
`;

const FRAG_END = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
`;

const surfaceVert = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  ${WAVES}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += waveH(wp.xz, uTime);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const surfaceFrag = /* glsl */ `
  uniform float uTime, uFrontZ;
  uniform vec3 uShallow, uDeep, uFoam, uSky;
  uniform sampler2D uNoise, uShore;
  uniform vec4 uShoreRect; // x0, width, z0, depth of the baked shore-distance texture
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;

    // Two slow noise layers drifting in different directions. They only nudge the wave
    // shapes a little, so the pattern evolves gently instead of churning.
    float n1 = texture2D(uNoise, p * vec2(0.035, 0.08) + vec2(t * 0.008, t * 0.004)).r;
    float n2 = texture2D(uNoise, p * vec2(0.06, 0.12) + vec2(-t * 0.005, t * 0.008)).r;
    float n = n1 + n2 - 1.0; // about -1..1

    // Wave slope from three slow swells in different directions, softly bent by the noise.
    vec2 q = p + vec2(n * 0.6, n * 0.3);
    float a1 = q.x * 0.45 + q.y * 0.2 - t * 0.9;
    float a2 = q.x * 0.9 - q.y * 0.4 + t * 1.1;
    float a3 = -q.x * 0.3 + q.y * 0.9 + t * 0.7;
    vec2 g = cos(a1) * vec2(0.0315, 0.014) + cos(a2) * vec2(0.027, -0.012) + cos(a3) * vec2(-0.009, 0.027);
    float s = dot(g, vec2(0.6, -0.8)) * 22.0 + n * 0.2; // lit side of each wave > 0

    // Shore distance from the baked texture (one read instead of a loop over islands).
    float d = texture2D(uShore, vec2((p.x - uShoreRect.x) / uShoreRect.y, (p.y - uShoreRect.z) / uShoreRect.w)).r * 4.0;
    float shore = 1.0 - smoothstep(0.0, 3.0, d);

    // One smooth base colour plus a single soft highlight on the sunlit wave faces.
    vec3 col = mix(uDeep, uShallow, 0.4 + shore * 0.45 + n * 0.03);
    col = mix(col, mix(col, uShallow, 0.5) + 0.03, smoothstep(0.75, 1.0, s) * 0.6);

    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(v.y, 0.0), 3.0);
    col = mix(col, uSky, fres * 0.35);

    // Rare small glints on the brightest wave faces.
    float glint = step(1.9, s) * step(0.66, n2);

    // Foam: a wobbly band on the shore, a broken ring rolling out, and the front lip.
    float foam = 1.0 - smoothstep(0.16, 0.21, d + n * 0.2);
    float roll = fract(t * 0.3);
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(d - 0.3 - roll * 1.2 + n * 0.25));
    foam = max(foam, ring * (1.0 - roll) * step(0.45, n1) * 0.85);
    foam = max(foam, 1.0 - smoothstep(0.1, 0.15, uFrontZ - p.y + n * 0.1));
    col = mix(col, uFoam, max(foam, glint));

    gl_FragColor = vec4(col, max(mix(0.8, 0.97, fres), max(foam, glint)));
    ${FRAG_END}
  }
`;

const bedVert = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const bedFrag = /* glsl */ `
  uniform vec3 uDeep, uSand;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(mix(uSand, uDeep, 0.85), 1.0);
    ${FRAG_END}
  }
`;

const frontVert = /* glsl */ `
  uniform float uTime, uSurfaceY;
  varying vec3 vWorld;
  varying float vTop;
  #include <fog_pars_vertex>
  ${WAVES}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vTop = uSurfaceY + waveH(wp.xz, uTime);
    if (uv.y > 0.99) wp.y = vTop; // the top edge rides the surface waves
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frontFrag = /* glsl */ `
  uniform float uTime, uHeight;
  uniform vec3 uShallow, uDeep, uFoam;
  varying vec3 vWorld;
  varying float vTop;
  #include <fog_pars_fragment>
  void main() {
    float depth = max(vTop - vWorld.y, 0.0);
    float k = clamp(depth / uHeight, 0.0, 1.0);
    // Two flat colour bands, like a cartoon cross-section, and a white waterline.
    vec3 col = mix(mix(uShallow, uDeep, 0.35), uDeep * 0.75, step(0.45, k));
    float lip = 1.0 - smoothstep(0.05, 0.09, depth);
    col = mix(col, uFoam, lip);
    gl_FragColor = vec4(col, max(mix(0.62, 0.85, k), lip));
    ${FRAG_END}
  }
`;

function shader(vertexShader, fragmentShader, uniforms, extra = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, fog: true,
    // Clone only the fog uniforms; ours are kept by reference so the shared uTime animates.
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    ...extra,
  });
  m.userData.own = true;
  return m;
}

// ------------------------------------------------------------------ baked textures

// Small tiling value-noise texture (two octaves), generated once and shared by every level.
let noiseTex = null;
function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 128;
  const lattice = (cells, seed) => {
    const g = new Float32Array(cells * cells);
    let x = seed;
    for (let i = 0; i < g.length; i++) { x = (x * 16807) % 2147483647; g[i] = x / 2147483647; }
    return (u, v) => { // u, v in cell units, wraps
      const i = Math.floor(u), j = Math.floor(v);
      const fu = u - i, fv = v - j;
      const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
      const at = (a, b) => g[((b % cells + cells) % cells) * cells + ((a % cells + cells) % cells)];
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
      const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
      return top + (bot - top) * sv;
    };
  };
  const o1 = lattice(8, 12345), o2 = lattice(16, 67890);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = o1(x / N * 8, y / N * 8) * 0.7 + o2(x / N * 16, y / N * 16) * 0.3;
    const k = (y * N + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = Math.round(v * 255);
    data[k + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, N, N);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = noiseTex.minFilter = THREE.LinearFilter;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

// Distance (in world units, /4, clamped) from each spot on the water to the nearest island.
function shoreTexture(islands, x0, width) {
  const W = Math.min(2048, Math.ceil(width * 4)), H = 32;
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const z = -FRONT_Z + (j + 0.5) / H * FRONT_Z * 2;
    for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) / W * width;
      let d = 4;
      for (const [a, b, c, e] of islands) {
        const qx = Math.max(a - x, 0, x - b), qz = Math.max(c - z, 0, z - e);
        d = Math.min(d, Math.hypot(qx, qz));
      }
      const k = (j * W + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(d / 4 * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ fish + seaweed

const FISH_COLORS = [
  [0xff8a3d, 0xffffff], // orange with white fins
  [0xffd93b, 0x3b8bff],
  [0xff6fae, 0xffd1e6],
  [0x4fc3f7, 0xffe14d],
  [0x9b7bff, 0xffb3ff],
  [0x7ee36b, 0xfff176],
];

function makeFish(rand) {
  const [bodyC, finC] = FISH_COLORS[Math.floor(rand() * FISH_COLORS.length)];
  const root = new THREE.Group();
  const body = part(sphere(1, 14, 10), mat(bodyC, { roughness: 0.45 }), false);
  body.scale.set(0.42, 0.26, 0.14);
  root.add(body);

  const finM = mat(finC, { roughness: 0.5 });
  const tail = new THREE.Group();
  tail.position.x = -0.36;
  const fin = part(geo('fish-tail', () => new THREE.ConeGeometry(0.2, 0.32, 4)), finM, false);
  fin.rotation.z = -Math.PI / 2; // apex points at the body, the fan flares out behind
  fin.position.x = -0.16;
  fin.scale.set(1, 1, 0.3);
  tail.add(fin);
  root.add(tail);

  const dorsal = part(geo('fish-dorsal', () => new THREE.ConeGeometry(0.12, 0.22, 3)), finM, false);
  dorsal.position.set(-0.02, 0.24, 0);
  dorsal.rotation.z = 0.5;
  dorsal.scale.set(1, 1, 0.3);
  root.add(dorsal);

  for (const s of [-1, 1]) {
    const eye = part(sphere(0.065, 10, 8), mat(0xffffff), false);
    eye.position.set(0.24, 0.06, s * 0.09);
    const pupil = part(sphere(0.038, 8, 6), mat(0x1a1a1a), false);
    pupil.position.set(0.27, 0.06, s * 0.13);
    root.add(eye, pupil);
  }
  root.scale.setScalar(0.7 + rand() * 0.45);
  return { root, tail };
}

function makeSeaweed(rand, h) {
  const g = new THREE.Group();
  const m = mat(rand() < 0.5 ? 0x3fbf6a : 0x5fd38a, { roughness: 0.7 });
  const blade = part(new THREE.CylinderGeometry(0.025, 0.08, h, 5, 1), m, false);
  blade.position.y = h / 2;
  g.add(blade);
  return g;
}

// ------------------------------------------------------------------ build

/**
 * islands: [x0, x1, z0, z1] footprints of land that pokes through the surface (for the shore foam).
 * palette: { shallow, deep, foam, sand } colours.
 */
export function buildWater(group, { cx, span, minX, maxX, y, islands, rand, palette }) {
  const pal = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, new THREE.Color(v)]));
  const time = { value: 0 };

  // Surface
  const shoreTex = shoreTexture(islands, cx - span / 2, span);
  const surfaceMat = shader(surfaceVert, surfaceFrag, {
    uTime: time, uFrontZ: { value: FRONT_Z },
    uShallow: { value: pal.shallow }, uDeep: { value: pal.deep }, uFoam: { value: pal.foam },
    uSky: { value: pal.sky },
    uNoise: { value: noiseTexture() }, uShore: { value: shoreTex },
    uShoreRect: { value: new THREE.Vector4(cx - span / 2, span, -FRONT_Z, FRONT_Z * 2) },
  }, { transparent: true });
  surfaceMat.addEventListener('dispose', () => shoreTex.dispose()); // baked per level
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(span, FRONT_Z * 2, Math.ceil(span / 1.2), 24), surfaceMat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(cx, y, 0);
  surface.renderOrder = 1;
  group.add(surface);

  // Sandy bottom
  const bedMat = shader(bedVert, bedFrag, { uDeep: { value: pal.deep }, uSand: { value: pal.sand } });
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(span, FRONT_Z * 2), bedMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(cx, y - BED_DEPTH, 0);
  group.add(bed);

  // Front face, so the water reads as a volume you can look into
  const frontMat = shader(frontVert, frontFrag, {
    uTime: time, uSurfaceY: { value: y }, uHeight: { value: BED_DEPTH },
    uShallow: { value: pal.shallow }, uDeep: { value: pal.deep }, uFoam: { value: pal.foam },
  }, { transparent: true, depthWrite: false });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(span, BED_DEPTH, Math.ceil(span / 1.5), 1), frontMat);
  front.position.set(cx, y - BED_DEPTH / 2, FRONT_Z);
  front.renderOrder = 2;
  group.add(front);

  // Is the water open (no land) around x? Fish only jump where you can see them clear the surface.
  const openAt = (x, pad) => !islands.some(([x0, x1]) => x > x0 - pad && x < x1 + pad);

  // Fish swim in the strip between the land and the front glass.
  const fish = [];
  for (let x = minX - 6; x < maxX + 6; x += 3.5 + rand() * 3.5) {
    const { root, tail } = makeFish(rand);
    const f = {
      root, tail, x0: x, x, range: 2.5 + rand() * 4, dir: rand() < 0.5 ? -1 : 1,
      speed: 0.8 + rand() * 1.1, y0: y - 0.4 - rand() * (BED_DEPTH - 0.75), z: 2.8 + rand() * 3.6,
      phase: rand() * 10, jumpIn: 3 + rand() * 12, jump: null,
    };
    root.position.set(f.x, f.y0, f.z);
    group.add(root);
    fish.push(f);
  }

  // Seaweed tufts and pebbles on the bottom
  const weeds = [];
  for (let x = minX - 6; x < maxX + 6; x += 2.5 + rand() * 4) {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const w = makeSeaweed(rand, 0.5 + rand() * 0.75);
      w.position.set(x + (rand() - 0.5) * 0.8, y - BED_DEPTH, 2.6 + rand() * 4);
      group.add(w);
      weeds.push({ w, phase: rand() * 6, amp: 0.12 + rand() * 0.12 });
    }
    if (rand() < 0.4) {
      const rock = part(geo('pebble', () => new THREE.DodecahedronGeometry(0.3, 0)), mat(0x8fa3b5), false);
      rock.position.set(x + 1, y - BED_DEPTH + 0.08, 3 + rand() * 3.5);
      rock.scale.set(1 + rand(), 0.5 + rand() * 0.4, 0.8 + rand() * 0.5);
      rock.rotation.y = rand() * 3;
      group.add(rock);
    }
  }

  // Ripple rings for jumping fish
  const ringGeo = new THREE.RingGeometry(0.8, 1, 28);
  const ripples = Array.from({ length: 8 }, () => {
    const m = new THREE.MeshBasicMaterial({ color: palette.foam, transparent: true, depthWrite: false, opacity: 0 });
    m.userData.own = true;
    const mesh = new THREE.Mesh(ringGeo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    return { mesh, age: 1 };
  });
  const ripple = (x, z) => {
    const r = ripples.find((q) => q.age >= 1) ?? ripples[0];
    r.age = 0;
    r.mesh.position.set(x, y + 0.2, z);
    r.mesh.visible = true;
  };

  const G = 14;
  return {
    animate(t, dt) {
      time.value = t;

      for (const f of fish) {
        const { root } = f;
        if (f.jump) {
          const j = f.jump;
          const wasAbove = root.position.y > y;
          j.vy -= G * dt;
          f.x += j.vx * dt;
          root.position.y += j.vy * dt;
          root.rotation.z = Math.atan2(j.vy, Math.abs(j.vx)) * 0.8;
          const isAbove = root.position.y > y;
          if (wasAbove !== isAbove) ripple(f.x, f.z);
          if (!isAbove && j.vy < 0 && root.position.y <= f.y0) {
            f.jump = null;
            root.rotation.z = 0;
            f.jumpIn = 6 + Math.random() * 14;
          }
        } else {
          f.x += f.dir * f.speed * dt;
          if (f.x > f.x0 + f.range) f.dir = -1;
          else if (f.x < f.x0 - f.range) f.dir = 1;
          root.position.y = f.y0 + Math.sin(t * 1.6 + f.phase) * 0.07;
          f.jumpIn -= dt;
          if (f.jumpIn <= 0) {
            if (openAt(f.x, 1.6)) f.jump = { vx: f.dir * 1.6, vy: 5.2 + Math.random() * 1.2 };
            else f.jumpIn = 1 + Math.random() * 2;
          }
        }
        root.position.x = f.x;
        // Turn smoothly to face the way it's swimming.
        const want = f.dir > 0 ? 0 : Math.PI;
        root.rotation.y += (want - root.rotation.y) * (1 - Math.exp(-dt * 6));
        f.tail.rotation.y = Math.sin(t * (8 + f.speed * 4) + f.phase) * 0.55;
      }

      for (const s of weeds) s.w.rotation.z = Math.sin(t * 1.3 + s.phase) * s.amp;

      for (const r of ripples) {
        if (r.age >= 1) continue;
        r.age = Math.min(1, r.age + dt / 0.9);
        r.mesh.scale.setScalar(0.15 + r.age * 0.9);
        r.mesh.material.opacity = (1 - r.age) * 0.85;
        if (r.age >= 1) r.mesh.visible = false;
      }
    },
  };
}
