// Canyon Viper — the aircraft: "VF-9 Viper", a twin-tail desert interceptor.
// Sculpted from tapered frustum sections (never a single box): pointed nose,
// chined forebody, bubble canopy with lit instruments, swept wings with
// cyan wingtip lights, twin canted tails, twin exhausts and a dynamic
// afterburner plume. Local space: nose points to -Z, +Y is up.

import { GeoBuilder, matRotZ, matMultiply, matTranslation } from './math3d.js';

const HULL = [0.62, 0.60, 0.56];       // sun-bleached desert grey
const HULL_DARK = [0.38, 0.37, 0.35];
const ACCENT = [0.85, 0.42, 0.12];    // viper orange cheatline
const CANOPY = [0.10, 0.28, 0.38];
const CYAN = [0.35, 0.95, 1.0];

export function buildJet() {
  const g = new GeoBuilder();
  // Fuselage: three tapered sections, nose to tail.
  g.frustum(0, 0, -6.4, 0.5, 0.5, 1.5, 1.3, 3.6, HULL);          // nose cone
  g.frustum(0, 0.05, -3.2, 1.5, 1.3, 2.0, 1.7, 3.4, HULL);       // forebody
  g.frustum(0, 0.1, 0.6, 2.0, 1.7, 2.2, 1.8, 4.2, HULL);         // mid body
  g.frustum(0, 0.15, 4.2, 2.2, 1.8, 1.7, 1.3, 3.2, HULL_DARK);   // tail cone
  g.box(0, -0.28, -3.4, 2.06, 0.22, 3.2, ACCENT);               // orange cheatline band
  // Bubble canopy with a lit instrument coaming inside.
  g.frustum(0, 0.95, -2.5, 1.25, 0.9, 0.8, 0.6, 2.6, CANOPY, 0.35);
  g.box(0, 0.78, -3.55, 1.1, 0.28, 0.5, [0.06, 0.10, 0.10], 0.9); // glowing panel face
  g.box(-0.3, 0.86, -3.5, 0.22, 0.1, 0.3, [0.3, 1.0, 0.55], 1.0); // MFD green
  g.box(0.3, 0.86, -3.5, 0.22, 0.1, 0.3, [1.0, 0.72, 0.25], 1.0); // MFD amber
  // Swept main wings (thin boxes sheared by rotation) + wingtip lights.
  const wingL = matMultiply(matTranslation(-3.4, -0.15, 0.9), matRotZ(0.06));
  const wingR = matMultiply(matTranslation(3.4, -0.15, 0.9), matRotZ(-0.06));
  g.box(0, 0, 0, 5.2, 0.16, 2.2, HULL, 0, wingL);
  g.box(0, 0, 0, 5.2, 0.16, 2.2, HULL, 0, wingR);
  g.box(-6.05, -0.05, 1.6, 0.5, 0.3, 0.9, CYAN, 1.0);            // left wingtip light (cyan)
  g.box(6.05, -0.05, 1.6, 0.5, 0.3, 0.9, CYAN, 1.0);             // right wingtip light (cyan)
  g.box(-6.05, -0.05, 0.5, 0.4, 0.24, 0.5, [1.0, 0.3, 0.25], 0.9); // port red marker
  // Twin canted vertical tails with orange tips.
  for (const s of [-1, 1]) {
    const tail = matMultiply(matTranslation(s * 1.05, 1.15, 3.9), matRotZ(s * -0.28));
    g.box(0, 0, 0, 0.18, 2.1, 1.7, HULL_DARK, 0, tail);
    const tip = matMultiply(matTranslation(s * 1.34, 2.2, 3.9), matRotZ(s * -0.28));
    g.box(0, 0, 0, 0.2, 0.5, 1.5, ACCENT, 0.25, tip);
    g.box(s * 0.62, -0.1, 5.15, 0.85, 0.8, 0.5, [0.12, 0.12, 0.13], 0.4); // exhaust nozzle
  }
  // Horizontal stabilators.
  g.box(-1.9, 0.25, 4.6, 2.6, 0.13, 1.3, HULL);
  g.box(1.9, 0.25, 4.6, 2.6, 0.13, 1.3, HULL);
  // Intakes under the chines.
  g.box(-1.25, -0.55, -0.6, 0.9, 0.7, 2.6, [0.15, 0.15, 0.16]);
  g.box(1.25, -0.55, -0.6, 0.9, 0.7, 2.6, [0.15, 0.15, 0.16]);
  // Landing gear (drawn always; the G key toggles its HUD state and drag).
  for (const [gx, gz] of [[0, -3.4], [-1.5, 1.2], [1.5, 1.2]]) {
    g.cylinder(gx, -1.05, gz, 0.16, 0.9, 8, [0.2, 0.2, 0.2], 0, 'z');
    g.cylinder(gx, -1.5, gz, 0.42, 0.3, 10, [0.08, 0.08, 0.09], 0, 'x');
  }
  return g.build();
}

