// On-screen PS5 DualSense HUD in three.js, drawn see-through over the game.
// The 3D model (models/dualsense.glb) is rendered twice: its left half in the bottom-left corner and its right half
// in the bottom-right. Whatever is pressed physically moves on the model (buttons sink,
// triggers pull back as far as they're squeezed, sticks tilt) and glows. Input can come from a
// real controller, the keyboard, or the model itself (click/tap its buttons, drag its left stick).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BTN } from './input.js';

// What an on-screen button does when pressed (the same mapping Input.poll() uses for a real pad).
const PRESS = {
  [BTN.cross]: ['jump'], [BTN.circle]: ['back', 'down'], [BTN.square]: ['run'],
  [BTN.r1]: ['run'], [BTN.r2]: ['run'],
  [BTN.create]: ['mute'], [BTN.options]: ['pause'],
  [BTN.up]: ['up'], [BTN.down]: ['down'], [BTN.left]: ['left'], [BTN.right]: ['right'],
};
// Keyboard actions shown on the button that does the same thing on the controller.
const KEY_LIGHTS = {
  left: BTN.left, right: BTN.right, down: BTN.down, jump: BTN.cross,
  run: BTN.square, pause: BTN.options, mute: BTN.create,
};
const GAME_KEYS = new Set(['left', 'right', 'down', 'jump', 'run']);
const L3 = 10, R3 = 11, PS = 16, TOUCHPAD = 17;
const DRAG_DEAD = 0.35;     // on-screen stick deadzone
const DRAG_RADIUS = 40;     // px of finger travel for a full on-screen stick push
const STICK_TILT = 0.42;    // radians at full stick
const PREF_KEY = 'mj-padview';

const MODEL_URL = 'models/dualsense.glb';   // geometry only (~1.6 MB), no textures
const MODEL_SCALE = 8;
// Glow colours when pressed: PlayStation symbol colours for the face buttons, orange for the rest.
const GLOW = { [BTN.cross]: 0x4f8dff, [BTN.circle]: 0xff4060, [BTN.square]: 0xff5fc8, [BTN.triangle]: 0x22e0c0, [PS]: 0x6fa8ff };
const PRESS_COLOR = 0xff8a00;
// Flat colours per model piece (by its material name in the model file).
const PIECE_COLOR = { 1002: 0xc4d0f0, 1011: 0x8c99bd, 1001: 0x66739a };  // shell, core, buttons
const OUTLINE_COLOR = 0x2a3352;
const OUTLINE_WIDTH = 0.0065;   // model units
const SYMBOL_COLOR = 0xf4f7ff;

// How each part of the model moves. Travel is in model units (the model is ~2 units wide).
const KIND = (b) => {
  if (b === L3 || b === R3) return { kind: 'stick', travel: 0.025 };
  if (b === BTN.l2 || b === BTN.r2) return { kind: 'trigger' };
  if (b === BTN.l1 || b === BTN.r1) return { kind: 'bumper', travel: 0.018 };
  if (b === TOUCHPAD) return { kind: 'push', travel: 0.012 };
  return { kind: 'push', travel: 0.022 };
};

// ---------------------------------------------------------------- toon shader (no textures)

const VERT = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// Three flat light bands, then the press colour on top.
const FRAG = `
uniform vec3 uColor;
uniform vec3 uGlow;
uniform float uPress;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float d = dot(n, normalize(vec3(-0.35, 0.8, 0.5))) * 0.5 + 0.5;
  float band = d > 0.62 ? 1.0 : (d > 0.38 ? 0.82 : 0.66);
  vec3 col = uColor * band;
  col = mix(col, uGlow * (0.8 + 0.3 * band), uPress);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const hudMat = (color) => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(color) },
    uGlow: { value: new THREE.Color(0) },
    uPress: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: FRAG,
  side: THREE.DoubleSide,
});

// Cartoon outline: the back faces, pushed out a little along their normals, in one flat colour.
// A pressed part's outline turns its glow colour and thickens, so the glow spills outside the button.
const OUTLINE_BASE = new THREE.Color(OUTLINE_COLOR);
const makeOutlineMat = () => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: OUTLINE_BASE.clone() }, uWidth: { value: OUTLINE_WIDTH } },
  vertexShader: `uniform float uWidth;
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uWidth, 1.0); }`,
  fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
  }`,
  side: THREE.BackSide,
});
const outlineMat = makeOutlineMat();
const withOutline = (mesh, mat = outlineMat) => {
  const o = new THREE.Mesh(mesh.geometry, mat);
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
};

