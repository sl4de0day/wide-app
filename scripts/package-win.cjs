'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(DIST, 'wide-app-win-x64');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const ISCC = process.env.ISCC || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe') : 'iscc');

if (!fs.existsSync(ELECTRON_DIST)) {
  console.error('Electron distribution not found in node_modules.');
  process.exit(1);
}

const mainOut = path.join(ROOT, 'out', 'main', 'index.js');
const rendererOut = path.join(ROOT, 'out', 'renderer', 'index.html');
if (!fs.existsSync(mainOut) || !fs.existsSync(rendererOut)) {
  console.log('Building renderer and backend...');
  cp.execSync('npm run build:linux', { cwd: ROOT, stdio: 'inherit' });
}

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

fs.cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true });

const origBinary = path.join(OUT_DIR, 'electron.exe');
const wideBinary = path.join(OUT_DIR, 'wide-app.exe');
if (fs.existsSync(origBinary)) {
  fs.renameSync(origBinary, wideBinary);
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
const version = rootPkg.version || '0.5151126';
const pkg = {
  name: 'wide-app',
  version,
  description: 'Wide App Windows Runtime',
  main: 'scripts/host-linux.cjs',
  private: true,
};
fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

function collectProdModules(rootDir, rootPkgJson) {
  const seen = new Set();
  const queue = Object.keys(rootPkgJson.dependencies || {});
  const dirs = new Set();
  while (queue.length > 0) {
    const modName = queue.shift();
    if (!modName || seen.has(modName)) continue;
    seen.add(modName);
    const modDir = path.join(rootDir, 'node_modules', modName);
    const pkgPath = path.join(modDir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    dirs.add(modName.startsWith('@') ? modName.split('/')[0] : modName);
    try {
      const subPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      for (const dep of Object.keys(subPkg.dependencies || {})) {
        queue.push(dep);
      }
      for (const opt of Object.keys(subPkg.optionalDependencies || {})) {
        if (fs.existsSync(path.join(rootDir, 'node_modules', opt))) {
          queue.push(opt);
        }
      }
    } catch {}
  }
  return [...dirs].sort();
}

const PROD_MODULES = collectProdModules(ROOT, rootPkg);

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

const assetsDir = path.join(OUT_DIR, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'native-host', 'assets', 'wide.ico'), path.join(assetsDir, 'wide.ico'));

console.log('Compiling Inno Setup installer...');
cp.execSync(`"${ISCC}" "${path.join(ROOT, 'installer', 'wide-app.iss')}"`, {
  cwd: ROOT,
  stdio: 'inherit',
});

const generatedExe = path.join(ROOT, 'release', `Wide-App-Setup-${version}.exe`);
if (fs.existsSync(generatedExe)) {
  fs.copyFileSync(generatedExe, path.join(DIST, `Wide-App-Setup-${version}.exe`));
  console.log(`Successfully created installer: ${generatedExe} (${fs.statSync(generatedExe).size} bytes)`);
}
