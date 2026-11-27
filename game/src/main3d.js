// main3d.js — Canyon Viper v4 game loop on Three.js.
// Golden-hour sky dome + matched fog, a pooled particle system (ring bursts,
// contrails, sparks, fireballs, dust, missile smoke), fireable missiles and a
// Target Strike second act, combo scoring with medal tiers, boost FOV kick
// and a lagging look-ahead chase camera. ACES grade, soft shadows, offline.
'use strict';

// ---------- renderer / scene / light rig --------------------------------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8b98a);
scene.fog = new THREE.FogExp2(0xeac493, 0.00034);   // fog colour = sky horizon colour
{
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#6f9fd8'); g.addColorStop(0.42, '#cfd9e2'); g.addColorStop(0.55, '#f6cf96');
  g.addColorStop(0.62, '#e0a55e'); g.addColorStop(1, '#8a5f33');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  const env = new THREE.CanvasTexture(cv);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.SRGBColorSpace;
  scene.environment = env;
}
const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 9000);

const hemi = new THREE.HemisphereLight(0xcfe0f4, 0x9a6b40, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9a3, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);

const sky = buildSky(scene);   // dome + sun sprite + cloud layer + cloud shadows
const world = buildWorld3D(scene);
const targets = buildTargets(scene);
const { jet, gear, burners, wingtips, missiles: wingMissiles } = buildJet3D();
scene.add(jet);
const cockpitApi = buildCockpit3D();
const cockpit = cockpitApi.group;
scene.add(cockpit);

// ---------- rings ---------------------------------------------------------------
const RING_CENTRES = [
  [10, 42, -60], [-26, 36, -210], [30, 48, -360], [-14, 30, -510], [22, 44, -660],
  [-30, 34, -800], [12, 52, -940], [-8, 38, -1090], [26, 46, -1240], [0, 40, -1400],
];
const ringMeshes = RING_CENTRES.map(([x, y, z]) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(17, 0.75, 10, 36),
    new THREE.MeshStandardMaterial({ color: 0xd88f22, emissive: 0xcc7f10, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.5 }));
  m.position.set(x, y, z); scene.add(m);
  return m;
});
const ringGlow = addGlow(scene, 0, 0, 0, 46, 0xffb02e, 0.5);

// ---------- particle pool (one THREE.Points, everything flows through it) -------
const PMAX = 1400;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX),
  pGrav = new Float32Array(PMAX), pBase = new Float32Array(PMAX * 3);
let pHead = 0;
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 1.6, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
points.frustumCulled = false;
scene.add(points);
function spawnP(x, y, z, vx, vy, vz, life, r, g, b, grav = 0) {
  const i = pHead; pHead = (pHead + 1) % PMAX;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pLife[i] = life; pMax[i] = life; pGrav[i] = grav;
  pBase[i * 3] = r; pBase[i * 3 + 1] = g; pBase[i * 3 + 2] = b;
}
function burst(pos, n, speed, life, col, grav = 0, up = 0) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 2, s = speed * (0.35 + Math.random() * 0.75);
    const vx = Math.cos(a) * s, vy = e * s * 0.7 + up, vz = Math.sin(a) * s;
    const lf = life * (0.6 + Math.random() * 0.7), sp = Math.random() * lf * 0.45;   // pre-expanded so a frozen frame still blooms
    spawnP(pos.x + vx * sp, pos.y + vy * sp, pos.z + vz * sp, vx, vy, vz, lf, col[0], col[1], col[2], grav);
  }
}
function stepParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
    pLife[i] -= dt;
    pVel[i * 3 + 1] -= pGrav[i] * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const f = Math.max(0, pLife[i] / pMax[i]);
    pCol[i * 3] = pBase[i * 3] * f; pCol[i * 3 + 1] = pBase[i * 3 + 1] * f; pCol[i * 3 + 2] = pBase[i * 3 + 2] * f;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
