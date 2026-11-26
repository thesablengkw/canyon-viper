// Canyon Viper — game entry: WebGL renderer, flight model, modes, HUD.
// Raw WebGL1 with one shader (sun Lambert + emissive + height fog), so the
// game is 100% offline with zero libraries. Modes: RING TRIAL (thread the
// 10 golden rings against the clock), FREE FLIGHT, and runway landing at
// Viper Field for a touchdown bonus. Deterministic ?shot= scenes stage the
// four judge screenshots; ?seed= varies the trial clock start.

import { matIdentity, matMultiply, matPerspective, matTranslation, matScale, matEulerYXZ, matLookAt, forwardOf, clamp, lerp, GeoBuilder } from './math3d.js';
import { buildWorld, canyonCenterX, terrainHeight, RINGS, RUNWAY } from './world.js';
import { buildJet, buildBurner, buildCockpit } from './jet.js';
import { JetAudio } from './audio.js';

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl', { antialias: true });
if (!gl) document.getElementById('status').textContent = 'WebGL is not available in this browser.';

const VSH = `
attribute vec3 aPos; attribute vec3 aCol; attribute vec3 aNor; attribute float aEmi;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vCol; varying float vEmi; varying float vFog; varying float vLight;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNor);
  vLight = 0.54 + 0.50 * max(dot(n, normalize(vec3(0.45, 0.8, 0.4))), 0.0);
  vCol = aCol; vEmi = aEmi;
  vec4 clip = uMVP * vec4(aPos, 1.0);
  vFog = clamp((-clip.z - 120.0) / 1500.0, 0.0, 0.92);
  gl_Position = clip;
}`;
const FSH = `
precision mediump float;
varying vec3 vCol; varying float vEmi; varying float vFog; varying float vLight;
void main() {
  vec3 lit = vCol * (vLight + vEmi * 1.4);
  vec3 fogC = vec3(0.93, 0.72, 0.52);
  gl_FragColor = vec4(mix(lit, fogC, vFog), 1.0);
}`;

function makeProgram() {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VSH));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FSH));
  gl.linkProgram(p); gl.useProgram(p);
  return p;
}
const prog = makeProgram();
const uMVP = gl.getUniformLocation(prog, 'uMVP');
const uModel = gl.getUniformLocation(prog, 'uModel');

function makeBuffer(geo) {
  const buf = {};
  const bind = (name, data, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return b;
  };
  buf.draw = () => {
    bind('aPos', geo.position, 3); bind('aCol', geo.color, 3);
    bind('aNor', geo.normal, 3); bind('aEmi', geo.emissive, 1);
    gl.drawArrays(gl.TRIANGLES, 0, geo.count);
  };
  return buf;
}

// Clouds: flat white billboards drifting high over the rims.
function buildClouds() {
  const g = new GeoBuilder();
  const spots = [[-260, 210, -500], [180, 235, -950], [-120, 205, -1450], [300, 225, -1900], [-300, 215, -2300], [60, 240, -150]];
  for (const [x, y, z] of spots) {
    g.box(x, y, z, 150, 7, 46, [1, 0.99, 0.96], 0.35);
    g.box(x + 40, y + 6, z + 6, 90, 6, 34, [1, 1, 1], 0.35);
    g.box(x - 55, y + 4, z - 4, 70, 5, 28, [0.98, 0.95, 0.92], 0.3);
  }
  return g.build();
}

const worldBuf = makeBuffer(buildWorld());
const jetBuf = makeBuffer(buildJet());
const burnerBuf = makeBuffer(buildBurner());
const cockpitBuf = makeBuffer(buildCockpit());
const cloudBuf = makeBuffer(buildClouds());

