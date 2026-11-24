'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const SOURCE_DIR = path.join(DIST, 'wide-app-linux-x64');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.7241126';
const APPIMAGE_NAME = `Wide-App-${VERSION}-x86_64.AppImage`;
const APPIMAGE_OUT = path.join(DIST, APPIMAGE_NAME);
const STAGE = path.join(DIST, '.appimage-staging');
const TAR2SQFS = process.env.TAR2SQFS || (process.platform === 'win32' ? 'tar2sqfs.exe' : 'tar2sqfs');

if (fs.existsSync(STAGE)) {
  fs.rmSync(STAGE, { recursive: true, force: true });
}
fs.mkdirSync(STAGE, { recursive: true });
fs.mkdirSync(RELEASE, { recursive: true });

fs.cpSync(SOURCE_DIR, STAGE, { recursive: true });

const appRunContent = `#!/bin/sh
SELF=$(readlink -f "$0")
HERE=\${SELF%/*}
export PATH="\${HERE}:\${PATH}"
exec "\${HERE}/wide-app-launcher.sh" "$@"
`;
fs.writeFileSync(path.join(STAGE, 'AppRun'), appRunContent.replace(/\r\n/g, '\n'), 'utf8');

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(STAGE, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(STAGE, 'wide.png'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(STAGE, 'wide-app.png'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(STAGE, '.DirIcon'));

const rawTar = path.join(DIST, 'temp-appimage.tar');
const sqfsOut = path.join(DIST, 'temp-appimage.sqfs');

console.log('Creating tar for AppImage...');
cp.execSync(`tar -cf "${rawTar}" -C "${STAGE}" .`, { stdio: 'inherit' });

console.log('Generating SquashFS image with tar2sqfs...');
cp.execSync(`"${TAR2SQFS}" -c zstd -b 131072 -f "${sqfsOut}"`, {
  input: fs.readFileSync(rawTar),
  stdio: ['pipe', 'inherit', 'inherit'],
});

const origAppImage = process.env.APPIMAGE_RUNTIME || path.join(ROOT, 'resources', 'appimage-runtime-x86_64');
const origFd = fs.openSync(origAppImage, 'r');
const runtimeBuf = Buffer.alloc(944632);
fs.readSync(origFd, runtimeBuf, 0, 944632, 0);
fs.closeSync(origFd);

const sqfsBuf = fs.readFileSync(sqfsOut);
const finalAppImage = Buffer.concat([runtimeBuf, sqfsBuf]);

fs.writeFileSync(APPIMAGE_OUT, finalAppImage);
fs.copyFileSync(APPIMAGE_OUT, path.join(RELEASE, APPIMAGE_NAME));

if (fs.existsSync(rawTar)) fs.unlinkSync(rawTar);
if (fs.existsSync(sqfsOut)) fs.unlinkSync(sqfsOut);
fs.rmSync(STAGE, { recursive: true, force: true });

console.log('Successfully generated AppImage: ' + APPIMAGE_OUT + ' (' + finalAppImage.length + ' bytes)');