// Afterburner plumes: one nested cone pair per exhaust nozzle (x = ±0.62),
// rebuilt cheaply by scaling this geometry along Z with the throttle.
export function buildBurner() {
  const g = new GeoBuilder();
  for (const s of [-0.62, 0.62]) {
    g.frustum(s, 0, 0.65, 0.58, 0.58, 0.06, 0.06, 1.3, [1.0, 0.50, 0.10], 0.9);  // orange outer
    g.frustum(s, 0, 0.45, 0.36, 0.36, 0.03, 0.03, 0.9, [0.45, 0.72, 1.0], 0.9);  // blue core
    g.frustum(s, 0, 0.2, 0.22, 0.22, 0.12, 0.12, 0.4, [0.95, 0.97, 1.0], 0.9);    // white throat
  }
  return g.build();
}

// Cockpit frame for the cockpit camera: glareshield, lit MFDs, HUD glass.
export function buildCockpit() {
  const g = new GeoBuilder();
  const dash = [0.07, 0.08, 0.09];
  g.box(0, -0.62, -1.15, 3.4, 0.75, 0.7, dash);                       // instrument panel
  g.box(0, -0.16, -0.95, 3.2, 0.26, 0.35, dash);                      // glareshield
  // Three lit multifunction displays + standby gauges, proud of the panel face.
  g.box(-0.85, -0.55, -0.76, 0.62, 0.5, 0.06, [0.16, 0.85, 0.45], 1.0);
  g.box(0, -0.55, -0.76, 0.62, 0.5, 0.06, [0.95, 0.65, 0.20], 1.0);
  g.box(0.85, -0.55, -0.76, 0.62, 0.5, 0.06, [0.30, 0.80, 1.0], 1.0);
  g.box(-1.35, -0.92, -0.76, 0.3, 0.22, 0.06, [0.9, 0.9, 0.85], 0.8);
  g.box(1.35, -0.92, -0.76, 0.3, 0.22, 0.06, [0.9, 0.4, 0.3], 0.8);
  // Screen graphics on the MFDs: dark horizon lines and data bars.
  for (const mx of [-0.85, 0, 0.85]) {
    g.box(mx, -0.55, -0.79, 0.5, 0.045, 0.02, [0.05, 0.10, 0.08], 0.4);
    g.box(mx - 0.14, -0.38, -0.79, 0.2, 0.05, 0.02, [0.05, 0.10, 0.08], 0.4);
    g.box(mx + 0.12, -0.70, -0.79, 0.24, 0.05, 0.02, [0.05, 0.10, 0.08], 0.4);
  }
  // Canopy frame pillars and the HUD combiner glass.
  const pilL = matMultiply(matTranslation(-1.45, 0.35, -0.9), matRotZ(0.35));
  const pilR = matMultiply(matTranslation(1.45, 0.35, -0.9), matRotZ(-0.35));
  g.box(0, 0, 0, 0.14, 1.5, 0.14, dash, 0, pilL);
  g.box(0, 0, 0, 0.14, 1.5, 0.14, dash, 0, pilR);
  g.box(0, 0.40, -0.95, 0.50, 0.34, 0.03, [0.55, 0.95, 0.75], 0.10);   // HUD glass
  g.box(0, -0.95, -0.30, 0.16, 0.5, 0.16, dash);                      // control stick
  return g.build();
}