// Soft round glow sprite that blooms around a pressed button.
let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

// Small text labels for the shoulder buttons (drawn once to a tiny canvas texture).
// PS5's own typeface (Sony's SST) can't be shipped, so this uses Source Sans 3, a free font with the
// same clean humanist shapes, in the light grey the DualSense prints its labels in.
const LABEL_FONT = '600 50px "Source Sans 3", "Segoe UI", system-ui, sans-serif';
const SHOULDER_LABEL = { [BTN.l1]: 'L1', [BTN.l2]: 'L2', [BTN.r1]: 'R1', [BTN.r2]: 'R2' };
function labelDecal(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = LABEL_FONT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(32, 40, 66, 0.85)';
  g.strokeText(text, 64, 34);
  g.fillStyle = '#e9edf5';
  g.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.075),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,   // sits on the surface, no flicker
    }),
  );
  decal.renderOrder = 11;
  decal.raycast = () => {};
  return decal;
}

/**
 * Lay a label flat on the part's visible surface: cast a ray from in front of / above the
 * controller at the part, then orient the label along the surface it hits, text reading
 * left-to-right with its top toward the top of the controller.
 */
const VIEW_DIR = new THREE.Vector3(0, 0.55, 1).normalize();
function stickLabel(part, label, aim) {
  part.root.updateMatrixWorld(true);   // part not in the model yet, so this is model space
  const meshes = part.mover.children.filter((o) => o.isMesh && o.material.isShaderMaterial);
  const ray = new THREE.Raycaster(aim.clone().addScaledVector(VIEW_DIR, 1), VIEW_DIR.clone().negate());
  const hit = ray.intersectObjects(meshes, false)[0];
  const point = hit ? hit.point : aim;
  const n = hit ? hit.face.normal.clone() : VIEW_DIR.clone();
  if (n.dot(VIEW_DIR) < 0) n.negate();   // double-sided model: face the viewer
  n.x = 0;                                // keep the text level along the controller, not the curve
  n.normalize();
  const upHint = Math.abs(n.y) > 0.85 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(upHint, n).normalize();
  const y = new THREE.Vector3().crossVectors(n, x);
  label.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
  label.position.copy(point).addScaledVector(n, 0.006).sub(part.root.position);
  part.mover.add(label);
}

// ---------------------------------------------------------------- button symbols (model units)

const V2 = (x, y) => new THREE.Vector2(x, y);
const ring = (outer, inner) => { const s = new THREE.Shape(outer); s.holes.push(new THREE.Path(inner.reverse())); return new THREE.ShapeGeometry(s); };
const tri = (r) => [V2(0, r), V2(-r * 0.866, -r / 2), V2(r * 0.866, -r / 2)];
const sq = (h) => [V2(-h, -h), V2(h, -h), V2(h, h), V2(-h, h)];
const cross = (a, t) => new THREE.ShapeGeometry(new THREE.Shape([
  V2(t, t), V2(a, t), V2(a, -t), V2(t, -t), V2(t, -a), V2(-t, -a),
  V2(-t, -t), V2(-a, -t), V2(-a, t), V2(-t, t), V2(-t, a), V2(t, a),
])).rotateZ(Math.PI / 4);
const arrow = (rot) => new THREE.ShapeGeometry(new THREE.Shape([V2(0, 0.022), V2(-0.02, -0.012), V2(0.02, -0.012)])).rotateZ(rot);
const SYMBOLS = {
  [BTN.triangle]: () => ring(tri(0.042), tri(0.027)).translate(0, -0.005, 0),
  [BTN.circle]: () => new THREE.RingGeometry(0.025, 0.036, 32),
  [BTN.cross]: () => cross(0.04, 0.0065),
  [BTN.square]: () => ring(sq(0.03), sq(0.019)),
  [BTN.up]: () => arrow(0),
  [BTN.down]: () => arrow(Math.PI),
  [BTN.left]: () => arrow(Math.PI / 2),
  [BTN.right]: () => arrow(-Math.PI / 2),
};

// ---------------------------------------------------------------- pressable parts

class Part {
  constructor(b) {
    Object.assign(this, KIND(b));
    this.b = b;
    this.root = new THREE.Group();   // sits at the part's pivot
    this.root.userData.b = b;
    this.mover = new THREE.Group();  // pressed / tilted / pulled
    this.root.add(this.mover);
    this.glow = new THREE.Color(GLOW[b] ?? PRESS_COLOR);
    this.glowMats = [];              // [material, strength, colour override]
    this.outline = makeOutlineMat();
    this.p = 0;                      // smoothed press amount, 0..1
  }
}

