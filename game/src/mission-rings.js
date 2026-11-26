// mission-rings.js — the Viper Gorge ring trial: ten golden gates threaded
// down the canyon, scored on a 180-second clock, plus the runway-landing bonus.
// Ring positions follow the river's S-curve so the fast line is the scenic line.
'use strict';

const RING_CENTRES = [
  [10, 42, -60], [-26, 36, -210], [30, 48, -360], [-14, 30, -510], [22, 44, -660],
  [-30, 34, -800], [12, 52, -940], [-8, 38, -1090], [26, 46, -1240], [0, 40, -1400],
];
const RING_RADIUS = 17, TRIAL_SECONDS = 180;

class RingTrial {
  constructor() { this.reset(); }
  reset() {
    this.next = 0; this.passed = 0; this.timeLeft = TRIAL_SECONDS;
    this.elapsed = 0; this.score = 0; this.finished = false; this.landedBonus = false;
  }
  // Returns 'pass' | 'miss' | null for the frame's movement segment.
  update(dt, prev, pos, freeFlight) {
    if (this.finished || freeFlight) return null;
    this.elapsed += dt; this.timeLeft = Math.max(0, TRIAL_SECONDS - this.elapsed);
    if (this.next >= RING_CENTRES.length) return null;
    const c = RING_CENTRES[this.next];
    // Plane crossing test on the segment prev->pos against the ring's z-plane.
    const dz0 = prev[2] - c[2], dz1 = pos[2] - c[2];
    if (dz0 === 0 || dz0 * dz1 > 0) return null;
    const t = dz0 / (dz0 - dz1);
    const x = prev[0] + (pos[0] - prev[0]) * t, y = prev[1] + (pos[1] - prev[1]) * t;
    const d = Math.hypot(x - c[0], y - c[1]);
    this.next++;
    if (d <= RING_RADIUS) {
      this.passed++;
      const timeBonus = Math.round(this.timeLeft * 2);
      this.score += 1000 + timeBonus;
      if (this.next >= RING_CENTRES.length) this.finished = true;
      return 'pass';
    }
    return 'miss';
  }
  awardLanding() {
    if (this.landedBonus) return 0;
    this.landedBonus = true; this.score += 2500;
    return 2500;
  }
}

// Torus-like gate built from segments; next ring glows hot gold, the rest amber.
function buildRingGeometry(centre, isNext) {
  const b = new GeoBuilder();
  const col = isNext ? [1.0, 0.78, 0.16] : [0.85, 0.55, 0.18];
  const seg = 22, tube = 1.15;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a, r) => [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r, centre[2]];
    b.quad(p(a0, RING_RADIUS - tube), p(a1, RING_RADIUS - tube), p(a1, RING_RADIUS + tube), p(a0, RING_RADIUS + tube),
      col, { emissive: isNext ? 0.95 : 0.45, rough: 0.4, metal: 0.4 });
  }
  if (isNext) b.halo(centre[0], centre[1], centre[2], RING_RADIUS * 1.15, [1.0, 0.72, 0.2]);
  return b;
}
