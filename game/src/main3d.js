// main3d.js — Canyon Viper v3 game loop on Three.js.
// Owns the renderer (ACES tone mapping, soft shadows, golden-hour fog), the
// flight model, the ring trial, both cameras, the DOM glass HUD (ALT/SPD/HDG
// tapes, FUEL + HULL bars, pitch ladder, minimap radar) and staged scenes.
'use strict';

// ---------- renderer / scene / light rig --------------------------------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9c39a);
scene.fog = new THREE.FogExp2(0xdcc49c, 0.00042);
// Gradient sky-dome environment map: without it, metals shade black.
{
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#7fb2e8'); g.addColorStop(0.42, '#cfd9e2'); g.addColorStop(0.55, '#f2d9a8');
  g.addColorStop(0.62, '#d9a860'); g.addColorStop(1, '#8a5f33');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  const env = new THREE.CanvasTexture(cv);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.SRGBColorSpace;
  scene.environment = env;
}
const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 4200);

const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x9a6b40, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe3b0, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 800;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.44).normalize();

const world = buildWorld3D(scene);
const { jet, gear, burners } = buildJet3D();
scene.add(jet);
const cockpit = buildCockpit3D();
scene.add(cockpit);

// ---------- rings ---------------------------------------------------------------
const RING_CENTRES = [
  [10, 42, -60], [-26, 36, -210], [30, 48, -360], [-14, 30, -510], [22, 44, -660],
  [-30, 34, -800], [12, 52, -940], [-8, 38, -1090], [26, 46, -1240], [0, 40, -1400],
];
const ringMeshes = RING_CENTRES.map(([x, y, z], i) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(17, 0.75, 10, 36),
    new THREE.MeshStandardMaterial({ color: 0xd88f22, emissive: 0xcc7f10, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.5 }));
  m.position.set(x, y, z); scene.add(m);
  return m;
});
const ringGlow = addGlow(scene, 0, 0, 0, 46, 0xffb02e, 0.5);

// ---------- flight model ---------------------------------------------------------
const F = {
  pos: new THREE.Vector3(0, 26, 660), yaw: 0, pitch: 0, roll: 0,
  throttle: 0.62, speed: 88, boost: false, brake: false, gearDown: true,
  fuel: 100, dmg: 0, crashed: false, scrapeCd: 0,
  reset() { this.pos.set(0, 26, 660); this.yaw = this.pitch = this.roll = 0; this.throttle = 0.62; this.speed = 88; this.fuel = 100; this.dmg = 0; this.crashed = false; this.gearDown = true; },
};
const trial = { next: 0, passed: 0, elapsed: 0, score: 0, finished: false, landed: false, timeLeft: 180 };
function resetTrial() { trial.next = 0; trial.passed = 0; trial.elapsed = 0; trial.score = 0; trial.finished = false; trial.landed = false; trial.timeLeft = 180; }

