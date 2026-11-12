// Losing a life (with lives to spare): the monkey becomes a little angel — a halo drops onto
// its head, wings sprout — and it flies back to the last checkpoint.
import * as THREE from 'three';

const DAZE = 0.6;        // knocked silly
const TRANSFORM = 0.9;   // halo + wings appear
const SETTLE = 0.65;     // lands, wings fold away, halo floats off
const HALO_Y = 0.66;     // above the head centre

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, a, b) => clamp01((t - a) / (b - a));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutBack = (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

// ---------------------------------------------------------------- ghost shader
// A copy of each of the monkey's materials with a ghost look patched in: pale and see-through,
// a glowing rim (fresnel) and faint wisps drifting up the body. uGhost blends it in (0..1).
const ghost = { uGhost: { value: 0 }, uTime: { value: 0 } };

function ghostMaterial(orig) {
  const g = orig.clone();
  g.transparent = true;
  g.customProgramCacheKey = () => 'ghost';
  g.onBeforeCompile = (sh) => {
    sh.uniforms.uGhost = ghost.uGhost;
    sh.uniforms.uTime = ghost.uTime;
    sh.vertexShader = 'varying vec3 vGhostPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vGhostPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const out = sh.fragmentShader.includes('#include <opaque_fragment>') ? '#include <opaque_fragment>' : '#include <output_fragment>';
    sh.fragmentShader = 'uniform float uGhost;\nuniform float uTime;\nvarying vec3 vGhostPos;\n'
      + sh.fragmentShader.replace(out, `${out}
  {
    vec3 vdir = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(abs(dot(normal, vdir)), 0.0, 1.0), 2.2);
    float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
    float wisp = 0.5 + 0.5 * sin(vGhostPos.y * 9.0 - uTime * 4.0 + sin(vGhostPos.x * 5.0 + uTime * 1.3) * 1.6);
    float flicker = 0.92 + 0.08 * sin(uTime * 23.0 + vGhostPos.y * 3.0);
    vec3 col = vec3(0.82, 0.9, 1.0) * (0.5 + lum * 0.7)   // keeps the face readable
      + vec3(0.7, 0.86, 1.0) * fres * 1.6                // glowing outline
      + vec3(0.9, 0.95, 1.0) * wisp * 0.1;
    float a = (0.38 + fres * 0.55 + wisp * 0.1) * flicker;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, col * flicker, uGhost);
    gl_FragColor.a = mix(gl_FragColor.a, a, uGhost);
  }`);
  };
  return g;
}

function wingShape(s = 1) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.bezierCurveTo(0.15 * s, 0.45 * s, 0.55 * s, 0.78 * s, 0.98 * s, 0.72 * s); // top edge to the tip
  sh.quadraticCurveTo(0.92 * s, 0.5 * s, 0.8 * s, 0.43 * s);                     // scalloped feathers
  sh.quadraticCurveTo(0.76 * s, 0.25 * s, 0.62 * s, 0.25 * s);
  sh.quadraticCurveTo(0.54 * s, 0.06 * s, 0.42 * s, 0.11 * s);
  sh.quadraticCurveTo(0.32 * s, -0.07 * s, 0.21 * s, -0.01 * s);
  sh.quadraticCurveTo(0.1 * s, -0.12 * s, 0, 0);
  return sh;
}

function buildWing(sx, outerM, innerM) {
  const pivot = new THREE.Group();
  pivot.position.set(sx * 0.12, 0.9, -0.27);
  const mirror = new THREE.Group();
  mirror.scale.x = sx; // right wing as built, left wing mirrored
  const outer = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape(1), { depth: 0.03, bevelEnabled: false }), outerM);
  const inner = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape(0.68), { depth: 0.02, bevelEnabled: false }), innerM);
  inner.position.set(0.04, 0.1, 0.03);
  outer.castShadow = inner.castShadow = true;
  mirror.add(outer, inner);
  pivot.add(mirror);
  pivot.scale.setScalar(0.001);
  pivot.visible = false;
  return pivot;
}

