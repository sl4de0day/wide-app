'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const VERSION = '0.3101126';
const RPM_NAME = `wide-app-${VERSION}-1.x86_64.rpm`;
const RPM_OUT = path.join(DIST, RPM_NAME);
const NFPM = 'C:\\Users\\yusuf\\AppData\\Local\\Microsoft\\WinGet\\Packages\\goreleaser.nfpm_Microsoft.Winget.Source_8wekyb3d8bbwe\\nfpm.exe';

fs.mkdirSync(RELEASE, { recursive: true });

const nfpmConfig = `name: "wide-app"
arch: "amd64"
platform: "linux"
version: "${VERSION}"
release: "1"
section: "devel"
priority: "optional"
maintainer: "sl4de <sl4de0day@github>"
description: "Autonomous AI workspace and mission control for Wide\\n Wide App is the standalone AI chat and autonomous workspace client."
homepage: "https://github.com/sl4de0day/wide-app"
license: "GPL-3.0-or-later"
depends:
  - gtk3
  - nss
  - alsa-lib
  - libnotify
  - libsecret
rpm:
  compression: zstd
contents:
  - src: ./dist/wide-app-linux-x64
    dst: /opt/wide-app
  - src: ./wide.desktop
    dst: /usr/share/applications/wide.desktop
  - src: ./assets/logo.png
    dst: /usr/share/pixmaps/wide.png
  - src: ./assets/logo.png
    dst: /usr/share/pixmaps/wide-app.png
  - src: ./assets/logo.png
    dst: /usr/share/icons/hicolor/512x512/apps/wide.png
  - src: ./assets/logo.png
    dst: /usr/share/icons/hicolor/512x512/apps/wide-app.png
  - src: /opt/wide-app/wide-app-launcher.sh
    dst: /usr/bin/wide-app
    type: symlink
`;

const configPath = path.join(ROOT, 'nfpm.yaml');
fs.writeFileSync(configPath, nfpmConfig, 'utf8');

console.log('Building RPM package with nfpm...');
cp.execSync(`"${NFPM}" pkg --config "${configPath}" --packager rpm --target "${RPM_OUT}"`, {
  cwd: ROOT,
  stdio: 'inherit',
});

if (fs.existsSync(configPath)) {
  fs.unlinkSync(configPath);
}

fs.copyFileSync(RPM_OUT, path.join(RELEASE, RPM_NAME));
console.log('Successfully generated RPM package: ' + RPM_OUT + ' (' + fs.statSync(RPM_OUT).size + ' bytes)');
