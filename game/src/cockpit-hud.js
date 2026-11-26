// cockpit-hud.js — the glass-cockpit overlay: ALT / SPD / HDG tapes, FUEL and
// DMG resource bars, an artificial-horizon pitch ladder (canvas), a corner
// minimap radar (canvas: gorge outline, runway, ring waypoints, ownship), the
// mission score block, and transient event banners. All DOM is cached once;
// update() runs per frame and touches only changed text.
'use strict';

class Hud {
  constructor(doc) {
    const $ = (id) => doc.getElementById(id);
    this.el = {
      alt: $('hud-alt'), spd: $('hud-spd'), hdg: $('hud-hdg'), thr: $('hud-thr'),
      gear: $('hud-gear'), score: $('hud-score'), rings: $('hud-rings'), clock: $('hud-clock'),
      mode: $('hud-mode'), next: $('hud-next'), banner: $('banner'),
      fuelBar: $('fuel-bar'), fuelTxt: $('fuel-txt'), dmgBar: $('dmg-bar'), dmgTxt: $('dmg-txt'),
      ladder: $('ladder').getContext('2d'), radar: $('radar').getContext('2d'),
    };
    this.bannerUntil = 0;
  }
  banner(text, ms = 1600) {
    this.el.banner.textContent = text;
    this.el.banner.style.opacity = '1';
    this.bannerUntil = performance.now() + ms;
  }
  update(f, trial, mode, now) {
    const e = this.el;
    if (now > this.bannerUntil) e.banner.style.opacity = '0';
    e.alt.textContent = String(f.altitudeFt).padStart(5, '0');
    e.spd.textContent = String(f.speedKnots).padStart(3, '0');
    e.hdg.textContent = String(Math.round(f.headingDeg)).padStart(3, '0');
    e.thr.textContent = Math.round(f.throttle * 100) + '%' + (f.boost ? ' BURN' : '');
    e.gear.textContent = f.gear ? 'GEAR ▼' : 'GEAR ▲';
    e.gear.style.color = f.gear ? '#7dff9a' : '#8fa3b0';
    e.fuelBar.style.width = f.fuel.toFixed(0) + '%';
    e.fuelBar.style.background = f.fuel < 25 ? '#ff5348' : f.fuel < 50 ? '#ffb02e' : '#39d353';
    e.fuelTxt.textContent = f.fuel.toFixed(0) + '%';
    e.dmgBar.style.width = f.dmg.toFixed(0) + '%';
    e.dmgTxt.textContent = f.dmg.toFixed(0) + '%';
    e.dmgTxt.style.color = f.dmg > 50 ? '#ff5348' : '#ffb02e';
    e.score.textContent = String(trial.score).padStart(6, '0');
    e.rings.textContent = trial.passed + ' / 10';
    const t = Math.max(0, Math.ceil(trial.timeLeft));
    e.clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    e.mode.textContent = mode;
    if (trial.next < RING_CENTRES.length && mode !== 'FREE FLIGHT') {
      const c = RING_CENTRES[trial.next];
      const d = Math.round(Math.hypot(f.pos[0] - c[0], f.pos[2] - c[2]));
      e.next.textContent = 'RING ' + (trial.next + 1) + ' · ' + d + ' m';
    } else e.next.textContent = mode === 'FREE FLIGHT' ? 'LAND AT VIPER FIELD' : 'ALL RINGS FLOWN';
    this._ladder(f);
    this._radar(f, trial);
  }
  _ladder(f) {
    const ctx = this.el.ladder, W = 190, H = 150, cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.rect(6, 6, W - 12, H - 12); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-f.roll);
    const pxPerDeg = 1.6, off = -f.pitch * 180 / Math.PI * pxPerDeg;
    ctx.fillStyle = 'rgba(46,110,180,0.55)'; ctx.fillRect(-W, -H + off, W * 2, H);
    ctx.fillStyle = 'rgba(122,84,40,0.55)'; ctx.fillRect(-W, off, W * 2, H);
    ctx.strokeStyle = '#eaf6ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-W, off); ctx.lineTo(W, off); ctx.stroke();
    ctx.font = '10px monospace'; ctx.fillStyle = '#cfe9ff'; ctx.lineWidth = 1;
    for (const d of [-20, -10, 10, 20]) {
      const y = off - d * pxPerDeg, w = d % 20 === 0 ? 34 : 22;
      ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(-8, y); ctx.moveTo(8, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(String(Math.abs(d)), -w - 16, y + 3); ctx.fillText(String(Math.abs(d)), w + 4, y + 3);
    }
    ctx.restore();
    ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 34, cy); ctx.lineTo(cx - 10, cy); ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx + 10, cy); ctx.lineTo(cx + 34, cy); ctx.stroke();
    ctx.strokeStyle = 'rgba(140,220,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(6, 6, W - 12, H - 12);
  }
  // Minimap radar: north-up plot of the gorge S-curve, runway strip, ring
  // waypoints (next one hot), and the ownship triangle rotated to heading.
  _radar(f, trial) {
    const ctx = this.el.radar, S = 148, cx = S / 2;
    const map = (x, z) => [cx + x * 0.075, 132 + z * 0.075]; // z 660 -> bottom, -1520 -> top
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(6,20,28,0.88)'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(120,220,255,0.25)';
    for (const r of [26, 52]) { ctx.beginPath(); ctx.arc(cx, 74, r, 0, 7); ctx.stroke(); }
    // gorge path
    ctx.strokeStyle = 'rgba(255,176,46,0.5)'; ctx.lineWidth = 5; ctx.beginPath();
    for (let z = 60; z >= -1520; z -= 60) { const [x, y] = map(gorgeCentreX(z), z); z === 60 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    // runway
    const [rx, ry] = map(0, 455);
    ctx.fillStyle = '#9fe8ff'; ctx.fillRect(rx - 2, ry - 12, 4, 24);
    // rings
    RING_CENTRES.forEach((c, i) => {
      const [x, y] = map(c[0], c[2]);
      ctx.fillStyle = i < trial.next ? 'rgba(140,255,160,0.85)' : i === trial.next ? '#ffd23e' : 'rgba(255,190,80,0.45)';
      ctx.beginPath(); ctx.arc(x, y, i === trial.next ? 4 : 2.6, 0, 7); ctx.fill();
    });
    // ownship
    const [ax, ay] = map(f.pos[0], f.pos[2]);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(f.yaw);
    ctx.fillStyle = '#54f0ff';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2.4); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(190,235,255,0.8)'; ctx.font = '9px monospace';
    ctx.fillText('RADAR', 6, 12); ctx.fillText('N', cx - 3, 12);
  }
}
