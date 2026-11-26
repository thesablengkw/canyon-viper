// Canyon Viper — procedural sound with the Web Audio API. No audio files:
// a jet is two detuned saw oscillators through a low-pass (the turbine),
// a filtered noise loop (the wind), and short oscillator blips for the
// ring chime, gear clunk and touchdown thump. Starts on first input,
// because browsers require a user gesture before making noise.

export class JetAudio {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    // Turbine: saw pair + lowpass, gain follows throttle.
    this.turbGain = ctx.createGain(); this.turbGain.gain.value = 0.0;
    this.turbFilter = ctx.createBiquadFilter();
    this.turbFilter.type = 'lowpass'; this.turbFilter.frequency.value = 400;
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth'; this.oscA.frequency.value = 55;
    this.oscB = ctx.createOscillator(); this.oscB.type = 'sawtooth'; this.oscB.frequency.value = 55.7;
    this.oscA.connect(this.turbFilter); this.oscB.connect(this.turbFilter);
    this.turbFilter.connect(this.turbGain); this.turbGain.connect(ctx.destination);
    this.oscA.start(); this.oscB.start();
    // Wind: looping white-noise buffer through a bandpass.
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.windSrc = ctx.createBufferSource(); this.windSrc.buffer = buf; this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    this.windSrc.connect(this.windFilter); this.windFilter.connect(this.windGain);
    this.windGain.connect(ctx.destination); this.windSrc.start();
  }
  update(throttle, speedKts, dt) {
    if (!this.ctx) return;
    if (this.muted) { // keep both loops silent while muted, not just the turbine
      this.turbGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      return;
    }
    const t = this.ctx.currentTime;
    const rpm = 50 + throttle * 130;
    this.oscA.frequency.setTargetAtTime(rpm, t, 0.08);
    this.oscB.frequency.setTargetAtTime(rpm * 1.013 + 4, t, 0.08);
    this.turbFilter.frequency.setTargetAtTime(300 + throttle * 1600, t, 0.1);
    this.turbGain.gain.setTargetAtTime(0.015 + throttle * 0.075, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(280 + speedKts * 1.6, t, 0.15);
    this.windGain.gain.setTargetAtTime(Math.min(0.11, speedKts / 4200), t, 0.15);
  }
  blip(freq, dur = 0.16, type = 'sine', vol = 0.12, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  ringChime() { this.blip(880, 0.14); this.blip(1318, 0.22, 'sine', 0.12, 0.09); }
  gearClunk() { this.blip(140, 0.12, 'square', 0.08); this.blip(95, 0.16, 'square', 0.07, 0.1); }
  thump() { this.blip(70, 0.25, 'sine', 0.2); }
  stallWarn() { this.blip(440, 0.1, 'square', 0.05); }
  toggleMute() { this.muted = !this.muted; if (this.turbGain) this.turbGain.gain.value = 0; return this.muted; }
}
