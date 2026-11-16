'use strict';

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const rulesDistDir = process.env.WIDE_RULES_DIST_DIR
  ? path.resolve(rootDir, process.env.WIDE_RULES_DIST_DIR)
  : path.resolve(rootDir, '..', 'wide-rules', 'dist');
const rulesSrc = path.join(rulesDistDir, 'rules.min.json');
const osvSrc = path.join(rulesDistDir, 'osv-bundle.min.json');
const outDir = path.join(rootDir, 'resources');

if (!fs.existsSync(rulesSrc) || !fs.existsSync(osvSrc)) {
  console.error(`Missing rules.min.json or osv-bundle.min.json in ${rulesDistDir}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(rulesSrc, path.join(outDir, 'rules.json'));
fs.copyFileSync(osvSrc, path.join(outDir, 'osv-bundle.json'));
console.log('Synced wide-rules offline bundle into resources/rules.json and resources/osv-bundle.json');