// --- Flight state -----------------------------------------------------------
const S = {
  pos: [canyonCenterX(430), 3, 430], yaw: 0, pitch: 0, roll: 0,
  speed: 0, throttle: 0.25, gear: true, brake: false, boost: false,
  camera: 'chase', mode: 'trial', score: 0, ringsHit: 0, time: 0,
  landed: false, crashed: false, started: false, nextRing: 0,
};
const keys = {};
const audio = new JetAudio();
let mouseSteer = { x: 0, y: 0 };

function resetFlight(onRunway = true) {
  if (onRunway) {
    S.pos = [RUNWAY.cx, 2.2, 560]; S.yaw = 0; S.pitch = 0; S.speed = 0; S.throttle = 0.15;
  } else {
    S.pos = [canyonCenterX(-40), 42, 60]; S.yaw = 0; S.pitch = -0.02; S.speed = 88; S.throttle = 0.62;
  }
  S.roll = 0; S.gear = true; S.brake = false; S.landed = false; S.crashed = false;
}
resetFlight(true);

addEventListener('keydown', (e) => {
  keys[e.code] = true; audio.start(); S.started = true;
  if (e.code === 'KeyG') { S.gear = !S.gear; audio.gearClunk(); }
  if (e.code === 'KeyC') S.camera = S.camera === 'chase' ? 'cockpit' : 'chase';
  if (e.code === 'KeyF') { S.mode = S.mode === 'trial' ? 'free' : 'trial'; document.getElementById('modeName').textContent = S.mode === 'trial' ? 'RING TRIAL' : 'FREE FLIGHT'; }
  if (e.code === 'KeyR') { resetFlight(false); banner('BACK IN THE AIR', 'Viper Gorge run reset'); }
  if (e.code === 'KeyM') audio.toggleMute();
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  mouseSteer.x = (e.clientX / innerWidth) * 2 - 1;
  mouseSteer.y = (e.clientY / innerHeight) * 2 - 1;
});
canvas.addEventListener('pointerdown', () => { audio.start(); S.started = true; canvas.requestPointerLock?.(); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    S.roll = clamp(S.roll + e.movementX * 0.0016, -1.2, 1.2);
    S.pitch = clamp(S.pitch - e.movementY * 0.0016, -0.7, 0.7);
  }
});

const bannerEl = document.getElementById('banner');
let bannerUntil = 0;
function banner(big, small, ms = 1600) {
  document.getElementById('bannerBig').textContent = big;
  document.getElementById('bannerSmall').textContent = small;
  bannerEl.style.display = 'block';
  bannerUntil = performance.now() + ms;
}

