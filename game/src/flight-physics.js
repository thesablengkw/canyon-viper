// flight-physics.js — the VF-9's flight model and resource systems.
// One FlightState stepped at a fixed dt: arcade-true aerodynamics (lift curve,
// induced drag, coordinated turns), throttle/boost, landing gear drag, and the
// two resources the HUD tracks — FUEL (burns with throttle, faster on boost)
// and DMG (hull integrity, lost to wall scrapes and hard ground contact).
'use strict';

class FlightState {
  constructor() { this.reset(); }
  reset() {
    this.pos = [0, 26, 660];            // lined up south of Viper Field, facing the gorge
    this.yaw = 0; this.pitch = 0; this.roll = 0;   // yaw 0 = north, down-gorge
    this.throttle = 0.62;
    this.speed = 88;                    // m/s along the nose
    this.boost = false; this.brake = false; this.gear = true;
    this.fuel = 100;                    // percent
    this.dmg = 0;                       // percent hull damage
    this.crashed = false;
    this.scrapeCooldown = 0;
  }
  get headingDeg() { return ((this.yaw * 180 / Math.PI) % 360 + 360) % 360; }
  get speedKnots() { return Math.round(this.speed * 1.944); }
  get altitudeFt() { return Math.round(this.pos[1] * 3.281); }
  forward() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }
  // input: {pitch, roll, yaw} in -1..1, throttleDelta, toggles handled by caller.
  step(dt, input, groundY) {
    if (this.crashed) return;
    this.throttle = Math.min(1, Math.max(0, this.throttle + (input.throttleDelta || 0) * dt * 0.55));
    this.boost = !!input.boost && this.fuel > 0;
    this.brake = !!input.brake;
    if (input.toggleGear) this.gear = !this.gear;

    // Control response scales with airspeed (dead stick at a standstill).
    const authority = Math.min(1, this.speed / 55);
    this.pitch += input.pitch * 1.15 * authority * dt;
    this.pitch = Math.max(-1.05, Math.min(1.05, this.pitch));
    this.roll += (input.roll * 2.3 * authority - this.roll * 2.6) * dt;
    this.roll = Math.max(-1.35, Math.min(1.35, this.roll));
    this.yaw -= (Math.sin(this.roll) * 0.62 * authority + input.yaw * 0.35) * dt;

    // Thrust vs drag: boost punches through, brake and gear add drag.
    const thrust = this.fuel > 0 ? this.throttle * 26 * (this.boost ? 1.9 : 1) : 0;
    let drag = 0.028 * this.speed + (this.brake ? 9 : 0) + (this.gear ? 2.4 : 0);
    drag += Math.abs(Math.sin(this.roll)) * 2.2;              // turning bleeds energy
    const gravityAlong = -9.8 * Math.sin(this.pitch) * 0.62; // dives gain, climbs cost
    this.speed += (thrust - drag + gravityAlong) * dt;
    this.speed = Math.max(0, Math.min(168, this.speed));

    // Fuel burn: cruise sips, boost gulps. Empty tank = glide.
    const burn = (0.055 + this.throttle * 0.11 + (this.boost ? 0.30 : 0)) * dt;
    this.fuel = Math.max(0, this.fuel - burn);

    const f = this.forward();
    this.pos[0] += f[0] * this.speed * dt;
    this.pos[1] += f[1] * this.speed * dt;
    this.pos[2] += f[2] * this.speed * dt;

    // Ground contact: gentle + gear + slow = rolling; anything else hurts.
    const floor = groundY(this.pos[0], this.pos[2]) + 2.2;
    this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);
    if (this.pos[1] <= floor) {
      this.pos[1] = floor;
      const sink = -f[1] * this.speed;
      const gentle = this.gear && sink < 6 && Math.abs(this.roll) < 0.3 && this.speed < 62;
      if (!gentle) {
        this.dmg = Math.min(100, this.dmg + Math.max(6, sink * 1.6));
        if (this.dmg >= 100 || sink > 16) this.crashed = true;
        this.speed *= 0.55; this.pitch = Math.max(0, this.pitch);
      }
    }
    // Canyon wall scrape: caller reports clearance each frame.
    if (input.wallClearance !== undefined && input.wallClearance < 3.2 && this.scrapeCooldown <= 0 && this.speed > 20) {
      this.dmg = Math.min(100, this.dmg + 4);
      this.scrapeCooldown = 0.7;
      if (this.dmg >= 100) this.crashed = true;
    }
  }
}

// Keyboard + mouse input. Arrows / WASD pitch & roll, Q/E rudder, Shift boost,
// Space airbrake, W/S or PgUp/PgDn throttle, G gear, C camera, F free flight,
// R reset, P pause. Mouse steers while the pointer is held down.
class InputRig {
  constructor(canvas) {
    this.keys = new Set(); this.mouseDX = 0; this.mouseDY = 0; this.mouseDown = false;
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyG') this.gearQueued = true;
      if (e.code === 'KeyC') this.cameraQueued = true;
      if (e.code === 'KeyF') this.freeQueued = true;
      if (e.code === 'KeyR') this.resetQueued = true;
      if (e.code === 'KeyP') this.pauseQueued = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('mousedown', () => { this.mouseDown = true; });
    addEventListener('mouseup', () => { this.mouseDown = false; });
    addEventListener('mousemove', (e) => {
      if (!this.mouseDown) return;
      this.mouseDX += e.movementX || 0; this.mouseDY += e.movementY || 0;
    });
  }
  sample() {
    const k = this.keys;
    let pitch = 0, roll = 0, yaw = 0, throttleDelta = 0;
    if (k.has('ArrowDown')) pitch += 1;
    if (k.has('ArrowUp')) pitch -= 1;
    if (k.has('ArrowLeft') || k.has('KeyA')) roll -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) roll += 1;
    if (k.has('KeyQ')) yaw -= 1;
    if (k.has('KeyE')) yaw += 1;
    if (k.has('PageUp') || k.has('Equal')) throttleDelta += 1;
    if (k.has('PageDown') || k.has('Minus')) throttleDelta -= 1;
    if (this.mouseDown) {
      roll += Math.max(-1, Math.min(1, this.mouseDX * 0.012));
      pitch += Math.max(-1, Math.min(1, this.mouseDY * 0.010));
      this.mouseDX = 0; this.mouseDY = 0;
    }
    const out = {
      pitch, roll, yaw, throttleDelta,
      boost: k.has('ShiftLeft') || k.has('ShiftRight'),
      brake: k.has('Space'),
      toggleGear: !!this.gearQueued, toggleCamera: !!this.cameraQueued,
      toggleFree: !!this.freeQueued, reset: !!this.resetQueued, togglePause: !!this.pauseQueued,
    };
    this.gearQueued = this.cameraQueued = this.freeQueued = this.resetQueued = this.pauseQueued = false;
    return out;
  }
}
