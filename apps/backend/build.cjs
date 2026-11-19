'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'src');
const RUNTIME = path.join(__dirname, 'runtime');
const OUT = path.resolve(__dirname, '..', '..', 'out', 'main', 'index.js');

const files = fs
  .readdirSync(SRC)
  .filter((name) => name.endsWith('.js'))
  .sort();

if (files.length === 0) {
  console.error('No backend segments found in', SRC);
  process.exit(1);
}

let rootPkg = {};
try {
  rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
} catch {}

const parts = files.map((name) => {
  const text = fs.readFileSync(path.join(SRC, name), 'utf8');

  let body = text.replace(/^\/\* [^\n]*\n[^\n]*\*\/\n/, '');
  if (name === '64-update.js' && rootPkg.version) {
    body = body.replace(/^const WIDE_VERSION = "[^"]+";/m, `const WIDE_VERSION = ${JSON.stringify(String(rootPkg.version))};`);
  }
  return { name, code: body.replace(/\n+$/, '') };
});

function collectTopLevelDeclarations(name, source) {
  const ts = require('typescript');
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const decls = [];
  const collectBinding = (node) => {
    if (!node) return;
    if (ts.isIdentifier(node)) {
      decls.push(node.text);
      return;
    }
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      for (const el of node.elements) {
        if (ts.isBindingElement(el)) collectBinding(el.name);
      }
    }
  };
  for (const stmt of sf.statements) {
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      decls.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) collectBinding(decl.name);
    }
  }
  return decls;
}

const seenDecls = new Map();
for (const part of parts) {
  for (const sym of collectTopLevelDeclarations(part.name, part.code)) {
    const prev = seenDecls.get(sym);
    if (prev && prev !== part.name) {
      throw new Error(`Duplicate top-level backend symbol "${sym}" across ${prev} and ${part.name}`);
    }
    if (!prev) seenDecls.set(sym, part.name);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.cpSync(RUNTIME, path.dirname(OUT), { recursive: true });

const esbuild = require('esbuild');
const tsEntry = path.join(SRC, 'ts', 'index.ts');
let tsPrefix = '';
if (fs.existsSync(tsEntry)) {
  esbuild.buildSync({
    entryPoints: [tsEntry],
    outfile: path.join(path.dirname(OUT), 'backend-modules.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'node:*', '@lydell/node-pty', 'playwright-core', 'node-forge', 'prettier', 'typescript', '@grpc/grpc-js', '@grpc/proto-loader', 'mysql2', 'pg', 'ioredis'],
    logLevel: 'silent',
  });
  tsPrefix = "const __wideTs = require('./backend-modules.cjs');\n";
}

fs.writeFileSync(OUT, `${tsPrefix}${parts.map((p) => p.code).join('\n')}\n`, 'utf8');

const rootDir = path.resolve(__dirname, '..', '..');
const aiVendorEntry = path.join(__dirname, 'vendor', 'ai-vendor.mjs');
const mcpVendorEntry = path.join(__dirname, 'vendor', 'mcp-vendor.mjs');
const dbVendorEntry = path.join(__dirname, 'vendor', 'db-vendor.mjs');
if (fs.existsSync(aiVendorEntry)) {
  esbuild.buildSync({
    entryPoints: [aiVendorEntry],
    outfile: path.join(path.dirname(OUT), 'ai-vendor.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    logLevel: 'silent',
  });
}
if (fs.existsSync(mcpVendorEntry)) {
  const mcpOutMain = path.join(path.dirname(OUT), 'mcp-vendor.cjs');
  const mcpSidecar = path.join(rootDir, 'sidecar', 'mcp-vendor.cjs');
  esbuild.buildSync({
    entryPoints: [mcpVendorEntry],
    outfile: mcpOutMain,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    logLevel: 'silent',
  });
  fs.mkdirSync(path.dirname(mcpSidecar), { recursive: true });
  fs.copyFileSync(mcpOutMain, mcpSidecar);
}
if (fs.existsSync(dbVendorEntry)) {
  const dbOutMain = path.join(path.dirname(OUT), 'db-vendor.cjs');
  const dbSidecar = path.join(rootDir, 'sidecar', 'db-vendor.cjs');
  esbuild.buildSync({
    entryPoints: [dbVendorEntry],
    outfile: dbOutMain,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    external: ['pg-native'],
    logLevel: 'silent',
  });
  fs.mkdirSync(path.dirname(dbSidecar), { recursive: true });
  fs.copyFileSync(dbOutMain, dbSidecar);
}

console.log(`backend: ${files.length} segments -> ${path.relative(process.cwd(), OUT)}`);