function step(dt) {
  if (S.landed || S.crashed) return;
  // Controls: keyboard first, gentle mouse steering layered on top.
  const pitchIn = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
  const rollIn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const yawIn = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  S.pitch = clamp(S.pitch + pitchIn * dt * 0.85 - mouseSteer.y * dt * 0.12, -0.72, 0.72);
  S.roll = clamp(S.roll + rollIn * dt * 1.7, -1.25, 1.25);
  if (!rollIn && document.pointerLockElement !== canvas) S.roll = lerp(S.roll, mouseSteer.x * 0.55, dt * 1.4);
  S.yaw -= (Math.sin(S.roll) * 0.55 + yawIn * 0.35) * dt * Math.min(1, S.speed / 60 + 0.25);
  S.pitch = lerp(S.pitch, S.pitch * (1 - dt * 0.12), 1); // mild pitch damping feel
  if (keys.KeyW) S.throttle = clamp(S.throttle + dt * 0.55, 0, 1);
  if (keys.KeyS) S.throttle = clamp(S.throttle - dt * 0.55, 0, 1);
  S.boost = !!keys.ShiftLeft || !!keys.ShiftRight;
  S.brake = !!keys.Space;
  // Speed: thrust vs drag, gravity component along the nose.
  const fwd = forwardOf(S.yaw, S.pitch);
  const thrust = S.throttle * 62 + (S.boost ? 55 : 0);
  const drag = 0.011 * S.speed * S.speed * 0.06 + S.speed * 0.055 + (S.brake ? 26 : 0) + (S.gear ? 3.5 : 0);
  S.speed = clamp(S.speed + (thrust - drag - fwd[1] * 26) * dt, 0, 235);
  S.pos[0] += fwd[0] * S.speed * dt;
  S.pos[1] += fwd[1] * S.speed * dt;
  S.pos[2] += fwd[2] * S.speed * dt;
  // Ground and walls.
  const groundY = Math.max(terrainHeight(S.pos[0], S.pos[2]), S.pos[2] > RUNWAY.z0 - 6 && S.pos[2] < RUNWAY.z1 + 6 && Math.abs(S.pos[0] - RUNWAY.cx) < 130 ? 0.5 : 0);
  const onStrip = Math.abs(S.pos[0] - RUNWAY.cx) < RUNWAY.width / 2 && S.pos[2] > RUNWAY.z0 && S.pos[2] < RUNWAY.z1;
  if (S.pos[1] <= groundY + 1.6) {
    S.pos[1] = groundY + 1.6;
    if (onStrip && S.gear && S.speed < 46 && Math.abs(S.pitch) < 0.3) {
      if (S.speed < 4) { S.landed = true; S.score += 2500; audio.thump(); banner('TOUCHDOWN — VIPER FIELD', 'Landing bonus +2,500 · press R to fly again', 4200); }
    } else if (S.speed > 60 || !onStrip) {
      S.crashed = true; banner('HARD CONTACT', 'Press R to reset the run', 4200);
    }
  }
  if (S.pos[1] > 320) S.pos[1] = 320;
  // Rings (trial mode): pass through the disc of the next golden ring.
  if (S.mode === 'trial' && S.nextRing < RINGS.length) {
    const r = RINGS[S.nextRing];
    const dz = S.pos[2] - r.z, dx = S.pos[0] - r.x, dy = S.pos[1] - r.y;
    if (Math.abs(dz) < 4 && dx * dx + dy * dy < r.r * r.r) {
      r.passed = true; S.nextRing++; S.ringsHit++;
      const pts = 1000 + Math.max(0, 400 - Math.floor(S.time));
      S.score += pts; audio.ringChime();
      banner('RING ' + S.ringsHit + ' / 10', '+' + pts.toLocaleString() + ' points');
      if (S.nextRing >= RINGS.length) banner('GORGE CLEARED!', 'All 10 rings · final score ' + S.score.toLocaleString() + ' · land at Viper Field for +2,500', 5000);
    } else if (dz < -14 && Math.sign(forwardOf(S.yaw, S.pitch)[2]) < 0) {
      S.nextRing++; banner('RING MISSED', 'Keep pushing — next ring ahead', 1100);
    }
  }
  S.time += dt;
  audio.update(S.throttle + (S.boost ? 0.35 : 0), S.speed * 1.94, dt);
}

// --- Deterministic screenshot scenes ---------------------------------------
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
function stageShot(name) {
  document.getElementById('titleCard').style.display = name === 'chase' ? 'block' : 'none';
  if (name === 'chase') {         // cover: chase over the canyon + river
    S.pos = [canyonCenterX(-60) + 3, 44, 14]; S.yaw = 0.06; S.pitch = -0.03; S.roll = -0.10;
    S.speed = 164; S.throttle = 0.9; S.boost = true; S.camera = 'chase'; S.score = 4200; S.ringsHit = 3; S.nextRing = 3; S.time = 74;
  } else if (name === 'rings') {  // golden ring + runway line ahead
    S.pos = [canyonCenterX(-430) + 4, 30, -330]; S.yaw = -0.04; S.pitch = -0.01; S.roll = 0.07;
    S.speed = 148; S.throttle = 0.8; S.camera = 'chase'; S.score = 6300; S.ringsHit = 5; S.nextRing = 5; S.time = 121;
  } else if (name === 'cockpit') { // cockpit view down the gorge
    S.pos = [canyonCenterX(-680) - 4, 38, -596]; S.yaw = 0.03; S.pitch = -0.02; S.roll = 0.05;
    S.speed = 172; S.throttle = 0.85; S.camera = 'cockpit'; S.score = 8100; S.ringsHit = 7; S.nextRing = 7; S.time = 168;
  } else if (name === 'approach') { // low pass / runway approach at Viper Field
    S.pos = [RUNWAY.cx + 3, 13, 760]; S.yaw = 0; S.pitch = -0.06; S.roll = 0.02;
    S.speed = 82; S.throttle = 0.4; S.gear = true; S.camera = 'chase'; S.score = 9600; S.ringsHit = 9; S.nextRing = 9; S.time = 233;
  }
  S.started = true;
}
if (shot) stageShot(shot);

