// Procedural remix of level 1. Every new run (first play, game over, "play again") gets a
// fresh level 1 layout so it doesn't feel the same every time. It outputs plain level data in the exact
// format of levels/level1.json, so buildLevel() bakes/merges it like any hand-made level: no extra
// meshes, assets or memory, and generating it is a few hundred cheap operations.
//
// The layout is stitched from small hand-tuned "chunks" (a gap, a ledge climb, a moving log, a vine
// swing, ...) picked in a shuffled order. Each chunk keeps its gaps and heights inside what a walking
// jump can clear (about 6 units across, 3.4 up), so every remix can be finished.
// The same seed always gives the same layout, so "Restart level" replays the layout you're on.

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEVEL_END = 128; // keep adding chunks until the course reaches this x (hand-made level: ~126)

export function remixLevel(base, seed) {
  const rand = mulberry32(seed);
  const between = (a, b) => a + rand() * (b - a);
  const half = (v) => Math.round(v * 2) / 2; // snap to 0.5 for tidy layouts
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const platforms = [], mushrooms = [], vines = [], checkpoints = [], powerups = [], enemies = [], bananaLines = [];
  let x = 0, y = 0; // right edge and top of the last ground segment

  const bananas = (bx, by, n, dx = 1.2) => bananaLines.push([half(bx), by, n, dx]);
  const enemy = (type, l, r, gy) => {
    const lo = l + 3, hi = r - 1; // keep clear of the landing spot
    if (hi - lo < 3) return;
    enemies.push({ type, x: half((lo + hi) / 2), y: gy, range: [half(lo), half(hi)] });
  };
  /** Jump a gap onto a new ground segment. Returns its left edge. */
  const land = (gap, w, newY = y) => {
    const l = half(x + gap);
    y = newY;
    platforms.push({ x: l, y, w: half(w) });
    x = l + half(w);
    if (!checkpoints.length && l > 62) checkpoints.push([l + 1.5, y]); // roughly halfway
    if (w > 12) bananas(x - 5, y + 1, 3); // a few at the far end of each landing (sprint refills)
    return l;
  };

  // --- start: wide safe ground (the monkey spawns at x=0), then one of several openers so the very
  // first screen already looks different from run to run.
  const startW = half(between(26, 34));
  platforms.push({ x: -8, y: 0, w: startW });
  x = -8 + startW;
  bananas(half(between(2, 3.5)), 1, pick([2, 3, 4]));
  const OPENERS = [
    () => { // two ledges climbing to the Super Banana
      const l1x = half(between(4.5, 8)), l1w = pick([3, 4]), l1y = pick([2.5, 3]);
      platforms.push({ x: l1x, y: l1y, w: l1w, type: 'ledge' });
      const l2x = half(l1x + l1w + between(1.5, 2.5)), l2y = l1y + pick([2, 2.5]);
      platforms.push({ x: l2x, y: l2y, w: 4, type: 'ledge' });
      powerups.push([l2x + 2, l2y + 0.9]);
      bananas(l1x + 0.6, l1y + 1, l1w - 1);
    },
    () => { // a mushroom bounce up to a high ledge holding the Super Banana
      const mx = half(between(6, 9));
      mushrooms.push([mx, 0]);
      const lx = half(mx + between(2, 3)), ly = pick([7, 7.5, 8]);
      platforms.push({ x: lx, y: ly, w: 5, type: 'ledge' });
      powerups.push([lx + 2.5, ly + 0.9]);
      bananas(lx + 0.6, ly + 1, 2);
    },
    () => { // a staircase of blocks, Super Banana floating above the top step
      let bx = half(between(5, 8));
      const steps = pick([2, 3]);
      for (let i = 0; i < steps; i++) {
        const h = 1.5 * (i + 1);
        platforms.push({ x: bx, y: h, w: 2.5, h, type: 'block' });
        bananas(bx + 0.6, h + 1, 2);
        bx += 2.5;
      }
      powerups.push([bx - 1.25, 1.5 * steps + 2.5]);
    },
    () => { // a single high ledge reached from a block, Super Banana on top
      const bx = half(between(5, 8));
      platforms.push({ x: bx, y: 1.5, w: 3, h: 1.5, type: 'block' });
      const lx = half(bx + between(3.5, 4.5)), ly = pick([4, 4.5]);
      platforms.push({ x: lx, y: ly, w: pick([4, 5]), type: 'ledge' });
      powerups.push([lx + 2, ly + 0.9]);
      bananas(bx + 0.4, 2.5, 2);
    },
  ];
  pick(OPENERS)();
  // The first enemy patrols the ground past the opener's blocks (never spawns inside one).
  const blockEnd = platforms.reduce((m, p) => (p.type === 'block' ? Math.max(m, p.x + p.w) : m), 10);
  const lo = half(blockEnd + 1), hi = half(x - 2);
  if (hi - lo >= 4) {
    enemies.push({ type: rand() < 0.65 ? 'walker' : 'hopper', x: half(between(lo + 1, hi - 1)), y: 0, range: [lo, hi] });
  }

  // --- chunks
  const CHUNKS = {
    hop() { // a plain gap, sometimes a step up or down
      const gap = between(2.5, 4), fromY = y, fromX = x;
      const l = land(gap, between(10, 16), fromY === 0 ? pick([0, 0, 1.5]) : pick([0, 1.5]));
      bananas(fromX + (l - fromX) / 2 - 1.2, Math.max(fromY, y) + 2.6, 3);
      if (rand() < 0.7) enemy('walker', l, x, y);
    },
    ledges() { // climb a ledge or two above a walker
      const l = land(between(2.5, 3.5), between(16, 20));
      const lx = half(l + between(3, 5)), ly = y + 3, lw = pick([3, 4, 5]);
      platforms.push({ x: lx, y: ly, w: lw, type: 'ledge' });
      bananas(lx + 0.6, ly + 1, lw - 1);
      if (rand() < 0.6 && lx + lw + 6.5 < x) {
        const hx = half(lx + lw + between(1.5, 2.5));
        platforms.push({ x: hx, y: ly + 2.5, w: 4, type: 'ledge' });
        bananas(hx + 0.6, ly + 3.5, 3);
      }
      if (rand() < 0.6) enemy('walker', l, x, y);
    },
    ferry() { // a wide water gap crossed on a drifting log
      const gap = half(between(11, 13)), lx = x + 1.5;
      platforms.push({ x: lx, y: 0.4, w: 4, type: 'log', move: [gap - 7, 0], speed: 0.45 });
      bananas(lx + 1, 2.5, 4, (gap - 5) / 3);
      land(gap, between(12, 16), 0);
    },
    vine() { // swing across on a vine (a sprint jump also makes it)
      const fromY = y, vx = x + 3;
      vines.push({ x: vx, y: fromY + 7.5, len: 5.5 });
      bananas(vx - 1.2, fromY + 4, 3);
      const l = land(6, between(12, 18), 0);
      if (rand() < 0.5) enemy('walker', l, x, y);
    },
    mushroom() { // bounce up to a high ledge full of bananas
      const l = land(between(2.5, 3.5), between(19, 22));
      mushrooms.push([l + 4.5, y]);
      platforms.push({ x: l + 7, y: y + 8, w: 6, type: 'ledge' });
      bananas(l + 7.6, y + 9, 5);
      enemy('hopper', l + 8, x, y);
    },
    thrower() { // a coconut thrower on a raised block
      const l = land(between(2.5, 3.5), between(14, 17));
      const bx = half(l + between(5, 7));
      platforms.push({ x: bx, y: y + 1.5, w: 3, h: 1.5, type: 'block' });
      enemies.push({ type: 'thrower', x: bx + 1.5, y: y + 1.5 });
      bananas(bx + 4, y + 1, Math.min(4, Math.floor(x - bx - 5)));
    },
    blocks() { // hop over a block with a hopper behind it
      const l = land(between(2.5, 3.5), between(15, 18));
      const bx = half(l + between(4, 6));
      platforms.push({ x: bx, y: y + 1.5, w: 2.5, h: 1.5, type: 'block' });
      bananas(bx + 0.4, y + 2.5, 2);
      enemy('hopper', bx + 1.5, x, y);
    },
  };

  // Deal the chunks like a shuffled deck so each remix gets a varied mix without repeats back to back.
  let deck = [], last = '';
  const draw = () => {
    if (!deck.length) {
      deck = ['ledges', 'ferry', 'vine', 'mushroom', 'thrower', 'blocks', 'hop', 'hop'];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      if (deck[deck.length - 1] === last) deck.unshift(deck.pop()); // drawn from the end
    }
    return (last = deck.pop());
  };
  while (x < LEVEL_END) CHUNKS[draw()]();

  // --- finish: a long run-out to the golden banana tree
  const fl = land(3, 30, 0);
  bananas(fl + 2, 1, 5);
  enemy('walker', fl + 4, x - 8, 0);
  if (!checkpoints.length) checkpoints.push([fl + 1.5, 0]);

  return {
    name: base.name,
    par: base.par,
    theme: base.theme,
    seed, // also varies the scenery (palms, bushes, clouds)
    remix: true,
    bounds: [-8, x],
    spawn: [0, 0],
    goal: [x - 6, 0],
    platforms, mushrooms, vines, checkpoints, powerups, enemies, bananaLines,
  };
}