/** Index range of one part inside a mesh, as its own geometry sharing the mesh's vertex data. */
function subGeometry(geo, tris) {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) if (name !== '_part') g.setAttribute(name, attr);
  g.setIndex(tris);
  const pos = geo.attributes.position, box = new THREE.Box3(), v = new THREE.Vector3();
  for (const i of tris) box.expandByPoint(v.fromBufferAttribute(pos, i));
  g.boundingBox = box;
  g.computeBoundingSphere();
  return g;
}

/**
 * Load the DualSense model and cut it into its moving parts. Every vertex carries a _PART
 * attribute (button index + 1, or 0 for the shell), written by the model's preprocessing step.
 */
async function loadController() {
  const [gltf] = await Promise.all([
    new GLTFLoader().loadAsync(MODEL_URL),
    document.fonts?.load(LABEL_FONT).catch(() => {}),   // labels are drawn once, so wait for the font
  ]);
  const model = new THREE.Group();
  model.scale.setScalar(MODEL_SCALE);
  const parts = new Map();

  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const tag = geo.attributes._part;
    const index = geo.index.array;
    const byPart = new Map();
    for (let t = 0; t < index.length; t += 3) {
      const id = tag ? Math.round(tag.getX(index[t])) : 0;
      if (!byPart.has(id)) byPart.set(id, []);
      byPart.get(id).push(index[t], index[t + 1], index[t + 2]);
    }
    const color = PIECE_COLOR[mesh.name] ?? PIECE_COLOR[1011];
    const shared = hudMat(color);
    for (const [id, tris] of byPart) {
      const g = subGeometry(geo, tris);
      if (id === 0) { model.add(withOutline(new THREE.Mesh(g, shared))); continue; }
      const b = id - 1;
      if (!parts.has(b)) parts.set(b, new Part(b));
      const part = parts.get(b);
      const m = hudMat(color);
      part.glowMats.push([m, 1]);
      part.mover.add(withOutline(new THREE.Mesh(g, m), part.outline));
      part.box = part.box ? part.box.union(g.boundingBox) : g.boundingBox.clone();
    }
  }

  // Put each part's pivot where it moves from, add its symbol on top, then add it to the model.
  for (const part of parts.values()) {
    const { min, max } = part.box;
    const c = part.box.getCenter(new THREE.Vector3());
    const pivot = part.kind === 'trigger' ? new THREE.Vector3(c.x, max.y, max.z)       // hinge at the top front
      : part.kind === 'stick' ? new THREE.Vector3(c.x, c.y, min.z - 0.06)               // ball joint under the cap
        : c;
    part.root.position.copy(pivot);
    for (const m of part.mover.children) m.position.copy(pivot).negate();
    if (SYMBOLS[part.b]) {
      const sm = hudMat(SYMBOL_COLOR);
      part.glowMats.push([sm, 1, new THREE.Color(0xffffff)]);   // the symbol turns white
      const sym = new THREE.Mesh(SYMBOLS[part.b](), sm);
      sym.position.set(c.x - pivot.x, c.y - pivot.y, max.z - pivot.z + 0.004);
      sym.raycast = () => {};   // clicks go to the button underneath
      part.mover.add(sym);
    }
    // Glow halo just above the button, faded in while it's pressed.
    const size = part.box.getSize(new THREE.Vector3());
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: part.glow, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, depthTest: false, opacity: 0,   // drawn over the shell, never hidden by it
    }));
    // Face buttons glow from their top; shoulders and sticks glow from their middle, a bit bigger.
    const big = part.kind === 'trigger' || part.kind === 'bumper' || part.kind === 'stick';
    halo.position.set(c.x - pivot.x, c.y - pivot.y, (big ? c.z : max.z) - pivot.z + 0.02);
    halo.userData.size = Math.min(Math.max(size.x, size.y, size.z) * 2.6, big ? 0.42 : 0.34);
    halo.raycast = () => {};
    halo.renderOrder = 10;
    part.halo = halo;
    part.mover.add(halo);
    if (SHOULDER_LABEL[part.b]) {
      // Printed flat on the button: L1/R1 on the bumper, L2/R2 on the trigger's upper face.
      const aim = c.clone().add(new THREE.Vector3(0, part.kind === 'trigger' ? size.y * 0.25 : 0, 0));
      stickLabel(part, labelDecal(SHOULDER_LABEL[part.b]), aim);
    }
    model.add(part.root);
  }
  return { model, parts: [...parts.values()] };
}

