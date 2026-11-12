// Box physics shared by the player and enemies.
// A body has x (center), y (feet), w, h, vx, vy. Solids are {l, r, b, t, dx, dy}.
// Every solid blocks from all four sides.

export const GRAVITY = 38;
const EPS = 0.005;

export function moveBody(b, dt, solids) {
  // Ride along with the platform we stood on last step.
  if (b.ground) { b.x += b.ground.dx; b.y += b.ground.dy; }
  const hw = b.w / 2;

  // Horizontal pass: walls. carryVx is momentum kept from a moving platform jumped off.
  b.x += (b.vx + (b.carryVx || 0)) * dt;
  b.hitWall = 0;
  for (const s of solids) {
    // Compare against where a moving platform's top was before this step: one that just rose
    // into the feet of a body standing on it is a floor (the vertical pass lifts the body), not a
    // wall to shove it sideways off the edge.
    const top = s.t - Math.max(0, s.dy);
    if (b.x - hw < s.r && b.x + hw > s.l && b.y < top - 0.01 && b.y + b.h > s.b + 0.01) {
      if (b.x < (s.l + s.r) / 2) { b.x = s.l - hw; b.hitWall = 1; }
      else { b.x = s.r + hw; b.hitWall = -1; }
      if (Math.sign(b.vx) === b.hitWall) b.vx = 0;
    }
  }

  // Vertical pass: floors and ceilings.
  const prevY = b.y;
  b.y += b.vy * dt;
  b.onGround = false;
  b.ground = null;
  b.hitCeil = false;
  for (const s of solids) {
    if (!(b.x - hw < s.r && b.x + hw > s.l)) continue;
    if (!(b.y < s.t && b.y + b.h > s.b)) continue;
    if (b.vy <= 0 && prevY >= s.t - Math.max(0, s.dy) - 0.02) {
      b.y = s.t; b.vy = 0; b.onGround = true; b.ground = s;
    } else if (b.vy > 0 && prevY + b.h <= s.b - Math.min(0, s.dy) + 0.05) {
      b.y = s.b - b.h; b.vy = 0; b.hitCeil = true;
    }
  }

  resolveOverlaps(b, solids);
}

/** Safety net: push a body out of any solid it still overlaps, along the shortest way out. */
export function resolveOverlaps(b, solids) {
  const hw = b.w / 2;
  let fixed = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const s of solids) {
      const pushL = b.x + hw - s.l;   // move left to get out
      const pushR = s.r - (b.x - hw); // move right
      const pushU = s.t - b.y;        // move up
      const pushD = b.y + b.h - s.b;  // move down
      if (pushL <= EPS || pushR <= EPS || pushU <= EPS || pushD <= EPS) continue;
      const m = Math.min(pushL, pushR, pushU, pushD);
      if (m === pushU) {
        b.y = s.t;
        if (b.vy < 0) b.vy = 0;
        b.onGround = true;
        b.ground = s;
      } else if (m === pushD) {
        b.y = s.b - b.h;
        if (b.vy > 0) b.vy = 0;
        b.hitCeil = true;
      } else if (m === pushL) {
        b.x = s.l - hw;
        if (b.vx > 0) b.vx = 0;
        b.hitWall = 1;
      } else {
        b.x = s.r + hw;
        if (b.vx < 0) b.vx = 0;
        b.hitWall = -1;
      }
      moved = fixed = true;
    }
    if (!moved) break;
  }
  return fixed;
}

export function overlapsAny(b, solids, margin = EPS) {
  const hw = b.w / 2;
  return solids.some((s) => b.x + hw - s.l > margin && s.r - (b.x - hw) > margin
    && s.t - b.y > margin && b.y + b.h - s.b > margin);
}

export function solidAt(x, y, solids) {
  return solids.some((s) => x >= s.l && x <= s.r && y >= s.b && y <= s.t);
}