// Wingtip contrails: two fading point trails fed from the wingtip offsets.
const TRAIL_N = 46;
const trailGeo = new THREE.BufferGeometry();
const tPos = new Float32Array(TRAIL_N * 2 * 3), tCol = new Float32Array(TRAIL_N * 2 * 3);
trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
const trailPts = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 1.4, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: true }));
trailPts.frustumCulled = false;
scene.add(trailPts);
const trailHist = [[], []];
function stepTrails(active) {
  const wp = new THREE.Vector3();
  for (let s = 0; s < 2; s++) {
    wp.copy(wingtips[s]).applyMatrix4(jet.matrixWorld);
    const h = trailHist[s];
    h.unshift([wp.x, wp.y, wp.z]);
    if (h.length > TRAIL_N) h.pop();
    for (let i = 0; i < TRAIL_N; i++) {
      const p = h[Math.min(i, h.length - 1)] || [wp.x, wp.y, wp.z];
      const idx = (s * TRAIL_N + i) * 3;
      tPos[idx] = p[0]; tPos[idx + 1] = p[1]; tPos[idx + 2] = p[2];
      const f = active ? (1 - i / TRAIL_N) * 0.85 : 0;
      tCol[idx] = f; tCol[idx + 1] = f; tCol[idx + 2] = f;
    }
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
}

// ---------- flight model ---------------------------------------------------------
const F = {
  pos: new THREE.Vector3(0, 26, 660), yaw: 0, pitch: 0, roll: 0,
  throttle: 0.62, speed: 88, boost: false, brake: false, gearDown: true,
  fuel: 100, dmg: 0, crashed: false, scrapeCd: 0, shake: 0,
  reset() { this.pos.set(0, 26, 660); this.yaw = this.pitch = this.roll = 0; this.throttle = 0.62; this.speed = 88; this.fuel = 100; this.dmg = 0; this.crashed = false; this.gearDown = true; this.shake = 0; },
};
const trial = { next: 0, passed: 0, elapsed: 0, score: 0, finished: false, landed: false, timeLeft: 180, combo: 0, bestCombo: 0, targetsHit: 0, medal: '' };
let bestScore = 0;
function resetTrial() {
  trial.next = 0; trial.passed = 0; trial.elapsed = 0; trial.score = 0; trial.finished = false; trial.landed = false;
  trial.timeLeft = 180; trial.combo = 0; trial.bestCombo = 0; trial.targetsHit = 0; trial.medal = '';
  targets.forEach((t) => { t.alive = true; t.group.visible = true; });
  missiles.forEach((m) => { m.active = false; m.mesh.visible = false; });
  wingMissiles.forEach((m) => { m.visible = true; });
}
function medalFor() {
  if (trial.passed >= 10 && trial.targetsHit >= 5 && F.dmg < 25) return 'ACE';
  if (trial.passed >= 9 && trial.targetsHit >= 3) return 'GOLD';
  if (trial.passed >= 7) return 'SILVER';
  if (trial.passed >= 4) return 'BRONZE';
  return '';
}

// ---------- missiles ---------------------------------------------------------------
const missiles = [];
for (let i = 0; i < 4; i++) {
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.1, 8), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.8 }));
  body.rotation.x = Math.PI / 2; mesh.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 8), new THREE.MeshStandardMaterial({ color: 0xb3312a, roughness: 0.45, metalness: 0.5 }));
  nose.rotation.x = -Math.PI / 2; nose.position.z = -1.45; mesh.add(nose);
  mesh.visible = false; scene.add(mesh);
  missiles.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, life: 0 });
}
let missileCd = 0, missilesLeft = 6;
function nearestTarget() {
  let best = null, bd = 1e9;
  for (const t of targets) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - F.pos.x, t.z - F.pos.z);
    if (d < bd) { bd = d; best = t; }
  }
  return { t: best, d: bd };
}
function fireMissile() {
  if (missileCd > 0 || missilesLeft <= 0) return;
  const m = missiles.find((mm) => !mm.active);
  if (!m) return;
  const { t } = nearestTarget();
  missileCd = 0.45; missilesLeft--;
  if (missilesLeft < wingMissiles.length) wingMissiles[missilesLeft].visible = false;
  m.active = true; m.life = 7; m.target = t;
  m.pos.copy(F.pos);
  const fwd = new THREE.Vector3(-Math.sin(F.yaw) * Math.cos(F.pitch), Math.sin(F.pitch), -Math.cos(F.yaw) * Math.cos(F.pitch));
  m.vel.copy(fwd).multiplyScalar(F.speed + 55);
  m.mesh.visible = true;
  hudBanner('MISSILE AWAY', 700);
  audio.blip(320, 0.3, 0.25, 'sawtooth');
}
function stepMissiles(dt) {
  missileCd = Math.max(0, missileCd - dt);
  for (const m of missiles) {
    if (!m.active) continue;
    m.life -= dt;
    if (m.target && m.target.alive) {
      const want = new THREE.Vector3(m.target.x - m.pos.x, m.target.y - m.pos.y, m.target.z - m.pos.z).normalize().multiplyScalar(150);
      m.vel.lerp(want, Math.min(1, dt * 2.6));
    }
    m.pos.addScaledVector(m.vel, dt);
    m.mesh.position.copy(m.pos);
    m.mesh.lookAt(m.pos.clone().add(m.vel));
    m.mesh.rotateY(Math.PI);   // missile nose is modelled toward -Z
    spawnP(m.pos.x, m.pos.y, m.pos.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.55, 0.85, 0.85, 0.85);
    let boom = m.life <= 0 || m.pos.y <= terrainHeight(m.pos.x, m.pos.z) + 0.6;
    if (m.target && m.target.alive && m.pos.distanceTo(new THREE.Vector3(m.target.x, m.target.y, m.target.z)) < 7) boom = true;
    if (boom) {
      m.active = false; m.mesh.visible = false;
      burst(m.pos, 42, 15, 0.8, [1, 0.55, 0.16], 3, 3);
      burst(m.pos, 18, 7, 1.3, [0.4, 0.36, 0.33]);
      F.shake = Math.max(F.shake, 0.35);
      audio.boom();
      if (m.target && m.target.alive && m.pos.distanceTo(new THREE.Vector3(m.target.x, m.target.y, m.target.z)) < 16) {
        m.target.alive = false; m.target.group.visible = false;
        trial.targetsHit++; trial.score += 1500;
        hudBanner('TARGET DESTROYED — +1500 (' + trial.targetsHit + ' / 6)', 1800);
        if (trial.targetsHit >= 6) finishRun('ALL TARGETS DESTROYED');
      }
    }
  }
}
function finishRun(why) {
  if (trial.finished) return;
  trial.finished = true;
  trial.medal = medalFor();
  bestScore = Math.max(bestScore, trial.score);
  hudBanner(why + (trial.medal ? ' — ' + trial.medal + ' MEDAL' : '') + ' · SCORE ' + trial.score + ' · BEST ' + bestScore, 4200);
}

