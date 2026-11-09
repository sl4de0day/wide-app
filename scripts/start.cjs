'use strict';

const cp = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const ROOT = path.resolve(__dirname, '..');
const host = path.join(ROOT, 'scripts', 'host-linux.cjs');
const args = [host, ...process.argv.slice(2)];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = cp.spawn(electron, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code || 0));