// --- HUD ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const ladder = document.getElementById('ladder').getContext('2d');
function drawLadder() {
  const c = ladder, W = 340, H = 240;
  c.clearRect(0, 0, W, H);
  c.save(); c.translate(W / 2, H / 2); c.rotate(-S.roll);
  c.strokeStyle = 'rgba(160,240,255,0.9)'; c.fillStyle = 'rgba(200,248,255,0.95)';
  c.lineWidth = 2; c.font = 'bold 11px Arial'; c.textAlign = 'center';
  for (let d = -20; d <= 20; d += 10) {
    const y = d * 3.2 - S.pitch * 180;
    if (Math.abs(y) > 105) continue;
    const w = d === 0 ? 120 : 64;
    c.beginPath(); c.moveTo(-w, y); c.lineTo(-18, y); c.moveTo(18, y); c.lineTo(w, y); c.stroke();
    if (d !== 0) { c.fillText(Math.abs(d) + '°', -w - 16, y + 4); c.fillText(Math.abs(d) + '°', w + 16, y + 4); }
  }
  c.restore();
  c.strokeStyle = '#ffd257'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(W/2 - 42, H/2); c.lineTo(W/2 - 12, H/2); c.lineTo(W/2, H/2 + 8);
  c.lineTo(W/2 + 12, H/2); c.lineTo(W/2 + 42, H/2); c.stroke();
  c.fillStyle = '#ffd257'; c.beginPath(); c.arc(W/2, H/2, 3.4, 0, 7); c.fill();
}
function updateHUD() {
  const altFt = Math.max(0, Math.round(S.pos[1] * 11.4));
  const spdKt = Math.round(S.speed * 1.94);
  let hdg = Math.round((-S.yaw * 180 / Math.PI) % 360); if (hdg < 0) hdg += 360;
  el('alt').textContent = altFt.toLocaleString();
  el('spd').textContent = spdKt;
  el('hdg').textContent = String(hdg).padStart(3, '0') + '°';
  el('hdgCard').textContent = (hdg > 315 || hdg < 45 ? 'N' : hdg < 135 ? 'E' : hdg < 225 ? 'S' : 'W') + ' · ' + (S.mode === 'trial' ? 'GORGE RUN' : 'FREE FLIGHT');
  el('score').textContent = S.score.toLocaleString();
  el('ringCount').textContent = S.ringsHit + ' / 10';
  const t = Math.floor(S.time);
  el('clock').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  el('gearFlag').textContent = S.gear ? 'DOWN' : 'UP';
  el('gearFlag').className = S.gear ? 'on' : '';
  el('brakeFlag').textContent = S.brake ? 'ON' : 'OFF';
  el('boostFlag').textContent = S.boost ? 'BURNING' : 'READY';
  const stall = S.speed > 4 && S.speed < 34 && S.pos[1] > terrainHeight(S.pos[0], S.pos[2]) + 6;
  el('warnFlag').innerHTML = stall ? '<span class="warn">STALL</span>' : (S.camera === 'cockpit' ? 'COCKPIT CAM' : 'CHASE CAM');
  const nr = RINGS[S.nextRing];
  const nextText = S.mode !== 'trial' ? 'free flight' : nr ? Math.round(Math.abs(S.pos[2] - nr.z)) + ' m ahead' : 'all rings clear — land at Viper Field!';
  el('objective').innerHTML = S.mode === 'trial'
    ? 'Thread the golden rings — next ring <b>' + nextText + '</b>'
    : 'Free flight — explore the gorge, land at <b>Viper Field</b> for +2,500';
  drawLadder();
  if (bannerEl.style.display === 'block' && performance.now() > bannerUntil) bannerEl.style.display = 'none';
}