const keys = new Set();
let gearQ = false, camQ = false, freeQ = false, resetQ = false, pauseQ = false, fireQ = false, interacted = false;
let mouseDX = 0, mouseDY = 0, mouseDown = false;
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code); interacted = true;
  if (e.code === 'KeyG') gearQ = true;
  if (e.code === 'KeyC') camQ = true;
  if (e.code === 'KeyF') freeQ = true;
  if (e.code === 'KeyR') resetQ = true;
  if (e.code === 'KeyP') pauseQ = true;
  if (e.code === 'KeyX') fireQ = true;
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', () => { mouseDown = true; interacted = true; });
addEventListener('mouseup', () => { mouseDown = false; });
addEventListener('mousemove', (e) => { if (mouseDown) { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; } });

function stepFlight(dt) {
  if (F.crashed) return;
  let pitchIn = 0, rollIn = 0, yawIn = 0, thrD = 0;
  if (keys.has('ArrowDown')) pitchIn += 1;
  if (keys.has('ArrowUp')) pitchIn -= 1;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) rollIn -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) rollIn += 1;
  if (keys.has('KeyQ')) yawIn -= 1;
  if (keys.has('KeyE')) yawIn += 1;
  if (keys.has('PageUp') || keys.has('Equal')) thrD += 1;
  if (keys.has('PageDown') || keys.has('Minus')) thrD -= 1;
  if (mouseDown) { rollIn += Math.max(-1, Math.min(1, mouseDX * 0.012)); pitchIn += Math.max(-1, Math.min(1, mouseDY * 0.01)); mouseDX = mouseDY = 0; }
  F.throttle = Math.min(1, Math.max(0, F.throttle + thrD * dt * 0.55));
  F.boost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && F.fuel > 0;
  F.brake = keys.has('KeyS');
  const authority = Math.min(1, F.speed / 55);
  F.pitch = Math.max(-1.05, Math.min(1.05, F.pitch + pitchIn * 1.15 * authority * dt));
  F.roll = Math.max(-1.35, Math.min(1.35, F.roll + (rollIn * 2.3 * authority - F.roll * 2.6) * dt));
  F.yaw -= (Math.sin(F.roll) * 0.62 * authority + yawIn * 0.35) * dt;
  const thrust = F.fuel > 0 ? F.throttle * 26 * (F.boost ? 1.9 : 1) : 0;
  const drag = 0.028 * F.speed + (F.brake ? 9 : 0) + (F.gearDown ? 2.4 : 0) + Math.abs(Math.sin(F.roll)) * 2.2;
  F.speed = Math.max(0, Math.min(168, F.speed + (thrust - drag - 9.8 * Math.sin(F.pitch) * 0.62) * dt));
  F.fuel = Math.max(0, F.fuel - (0.055 + F.throttle * 0.11 + (F.boost ? 0.3 : 0)) * dt);
  const cp = Math.cos(F.pitch);
  const fwd = new THREE.Vector3(-Math.sin(F.yaw) * cp, Math.sin(F.pitch), -Math.cos(F.yaw) * cp);
  const prev = F.pos.clone();
  F.pos.addScaledVector(fwd, F.speed * dt);
  const floor = terrainHeight(F.pos.x, F.pos.z) + 2.1;
  F.scrapeCd = Math.max(0, F.scrapeCd - dt);
  if (F.pos.y <= floor) {
    F.pos.y = floor;
    const sink = -fwd.y * F.speed;
    const gentle = F.gearDown && sink < 6 && Math.abs(F.roll) < 0.3 && F.speed < 62;
    if (!gentle) {
      F.dmg = Math.min(100, F.dmg + Math.max(6, sink * 1.6));
      F.shake = Math.max(F.shake, 0.5);
      burst(F.pos, 16, 9, 0.5, [1, 0.75, 0.3], 5);
      if (F.dmg >= 100 || sink > 16) { F.crashed = true; burst(F.pos, 70, 17, 1.1, [1, 0.5, 0.14], 2, 4); burst(F.pos, 30, 9, 1.8, [0.35, 0.3, 0.28]); audio.boom(); }
      F.speed *= 0.55; F.pitch = Math.max(0, F.pitch);
    }
  }
  if (wallClearance(F.pos.x, F.pos.z) < 3.2 && F.scrapeCd <= 0 && F.speed > 20) {
    F.dmg = Math.min(100, F.dmg + 4); F.scrapeCd = 0.7; F.shake = Math.max(F.shake, 0.3);
    burst(F.pos, 12, 8, 0.4, [1, 0.8, 0.35], 6);
    if (F.dmg >= 100) { F.crashed = true; burst(F.pos, 70, 17, 1.1, [1, 0.5, 0.14], 2, 4); audio.boom(); }
  }
  if (!trial.finished && mode === 'RING TRIAL' && trial.next < RING_CENTRES.length) {
    trial.elapsed += dt; trial.timeLeft = Math.max(0, 180 - trial.elapsed);
    const c = RING_CENTRES[trial.next];
    const dz0 = prev.z - c[2], dz1 = F.pos.z - c[2];
    if (dz0 !== 0 && dz0 * dz1 <= 0) {
      const t = dz0 / (dz0 - dz1);
      const x = prev.x + (F.pos.x - prev.x) * t, y = prev.y + (F.pos.y - prev.y) * t;
      trial.next++;
      if (Math.hypot(x - c[0], y - c[1]) <= 17) {
        trial.passed++; trial.combo++; trial.bestCombo = Math.max(trial.bestCombo, trial.combo);
        const mult = 1 + Math.min(1, (trial.combo - 1) * 0.25);
        const pts = Math.round((1000 + Math.round(trial.timeLeft * 2)) * mult);
        trial.score += pts;
        const rp = new THREE.Vector3(c[0], c[1], c[2]);
        burst(rp, 30, 11, 0.7, [1, 0.78, 0.2]);
        F.shake = Math.max(F.shake, 0.12);
        hudBanner('RING ' + trial.passed + ' CLEAN' + (trial.combo > 1 ? ' — COMBO ×' + mult.toFixed(2) : '') + ' +' + pts);
        audio.ring();
        if (trial.next >= RING_CENTRES.length) hudBanner('ALL RINGS — STRIKE THE BASIN TARGETS (X TO FIRE)', 2600);
      } else { trial.combo = 0; hudBanner('RING MISSED', 1100); audio.miss(); }
    }
  } else if (!trial.finished && mode === 'RING TRIAL') {
    trial.elapsed += dt; trial.timeLeft = Math.max(0, 180 - trial.elapsed);
  }
  if (trial.timeLeft <= 0 && !trial.finished && mode === 'RING TRIAL') finishRun('TIME UP');
  const onRwy = Math.abs(F.pos.x) < 21 && F.pos.z > RUNWAY_Z0 && F.pos.z < RUNWAY_Z1;
  const grounded = F.pos.y <= terrainHeight(F.pos.x, F.pos.z) + 2.3;
  if (grounded && wasAirborne && !F.crashed) {
    audio.thump();
    burst(F.pos, 14, 6, 0.7, [0.75, 0.62, 0.45], 1, 2);   // touchdown dust
    if (onRwy && F.gearDown && F.speed < 40 && !trial.landed) { trial.landed = true; trial.score += 2500; hudBanner('TOUCHDOWN AT VIPER FIELD — +2500', 2400); }
  }
  wasAirborne = !grounded;
}

