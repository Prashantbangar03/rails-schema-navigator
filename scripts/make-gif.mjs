#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const framesDir = process.argv[2];
  const outPath = process.argv[3];
  if (!framesDir || !outPath) {
    console.error('usage: make-gif.mjs <frames-dir> <out.gif>');
    process.exit(1);
  }

  let pngToGif;
  try {
    pngToGif = require('png-to-gif');
  } catch {
    console.warn('png-to-gif not installed; skipping GIF. Run: npm install --no-save png-to-gif');
    process.exit(0);
  }

  const files = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => path.join(framesDir, f));

  if (files.length < 2) {
    console.warn('not enough frames for GIF');
    process.exit(0);
  }

  const buffers = files.map((f) => fs.readFileSync(f));
  const gif = await pngToGif(buffers, { delay: 35, repeat: 0 });
  fs.writeFileSync(outPath, gif);
  console.log(`wrote ${outPath} (${files.length} frames)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