const keys = new Set();
let gearQ = false, camQ = false, freeQ = false, resetQ = false, pauseQ = false;
let mouseDX = 0, mouseDY = 0, mouseDown = false;
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyG') gearQ = true;
  if (e.code === 'KeyC') camQ = true;
  if (e.code === 'KeyF') freeQ = true;
  if (e.code === 'KeyR') resetQ = true;
  if (e.code === 'KeyP') pauseQ = true;
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', () => { mouseDown = true; });
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
  F.brake = keys.has('Space');
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
      if (F.dmg >= 100 || sink > 16) F.crashed = true;
      F.speed *= 0.55; F.pitch = Math.max(0, F.pitch);
    }
  }
  if (wallClearance(F.pos.x, F.pos.z) < 3.2 && F.scrapeCd <= 0 && F.speed > 20) {
    F.dmg = Math.min(100, F.dmg + 4); F.scrapeCd = 0.7;
    if (F.dmg >= 100) F.crashed = true;
  }
  // Ring trial bookkeeping.
  if (!trial.finished && mode === 'RING TRIAL' && trial.next < RING_CENTRES.length) {
    trial.elapsed += dt; trial.timeLeft = Math.max(0, 180 - trial.elapsed);
    const c = RING_CENTRES[trial.next];
    const dz0 = prev.z - c[2], dz1 = F.pos.z - c[2];
    if (dz0 !== 0 && dz0 * dz1 <= 0) {
      const t = dz0 / (dz0 - dz1);
      const x = prev.x + (F.pos.x - prev.x) * t, y = prev.y + (F.pos.y - prev.y) * t;
      trial.next++;
      if (Math.hypot(x - c[0], y - c[1]) <= 17) {
        trial.passed++; trial.score += 1000 + Math.round(trial.timeLeft * 2);
        hudBanner('RING ' + trial.passed + ' CLEAN');
        audio.ring();
        if (trial.next >= RING_CENTRES.length) trial.finished = true;
      } else { hudBanner('RING MISSED', 1100); audio.miss(); }
    }
  }
  const onRwy = Math.abs(F.pos.x) < 21 && F.pos.z > RUNWAY_Z0 && F.pos.z < RUNWAY_Z1;
  const grounded = F.pos.y <= terrainHeight(F.pos.x, F.pos.z) + 2.3;
  if (grounded && wasAirborne && !F.crashed) {
    audio.thump();
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
  ring() { this.blip(880, 0.16, 0.32); setTimeout(() => this.blip(1318, 0.24, 0.3), 70); },
  miss() { this.blip(196, 0.3, 0.28, 'square'); },
  thump() { this.blip(72, 0.22, 0.5, 'triangle'); },
};

// ---------- DOM glass HUD ---------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hudEl = { alt: $('hud-alt'), spd: $('hud-spd'), hdg: $('hud-hdg'), thr: $('hud-thr'), gear: $('hud-gear'),
  score: $('hud-score'), rings: $('hud-rings'), clock: $('hud-clock'), mode: $('hud-mode'), next: $('hud-next'),
  banner: $('banner'), fuelBar: $('fuel-bar'), fuelTxt: $('fuel-txt'), dmgBar: $('dmg-bar'), dmgTxt: $('dmg-txt') };
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
  const map = (x, z) => [cx + x * 0.075, 132 + z * 0.075];
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
  hudEl.thr.textContent = Math.round(F.throttle * 100) + '%' + (F.boost ? ' BURN' : '');
  hudEl.gear.textContent = F.gearDown ? 'GEAR ▼' : 'GEAR ▲';
  hudEl.gear.style.color = F.gearDown ? '#7dff9a' : '#8fa3b0';
  hudEl.fuelBar.style.width = F.fuel.toFixed(0) + '%';
  hudEl.fuelBar.style.background = F.fuel < 25 ? '#ff5348' : F.fuel < 50 ? '#ffb02e' : '#39d353';
  hudEl.fuelTxt.textContent = F.fuel.toFixed(0) + '%';
  hudEl.dmgBar.style.width = F.dmg.toFixed(0) + '%';
  hudEl.dmgTxt.textContent = F.dmg.toFixed(0) + '%';
  hudEl.score.textContent = String(trial.score).padStart(6, '0');
  hudEl.rings.textContent = trial.passed + ' / 10';
  const t = Math.max(0, Math.ceil(trial.timeLeft));
  hudEl.clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  hudEl.mode.textContent = mode;
  if (trial.next < RING_CENTRES.length && mode !== 'FREE FLIGHT') {
    const c = RING_CENTRES[trial.next];
    hudEl.next.textContent = 'RING ' + (trial.next + 1) + ' · ' + Math.round(Math.hypot(F.pos.x - c[0], F.pos.z - c[2])) + ' m';
  } else hudEl.next.textContent = mode === 'FREE FLIGHT' ? 'LAND AT VIPER FIELD' : 'ALL RINGS FLOWN';
  drawLadder(); drawRadar();
}