// ---------- audio (procedural, Web Audio) ---------------------------------------
const audio = {
  ctx: null,
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.15; this.master.connect(ctx.destination);
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620;
    this.oA = ctx.createOscillator(); this.oA.type = 'sawtooth'; this.oA.frequency.value = 58;
    this.oB = ctx.createOscillator(); this.oB.type = 'sawtooth'; this.oB.frequency.value = 58.4;
    this.oA.connect(lp); this.oB.connect(lp); lp.connect(this.eng); this.eng.connect(this.master);
    this.oA.start(); this.oB.start();
    const len = ctx.sampleRate * 1.4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 480;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    src.connect(this.windF); this.windF.connect(this.wind); this.wind.connect(this.master); src.start();
    // Low music bed: two detuned triangle pads cycling a minor progression.
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.035; this.padGain.connect(this.master);
    this.padOsc = [110, 164.8].map((f) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(this.padGain); o.start(); return o; });
    this.padStep = 0;
    setInterval(() => {
      if (!this.ctx) return;
      const roots = [110, 87.3, 98, 130.8];
      const r = roots[this.padStep++ % 4], t = this.ctx.currentTime;
      this.padOsc[0].frequency.setTargetAtTime(r, t, 0.4);
      this.padOsc[1].frequency.setTargetAtTime(r * 1.5, t, 0.4);
    }, 3400);
  },
  update() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, rpm = 46 + F.throttle * 92 + (F.boost ? 26 : 0);
    this.oA.frequency.setTargetAtTime(rpm, t, 0.08);
    this.oB.frequency.setTargetAtTime(rpm * 1.007, t, 0.08);
    this.eng.gain.setTargetAtTime(0.1 + F.throttle * 0.3, t, 0.1);
    this.wind.gain.setTargetAtTime(Math.min(0.5, F.speed / 300), t, 0.12);
    this.windF.frequency.setTargetAtTime(280 + F.speed * 5.2, t, 0.12);
  },
  blip(f, dur, g = 0.3, type = 'sine') {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.type = type; o.frequency.value = f;
    gn.gain.setValueAtTime(g, this.ctx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(gn); gn.connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur);
  },
  sweep() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), gn = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    gn.gain.setValueAtTime(0.22, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(gn); gn.connect(this.master); o.start(); o.stop(t + 0.3);
  },
  ring() { this.blip(880, 0.16, 0.32); setTimeout(() => this.blip(1318, 0.24, 0.3), 70); this.sweep(); },
  miss() { this.blip(196, 0.3, 0.28, 'square'); },
  thump() { this.blip(72, 0.22, 0.5, 'triangle'); },
  boom() {
    if (!this.ctx) return;
    const ctx = this.ctx, len = ctx.sampleRate * 0.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const gn = ctx.createGain(); gn.gain.value = 0.6;
    src.connect(f); f.connect(gn); gn.connect(this.master); src.start();
    this.blip(55, 0.45, 0.5, 'triangle');
  },
};

