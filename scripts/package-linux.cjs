'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const OUT_DIR = path.join(DIST, 'wide-app-linux-x64');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const LINUX_ZIP = 'C:\\Users\\yusuf\\Downloads\\electron-v41.7.1-linux-x64.zip';
const ZSTD = 'C:\\Users\\yusuf\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Meta.Zstandard_Microsoft.Winget.Source_8wekyb3d8bbwe\\zstd-v1.5.7-win64\\zstd.exe';

const mainOut = path.join(ROOT, 'out', 'main', 'index.js');
const rendererOut = path.join(ROOT, 'out', 'renderer', 'index.html');
if (!fs.existsSync(mainOut) || !fs.existsSync(rendererOut)) {
  console.log('Derlenmis dosyalar eksik, derleme baslatiliyor...');
  cp.execSync('npm run build:linux', { cwd: ROOT, stdio: 'inherit' });
}

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RELEASE, { recursive: true });

if (fs.existsSync(LINUX_ZIP)) {
  console.log('Linux Electron zip arsivi aciliyor...');
  cp.execSync(`tar -xf "${LINUX_ZIP}" -C "${OUT_DIR}"`, { stdio: 'inherit' });
} else if (fs.existsSync(ELECTRON_DIST)) {
  console.log('Electron kopyalaniyor...');
  fs.cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true });
} else {
  console.error('Electron dagitimi bulunamadi.');
  process.exit(1);
}

const origBinary = path.join(OUT_DIR, 'electron');
const origExe = path.join(OUT_DIR, 'electron.exe');
const wideBinary = path.join(OUT_DIR, 'wide-app');

if (fs.existsSync(origBinary)) {
  fs.renameSync(origBinary, wideBinary);
  try { fs.chmodSync(wideBinary, 0o755); } catch {}
} else if (fs.existsSync(origExe)) {
  fs.renameSync(origExe, wideBinary);
}

const APP_DIR = path.join(OUT_DIR, 'resources', 'app');
fs.mkdirSync(APP_DIR, { recursive: true });

const copyTargets = [
  ['scripts', 'scripts'],
  ['out', 'out'],
  ['native-host/assets', 'native-host/assets'],
  ['sidecar', 'sidecar'],
  ['resources', 'resources'],
  ['assets', 'assets'],
  ['wide.desktop', 'wide.desktop'],
];

for (const [src, dest] of copyTargets) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(APP_DIR, dest);
  if (fs.existsSync(srcPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.cpSync(srcPath, destPath, { recursive: true });
  }
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = rootPkg.version || '0.3101126';
const pkg = {
  name: 'wide-app',
  version,
  description: 'Wide App Linux Runtime',
  main: 'scripts/host-linux.cjs',
  private: true,
};
fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

const PROD_MODULES = [
  '@grpc',
  '@lydell',
  'node-forge',
  'prettier',
  'typescript',
];

const destModules = path.join(APP_DIR, 'node_modules');
fs.mkdirSync(destModules, { recursive: true });
const srcModules = path.join(ROOT, 'node_modules');

for (const mod of PROD_MODULES) {
  const s = path.join(srcModules, mod);
  const d = path.join(destModules, mod);
  if (fs.existsSync(s)) {
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.cpSync(s, d, { recursive: true });
  }
}

const launcherContent = `#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

WAYLAND_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
  WAYLAND_FLAGS=(--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations)
fi

exec "$DIR/wide-app" "\${WAYLAND_FLAGS[@]}" "$@"
`;
const launcherPath = path.join(OUT_DIR, 'wide-app-launcher.sh');
fs.writeFileSync(launcherPath, launcherContent.replace(/\r\n/g, '\n'), 'utf8');
try { fs.chmodSync(launcherPath, 0o755); } catch {}

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(OUT_DIR, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(OUT_DIR, 'wide.png'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(OUT_DIR, 'wide-app.png'));

const tarGzName = `wide-app-${version}-linux-x64.tar.gz`;
const tarGzPath = path.join(DIST, tarGzName);
try {
  cp.execSync(`tar -czf "${tarGzPath}" -C "${DIST}" wide-app-linux-x64`, { stdio: 'inherit' });
  fs.copyFileSync(tarGzPath, path.join(RELEASE, tarGzName));
  console.log(`Paket hazirlandi: ${tarGzName}`);
} catch (e) {
  console.warn('tar.gz olusturulamadi:', e.message);
}

const tarZstName = `wide-app-${version}-linux-x64.tar.zst`;
const tarZstPath = path.join(DIST, tarZstName);
const rawTar = path.join(DIST, `wide-app-${version}-linux-x64.tar`);
try {
  cp.execSync(`tar -cf "${rawTar}" -C "${DIST}" wide-app-linux-x64`, { stdio: 'inherit' });
  cp.execSync(`"${ZSTD}" -T0 -19 -f -o "${tarZstPath}" "${rawTar}"`, { stdio: 'inherit' });
  if (fs.existsSync(rawTar)) fs.unlinkSync(rawTar);
  fs.copyFileSync(tarZstPath, path.join(RELEASE, tarZstName));
  console.log(`Paket hazirlandi: ${tarZstName}`);
} catch (e) {
  console.warn('tar.zst olusturulamadi:', e.message);
}