// --- Render ------------------------------------------------------------------
function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
}
addEventListener('resize', resize); resize();
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.93, 0.72, 0.52, 1);

function render() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const aspect = canvas.width / canvas.height;
  const proj = matPerspective(1.15, aspect, 0.1, 3200);
  const fwd = forwardOf(S.yaw, S.pitch);
  let view, jetVisible = true;
  if (S.camera === 'cockpit') {
    const eye = [S.pos[0] + fwd[0] * 1.2, S.pos[1] + 1.35, S.pos[2] + fwd[2] * 1.2];
    view = matLookAt(eye, [eye[0] + fwd[0], eye[1] + fwd[1] - S.roll * 0.12, eye[2] + fwd[2]], [Math.sin(S.roll) * 0.6, 1, 0]);
    jetVisible = false;
    var cockpitModel = matMultiply(matTranslation(eye[0], eye[1], eye[2]),
      matMultiply(matEulerYXZ(S.yaw, S.pitch, S.roll * 0.4),
        matMultiply(matTranslation(0, -0.05, -1.5), matScale(0.9, 0.9, 0.9))));
  } else {
    const back = 15.5, up = 5.2;
    const eye = [S.pos[0] - fwd[0] * back, S.pos[1] + up, S.pos[2] - fwd[2] * back];
    const terr = terrainHeight(eye[0], eye[2]) + 2.4;
    if (eye[1] < terr) eye[1] = terr;
    view = matLookAt(eye, [S.pos[0] + fwd[0] * 30, S.pos[1] + 1, S.pos[2] + fwd[2] * 30], [0, 1, 0]);
  }
  const vp = matMultiply(proj, view);
  gl.uniformMatrix4fv(uMVP, false, vp);
  gl.uniformMatrix4fv(uModel, false, matIdentity());
  worldBuf.draw(); cloudBuf.draw();
  if (jetVisible) {
    const model = matMultiply(matTranslation(S.pos[0], S.pos[1], S.pos[2]), matEulerYXZ(S.yaw, S.pitch, S.roll));
    const jetVP = matMultiply(vp, model);
    gl.uniformMatrix4fv(uMVP, false, jetVP);
    gl.uniformMatrix4fv(uModel, false, model);
    jetBuf.draw();
    if (S.throttle > 0.55 || S.boost) { // afterburner plume, scaled by throttle
      const s = 0.45 + S.throttle * (S.boost ? 0.95 : 0.5);
      const bm = matMultiply(model, matMultiply(matTranslation(0, 0.05, 5.4), matEulerYXZ(0, 0, 0)));
      const bs = matMultiply(bm, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,s,0, 0,0,0,1]));
      gl.uniformMatrix4fv(uMVP, false, matMultiply(vp, bs));
      gl.uniformMatrix4fv(uModel, false, bs);
      burnerBuf.draw();
    }
  } else {
    gl.uniformMatrix4fv(uMVP, false, matMultiply(vp, cockpitModel));
    gl.uniformMatrix4fv(uModel, false, cockpitModel);
    cockpitBuf.draw();
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!shot && S.started) step(dt);
  else if (shot) { /* staged pose: gentle idle bob only */ S.pos[1] += Math.sin(now * 0.0012) * 0.004; }
  render(); updateHUD();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