// ---------------------------------------------------------------- the HUD

export class PadView {
  constructor(input, root) {
    this.input = input;
    this.root = root;
    root.innerHTML = `
      <canvas class="pad-canvas"></canvas>
      <div class="pad-half pad-left" aria-hidden="true"></div>
      <div class="pad-half pad-right" aria-hidden="true"></div>`;
    const canvas = root.querySelector('canvas');
    this.halves = [
      { el: root.querySelector('.pad-left'), cam: new THREE.PerspectiveCamera(32, 1, 1, 100), side: -1 },
      { el: root.querySelector('.pad-right'), cam: new THREE.PerspectiveCamera(32, 1, 1, 100), side: 1 },
    ];
    for (const h of this.halves) {
      const target = new THREE.Vector3(h.side * 4.3, 0.2, 0);
      h.cam.position.set(h.side * 7.2, 4.5, 18.5);
      h.cam.lookAt(target);
    }

    // This is a second WebGL context covering the whole screen, so keep it lean: on low-end
    // devices (see main.js) no MSAA and 1× resolution, which cuts its GPU memory several times over.
    const lowEnd = document.documentElement.classList.contains('low-end');
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !lowEnd, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1 : 1.5));
    this.target = new Map(); // reused every frame
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();

    this.parts = [];
    this.pickables = [];
    this.raycaster = new THREE.Raycaster();
    loadController().then(({ model, parts }) => {
      model.rotation.x = 0.5;    // tip the top edge toward the camera so L1/L2/R1/R2 face it
      this.scene.add(model);
      this.parts = parts;
      model.traverse((o) => { if (o.isMesh) this.pickables.push(o); });
    }).catch((err) => console.warn('Controller model failed to load', err));

    this.down = new Map();      // on-screen buttons held: index -> number of pointers on it
    this.pointers = new Map();  // pointerId -> { b, x0, y0 }
    this.drag = { x: 0, y: 0 }; // on-screen left stick
    this.sticks = { [L3]: { x: 0, y: 0 }, [R3]: { x: 0, y: 0 } };
    for (const h of this.halves) this.bindPointer(h);

    let pref = null;
    try { pref = localStorage.getItem(PREF_KEY); } catch {}
    this.enabled = pref !== 'off';
    root.classList.toggle('off', !this.enabled);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.root.classList.toggle('off', !this.enabled);
    try { localStorage.setItem(PREF_KEY, this.enabled ? 'on' : 'off'); } catch {}
    return this.enabled;
  }

  /** Which button (if any) is under a point inside one half. */
  pick(h, e) {
    const r = h.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, h.cam);
    for (const hit of this.raycaster.intersectObjects(this.pickables, false)) {
      for (let o = hit.object; o; o = o.parent) if (o.userData.b !== undefined) return o.userData.b;
      return undefined; // hit the body first
    }
    return undefined;
  }

  bindPointer(h) {
    const el = h.el;
    const release = (e) => {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) return;
      this.pointers.delete(e.pointerId);
      const n = (this.down.get(ptr.b) || 1) - 1;
      n > 0 ? this.down.set(ptr.b, n) : this.down.delete(ptr.b);
      if (ptr.b === L3) this.drag = { x: 0, y: 0 };
      this.sync();
    };
    el.addEventListener('pointerdown', (e) => {
      const b = this.pick(h, e);
      if (b === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { b, x0: e.clientX, y0: e.clientY });
      this.down.set(b, (this.down.get(b) || 0) + 1);
      this.sync();
    });
    el.addEventListener('pointermove', (e) => {
      const ptr = this.pointers.get(e.pointerId);
      if (ptr?.b !== L3) return;
      let x = (e.clientX - ptr.x0) / DRAG_RADIUS, y = (e.clientY - ptr.y0) / DRAG_RADIUS;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.drag = { x, y };
      this.sync();
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  /** Turn the on-screen buttons that are held into game actions (fires new presses at once). */
  sync() {
    const now = new Set();
    for (const b of this.down.keys()) for (const a of PRESS[b] || []) now.add(a);
    const { x, y } = this.drag;
    if (x < -DRAG_DEAD) now.add('left');
    if (x > DRAG_DEAD) now.add('right');
    if (y < -0.6) now.add('up');
    if (y > 0.6) now.add('down');

    const input = this.input;
    for (const a of now) {
      if (input.screenHeld.has(a)) continue;
      if (GAME_KEYS.has(a)) input.queue.add(a);
      input.onAction?.(a, 'pad');
    }
    input.screenHeld = now;
  }

  /** Called every frame: move and light whatever is pressed, then draw both halves. */
  update(dt = 1 / 60) {
    const cl = this.root.classList;
    const gp = this.input.pad;
    // Only shown while a controller (USB or Bluetooth) is connected. Phones use the plain touch
    // buttons in touchpad.js instead.
    const show = !!gp;
    cl.toggle('nopad', !show);
    if (!show && this.down.size) {   // let go of anything held on screen when it disappears
      this.down.clear();
      this.pointers.clear();
      this.drag = { x: 0, y: 0 };
      this.sync();
    }
    if (!show || cl.contains('off') || cl.contains('hidden') || !this.parts.length) { this.lastKey = null; return; }  // redraw once shown again

    const target = this.target;  // button -> 0..1
    target.clear();
    const set = (b, v) => target.set(b, Math.max(target.get(b) || 0, v));
    for (const b of this.down.keys()) set(b, 1);
    const analog = (i) => i === BTN.l2 || i === BTN.r2;
    if (gp) gp.buttons.forEach((bt, i) => {
      if (!bt) return;
      if (analog(i)) set(i, bt.value);       // triggers move as far as they're pulled
      else if (bt.pressed) set(i, 1);
    });
    for (const [action, b] of Object.entries(KEY_LIGHTS)) if (this.input.keyHeld(action)) set(b, 1);

    const k = 1 - Math.exp(-dt * 28);
    const ax = (i) => (gp ? gp.axes[i] ?? 0 : 0);
    const L = Math.hypot(ax(0), ax(1)) > Math.hypot(this.drag.x, this.drag.y) ? { x: ax(0), y: ax(1) } : this.drag;
    const stickTarget = { [L3]: L, [R3]: { x: ax(2), y: ax(3) } };

    let key = '';
    for (const p of this.parts) {
      const t = target.get(p.b) || 0;
      p.p += (t - p.p) * k;
      if (p.p < 0.001) p.p = 0;
      if (p.kind === 'push') p.mover.position.z = -p.travel * p.p;
      else if (p.kind === 'bumper') p.mover.position.y = -p.travel * p.p;
      else if (p.kind === 'trigger') p.mover.rotation.x = -0.22 * p.p;   // pulled back as far as it's squeezed (stays in view)
      else if (p.kind === 'stick') {
        const s = this.sticks[p.b], g = stickTarget[p.b];
        s.x += (g.x - s.x) * k;
        s.y += (g.y - s.y) * k;
        p.mover.rotation.set(s.y * STICK_TILT, s.x * STICK_TILT, 0);
        p.mover.position.z = -p.travel * p.p;
      }
      // Sticks glow while tilted as well as when clicked in.
      const glow = p.kind === 'stick'
        ? Math.max(p.p, Math.min(1, Math.max(0, Math.hypot(this.sticks[p.b].x, this.sticks[p.b].y) - 0.15) * 1.6))  // deadzone ignores drift
        : p.p;
      for (const [m, amt, col] of p.glowMats) {
        m.uniforms.uGlow.value.copy(col ?? p.glow);
        m.uniforms.uPress.value = glow * amt;
      }
      p.outline.uniforms.uColor.value.copy(OUTLINE_BASE).lerp(p.glow, glow);
      p.outline.uniforms.uWidth.value = OUTLINE_WIDTH * (1 + 1.6 * glow);
      p.halo.material.opacity = glow;
      p.halo.scale.setScalar(p.halo.userData.size * (0.7 + 0.3 * glow));
      p.halo.visible = glow > 0.01;
      key += glow.toFixed(3) + p.p.toFixed(3) + (p.kind === 'stick' ? this.sticks[p.b].x.toFixed(3) + this.sticks[p.b].y.toFixed(3) : '');
    }

    // Only redraw when something moved (idle frames cost nothing).
    key += `${innerWidth}x${innerHeight}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.render();
  }

  render() {
    const r = this.renderer;
    const W = innerWidth, H = innerHeight;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H) r.setSize(W, H, false);
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    for (const h of this.halves) {
      const b = h.el.getBoundingClientRect();
      if (!b.width) continue;
      const y = H - b.bottom;
      r.setViewport(b.left, y, b.width, b.height);
      r.setScissor(b.left, y, b.width, b.height);
      if (h.cam.aspect !== b.width / b.height) {
        h.cam.aspect = b.width / b.height;
        h.cam.updateProjectionMatrix();
      }
      r.render(this.scene, h.cam);
    }
  }
}