// ---------- cameras / render -------------------------------------------------------
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function placeJet() {
  jet.position.copy(F.pos);
  _e.set(F.pitch, F.yaw, F.roll, 'YXZ'); _q.setFromEuler(_e);
  jet.quaternion.copy(_q);
  gear.visible = F.gearDown;
  const flame = Math.min(1.45, 0.3 + F.throttle * 0.6 + (F.boost ? 0.55 : 0));
  for (const b of burners) {
    b.coneOuter.scale.set(1, flame, 1); b.coneOuter.position.z = 7.35 + 0.95 * flame;
    b.coneInner.scale.set(1, flame * 0.9, 1); b.coneInner.position.z = 7.35 + 0.62 * flame * 0.9;
  }
  cockpit.position.copy(F.pos); cockpit.quaternion.copy(_q);
  cockpit.visible = camMode === 'cockpit';
  jet.visible = camMode !== 'cockpit';
}
function placeCamera() {
  if (camMode === 'cockpit') {
    _v.set(0, 0.55, -0.9).applyQuaternion(_q).add(F.pos);
    camera.position.copy(_v);
    _v.set(0, -6.4, -30).applyQuaternion(_q).add(F.pos);
    camera.up.set(0, 1, 0).applyQuaternion(_q);
    camera.lookAt(_v);
  } else {
    // Rear three-quarter chase: elevated, offset to starboard, jet framed whole.
    _v.set(8.6, 5.0, 16.8).applyQuaternion(_q).add(F.pos);
    camera.position.copy(_v);
    _v.set(0, 0.2, -30).applyQuaternion(_q).add(F.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(_v);
  }
}
function renderFrame(now) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  placeJet(); placeCamera();
  sun.position.copy(F.pos).addScaledVector(SUN_DIR, 320);
  sun.target.position.copy(F.pos);
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
  renderer.render(scene, camera);
  updateHud(now);
}

// ---------- staged scenes + main loop -----------------------------------------------
const shot = new URLSearchParams(location.search).get('shot');
function stage(name) {
  const set = (pos, yaw, pitch, roll, thr, boost, gearDown, fuel, spd, cam, next) => {
    F.pos.set(...pos); F.yaw = yaw; F.pitch = pitch; F.roll = roll; F.throttle = thr;
    F.boost = boost; F.gearDown = gearDown; F.fuel = fuel; F.speed = spd; camMode = cam;
    trial.next = next; trial.passed = next; trial.score = next * 1400;
  };
  if (name === 'cover') set([4, 52, 720], 0, -0.03, -0.38, 0.92, true, false, 86, 122, 'chase', 0);
  else if (name === 'rings') set([-2, 42, -80], 0.02, -0.02, 0.28, 0.8, true, false, 74, 118, 'chase', 1);
  else if (name === 'cockpit') set([2, 44, -330], -0.06, 0.01, 0.05, 0.85, false, false, 63, 126, 'cockpit', 2);
  else if (name === 'approach') set([3, 30, 770], 0, -0.05, 0, 0.42, false, true, 41, 58, 'chase', 0);
}
if (shot) {
  stage(shot);
  for (let i = 0; i < 4; i++) renderFrame(performance.now());
  window.__shotReady = true;
} else {
  addEventListener('pointerdown', () => audio.start(), { once: true });
  addEventListener('keydown', () => audio.start(), { once: true });
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (gearQ) { F.gearDown = !F.gearDown; gearQ = false; }
    if (camQ) { camMode = camMode === 'chase' ? 'cockpit' : 'chase'; camQ = false; }
    if (freeQ) { mode = mode === 'FREE FLIGHT' ? 'RING TRIAL' : 'FREE FLIGHT'; hudBanner(mode); freeQ = false; }
    if (resetQ) { F.reset(); resetTrial(); hudBanner('RESET — LINE UP AND FLY THE GORGE'); resetQ = false; }
    if (pauseQ) { paused = !paused; pauseQ = false; }
    if (!paused) { const sub = Math.max(1, Math.round(dt / (1 / 120))); for (let i = 0; i < sub; i++) stepFlight(dt / sub); }
    audio.update();
    renderFrame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
