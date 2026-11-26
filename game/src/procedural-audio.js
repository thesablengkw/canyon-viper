// procedural-audio.js — all sound is synthesized with the Web Audio API.
// No audio files exist: a jet is a sawtooth + filtered noise whose pitch and
// growl track RPM, wind is band-passed noise tracking airspeed, and UI events
// (ring chime, landing thump, scrape, warning) are small oscillator envelopes.
// Starts on the first user gesture, as browser autoplay rules require.
'use strict';

class JetAudio {
  constructor() { this.ctx = null; this.started = false; }
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.16;
    this.master.connect(ctx.destination);
    // Engine: two detuned saws through a low-pass, gain follows throttle.
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 640; lp.Q.value = 2;
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth'; this.oscA.frequency.value = 58;
    this.oscB = ctx.createOscillator(); this.oscB.type = 'sawtooth'; this.oscB.frequency.value = 58 * 1.007;
    this.oscA.connect(lp); this.oscB.connect(lp); lp.connect(this.engGain); this.engGain.connect(this.master);
    this.oscA.start(); this.oscB.start();
    // Wind: looping noise buffer through a band-pass.
    const len = ctx.sampleRate * 1.4, buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 480; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    src.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
    src.start();
    this.started = true;
  }
  update(f) {
    if (!this.started) return;
    const t = this.ctx.currentTime, rpm = 46 + f.throttle * 92 + (f.boost ? 26 : 0);
    this.oscA.frequency.setTargetAtTime(rpm, t, 0.08);
    this.oscB.frequency.setTargetAtTime(rpm * 1.007, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.10 + f.throttle * 0.30, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.5, f.speed / 300), t, 0.12);
    this.windFilter.frequency.setTargetAtTime(280 + f.speed * 5.2, t, 0.12);
  }
  blip(freq, dur, gain = 0.3, type = 'sine') {
    if (!this.started) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  ring() { this.blip(880, 0.16, 0.32); setTimeout(() => this.blip(1318, 0.24, 0.3), 70); }
  miss() { this.blip(196, 0.3, 0.28, 'square'); }
  thump() { this.blip(72, 0.22, 0.5, 'triangle'); }
  scrape() { this.blip(2400, 0.09, 0.12, 'sawtooth'); }
}
