'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.dirname(ROOT);
const REPO_IDE = path.join(WORKSPACE, 'wide-ide');
const REPO_APP = path.join(WORKSPACE, 'wide-app');

const DIVERGENT = new Set([
  'apps/backend/src/35-sssf-engine.js',
  'apps/backend/src/40-ai-store.js',
  'apps/backend/src/52-extensions.js',
  'apps/backend/src/64-update.js',
]);

const SHARED_FILES = [
  'apps/backend/build.cjs',
  'apps/backend/tsconfig.json',
  'apps/renderer/src/components/DatabaseView.tsx',
  'apps/renderer/src/panels/DatabasePanel.tsx',
  'apps/renderer/src/stores/database.ts',
  'apps/renderer/src/lib/trafficBridge.ts',
  'apps/renderer/src/stores/telemetry.ts',
  'native-host/build.rs',
  'native-host/src/main.rs',
  'native-host/assets/titlebar.js',
  'native-host/assets/engine-preview.js',
  'scripts/remote-sync.mjs',
  'scripts/test-host-win.ps1',
  'scripts/sync-shared.cjs',
  'scripts/sync-rules.cjs',
  'resources/rules.json',
  'resources/osv-bundle.json',
];

const SHARED_DIRS = ['apps/backend/src', 'sidecar', 'native-core'];

function walkRel(baseDir, subDir) {
  const start = path.join(baseDir, subDir);
  if (!fs.existsSync(start)) return [];
  const results = [];
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name === 'target' || entry.name === 'node_modules')) {
        continue;
      }
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, full).replace(/\\/g, '/'));
      }
    }
  }
  return results;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectSharedPaths(srcDir, dstDir) {
  const candidates = new Set(SHARED_FILES);
  for (const dir of SHARED_DIRS) {
    for (const rel of walkRel(srcDir, dir)) candidates.add(rel);
    for (const rel of walkRel(dstDir, dir)) candidates.add(rel);
  }
  return [...candidates].filter((rel) => !DIVERGENT.has(rel)).sort();
}

function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const apply = args.has('--apply');
  const quiet = args.has('--quiet');

  let fromArg = 'ide';
  let targetArg = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from' && argv[i + 1]) {
      fromArg = argv[i + 1];
    } else if (argv[i].startsWith('--from=')) {
      fromArg = argv[i].slice(7);
    } else if (argv[i] === '--target' && argv[i + 1]) {
      targetArg = argv[i + 1];
    } else if (argv[i].startsWith('--target=')) {
      targetArg = argv[i].slice(9);
    }
  }

  const useAppAsSrc =
    fromArg === 'app' ||
    fromArg === 'wide-app' ||
    (fromArg === 'current' && path.basename(ROOT) === 'wide-app');
  const srcRoot = useAppAsSrc ? REPO_APP : REPO_IDE;
  const dstRoot = targetArg
    ? path.resolve(targetArg)
    : useAppAsSrc
      ? REPO_IDE
      : REPO_APP;

  if (!fs.existsSync(srcRoot) || !fs.existsSync(dstRoot)) {
    console.error(`[sync-shared] Repository not found: ${!fs.existsSync(srcRoot) ? srcRoot : dstRoot}`);
    process.exit(2);
  }

  const srcName = path.basename(srcRoot);
  const dstName = path.basename(dstRoot);
  const shared = collectSharedPaths(srcRoot, dstRoot);
  let identical = 0;
  const drifted = [];
  const missing = [];

  for (const rel of shared) {
    const srcPath = path.join(srcRoot, rel);
    const dstPath = path.join(dstRoot, rel);
    const hasSrc = fs.existsSync(srcPath);
    const hasDst = fs.existsSync(dstPath);
    if (!hasSrc || !hasDst) {
      missing.push({ rel, hasSrc, hasDst });
      continue;
    }
    if (hashFile(srcPath) === hashFile(dstPath)) {
      identical += 1;
    } else {
      drifted.push(rel);
    }
  }

  if (apply) {
    let copied = 0;
    for (const rel of drifted) {
      const srcPath = path.join(srcRoot, rel);
      const dstPath = path.join(dstRoot, rel);
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      if (!quiet) console.log(`COPIED ${srcName}/${rel} -> ${dstName}/${rel}`);
      copied += 1;
    }
    for (const item of missing) {
      if (item.hasSrc && !item.hasDst) {
        const srcPath = path.join(srcRoot, item.rel);
        const dstPath = path.join(dstRoot, item.rel);
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
        if (!quiet) console.log(`ADDED  ${srcName}/${item.rel} -> ${dstName}/${item.rel}`);
        copied += 1;
      } else if (!quiet) {
        console.log(`WARN   missing in ${srcName}: ${item.rel}`);
      }
    }
    if (!quiet) {
      console.log(`[sync-shared] Synced ${copied} file(s), ${identical} already identical, ${DIVERGENT.size} divergent allowlisted.`);
    }
    return;
  }

  for (const rel of drifted) console.log(`DRIFT  ${rel}`);
  for (const item of missing) {
    console.log(`MISS   ${item.rel} (${srcName}:${item.hasSrc ? 'yes' : 'no'} ${dstName}:${item.hasDst ? 'yes' : 'no'})`);
  }
  if (!quiet || drifted.length > 0 || missing.length > 0) {
    console.log(
      `[sync-shared] Identical: ${identical} | Drifted: ${drifted.length} | Missing: ${missing.length} | Allowlisted divergent: ${DIVERGENT.size}`,
    );
  }
  if (drifted.length > 0 || missing.length > 0) {
    process.exit(1);
  }
}

main();