// ---------- DOM glass HUD ---------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hudEl = { alt: $('hud-alt'), spd: $('hud-spd'), hdg: $('hud-hdg'), thr: $('hud-thr'), burn: $('hud-burn'), gear: $('hud-gear'),
  score: $('hud-score'), rings: $('hud-rings'), clock: $('hud-clock'), mode: $('hud-mode'), next: $('hud-next'),
  banner: $('banner'), fuelBar: $('fuel-bar'), fuelTxt: $('fuel-txt'), dmgBar: $('dmg-bar'), dmgTxt: $('dmg-txt'),
  ladderBox: $('hud-ladder'), radarBox: $('hud-radar'), help: $('help'), title: $('title'), combo: $('hud-combo') };
const ladderCtx = $('ladder').getContext('2d'), radarCtx = $('radar').getContext('2d');
let bannerUntil = 0, mode = 'RING TRIAL', camMode = 'chase', paused = false, wasAirborne = false;
function hudBanner(text, ms = 1600) { hudEl.banner.textContent = text; hudEl.banner.style.opacity = '1'; bannerUntil = performance.now() + ms; }

function drawLadder() {
  const ctx = ladderCtx, W = 190, H = 150, cx = W / 2, cy = H / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(6, 6, W - 12, H - 12); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-F.roll);
  const off = -F.pitch * 180 / Math.PI * 1.6;
  ctx.fillStyle = 'rgba(46,110,180,0.55)'; ctx.fillRect(-W, -H + off, W * 2, H);
  ctx.fillStyle = 'rgba(122,84,40,0.55)'; ctx.fillRect(-W, off, W * 2, H);
  ctx.strokeStyle = '#eaf6ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-W, off); ctx.lineTo(W, off); ctx.stroke();
  ctx.font = '10px monospace'; ctx.fillStyle = '#cfe9ff'; ctx.lineWidth = 1;
  for (const d of [-20, -10, 10, 20]) {
    const y = off - d * 1.6, w = d % 20 === 0 ? 34 : 22;
    ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(-8, y); ctx.moveTo(8, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillText(String(Math.abs(d)), -w - 16, y + 3); ctx.fillText(String(Math.abs(d)), w + 4, y + 3);
  }
  ctx.restore();
  ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 34, cy); ctx.lineTo(cx - 10, cy); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx + 10, cy); ctx.lineTo(cx + 34, cy); ctx.stroke();
  ctx.strokeStyle = 'rgba(140,220,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(6, 6, W - 12, H - 12);
}
function drawRadar() {
  const ctx = radarCtx, S = 148, cx = S / 2;
  const map = (x, z) => [cx + x * 0.062, 136 + z * 0.062];
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(6,20,28,0.88)'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(120,220,255,0.25)';
  for (const r of [26, 52]) { ctx.beginPath(); ctx.arc(cx, 74, r, 0, 7); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,176,46,0.5)'; ctx.lineWidth = 5; ctx.beginPath();
  for (let z = 60; z >= -1520; z -= 60) { const [x, y] = map(gorgeCentreX(z), z); z === 60 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  ctx.stroke();
  const [rx, ry] = map(0, 455);
  ctx.fillStyle = '#9fe8ff'; ctx.fillRect(rx - 2, ry - 12, 4, 24);
  RING_CENTRES.forEach((c, i) => {
    const [x, y] = map(c[0], c[2]);
    ctx.fillStyle = i < trial.next ? 'rgba(140,255,160,0.85)' : i === trial.next ? '#ffd23e' : 'rgba(255,190,80,0.45)';
    ctx.beginPath(); ctx.arc(x, y, i === trial.next ? 4 : 2.6, 0, 7); ctx.fill();
  });
  targets.forEach((t) => {
    if (!t.alive) return;
    const [x, y] = map(t.x, t.z);
    ctx.fillStyle = '#ff5040'; ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
  });
  const [ax, ay] = map(F.pos.x, F.pos.z);
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(F.yaw);
  ctx.fillStyle = '#54f0ff';
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2.4); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(190,235,255,0.8)'; ctx.font = '9px monospace';
  ctx.fillText('RADAR', 6, 12); ctx.fillText('N', cx - 3, 12);
}
function updateHud(now) {
  if (now > bannerUntil) hudEl.banner.style.opacity = '0';
  hudEl.alt.textContent = String(Math.round(F.pos.y * 3.281)).padStart(5, '0');
  hudEl.spd.textContent = String(Math.round(F.speed * 1.944)).padStart(3, '0');
  hudEl.hdg.textContent = String(Math.round(((F.yaw * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0');
  hudEl.thr.textContent = Math.round(F.throttle * 100) + '%';
  hudEl.burn.style.display = F.boost ? 'inline-block' : 'none';
  hudEl.gear.textContent = F.gearDown ? 'GEAR ▼' : 'GEAR ▲';
  hudEl.gear.style.color = F.gearDown ? '#7dff9a' : '#8fa3b0';
  hudEl.fuelBar.style.width = F.fuel.toFixed(0) + '%';
  hudEl.fuelBar.style.background = F.fuel < 25 ? '#ff5348' : F.fuel < 50 ? '#ffb02e' : '#39d353';
  hudEl.fuelTxt.textContent = F.fuel.toFixed(0) + '%';
  hudEl.dmgBar.style.width = F.dmg.toFixed(0) + '%';
  hudEl.dmgTxt.textContent = F.dmg.toFixed(0) + '%';
  hudEl.score.textContent = String(trial.score).padStart(6, '0');
  hudEl.rings.textContent = trial.passed + ' / 10 · TGT ' + trial.targetsHit + ' / 6';
  const t = Math.max(0, Math.ceil(trial.timeLeft));
  hudEl.clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  hudEl.mode.textContent = mode + (trial.medal ? ' · ' + trial.medal : '');
  hudEl.combo.textContent = trial.combo > 1 ? 'COMBO ×' + (1 + Math.min(1, (trial.combo - 1) * 0.25)).toFixed(2) : '';
  const inCockpit = camMode === 'cockpit';
  hudEl.ladderBox.style.display = inCockpit ? 'none' : '';
  hudEl.radarBox.style.display = inCockpit ? 'none' : '';
  hudEl.help.style.opacity = interacted ? '0' : '1';
  hudEl.title.style.opacity = interacted ? '0.55' : '1';
  if (trial.next < RING_CENTRES.length && mode !== 'FREE FLIGHT') {
    const c = RING_CENTRES[trial.next];
    hudEl.next.textContent = 'RING ' + (trial.next + 1) + ' · ' + Math.round(Math.hypot(F.pos.x - c[0], F.pos.z - c[2])) + ' m';
  } else if (mode !== 'FREE FLIGHT') {
    const { t: nt, d } = nearestTarget();
    hudEl.next.textContent = nt ? 'TARGET · ' + Math.round(d) + ' m · MSL ' + missilesLeft : 'STRIKE COMPLETE';
  } else hudEl.next.textContent = 'LAND AT VIPER FIELD';
  if (!inCockpit) { drawLadder(); drawRadar(); }
  // Live cockpit MFDs fed from real flight state.
  const blips = RING_CENTRES.map((c) => [(c[0] - F.pos.x) * 0.14, (c[2] - F.pos.z) * 0.14]).filter(([bx, by]) => Math.abs(bx) < 80 && Math.abs(by) < 80);
  const tblips = targets.filter((t) => t.alive).map((t) => [(t.x - F.pos.x) * 0.14, (t.z - F.pos.z) * 0.14]).filter(([bx, by]) => Math.abs(bx) < 80 && Math.abs(by) < 80);
  const { d: nd } = nearestTarget();
  cockpitApi.updateLive({ roll: F.roll, pitch: F.pitch, thr: F.throttle, boost: F.boost, fuel: F.fuel,
    alt: Math.round(F.pos.y * 3.281), spd: Math.round(F.speed * 1.944), blips, targetBlips: tblips,
    lock: trial.next >= RING_CENTRES.length && nd < 700, rng: Math.round(nd), msl: missilesLeft, tgt: trial.targetsHit + '/6' });
}

// ---------- cameras / render -------------------------------------------------------
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const camPos = new THREE.Vector3(8.6, 31, 677);
let camInit = false;
let curFov = 64, simTime = 0;
function placeJet(now) {
  jet.position.copy(F.pos);
  _e.set(F.pitch, F.yaw, F.roll, 'YXZ'); _q.setFromEuler(_e);
  jet.quaternion.copy(_q);
  gear.visible = F.gearDown;
  const flick = 1 + Math.sin(now * 0.09) * 0.08 + Math.sin(now * 0.23) * 0.05;
  const flame = Math.min(1.5, (0.3 + F.throttle * 0.6 + (F.boost ? 0.55 : 0)) * flick);
  for (const b of burners) {
    b.coneOuter.scale.set(1, flame, 1); b.coneOuter.position.z = 9.12 + 0.58 * flame;
    b.coneInner.scale.set(1, flame * 0.9, 1); b.coneInner.position.z = 9.12 + 0.4 * flame * 0.9;
  }
  cockpit.position.copy(F.pos); cockpit.quaternion.copy(_q);
  cockpit.visible = camMode === 'cockpit';
  jet.visible = camMode !== 'cockpit';
}
function placeCamera(dt, staged) {
  const targetFov = F.boost ? 72 : 64 + Math.min(4, F.speed * 0.012);
  curFov += (targetFov - curFov) * Math.min(1, dt * 5 + (staged ? 1 : 0));
  if (Math.abs(camera.fov - curFov) > 0.05) { camera.fov = curFov; camera.updateProjectionMatrix(); }
  F.shake = Math.max(0, F.shake - dt * 1.4);
  const shX = (Math.random() - 0.5) * F.shake * 0.7, shY = (Math.random() - 0.5) * F.shake * 0.7;
  if (camMode === 'cockpit') {
    _v.set(shX * 0.3, 0.55 + shY * 0.3, -0.9).applyQuaternion(_q).add(F.pos);
    camera.position.copy(_v);
    _v.set(0, -6.4, -30).applyQuaternion(_q).add(F.pos);
    camera.up.set(0, 1, 0).applyQuaternion(_q);
    camera.lookAt(_v);
  } else {
    _v.set(8.6, 5.0, 17.5).applyQuaternion(_q).add(F.pos);
    if (staged || !camInit) { camPos.copy(_v); camInit = true; }
    else camPos.lerp(_v, Math.min(1, dt * 7));           // chase lag
    camera.position.set(camPos.x + shX, camPos.y + shY, camPos.z);
    _v2.set(0, 0.2, -34).applyQuaternion(_q).add(F.pos); // look-ahead into the turn
    camera.up.set(0, 1, 0);
    camera.lookAt(_v2);
  }
}
function renderFrame(now, dt = 0.016, staged = false) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  jet.updateMatrixWorld();
  placeJet(now); placeCamera(dt, staged);
  sun.position.copy(F.pos).addScaledVector(SUN_DIR, 340);
  sun.target.position.copy(F.pos);
  sky.update(dt, F.pos);
  ringMeshes.forEach((m, i) => {
    const isNext = i === trial.next && mode === 'RING TRIAL';
    m.material.emissiveIntensity = isNext ? 1.5 + Math.sin(now * 0.006) * 0.5 : 0.55;
    m.material.color.setHex(isNext ? 0xffb02e : 0xc07a20);
  });
  if (trial.next < RING_CENTRES.length) {
    const c = RING_CENTRES[trial.next];
    ringGlow.position.set(c[0], c[1], c[2]);
    ringGlow.material.opacity = 0.35 + Math.sin(now * 0.006) * 0.12;
  } else ringGlow.material.opacity = 0;
  const trailOn = F.boost || Math.abs(F.roll) > 0.45;
  stepTrails(trailOn && camMode !== 'cockpit');
  renderer.render(scene, camera);
  updateHud(now);
}

// ---------- staged scenes + main loop -----------------------------------------------
const shot = new URLSearchParams(location.search).get('shot');
function stage(name) {
  const set = (pos, yaw, pitch, roll, thr, boost, gearDown, fuel, spd, cam, next, elapsed, score, extra = {}) => {
    F.pos.set(...pos); F.yaw = yaw; F.pitch = pitch; F.roll = roll; F.throttle = thr;
    F.boost = boost; F.gearDown = gearDown; F.fuel = fuel; F.speed = spd; camMode = cam;
    trial.next = next; trial.passed = next; trial.elapsed = elapsed; trial.timeLeft = 180 - elapsed; trial.score = score;
    trial.combo = extra.combo || 0; trial.targetsHit = extra.tgt || 0;
    missilesLeft = extra.msl !== undefined ? extra.msl : 6;
    Object.assign(F, extra.f || {});
  };
  if (name === 'cover') {
    set([4, 52, 720], 0, -0.03, -0.42, 0.92, true, false, 86, 122, 'chase', 0, 13, 0);
    for (let k = 0; k < 30; k++) stepTrails(true);   // pre-roll contrails into frame
  } else if (name === 'rings') {
    set([-2, 42, -96], 0.02, -0.02, 0.3, 0.8, true, false, 74, 118, 'chase', 1, 47, 2412, { combo: 1 });
    const c = RING_CENTRES[0];
    burst(new THREE.Vector3(-4, 40, -118), 34, 11, 1.4, [1, 0.78, 0.2]);   // ring-pass burst blooming ahead of the jet
    burst(new THREE.Vector3(c[0], c[1], c[2]), 18, 9, 1.4, [1, 0.78, 0.2]);
    for (let k = 0; k < 24; k++) stepTrails(true);
  } else if (name === 'cockpit') {
    set([2, 44, -330], -0.06, 0.01, 0.05, 0.85, false, false, 63, 126, 'cockpit', 3, 83, 6940, { combo: 2 });
    cockpitApi.mfds.forEach((m) => drawMfd(m, { roll: 0.05, pitch: 0.01, thr: 0.85, boost: false, fuel: 63,
      alt: 144, spd: 245, blips: [[30, -40], [-52, 18], [12, 55]], targetBlips: [], lock: false, rng: 1240, msl: 6, tgt: '0/6' }));
  } else if (name === 'strike') {
    set([52, 40, -1580], -0.29, -0.1, 0.22, 0.88, false, false, 38, 118, 'chase', 10, 152, 16940, { combo: 3, tgt: 2, msl: 3 });
    targets.forEach((t, i) => { if (i < 2) { t.alive = false; t.group.visible = false; } });
    const m = missiles[0];
    m.active = false; m.mesh.visible = true;
    m.pos.set(61, 26, -1610); m.mesh.position.copy(m.pos); m.mesh.lookAt(70, 12, -1640); m.mesh.rotateY(Math.PI);
    for (let k = 0; k < 14; k++) spawnP(61 - k * 1.2, 26 + k * 0.7, -1610 + k * 1.6, 0, 0, 0, 2.5, 0.9, 0.9, 0.9);
    burst(new THREE.Vector3(70, 13, -1640), 90, 16, 2.4, [1, 0.55, 0.16], 0, 3);
    burst(new THREE.Vector3(70, 15, -1640), 34, 8, 2.8, [0.42, 0.38, 0.35]);
    burst(new THREE.Vector3(70, 12, -1640), 26, 10, 2.0, [1, 0.85, 0.4]);
    addGlow(scene, 70, 14, -1640, 26, 0xff7a20, 0.75);
    {   // dark smoke column over the kill (normal blending — additive can't darken)
      const smokeTex = cloudTexture();
      for (let k = 0; k < 3; k++) {
        const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x4a4038, transparent: true, opacity: 0.5, depthWrite: false }));
        sm.position.set(70 + k * 3 - 3, 16 + k * 5, -1640);
        sm.scale.set(20 + k * 7, 12 + k * 4, 1);
        scene.add(sm);
      }
    }
    for (let k = 0; k < 20; k++) stepTrails(false);
  } else if (name === 'approach') {
    set([3, 30, 770], 0, -0.05, 0, 0.42, false, true, 41, 58, 'chase', 10, 158, 12400, { tgt: 1 });
  }
}
if (shot) {
  stage(shot);
  stepParticles(0.001);   // bake particle colours once (the live loop steps them per-frame)
  for (let i = 0; i < 5; i++) renderFrame(performance.now(), 0.016, true);
  window.__shotReady = true;
} else {
  addEventListener('pointerdown', () => audio.start(), { once: true });
  addEventListener('keydown', () => audio.start(), { once: true });
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;   // rAF timestamps can predate the eval-time snapshot under load — never step backwards
    if (gearQ) { F.gearDown = !F.gearDown; gearQ = false; }
    if (camQ) { camMode = camMode === 'chase' ? 'cockpit' : 'chase'; camQ = false; }
    if (freeQ) { mode = mode === 'FREE FLIGHT' ? 'RING TRIAL' : 'FREE FLIGHT'; hudBanner(mode); freeQ = false; }
    if (resetQ) { F.reset(); resetTrial(); missilesLeft = 6; hudBanner('RESET — LINE UP AND FLY THE GORGE'); resetQ = false; }
    if (pauseQ) { paused = !paused; pauseQ = false; }
    if (fireQ) { fireMissile(); fireQ = false; }
    if (keys.has('Space')) fireMissile();
    if (!paused) {
      const sub = Math.max(1, Math.round(dt / (1 / 120)));
      for (let i = 0; i < sub; i++) stepFlight(dt / sub);
      stepMissiles(dt);
      stepParticles(dt);
      simTime += dt;
    }
    audio.update();
    renderFrame(now, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
