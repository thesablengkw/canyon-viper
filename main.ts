// Canyon Viper — entrypoint for the make.fun program/v1 harness (Node 22).
//
// The game itself is the static site in game/ (open game/index.html in a
// desktop browser, fully offline). This program hands the entry in: it
// copies game/ and screenshots/ into the output directory and writes
// dossier.json with the vendored make.fun library, byte-for-byte the way
// the scorer rebuilds it, so a mismatch fails here first, not on the site.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play it:    serve game/ with any static server and open index.html.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-game.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

mkdirSync(outDir, { recursive: true });
cpSync(join(root, "game"), join(outDir, "game"), { recursive: true });

const shotsDir = join(root, "screenshots");
if (existsSync(shotsDir)) {
  mkdirSync(join(outDir, "screenshots"), { recursive: true });
  cpSync(shotsDir, join(outDir, "screenshots"), { recursive: true });
}

// Caps from the bounty's gate: at most 4 screenshots of 256 KiB each,
// at most 993 files / 48 MiB under game/, paths at most 1000 bytes,
// and the dossier text block capped at 160 KiB.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, "dossier.json"), dossier);

console.log("Canyon Viper handed in: game/ + screenshots/ + dossier.json ->", outDir);
if (!existsSync(join(outDir, "game", "index.html"))) throw new Error("game/index.html missing from output");
const shotCount = readdirSync(join(outDir, "screenshots")).filter((f) => /\.(png|jpe?g)$/i.test(f)).length;
console.log("entry verified: game/index.html present,", shotCount, "screenshots, dossier bytes:", dossier.length);
