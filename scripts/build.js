/**
 * Packages the Chrome extension into a .zip ready for Chrome Web Store upload.
 * Usage: node scripts/build.js
 * Output: dist/fill-a-form-ai-v<version>.zip
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const INCLUDE = [
  'manifest.json',
  'background',
  'content',
  'popup',
  'utils',
  'icons',
];

const EXCLUDE = [
  'node_modules',
  '.git',
  'backend',
  'scripts',
  'store',
  'dist',
  '*.md',
  '.env*',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
}

function build() {
  const manifest = readManifest();
  const version = manifest.version;
  const outFile = path.join(DIST, `fill-a-form-ai-v${version}.zip`);

  ensureDir(DIST);

  // Remove existing zip if present
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

  // Build include list for zip
  const includeArgs = INCLUDE.join(' ');

  // Use system zip (available on macOS/Linux; use 7z on Windows)
  const cmd = `cd "${ROOT}" && zip -r "${outFile}" ${includeArgs} -x "*.DS_Store" -x "__MACOSX/*"`;
  execSync(cmd, { stdio: 'inherit' });

  const stat = fs.statSync(outFile);
  const kb = (stat.size / 1024).toFixed(1);
  console.log(`\n✓ Built: ${outFile} (${kb} KB)`);
  console.log(`  Version: ${version}`);
  console.log(`  Upload at: https://chrome.google.com/webstore/devconsole\n`);
}

build();