export class Angel {
  /** hooks: { effects, sound, haptic(name) } */
  constructor(player, hooks) {
    this.hooks = hooks;
    const m = player.model;

    // Every monkey mesh (collected before the halo and wings are attached) gets a ghost twin material.
    const twins = new Map();
    this.parts = [];
    m.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!twins.has(o.material)) twins.set(o.material, ghostMaterial(o.material));
      this.parts.push({ mesh: o, orig: o.material, ghost: twins.get(o.material), cast: o.castShadow });
    });
    this.ghosted = false;

    const haloM = new THREE.MeshStandardMaterial({
      color: 0xffe066, emissive: 0xffc21a, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.2,
    });
    this.halo = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 10, 32), haloM);
    ring.rotation.x = Math.PI / 2 - 0.45; // tipped toward the camera so the ring reads clearly
    ring.castShadow = true;
    this.halo.add(ring);
    this.halo.visible = false;
    m.head.add(this.halo);

    const outerM = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide,
    });
    const innerM = new THREE.MeshStandardMaterial({
      color: 0xdff1ff, emissive: 0xcfe9ff, emissiveIntensity: 0.25, roughness: 0.6, side: THREE.DoubleSide,
    });
    this.wings = [-1, 1].map((sx) => {
      const w = buildWing(sx, outerM, innerM);
      w.userData.sx = sx;
      m.body.add(w);
      return w;
    });
    this.active = false;
  }

  /** Begins the sequence; returns how long it lasts (seconds). */
  start(player, checkpoint, waterY) {
    const x0 = player.x;
    const y0 = Math.max(player.y, waterY - 0.3); // fell in the water: rise back out of it
    player.y = y0;
    const x1 = checkpoint.x, y1 = checkpoint.y;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const fly = Math.min(3.2, Math.max(1.1, dist / 10));
    const fy0 = y0 + 0.8; // where the transformation leaves it hovering
    Object.assign(this, {
      active: true, t: 0, p: player, x0, y0, x1, y1, fly,
      cx: (x0 + x1) / 2, cy: Math.max(fy0, y1) + 2.5 + Math.min(4, dist * 0.08), fy0,
      dir: Math.sign(x1 - x0) || 1, flap: 0, trailT: 0, glowT: 0, transformed: false, landed: false,
    });
    this.T1 = DAZE;
    this.T2 = DAZE + TRANSFORM;
    this.T3 = this.T2 + fly;
    this.T4 = this.T3 + SETTLE;
    this.hooks.effects.stars(x0, y0 + 1.4);
    this.setGear(0, 0, 0);
    return this.T4 + 0.1;
  }

  /** 0 = normal living monkey, 1 = full ghost. */
  setGhost(k) {
    ghost.uGhost.value = k;
    const on = k > 0.001;
    if (on === this.ghosted) return;
    this.ghosted = on;
    for (const p of this.parts) {
      p.mesh.material = on ? p.ghost : p.orig;
      p.mesh.castShadow = on ? false : p.cast; // ghosts don't cast shadows
    }
  }

  setGear(halo, wings, haloLift) {
    this.halo.visible = halo > 0.01;
    this.halo.scale.setScalar(Math.max(0.001, halo));
    this.halo.position.y = HALO_Y + haloLift;
    for (const w of this.wings) {
      w.visible = wings > 0.01;
      w.scale.setScalar(Math.max(0.001, wings));
    }
  }

  update(dt) {
    if (!this.active) return;
    const p = this.p, { effects, sound, haptic } = this.hooks;
    this.t += dt;
    const t = this.t, { T1, T2, T3, T4 } = this;
    ghost.uTime.value = t;
    // Turns ghostly as the halo arrives, comes back to life as it lands.
    this.setGhost(t < T3 ? easeOut(span(t, T1, T1 + 0.6)) : 1 - easeInOut(span(t, T3, T4)));
    let flapRate = 9, flapAmp = 0.45;

    if (t < T1) {
      // Dazed wobble.
      const k = t / T1;
      p.deadMode = 'limp';
      p.y = this.y0 + Math.sin(k * Math.PI) * 0.35;
      p.deadRotZ = Math.sin(t * 14) * 0.2 * (1 - k);
    } else if (t < T2) {
      // Halo descends onto the head, wings unfurl, the monkey lifts off the ground.
      if (!this.transformed) {
        this.transformed = true;
        sound.angel?.();
        haptic('grow');
        for (const c of [0xfff176, 0xffffff]) {
          effects.burst(p.x, p.y + 0.9, c, 10, { speed: 3.5, up: 2, life: 0.8, gravity: -1.5, z: 0.7 });
        }
      }
      const k = span(t, T1, T2);
      p.deadMode = k > 0.25 ? 'angel' : 'limp';
      p.deadRotZ = 0;
      p.y = lerp(this.y0, this.fy0, easeOut(k));
      this.setGear(easeOutBack(span(t, T1, T1 + 0.5)), easeOutBack(span(t, T1 + 0.25, T2)),
        (1 - easeOut(span(t, T1, T1 + 0.5))) * 1.1);
      this.halo.rotation.y += dt * 4;
      if ((this.glowT -= dt) <= 0) {
        this.glowT = 0.06;
        const a = Math.random() * Math.PI * 2;
        effects.burst(p.x + Math.cos(a) * 0.8, p.y + 0.8 + Math.sin(a) * 0.8, 0xfff8c4, 1,
          { speed: 0.5, up: 0.5, life: 0.6, gravity: -2, z: 0.7 });
      }
    } else if (t < T3) {
      // Fly an arc back to the checkpoint.
      const k = easeInOut(span(t, T2, T3)), u = 1 - k;
      p.deadMode = 'angel';
      p.x = u * u * this.x0 + 2 * u * k * this.cx + k * k * this.x1;
      p.y = u * u * this.fy0 + 2 * u * k * this.cy + k * k * this.y1;
      const lean = Math.sin(span(t, T2, T3) * Math.PI);
      p.deadRotY = this.dir * 0.7 * lean;
      p.deadRotZ = -this.dir * 0.25 * lean;
      this.setGear(1, 1, Math.sin(t * 5) * 0.04);
      flapRate = 18; flapAmp = 0.6;
      if ((this.trailT -= dt) <= 0) {
        this.trailT = 0.045;
        effects.burst(p.x - this.dir * 0.3, p.y + 0.8, Math.random() < 0.5 ? 0xffffff : 0xfff176, 1,
          { speed: 0.6, up: 0.4, life: 0.7, gravity: 1, z: 0.3 });
      }
    } else {
      // Touch down: wings fold away, halo floats up and vanishes.
      if (!this.landed) {
        this.landed = true;
        p.x = this.x1; p.y = this.y1;
        sound.chime?.();
        haptic('checkpoint');
        effects.dust(p.x, p.y);
        effects.burst(p.x, p.y + 1, 0xffffff, 12, { speed: 3, up: 3, life: 0.7, gravity: 2, z: 0.7 });
      }
      const k = span(t, T3, T4);
      p.deadMode = k > 0.4 ? 'idle' : 'angel';
      p.deadRotY = 0;
      p.deadRotZ = 0;
      this.setGear(1 - easeIn(k), 1 - easeIn(span(t, T3, T3 + SETTLE * 0.7)), easeIn(k) * 0.8);
    }

    // Flap.
    this.flap += dt * flapRate;
    const f = Math.sin(this.flap) * flapAmp;
    for (const w of this.wings) {
      const sx = w.userData.sx;
      w.rotation.y = sx * (0.35 + f);
      w.rotation.z = sx * f * 0.5;
    }
  }

  reset() {
    this.active = false;
    this.setGear(0, 0, 0);
    this.setGhost(0);
  }
}
