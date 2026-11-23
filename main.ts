// BLACKWATER CIENAGA 3D — entrypoint (Node 22 stdlib only, erasable TypeScript).
// Copies game/ and screenshots/ into the output directory and writes the
// make.fun dossier for them, deterministically: same input, same bytes out.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Fail loudly on a bad input tree instead of silently shipping an empty dossier:
// a missing game/index.html or an empty screenshots/ folder means the build
// ran against the wrong directory, and that must never reach the grader.
if (!existsSync(join(repoDir, 'game', 'index.html'))) {
  throw new Error('blackwater-cienaga-3d: game/index.html missing under ' + repoDir);
}
const shotNames = readdirSync(join(repoDir, 'screenshots')).filter((n) => !n.startsWith('.'));
if (shotNames.length === 0) {
  throw new Error('blackwater-cienaga-3d: screenshots/ is empty under ' + repoDir);
}

function copyTree(srcDir: string, dstDir: string): number {
  mkdirSync(dstDir, { recursive: true });
  let files = 0;
  const names = readdirSync(srcDir).sort();
  for (const name of names) {
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    const st = statSync(src);
    if (st.isDirectory()) {
      files += copyTree(src, dst);
    } else if (st.isFile()) {
      writeFileSync(dst, readFileSync(src));
      files++;
    }
  }
  return files;
}

const gameFiles = copyTree(join(repoDir, 'game'), join(outDir, 'game'));
const shotFiles = copyTree(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
if (dossier.length < 100) {
  throw new Error('blackwater-cienaga-3d: buildDossier returned a suspiciously short dossier (' + dossier.length + ' bytes)');
}
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log(`blackwater-cienaga-3d: copied ${gameFiles} game files and ${shotFiles} screenshots to ${outDir}`);
console.log(`blackwater-cienaga-3d: dossier.json written (${dossier.length} bytes)`);
