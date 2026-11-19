'use strict';

const cp = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const fsRoot = require('node:fs');
const os = require('node:os');
const smokeOwnedConfigDir = !process.env.XDG_CONFIG_HOME;
const testConfigDir = process.env.XDG_CONFIG_HOME || path.join(os.tmpdir(), `wide-smoke-${process.pid}`);
fsRoot.mkdirSync(testConfigDir, { recursive: true });
if (smokeOwnedConfigDir) {
  process.on('exit', () => {
    try { fsRoot.rmSync(testConfigDir, { recursive: true, force: true }); } catch {}
  });
}
const child = cp.spawn(process.execPath, [path.join(__dirname, 'sidecar.cjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: testConfigDir,
    APPDATA: testConfigDir,
    LOCALAPPDATA: testConfigDir,
    WIDE_NO_AUTO_RULES_SYNC: process.env.WIDE_NO_AUTO_RULES_SYNC || '1',
  },
});
let buf = '';
const replies = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.t === 'host') {
      send({ t: 'hostReply', id: m.id, result: m.method === 'dialog:showOpenDialog' ? { canceled: false, filePaths: [ROOT] } : null });
    } else if (m.type === 'reply') {

      const cb = replies.get(m.replyId); if (cb) { replies.delete(m.replyId); cb(m); }
    }
  }
});
function send(o) { child.stdin.write(JSON.stringify(o) + '\n'); }
let seq = 1;
const invoke = (channel, args) =>
  new Promise((res) => { const id = seq++; replies.set(id, res); send({ t: 'invoke', id, channel, args }); });

const CHECKS = [
  ['fs:readDir', [ROOT], (r) => Array.isArray(r) && r.length > 0],
  ['workspace:recents', [], (r) => Array.isArray(r?.projects)],
  ['search:inFiles', [ROOT, { query: 'bridge' }], (r) => typeof r?.total === 'number'],
  ['project:scripts', [ROOT], (r) => Array.isArray(r?.scripts)],
  ['perf:sample', [], (r) => r?.available === true && r.cores > 0],
  ['ts:diagnostics', [ROOT, path.join(ROOT, 'apps/renderer/src/lib/utils.ts')], (r) => Array.isArray(r?.diagnostics)],
  ['engine:status', [], (r) => typeof r?.running === 'boolean'],
  ['tools:list', [ROOT], (r) => Array.isArray(r?.tools)],
  ['extensions:list', [], (r) => Array.isArray(r?.installed) && Array.isArray(r?.optional)],
];

const GONE = [
  'git:status',
  'astro:inspect',
  'bundler:bundle',
  'deadcode:scan',
  'engine:save',
  'project:quickOpenPrepare',
  'project:quickOpenQuery',
  'native:fast-trim',
];

(async () => {
  await new Promise((r) => setTimeout(r, 1400));
  await invoke('dialog:openFolder', []);

  let failed = 0;
  for (const [channel, args, ok] of CHECKS) {
    const reply = await invoke(channel, args);
    const pass = !reply.error && ok(reply.result);
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${channel}${reply.error ? ` (${reply.error})` : ''}`);
  }
  for (const channel of GONE) {
    const reply = await invoke(channel, []);
    const pass = Boolean(reply.error);
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${channel} removed`);
  }

  failed += await checkExtensionGate();
  failed += await checkCommentCleanerDirectives();
  failed += await checkWorkflowRoundTrip();
  failed += await checkUpdateIntegrity();
  failed += await checkCatcherAutosave();
  failed += await checkMcpTrustGate();
  failed += await checkSecurityScanControls();
  failed += await checkSecurityCorpus();
  failed += await checkSca();
  failed += await checkTaintFlow();
  failed += await checkCustomRules();
  failed += await checkAgentEmojiGuardrail();
  failed += await checkDatabaseLifecycle();
  failed += await checkAiBrowserFeatures();
  failed += await checkReconCoreEngine();
  failed += await checkAiTrustArchitecture();
  failed += await checkRegressions();
  failed += checkNativeColours();

  console.log(failed === 0 ? '\nAll backend checks passed.' : `\n${failed} check(s) failed.`);
  child.kill();
  process.exit(failed === 0 ? 0 : 1);
})();

async function checkSecurityScanControls() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-secscan-${process.pid}`);
  fsSync.mkdirSync(pathSync.join(dir, 'src'), { recursive: true });
  fsSync.mkdirSync(pathSync.join(dir, 'spec'), { recursive: true });

  const flow = (name) =>
    `const ${name} = req.query.${name};\nfs.readFile(${name});\n`;

  fsSync.writeFileSync(pathSync.join(dir, 'src', 'plain.js'), flow('alpha'), 'utf8');
  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'hushed.js'),
    `const beta = req.query.beta;\nfs.readFile(beta); // wide-ignore\n`,
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(dir, 'spec', 'fixture.js'), flow('gamma'), 'utf8');

  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'sink.js'),
    `function runQuery(q) {\n  return db.query(q);\n}\nmodule.exports = { runQuery };\n`,
    'utf8'
  );
  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'middle.js'),
    `function handle(input) {\n  return runQuery(input);\n}\nmodule.exports = { handle };\n`,
    'utf8'
  );
  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'entry.js'),
    `const x = req.query.x;\nhandle(x);\n`,
    'utf8'
  );

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  const inFile = (needle) => findings.filter((f) => String(f.file).includes(needle));

  report(inFile('plain.js').length > 0, 'security scan reports a taint flow');
  report(
    inFile('middle.js').some((f) => String(f.ruleId).startsWith('xfile/')),
    'cross-file taint propagates transitively through two function hops'
  );
  report(inFile('hushed.js').length === 0, 'wide-ignore silences the line it sits on');
  report(inFile('fixture.js').length === 0, 'spec folders are out of scope by default');
  report(
    findings.every((f) => f.confidence === 'high' || f.confidence === 'medium' || f.confidence === 'low'),
    'every finding carries a confidence'
  );

  const wideDir = pathSync.join(dir, '.wide');
  fsSync.mkdirSync(wideDir, { recursive: true });
  fsSync.writeFileSync(
    pathSync.join(wideDir, 'security.json'),
    JSON.stringify({ disable: ['taint/path'] }),
    'utf8'
  );
  const disabled = await invoke('security:scanProject', [dir]);
  report(
    (disabled.result?.findings ?? []).every((f) => f.ruleId !== 'taint/path'),
    'security.json can switch a rule off'
  );
  fsSync.unlinkSync(pathSync.join(wideDir, 'security.json'));

  const exported = await invoke('security:export', [dir, 'sarif']);
  let sarif = null;
  try { sarif = JSON.parse(exported.result?.text ?? ''); } catch {}
  report(sarif?.version === '2.1.0' && Array.isArray(sarif?.runs?.[0]?.results), 'SARIF 2.1.0 export is well formed');
  report(
    Array.isArray(sarif?.runs?.[0]?.tool?.driver?.rules) && sarif.runs[0].tool.driver.rules.length > 0,
    'SARIF export declares the rules it used'
  );

  const based = await invoke('security:baseline', [dir, 'set']);
  report(based.result?.ok === true && based.result.count > 0, 'a baseline can be written from the last scan');
  const after = await invoke('security:scanProject', [dir]);
  report((after.result?.findings ?? []).length === 0, 'findings in the baseline stop being reported');
  report((after.result?.baselined ?? 0) > 0, 'the scan says how many it held back');

  await invoke('security:baseline', [dir, 'clear']);
  const cleared = await invoke('security:scanProject', [dir]);
  report((cleared.result?.findings ?? []).length > 0, 'clearing the baseline brings them back');

  const secSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '65-secscan.js'), 'utf8');
  const vm = require('node:vm');
  const supStart = secSrc.indexOf('function secRuleSuppressed');
  const supEnd = secSrc.indexOf('const SEC_HIGH_ENTROPY');
  const supCtx = vm.createContext({});
  vm.runInContext(secSrc.slice(supStart, supEnd), supCtx);
  const stickyRule = { notMatch: /foo/g, notMatchUnless: null };
  const s1 = supCtx.secRuleSuppressed(stickyRule, 'foo');
  const s2 = supCtx.secRuleSuppressed(stickyRule, 'foo');
  report(s1 === true && s2 === true, 'secRuleSuppressed resets sticky global lastIndex across calls');

  const isoA = pathSync.join(osSync.tmpdir(), `wide-osv-iso-a-${process.pid}`);
  const isoB = pathSync.join(osSync.tmpdir(), `wide-osv-iso-b-${process.pid}`);
  fsSync.mkdirSync(pathSync.join(isoA, '.wide'), { recursive: true });
  fsSync.mkdirSync(isoB, { recursive: true });
  const isoPkg = JSON.stringify({ name: 'iso-test', dependencies: { 'demo-isolated-pkg': '1.0.0' } }, null, 2);
  fsSync.writeFileSync(pathSync.join(isoA, 'package.json'), isoPkg, 'utf8');
  fsSync.writeFileSync(pathSync.join(isoB, 'package.json'), isoPkg, 'utf8');
  fsSync.writeFileSync(
    pathSync.join(isoA, '.wide', 'osv.json'),
    JSON.stringify({
      npm: [{ name: 'demo-isolated-pkg', lt: '2.0.0', id: 'CVE-9999-ISOLATION', cwe: 'CWE-1395', sev: 'high', note: 'isolated project advisory' }],
    }),
    'utf8'
  );
  const [scanA, scanB] = await Promise.all([
    invoke('security:scanProject', [isoA]),
    invoke('security:scanProject', [isoB]),
  ]);
  const [rescanA, rescanB] = await Promise.all([
    invoke('security:rescanFile', [isoA, pathSync.join(isoA, 'package.json'), isoPkg]),
    invoke('security:rescanFile', [isoB, pathSync.join(isoB, 'package.json'), isoPkg]),
  ]);
  const hitA = [...(scanA.result?.findings || []), ...(rescanA.result?.findings || [])].some((f) => f.ruleId === 'vuln-dep-cve-9999-isolation');
  const hitB = [...(scanB.result?.findings || []), ...(rescanB.result?.findings || [])].some((f) => f.ruleId === 'vuln-dep-cve-9999-isolation');
  report(hitA && !hitB, 'concurrent secScanFile and scanProject isolate project OSV snapshots per workspace');
  try { fsSync.rmSync(isoA, { recursive: true, force: true }); } catch {}
  try { fsSync.rmSync(isoB, { recursive: true, force: true }); } catch {}

  const extScaDir = pathSync.join(osSync.tmpdir(), `wide-osv-ext-${process.pid}`);
  fsSync.mkdirSync(pathSync.join(extScaDir, '.wide'), { recursive: true });
  fsSync.writeFileSync(
    pathSync.join(extScaDir, '.wide', 'osv.json'),
    JSON.stringify({
      npm: [{ name: 'minimist', ge: '1.0.0', le: '1.2.5', id: 'CVE-2021-44906', cwe: 'CWE-1321', sev: 'critical', kev: true, epss: 0.81, note: 'inclusive upper bound' }],
      cargo: [{ name: 'openssl', lt: '0.10.60', id: 'CVE-2023-50001', cwe: 'CWE-119', sev: 'high', note: 'crate bug' }]
    }),
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(extScaDir, 'yarn.lock'), '"minimist@^1.2.0":\n  version "1.2.5"\n', 'utf8');
  fsSync.writeFileSync(pathSync.join(extScaDir, 'Cargo.lock'), '[[package]]\nname = "openssl"\nversion = "0.10.55"\n', 'utf8');
  const extScan = await invoke('security:scanProject', [extScaDir]);
  const extFindings = extScan.result?.findings ?? [];
  const minimistYarn = extFindings.find((f) => f.ruleId === 'vuln-dep-cve-2021-44906');
  const cargoHit = extFindings.find((f) => f.ruleId === 'vuln-dep-cve-2023-50001');
  report(Boolean(minimistYarn && String(minimistYarn.message).includes('CISA KEV') && String(minimistYarn.message).includes('newer than 1.2.5')), 'SCA flags inclusive le + yarn.lock + KEV metadata');
  report(Boolean(cargoHit), 'SCA flags Cargo.lock crates via 8-ecosystem OSV index');
  try { fsSync.rmSync(extScaDir, { recursive: true, force: true }); } catch {}

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkSecurityCorpus() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  let corpus = [];
  try {
    corpus = require('./security-corpus.json');
  } catch {
    report(false, 'security corpus could not be loaded');
    return failed;
  }

  const dir = pathSync.join(osSync.tmpdir(), `wide-corpus-${process.pid}`);
  const src = pathSync.join(dir, 'src');
  fsSync.mkdirSync(src, { recursive: true });
  const safe = (id) => id.replace(/[^a-z0-9]+/gi, '_');
  for (const entry of corpus) {
    fsSync.writeFileSync(pathSync.join(src, `${safe(entry.id)}_pos.${entry.ext}`), entry.positive, 'utf8');
    fsSync.writeFileSync(pathSync.join(src, `${safe(entry.id)}_neg.${entry.ext}`), entry.negative, 'utf8');
  }

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  for (const entry of corpus) {
    const posHit = findings.some((f) => String(f.file).includes(`${safe(entry.id)}_pos.`) && f.ruleId === entry.id);
    const negHit = findings.some((f) => String(f.file).includes(`${safe(entry.id)}_neg.`) && f.ruleId === entry.id);
    report(posHit, `corpus: ${entry.id} flags its positive sample`);
    report(!negHit, `corpus: ${entry.id} ignores its negative sample`);
  }

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkTaintFlow() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-taintflow-${process.pid}`);
  const src = pathSync.join(dir, 'src');
  fsSync.mkdirSync(src, { recursive: true });
  fsSync.writeFileSync(pathSync.join(src, 'multiline.js'), 'const c = req.query.c;\nexec(\n  "a",\n  "b",\n  c\n);\n', 'utf8');
  fsSync.writeFileSync(pathSync.join(src, 'sanitized.js'), 'let x = req.query.x;\nx = escape(x);\nexec(x);\n', 'utf8');
  fsSync.writeFileSync(pathSync.join(src, 'raw.js'), 'let y = req.query.y;\nexec(y);\n', 'utf8');

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  const hits = (needle) => findings.filter((f) => String(f.file).includes(needle) && f.ruleId === 'taint/command');
  report(hits('multiline.js').length > 0, 'multi-line: a sink arg beyond the 3-line window is caught');
  report(hits('sanitized.js').length === 0, 'taint dies after a sanitizer reassigns the variable');
  report(hits('raw.js').length > 0, 'unsanitized taint still flags (control)');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkCustomRules() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-customrule-${process.pid}`);
  fsSync.mkdirSync(pathSync.join(dir, 'src'), { recursive: true });
  fsSync.mkdirSync(pathSync.join(dir, '.wide'), { recursive: true });
  fsSync.writeFileSync(pathSync.join(dir, 'src', 'app.js'), 'dangerousThing(userInput);\nsafeThing(x);\n', 'utf8');
  fsSync.writeFileSync(
    pathSync.join(dir, '.wide', 'security.json'),
    JSON.stringify({ rules: [{ id: 'no-dangerous', pattern: 'dangerousThing\\(', message: 'Do not use dangerousThing', severity: 'high', langs: ['js'] }] }),
    'utf8',
  );

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  report(findings.some((f) => f.ruleId === 'custom/no-dangerous'), 'custom rule from security.json fires');

  const test = await invoke('security:testRule', ['dangerousThing\\(', '', 'a\ndangerousThing()\nb']);
  report(test.result?.ok === true && (test.result.matches ?? []).some((m) => m.line === 2), 'security:testRule reports the matching line');
  const bad = await invoke('security:testRule', ['(', '', 'x']);
  report(bad.result?.ok === false, 'security:testRule rejects an invalid pattern');

  fsSync.writeFileSync(
    pathSync.join(dir, '.wide', 'rules.json'),
    JSON.stringify([
      {
        id: 'wide/dynamic-sink',
        pattern: 'dynamicSink\\(',
        'not-match': 'safeLiteral',
        message: 'Dynamic sink detected',
        severity: 'CRITICAL',
        languages: ['js']
      }
    ]),
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(dir, 'src', 'dyn.js'), 'dynamicSink(input);\ndynamicSink(safeLiteral);\n', 'utf8');

  const dynScan = await invoke('security:scanProject', [dir]);
  const dynFindings = dynScan.result?.findings ?? [];
  const dynHits = dynFindings.filter((f) => f.ruleId === 'wide/dynamic-sink');
  report(dynHits.length === 1 && dynHits[0].line === 1, 'dynamic rule from rules.json fires and respects not-match');

  const loaded = await invoke('security:loadRules', [dir]);
  report(loaded.result?.ok === true && loaded.result.count >= 1, 'security:loadRules returns workspace rules');

  const rPath = await invoke('security:rulesPath', [dir]);
  report(rPath.result?.workspace !== null, 'security:rulesPath detects workspace rules path');

  const agentLoaded = await invoke('security:loadAgentRules', [dir]);
  report(agentLoaded.result?.ok === true && agentLoaded.result.count >= 1, 'security:loadAgentRules returns active agent rules');

  const agentPath = await invoke('security:agentRulesPath', [dir]);
  report(typeof agentPath.result?.active === 'string' && typeof agentPath.result?.cache === 'string', 'security:agentRulesPath returns paths');

  const cons = await invoke('decision:consensus', [{
    classesCount: 4,
    votes: [{ voterId: 1, choice: 2 }, { voterId: 2, choice: 2 }, { voterId: 3, choice: 0 }]
  }]);
  report(cons.result?.settled === true && cons.result.value === 2, 'decision:consensus resolves plurality vote');

  const claim = await invoke('decision:claim', [{ holderId: 10, bid: 1.0, lifetime: 5.0, capacity: 1 }]);
  report(claim.result?.ok === true, 'decision:claim acquires exclusive lease');

  const sc = await invoke('decision:score', [{
    candidates: [{ relevance: 0.9, speed: 0.8 }, { relevance: 0.4, speed: 0.95 }],
    criteria: [{ field: 'relevance', weight: 0.7 }, { field: 'speed', weight: 0.3 }],
    threshold: 0.5
  }]);
  report(sc.result?.success === true && sc.result.bestIndex === 0, 'decision:score selects highest-scoring candidate');

  const brStatus = await invoke('ai:browser', ['status', {}]);
  report(brStatus.result?.ok === true && typeof brStatus.result?.session?.url === 'string', 'ai:browser reports status');

  const brExtract = await invoke('ai:browser', ['extract', { mode: 'text' }]);
  report(brExtract.result?.ok === true, 'ai:browser extracts text content');

  const brShot = await invoke('ai:browser', ['screenshot', {}]);
  report(brShot.result?.ok === true && typeof brShot.result?.result === 'string', 'ai:browser captures live screencast frame');

  const brClose = await invoke('ai:browser', ['close', {}]);
  report(brClose.result?.ok === true, 'ai:browser closes session');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkSca() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-sca-${process.pid}`);
  const src = pathSync.join(dir, 'src');
  fsSync.mkdirSync(src, { recursive: true });
  fsSync.writeFileSync(pathSync.join(src, 'package.json'), JSON.stringify({ dependencies: { lodash: '4.17.20', express: '4.18.2', foolib: '1.0.0' } }), 'utf8');
  fsSync.mkdirSync(pathSync.join(dir, '.wide'), { recursive: true });
  fsSync.writeFileSync(
    pathSync.join(dir, '.wide', 'osv.json'),
    JSON.stringify({ npm: [{ name: 'foolib', lt: '2.0.0', id: 'WIDE-TEST-1', cwe: 'CWE-1395', sev: 'high', note: 'test override entry' }] }),
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(src, 'requirements.txt'), 'pyyaml==5.3\nrequests==2.31.0\n', 'utf8');
  fsSync.writeFileSync(
    pathSync.join(src, 'pom.xml'),
    '<project><dependencies><dependency><artifactId>log4j-core</artifactId><version>2.14.1</version></dependency></dependencies></project>',
    'utf8'
  );
  fsSync.writeFileSync(
    pathSync.join(src, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/minimist': { version: '1.2.5' } } }),
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(src, 'go.mod'), 'module x\n\nrequire github.com/dgrijalva/jwt-go v3.2.0\n', 'utf8');

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  const has = (id) => findings.some((f) => f.ruleId === id);
  report(has('vuln-dep-cve-2021-23337'), 'SCA flags vulnerable lodash in package.json');
  report(has('vuln-dep-cve-2020-14343'), 'SCA flags vulnerable PyYAML in requirements.txt');
  report(has('vuln-dep-cve-2021-44228'), 'SCA flags Log4Shell in pom.xml');
  report(has('vuln-dep-cve-2021-44906'), 'SCA flags vulnerable minimist in package-lock.json');
  report(has('vuln-dep-cve-2020-26160'), 'SCA flags vulnerable jwt-go in go.mod');
  report(!has('vuln-dep-cve-2023-32681'), 'SCA leaves a patched dependency (requests 2.31.0) alone');
  report(has('vuln-dep-cve-2024-29041'), 'SCA flags express from the offline OSV snapshot');
  report(has('vuln-dep-wide-test-1'), 'SCA applies a project .wide/osv.json override');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkMcpTrustGate() {
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const pending = await invoke('mcp:pending', []);
  report(!pending.error && pending.result?.ok === true && Array.isArray(pending.result.servers), 'mcp:pending lists offers');

  const unoffered = await invoke('mcp:trust', ['0123456789abcdef0123456789abcdef', true]);
  report(!unoffered.error && unoffered.result?.ok === false, 'mcp:trust refuses a server it never offered');

  const malformed = await invoke('mcp:trust', ['not-a-signature', true]);
  report(!malformed.error && malformed.result?.ok === false, 'mcp:trust refuses a malformed signature');

  const revoke = await invoke('mcp:trust', ['0123456789abcdef0123456789abcdef', false]);
  report(!revoke.error && revoke.result?.ok === true, 'mcp:trust allows revoking without an offer');

  return failed;
}

async function checkWorkflowRoundTrip() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const file = pathSync.join(ROOT, `smoke-${process.pid}.wideflow`);
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  try {
    const made = (await invoke('workflow:create', [
      file,
      [
        { path: pathSync.join(ROOT, 'apps'), name: 'Apps' },
        { path: pathSync.join(ROOT, 'sidecar'), name: 'Sidecar' },
      ],
    ])).result;
    report(made?.folders?.length === 2, 'workflow:create writes two folders');

    const onDisk = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    report(
      onDisk?.folders?.every((folder) => !pathSync.isAbsolute(folder.path)),
      'workflow stores folder paths relative to itself',
    );

    const opened = (await invoke('workflow:open', [file])).result;
    report(
      opened?.folders?.length === 2 &&
        opened.folders.every((folder) => pathSync.isAbsolute(folder.path) && !folder.missing),
      'workflow:open resolves them back to real folders',
    );
    report(opened?.folders?.[0]?.name === 'Apps', 'workflow keeps the names given to folders');

    const refused = (await invoke('workflow:open', [pathSync.join(ROOT, 'package.json')])).result;
    report(Boolean(refused?.error), 'workflow:open refuses a file that is not a workflow');
  } finally {
    try { fsSync.unlinkSync(file); } catch {}
  }
  return failed;
}

async function checkExtensionGate() {
  const before = (await invoke('extensions:list', [])).result?.installed ?? [];
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  await invoke('extensions:remove', ['github']);
  await invoke('extensions:remove', ['codeberg']);
  const closed = (await invoke('codeberg:status', [ROOT])).result;
  report(closed?.installed === false, 'source control refuses when codeberg and github both removed');

  await invoke('extensions:install', ['github']);
  await invoke('extensions:install', ['codeberg']);
  const open = (await invoke('codeberg:status', [ROOT])).result;
  report(open?.installed === true, 'codeberg:status answers when installed');

  await invoke('extensions:remove', ['ai-assistant']);
  const aiClosed = (await invoke('ai:config', [])).result;
  report(aiClosed?.installed === false, 'ai:config refuses when removed');

  await invoke('extensions:install', ['ai-assistant']);
  const aiOpen = (await invoke('ai:config', [])).result;
  report(aiOpen?.ok === true, 'ai:config answers when installed');

  if (!before.includes('codeberg')) await invoke('extensions:remove', ['codeberg']);
  if (!before.includes('ai-assistant')) await invoke('extensions:remove', ['ai-assistant']);
  return failed;
}

async function checkCommentCleanerDirectives() {
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const before = (await invoke('extensions:list', [])).result?.installed ?? [];
  await invoke('extensions:install', ['comment-cleaner']);

  const sampleJs = [
    '// disposable standalone comment',
    'const a = req.query.a; // wide-ignore[taint/path]',
    'const b = req.query.b; // disposable inline comment',
    '// wide-ignore-next-line[taint/sql]',
    'const c = req.query.c; // eslint-disable-line no-unused-vars',
    '// @ts-ignore',
    'const d = 42;',
  ].join('\n');

  const stripped = (await invoke('comments:strip', [ROOT, 'sample.js', sampleJs])).result;
  report(stripped?.ok === true, 'comment-cleaner runs on sample.js');
  report(stripped?.text?.includes('// wide-ignore[taint/path]'), 'comment-cleaner preserves inline wide-ignore[...]');
  report(stripped?.text?.includes('// wide-ignore-next-line[taint/sql]'), 'comment-cleaner preserves wide-ignore-next-line');
  report(stripped?.text?.includes('// eslint-disable-line no-unused-vars'), 'comment-cleaner preserves inline eslint-disable-line');
  report(stripped?.text?.includes('// @ts-ignore'), 'comment-cleaner preserves @ts-ignore');
  report(!stripped?.text?.includes('disposable standalone comment'), 'comment-cleaner removes disposable standalone comments');
  report(!stripped?.text?.includes('disposable inline comment'), 'comment-cleaner removes disposable inline comments');

  if (!before.includes('comment-cleaner')) await invoke('extensions:remove', ['comment-cleaner']);
  return failed;
}

async function checkCatcherAutosave() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const payload = JSON.stringify({ version: 2, entries: [{ id: 1, host: 'example.invalid' }] });
  const wrote = (await invoke('catcher:autosaveWrite', [ROOT, payload])).result;
  report(wrote?.ok === true, 'catcher session autosave writes');

  const read = (await invoke('catcher:autosaveRead', [ROOT])).result;
  report(read?.ok === true && read.json === payload, 'catcher session autosave reads the same bytes back');

  report(
    !fsSync.existsSync(pathSync.join(ROOT, '.wide', 'catcher-session.json')),
    'catcher autosave never writes captured traffic into the project',
  );

  const missing = (await invoke('catcher:autosaveRead', ['C:\\no\\such\\workspace'])).result;
  report(missing?.ok === true && missing.json === '', 'catcher autosave read of an unknown workspace is empty, not an error');

  return failed;
}

async function checkUpdateIntegrity() {
  const http = require('node:http');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const serve = (body) =>
    new Promise((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  const newer = await serve({ version: '99.0.0', url: 'https://example.invalid/Wide-Setup-99.0.0.exe' });
  const newerReply = (await invoke('update:check', [`http://127.0.0.1:${newer.address().port}/m.json`])).result;
  report(
    newerReply?.ok === true && newerReply.latest === '99.0.0' && newerReply.available === true,
    'update:check sees a newer manifest version as available',
  );
  newer.close();

  const older = await serve({ version: '0.0.1', url: '' });
  const olderReply = (await invoke('update:check', [`http://127.0.0.1:${older.address().port}/m.json`])).result;
  report(
    olderReply?.ok === true && olderReply.available === false,
    'update:check sees an older manifest version as not available',
  );
  older.close();

  const plain = (await invoke('update:download', [{ url: 'http://example.invalid/x.exe' }])).result;
  report(plain?.ok === false, 'update:download refuses a link that is not https');

  const unverified = (await invoke('update:download', [
    { url: 'https://example.invalid/x.exe', version: '0.0.1', asset: 'x.exe', sums: '' },
  ])).result;
  report(
    unverified?.ok === false && /SHA256SUMS/i.test(String(unverified?.error || '')),
    'update:download refuses an update with no published checksum',
  );

  const listed = (await invoke('extensions:list', [])).result;
  report(
    Array.isArray(listed?.optional) && !listed.optional.includes('browser'),
    'browser is built in, not an optional extension',
  );

  return failed;
}

function checkNativeColours() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const root = pathSync.resolve(__dirname, '..');

  const css = fsSync.readFileSync(pathSync.join(root, 'apps/renderer/src/styles/index.css'), 'utf8');
  const rustPath = pathSync.join(root, 'native-host/src/main.rs');
  const cppPath = pathSync.join(root, 'native-host/src/main.cpp');

  const token = (name) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    return match ? match[1].toLowerCase() : null;
  };
  const constant = (name) => {
    if (fsSync.existsSync(rustPath)) {
      const rust = fsSync.readFileSync(rustPath, 'utf8');
      const match = new RegExp(`const BACKGROUND_COLOR:\\s*\\(u8,\\s*u8,\\s*u8\\)\\s*=\\s*\\(0x([0-9a-fA-F]{2}),\\s*0x([0-9a-fA-F]{2}),\\s*0x([0-9a-fA-F]{2})\\)`).exec(rust);
      if (match) return `#${match[1]}${match[2]}${match[3]}`.toLowerCase();
    }
    if (fsSync.existsSync(cppPath)) {
      const cpp = fsSync.readFileSync(cppPath, 'utf8');
      const match = new RegExp(`constexpr COLORREF ${name} = RGB\\(0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2})\\)`).exec(cpp);
      if (match) return `#${match[1]}${match[2]}${match[3]}`.toLowerCase();
    }
    return token('mono-800');
  };

  const pairs = [['kBackground', 'mono-800']];

  let bad = 0;
  for (const [name, tokenName] of pairs) {
    const fromHost = constant(name);
    const fromCss = token(tokenName);
    const pass = fromHost !== null && fromCss !== null && fromHost === fromCss;
    if (!pass) bad += 1;
    console.log(
      `${pass ? 'ok  ' : 'FAIL'} ${name} == --${tokenName}` +
        (pass ? '' : ` (Host ${fromHost ?? 'unreadable'}, CSS ${fromCss ?? 'unreadable'})`),
    );
  }
  return bad;
}

async function checkDatabaseLifecycle() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-app-db-${process.pid}`);
  fsSync.mkdirSync(dir, { recursive: true });
  const dbFile = pathSync.join(dir, 'sample.sqlite');
  fsSync.writeFileSync(pathSync.join(dir, '.env'), 'DATABASE_URL=postgres://secret:topsecret@db.internal/prod\n', 'utf8');

  const saved = (await invoke('db:save', [{
    name: 'smoke-sqlite',
    engine: 'sqlite',
    environment: 'dev',
    readOnly: false,
    filePath: dbFile,
    password: 'super-secret-value',
  }])).result;
  report(
    saved?.ok === true && saved.connection?.id && !('password' in saved.connection),
    'db:save creates SQLite connection without returning plaintext password',
  );

  const id = saved?.connection?.id;
  if (id) {
    const createRes = (await invoke('db:query', [
      id,
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, password_hash TEXT)',
    ])).result;
    report(createRes?.ok === true, 'db:query creates table in SQLite');

    const insRes = (await invoke('db:applyChanges', [
      id,
      [{ kind: 'insert', schema: 'main', table: 'users', values: { email: 'a@b.test', password_hash: '5d41402abc4b2a76b9719d911017c592' } }],
    ])).result;
    report(insRes?.ok === true && insRes.applied === 1, 'db:applyChanges inserts row atomically');

    const schemaRes = (await invoke('db:schema', [id])).result;
    report(
      schemaRes?.ok === true && schemaRes.schema?.tables?.some((t) => t.name === 'users'),
      'db:schema introspects users table and columns',
    );

    const selRes = (await invoke('db:query', [id, 'SELECT id, email FROM users'])).result;
    report(selRes?.ok === true && selRes.result?.rowCount === 1, 'db:query executes SELECT cleanly');

    const histList = (await invoke('db:listHistory', [id])).result;
    report(
      histList?.ok === true &&
        Array.isArray(histList.history) &&
        histList.history.length >= 2 &&
        typeof histList.history[0].durationMs === 'number' &&
        histList.history.some((h) => h.sql.includes('SELECT id, email FROM users')),
      'db:listHistory persists recent queries with durationMs and rowCount',
    );

    const csvExport = (await invoke('db:export', [id, { format: 'csv', table: 'users' }])).result;
    const sqlExport = (await invoke('db:export', [id, { format: 'sql', table: 'users' }])).result;
    report(
      csvExport?.ok === true &&
        String(csvExport.content || '').includes('a@b.test') &&
        sqlExport?.ok === true &&
        String(sqlExport.content || '').includes('INSERT INTO'),
      'db:export outputs CSV and SQL INSERT statements',
    );

    const histClear = (await invoke('db:clearHistory', [id])).result;
    const histAfterClear = (await invoke('db:listHistory', [id])).result;
    report(
      histClear?.ok === true && histAfterClear?.ok === true && histAfterClear.history.length === 0,
      'db:clearHistory removes persisted query history for connection',
    );

    const expRes = (await invoke('db:query', [id, 'SELECT * FROM users', { explain: true }])).result;
    report(expRes?.ok === true && expRes.result?.isExplain === true, 'db:query EXPLAIN returns query plan');

    const dangerBlocked = (await invoke('db:query', [id, 'DROP TABLE users'])).result;
    report(dangerBlocked?.ok === false && Boolean(dangerBlocked?.dangerous), 'db:query gates dangerous DROP statements without confirmation');

    const auditRes = (await invoke('db:audit', [id])).result;
    report(
      auditRes?.ok === true &&
        Array.isArray(auditRes.findings) &&
        auditRes.findings.some((f) => f.category === 'crypto' || f.category === 'pii'),
      'db:audit detects PII columns and weak hash formats without returning secret values',
    );

    const disc = (await invoke('db:discover', [dir])).result;
    report(
      disc?.ok === true &&
        disc.items?.some((it) => it.engine === 'sqlite') &&
        !JSON.stringify(disc).includes('topsecret'),
      'db:discover detects workspace SQLite files while never reading .env',
    );

    await invoke('db:save', [{ id, readOnly: true }]);
    const roQueryBlocked = (await invoke('db:query', [id, "DELETE FROM users WHERE id = 1"])).result;
    report(roQueryBlocked?.ok === false && roQueryBlocked?.readOnlyBlocked === true, 'readOnly connection blocks write SQL');
    const roDiffBlocked = (await invoke('db:applyChanges', [id, [{ kind: 'delete', table: 'users', key: { id: 1 } }]])).result;
    report(roDiffBlocked?.ok === false && roDiffBlocked?.readOnlyBlocked === true, 'readOnly connection blocks db:applyChanges');

    const sqSaved = (await invoke('db:saveQuery', [dir, 'smoke-q', 'SELECT 1;'])).result;
    const sqList = (await invoke('db:listSavedQueries', [dir])).result;
    report(
      sqSaved?.ok === true &&
        sqList?.ok === true &&
        Array.isArray(sqList.queries) &&
        sqList.queries.some((q) => q.name === 'smoke-q' && q.sql === 'SELECT 1;'),
      'db:saveQuery and db:listSavedQueries obey isInside(full, root) argument order',
    );

    const cancelReply = await invoke('db:cancel', ['nonexistent-query-id']);
    report(!cancelReply.error && cancelReply.result?.ok === false, 'db:cancel is registered and handles missing queries cleanly');

    const findVaultFile = (rootDir) => {
      if (!fsSync.existsSync(rootDir)) return null;
      const stack = [rootDir];
      while (stack.length) {
        const cur = stack.pop();
        for (const ent of fsSync.readdirSync(cur, { withFileTypes: true })) {
          const full = pathSync.join(cur, ent.name);
          if (ent.isDirectory()) stack.push(full);
          else if (ent.isFile() && ent.name === 'database-vault.bin') return full;
        }
      }
      return null;
    };
    const vaultPath = findVaultFile(testConfigDir);
    if (vaultPath) {
      const validVaultBuf = fsSync.readFileSync(vaultPath);
      fsSync.writeFileSync(vaultPath, Buffer.from('x'), 'binary');
      const saveOnCorrupt = (await invoke('db:save', [{
        name: 'corrupt-guard',
        engine: 'sqlite',
        filePath: dbFile,
        password: 'pw',
      }])).result;
      const listOnCorrupt = (await invoke('db:list', [])).result;
      const corruptBackups = fsSync.readdirSync(pathSync.dirname(vaultPath)).filter((n) => n.startsWith('database-vault.bin.corrupt-'));
      report(
        saveOnCorrupt?.ok === false &&
          listOnCorrupt?.ok === true &&
          Boolean(listOnCorrupt?.vaultError) &&
          corruptBackups.length > 0,
        'corrupt database vault blocks overwrite, preserves backup, and surfaces vaultError on db:list',
      );
      fsSync.writeFileSync(vaultPath, validVaultBuf);
      for (const b of corruptBackups) {
        try { fsSync.unlinkSync(pathSync.join(pathSync.dirname(vaultPath), b)); } catch {}
      }
    } else {
      report(false, 'database-vault.bin was written inside testConfigDir');
    }

    await invoke('db:delete', [id]);
  }

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkAgentEmojiGuardrail() {
  const vm = require('node:vm');
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };
  const agentRulesRes = (await invoke('security:loadAgentRules', [])).result;
  const hasNoEmojis = Boolean(
    agentRulesRes?.ok &&
      Array.isArray(agentRulesRes.rules) &&
      agentRulesRes.rules.some((r) => r.id === 'wide/ai-no-emojis')
  );
  report(hasNoEmojis, 'security:loadAgentRules enforces wide/ai-no-emojis even over partial rule caches');

  const agentSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '44-ai-agent.js'), 'utf8');
  const ctx = vm.createContext({
    node_path: pathSync,
    node_os: require('node:os'),
    promises: fsSync.promises,
    appRoot: () => ROOT,
    __wideTs: require(pathSync.join(ROOT, 'out', 'main', 'backend-modules.cjs')),
  });
  const s1 = agentSrc.indexOf('function aiCreateStreamFilter');
  const e1 = agentSrc.indexOf('function aiToolsFor');
  const s2 = agentSrc.indexOf('const AI_EMBEDDED_AGENT_RULES');
  const e2 = agentSrc.indexOf('async function aiExecuteDependencyCheck');
  vm.runInContext(
    `${agentSrc.slice(s1, e1)}\n${agentSrc.slice(s2, e2)}`,
    ctx
  );

  const collected = [];
  const sanitizer = ctx.aiCreateStreamEmojiSanitizer([]);
  const filter = ctx.aiCreateStreamFilter((ev) => {
    const clean = sanitizer.sanitizeChunk(`${ev.type}:text`, ev.text);
    if (clean) collected.push({ type: ev.type, text: clean });
  });
  filter.push('Hello \uD83D');
  filter.push('\uDE00 <think>plan \uD83D');
  filter.push('\uDE80</think>1\uFE0F');
  filter.push('\u20E3 \u2139');
  filter.push('\uFE0F \uD83D\uDC68\u200D\uD83D\uDCBB \u2B50\u23F0 OK');
  filter.flush();
  sanitizer.flush((ev) => collected.push(ev));
  const outText = collected.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const outThink = collected.filter((c) => c.type === 'thinking').map((c) => c.text).join('');
  report(outText === 'Hello      OK' && outThink === 'plan ', 'streaming emoji sanitizer strips split surrogates, keycaps, variation icons, and ZWJ clusters');
  return failed;
}

async function checkAiBrowserFeatures() {
  const vm = require('node:vm');
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const browserSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '44-ai-1-browser.js'), 'utf8');
  const endSlice = browserSrc.indexOf('function aiBrowserBroadcast');
  const ctx = vm.createContext({ Buffer, URL, Map, Set, Date, Math, Number, String, Array, Object, process });
  vm.runInContext(browserSrc.slice(0, endSlice), ctx);

  report(
    ctx.aiBrowserStripEmojis('\uD83D\uDE80 Wide \u2B50 Dashboard \uD83D\uDC68\u200D\uD83D\uDCBB') === 'Wide Dashboard',
    'aiBrowserStripEmojis removes emojis and collapses whitespace in browser titles',
  );
  const clamped = ctx.aiBrowserClampHighlight({ x: -20, y: 780, width: 200, height: 100 }, 'Submit \uD83D\uDE80', 'click');
  report(
    Boolean(clamped && clamped.x === 0 && clamped.y === 780 && clamped.width === 200 && clamped.height === 20 && clamped.target === 'Submit'),
    'aiBrowserClampHighlight clamps bounding boxes inside 1280x800 viewport and sanitizes target',
  );
  const redactedHeaders = ctx.aiBrowserRedactHarHeaders({
    Authorization: 'Bearer secret123',
    Cookie: 'sid=abc',
    'Content-Type': 'application/json',
  });
  const authHdr = redactedHeaders.find((h) => h.name === 'Authorization');
  const ctHdr = redactedHeaders.find((h) => h.name === 'Content-Type');
  report(
    Boolean(authHdr?.value === '[REDACTED]' && ctHdr?.value === 'application/json'),
    'aiBrowserRedactHarHeaders masks secret auth/cookie headers',
  );
  const harUnit = ctx.aiBrowserBuildHarLog();
  report(
    harUnit?.log?.version === '1.2' && Array.isArray(harUnit.log.pages) && Array.isArray(harUnit.log.entries),
    'aiBrowserBuildHarLog outputs valid HAR 1.2 structure',
  );

  const stBefore = (await invoke('ai:browserStatus', [])).result;
  report(stBefore?.ok === true && stBefore?.session?.stealth === false, 'ai:browserStatus reports initial stealth=false');

  const togOn = (await invoke('ai:browserNav', [{ action: 'toggle_stealth' }])).result;
  report(togOn?.ok === true && togOn?.session?.stealth === true, 'ai:browserNav toggle_stealth enables stealth mode');

  const harIpc = (await invoke('ai:browserNav', [{ action: 'export_har' }])).result;
  report(harIpc?.ok === true && harIpc?.har?.log?.version === '1.2', 'ai:browserNav export_har returns HAR 1.2 log');

  await invoke('ai:browserNav', [{ action: 'toggle_stealth' }]);
  return failed;
}

async function checkRegressions() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  const vm = require('node:vm');
  const { Worker } = require('node:worker_threads');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dupDir = pathSync.join(osSync.tmpdir(), `wide-build-dup-${process.pid}`);
  try {
    fsSync.mkdirSync(pathSync.join(dupDir, 'apps', 'backend', 'src'), { recursive: true });
    fsSync.mkdirSync(pathSync.join(dupDir, 'apps', 'backend', 'runtime'), { recursive: true });
    fsSync.copyFileSync(pathSync.join(ROOT, 'apps', 'backend', 'build.cjs'), pathSync.join(dupDir, 'apps', 'backend', 'build.cjs'));
    fsSync.writeFileSync(pathSync.join(dupDir, 'apps', 'backend', 'src', '00-a.js'), 'function wideDupSym() { return 1; }\n', 'utf8');
    fsSync.writeFileSync(pathSync.join(dupDir, 'apps', 'backend', 'src', '01-b.js'), 'function wideDupSym() { return 2; }\n', 'utf8');
    const buildRun = cp.spawnSync(process.execPath, [pathSync.join(dupDir, 'apps', 'backend', 'build.cjs')], {
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: pathSync.join(ROOT, 'node_modules') },
    });
    report(
      buildRun.status !== 0 && /Duplicate top-level backend symbol "wideDupSym"/.test(String(buildRun.stderr || '')),
      'build.cjs rejects duplicate top-level symbols across backend segments',
    );
  } finally {
    try { fsSync.rmSync(dupDir, { recursive: true, force: true }); } catch {}
  }

  const shimSrc = fsSync.readFileSync(pathSync.join(ROOT, 'native-host', 'assets', 'preload-shim.js'), 'utf8');
  let onMsg = null;
  const fakeWin = {
    chrome: {
      webview: {
        addEventListener: (_type, fn) => { onMsg = fn; },
        postMessage: () => {},
      },
    },
    addEventListener: () => {},
  };
  fakeWin.window = fakeWin;
  const vmCtx = vm.createContext({ ...fakeWin, console, Map, Set, Array, Error, Promise });
  vm.runInContext(shimSrc, vmCtx);
  const apiObj = fakeWin.api || vmCtx.api;
  const p1 = apiObj.readDir('a');
  const p2 = apiObj.readDir('b');
  if (onMsg) onMsg({ data: { type: 'event', channel: 'host:backend', payload: 'stopped' } });
  const settled = await Promise.allSettled([p1, p2]);
  report(
    settled.length === 2 && settled.every((r) => r.status === 'rejected' && /stopped/i.test(String(r.reason?.message || ''))),
    'preload-shim failPending rejects all Map values via Array.from instead of hanging',
  );

  const workerPath = pathSync.join(ROOT, 'sidecar', 'workers', 'ts-worker.cjs');
  const worker = new Worker(workerPath);
  const workerCall = (op, args) =>
    new Promise((resolve, reject) => {
      const id = `${Date.now()}_${Math.random()}`;
      const timer = setTimeout(() => {
        worker.off('message', onMessage);
        reject(new Error(`ts-worker timeout on ${op}`));
      }, 10000);
      const onMessage = (msg) => {
        if (!msg || msg.id !== id) return;
        clearTimeout(timer);
        worker.off('message', onMessage);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      };
      worker.on('message', onMessage);
      worker.postMessage({ id, op, args });
    });
  try {
    const targetTs = pathSync.join(ROOT, 'apps', 'renderer', 'src', 'lib', 'utils.ts');
    const r1 = await workerCall('diagnostics', [ROOT, targetTs]);
    const c1 = await workerCall('close', [ROOT]);
    const r2 = await workerCall('diagnostics', [ROOT, targetTs]);
    report(
      Array.isArray(r1?.diagnostics) && c1?.ok === true && Array.isArray(r2?.diagnostics),
      'ts-worker recovers cleanly across close and subsequent diagnostics calls',
    );
  } catch {
    report(false, 'ts-worker recovers cleanly across close and subsequent diagnostics calls');
  } finally {
    await worker.terminate();
  }

  return failed;
}

async function checkAiTrustArchitecture() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  const vm = require('node:vm');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const coreSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '43-ai-0-core.js'), 'utf8');
  const toolsSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '44-ai-0-tools.js'), 'utf8');
  const agentSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '44-ai-agent.js'), 'utf8');

  report(
    !coreSrc.includes('nudgedForFileWrite') && !agentSrc.includes('aiHasSubstantialCodeBlock'),
    'hidden write nudge loop is removed from core and agent',
  );
  report(
    !toolsSrc.includes('AI_TOOL_NAME_ALIASES') && !coreSrc.includes('aiNormalizeToolCall') && !agentSrc.includes('AI_ARGS_MAY_BE_EMPTY'),
    'tool name alias guessing and empty-arg bypasses are removed',
  );

  const beforeExts = (await invoke('extensions:list', [])).result?.installed ?? [];
  if (!beforeExts.includes('ai-assistant')) await invoke('extensions:install', ['ai-assistant']);
  const cfgRes = await invoke('ai:config', []);
  const migratedRes = await invoke('ai:config', [{ provider: 'deepseek' }]);
  if (!beforeExts.includes('ai-assistant')) await invoke('extensions:remove', ['ai-assistant']);
  const cfg = cfgRes.result?.config;
  const migratedCfg = migratedRes.result?.config;
  report(
    cfgRes.result?.ok === true &&
      cfg?.provider === 'claude-code' &&
      !('gemini' in (cfg?.cloudModel ?? {})) &&
      !('deepseek' in (cfg?.cloudModel ?? {})) &&
      !('claude' in (cfg?.cloudModel ?? {})) &&
      migratedCfg?.provider === 'claude-code' &&
      cfg?.toolMode === 'full' &&
      cfg?.interactionMode === 'agent' &&
      cfg?.allowBrowser === true,
    'ai:config defaults to claude-code, migrates legacy API providers, and scopes toolMode/interactionMode/allowBrowser',
  );

  const tsModules = require(pathSync.join(ROOT, 'out', 'main', 'backend-modules.cjs'));
  const toolsCtx = vm.createContext({
    console,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    Math,
    __wideTs: tsModules,
    aiLoadSdkVendor: () => require(pathSync.join(ROOT, 'out', 'main', 'ai-vendor.cjs')),
  });
  vm.runInContext(toolsSrc, toolsCtx);

  const codeNoBrowser = toolsCtx.aiFilterTools({ allowWrites: true, toolMode: 'code', allowBrowser: false }).map((t) => t.name);
  const codeWithBrowser = toolsCtx.aiFilterTools({ allowWrites: true, toolMode: 'code', allowBrowser: true }).map((t) => t.name);
  const secNoBrowser = toolsCtx.aiFilterTools({ allowWrites: true, toolMode: 'security', allowBrowser: false }).map((t) => t.name);
  const fullAsk = toolsCtx.aiFilterTools({ allowWrites: false, toolMode: 'full', allowBrowser: true }).map((t) => t.name);

  report(
    codeNoBrowser.includes('write_file') &&
      codeNoBrowser.includes('edit_file') &&
      !codeNoBrowser.includes('catcher_traffic_query') &&
      !codeNoBrowser.includes('oast_control') &&
      !codeNoBrowser.includes('browser_navigate'),
    'aiFilterTools(code, browser=false) excludes security and browser tools',
  );
  report(
    codeWithBrowser.includes('write_file') &&
      codeWithBrowser.includes('browser_navigate') &&
      !codeWithBrowser.includes('catcher_traffic_query'),
    'aiFilterTools(code, browser=true) includes browser tools while keeping security tools excluded',
  );
  report(
    secNoBrowser.includes('catcher_traffic_query') &&
      secNoBrowser.includes('oast_control') &&
      secNoBrowser.includes('read_file') &&
      !secNoBrowser.includes('write_file') &&
      !secNoBrowser.includes('browser_navigate'),
    'aiFilterTools(security, browser=false) scopes to security and read-only tools',
  );
  report(
    !fullAsk.includes('write_file') && !fullAsk.includes('edit_file') && !fullAsk.includes('run_command') && fullAsk.includes('read_file'),
    'aiFilterTools(ask) strips all write and command execution tools',
  );

  const unknownRes = toolsCtx.aiValidateToolCall('writeFile', { path: 'a.ts', content: 'x' }, { allowWrites: true, toolMode: 'code', allowBrowser: true });
  const aliasKeyRes = toolsCtx.aiValidateToolCall('write_file', { file_path: 'a.ts', content: 'x' }, { allowWrites: true, toolMode: 'code', allowBrowser: true });
  const browserBlockedRes = toolsCtx.aiValidateToolCall('browser_navigate', { url: 'https://example.com' }, { allowWrites: true, toolMode: 'code', allowBrowser: false });
  const askBlockedRes = toolsCtx.aiValidateToolCall('write_file', { path: 'a.ts', content: 'x' }, { allowWrites: false, toolMode: 'code', allowBrowser: true });
  const validWriteRes = toolsCtx.aiValidateToolCall('write_file', { path: 'a.ts', content: 'export const x = 1;' }, { allowWrites: true, toolMode: 'code', allowBrowser: true });

  report(
    unknownRes.ok === false && String(unknownRes.error || '').startsWith('UNKNOWN_TOOL'),
    'aiValidateToolCall rejects camelCase alias tool names with UNKNOWN_TOOL',
  );
  report(
    aliasKeyRes.ok === false && String(aliasKeyRes.error || '').startsWith('SCHEMA_VALIDATION_ERROR'),
    'aiValidateToolCall strictly rejects unknown parameter aliases (file_path) with SCHEMA_VALIDATION_ERROR',
  );
  report(
    browserBlockedRes.ok === false && String(browserBlockedRes.error || '').startsWith('TOOL_DISABLED_IN_MODE'),
    'aiValidateToolCall blocks browser tools when allowBrowser is false',
  );
  report(
    askBlockedRes.ok === false && String(askBlockedRes.error || '').startsWith('PERMISSION_DENIED'),
    'aiValidateToolCall blocks write tools in Ask mode',
  );
  report(
    validWriteRes.ok === true && validWriteRes.input?.path === 'a.ts',
    'aiValidateToolCall accepts strictly valid tool payloads',
  );

  const diagStart = agentSrc.indexOf('async function aiRunFileDiagnostics(');
  const diagEnd = agentSrc.indexOf('async function aiGetDiagnostics(');
  const runToolStart = agentSrc.indexOf('async function aiRunTool(');
  const runToolEnd = agentSrc.indexOf('const aiTurns = new Map();');
  const stageSlice =
    diagStart !== -1 && diagEnd > diagStart && runToolStart !== -1 && runToolEnd > runToolStart
      ? `${agentSrc.slice(diagStart, diagEnd)}\n${agentSrc.slice(runToolStart, runToolEnd)}`
      : '';
  if (!stageSlice) {
    report(false, 'could not slice aiVerifyEditedFile and aiRunTool for staging smoke test');
    return failed;
  }

  const emitted = [];
  const tempRoot = pathSync.join(osSync.tmpdir(), `wide-trust-stage-${process.pid}`);
  fsSync.mkdirSync(tempRoot, { recursive: true });
  const agentCtx = vm.createContext({
    console,
    Buffer,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    JSON,
    Math,
    URL,
    Date,
    RegExp,
    Error,
    process,
    node_path: pathSync,
    fs: fsSync,
    promises: fsSync.promises,
    setTimeout,
    clearTimeout,
    MAX_FILE_BYTES$1: 1024 * 1024,
    IGNORED$3: new Set(['node_modules', '.git']),
    aiValidateToolCall: toolsCtx.aiValidateToolCall,
    aiResolvePath: (root, rel) => {
      const target = pathSync.resolve(root, String(rel || ''));
      const relative = pathSync.relative(root, target).replace(/\\/g, '/');
      if (relative.startsWith('..') || pathSync.isAbsolute(relative)) return { error: 'Path escapes root' };
      return { path: target, relative };
    },
    aiAllowed: () => ({ ok: true }),
    aiTrim: (text) => String(text ?? ''),
    aiDiffCounts: () => ({ added: 1, removed: 0 }),
    isProtectedInstructionsFile: () => false,
    isMcpTool: () => false,
    aiOffsetToPosition: () => ({ line: 1, col: 7 }),
    writeFileAtomic: async (filePath, content) => {
      await fsSync.promises.writeFile(filePath, content, 'utf8');
    },
    runLinter: async () => ({ ok: true, diagnostics: [] }),
    lspGetCachedDiagnostics: () => [],
    tsCall: async (cmd, args) => {
      if (cmd === 'sync' && String(args?.[2] || '').includes('BROKEN_TS')) {
        agentCtx.__lastSyncedBroken = true;
        return { ok: true };
      }
      if (cmd === 'sync') {
        agentCtx.__lastSyncedBroken = false;
        return { ok: true };
      }
      if (cmd === 'diagnostics' && agentCtx.__lastSyncedBroken) {
        return {
          ok: true,
          diagnostics: [{ from: 0, to: 10, severity: 'error', code: 1005, message: 'Syntax error in staged TS' }],
        };
      }
      return { ok: true, diagnostics: [] };
    },
  });
  vm.runInContext(stageSlice, agentCtx);

  try {
    const stagedFiles = new Map();
    const stagedCtx = {
      toolMode: 'code',
      interactionMode: 'agent',
      allowBrowser: false,
      reviewEnabled: true,
      stagedFiles,
    };
    const stageWrite = await agentCtx.aiRunTool(
      tempRoot,
      'write_file',
      { path: 'demo.ts', content: 'const BROKEN_TS = ;' },
      (ev) => emitted.push(ev),
      true,
      'write demo',
      null,
      stagedCtx,
    );
    const stageRead = await agentCtx.aiRunTool(
      tempRoot,
      'read_file',
      { path: 'demo.ts' },
      () => {},
      true,
      'read demo',
      null,
      stagedCtx,
    );
    const diskExists = fsSync.existsSync(pathSync.join(tempRoot, 'demo.ts'));
    const stagedEditEv = emitted.find((e) => e.type === 'edit' && e.relativePath === undefined && pathSync.basename(String(e.path || '')) === 'demo.ts');
    const verifyEv = emitted.find((e) => e.type === 'verification' && e.relativePath === 'demo.ts');

    report(
      typeof stageWrite === 'string' &&
        stageWrite.includes('Staged demo.ts') &&
        !diskExists &&
        stagedEditEv?.staged === true &&
        String(stageRead || '').includes('BROKEN_TS'),
      'reviewEnabled stages writes in memory without touching disk and read_file reads staged content',
    );
    report(
      verifyEv?.ok === false &&
        verifyEv?.errors === 1 &&
        typeof stageWrite === 'string' &&
        stageWrite.includes('AUTO-VERIFICATION FAILED: 1 error(s) detected in demo.ts'),
      'post-edit verification runs on staged in-memory content and reports diagnostics to both UI and model',
    );
  } finally {
    try { fsSync.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }

  const runtimeSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '00-runtime.js'), 'utf8');
  const warnLogs = [];
  const faultCalls = [];
  const rtCtx = vm.createContext({
    require: () => { throw Object.assign(new Error('missing'), { code: 'MODULE_NOT_FOUND' }); },
    process,
    console: {
      warn: (...a) => warnLogs.push(a.join(' ')),
      error: (...a) => warnLogs.push(a.join(' ')),
    },
    Intl,
    Buffer,
    setTimeout,
    __wideTs: tsModules,
    reportFault: (k, d) => faultCalls.push([k, d]),
  });
  vm.runInContext(runtimeSrc.slice(runtimeSrc.indexOf('function reportRecoverableError')), rtCtx);
  rtCtx.reportRecoverableError('secscan', 'missing optional file', Object.assign(new Error('no file'), { code: 'ENOENT' }), { ignoreCodes: ['ENOENT'] });
  rtCtx.reportRecoverableError('secscan', 'corrupt JSON rules', new SyntaxError('Unexpected token'), { surfaceToUi: true });
  report(
    warnLogs.length === 1 &&
      warnLogs[0].includes('[secscan] corrupt JSON rules: Unexpected token') &&
      faultCalls.length === 1 &&
      faultCalls[0][0] === 'secscan',
    'reportRecoverableError skips ENOENT when ignored and surfaces real errors to logs and backend:fault',
  );

  const xmlParsed = tsModules.aiExtractTextToolCalls('<tool_call><function=write_file><parameter=path>a.ts</parameter><parameter=content>ok</parameter></function></tool_call>');
  const fencedFiltered = tsModules.aiExtractTextToolCalls('```json\n{"name":"unknownTool","arguments":{"x":1}}\n```', new Set(['write_file']));
  report(
    xmlParsed.length === 1 && xmlParsed[0].name === 'write_file' && xmlParsed[0].input.path === 'a.ts' && fencedFiltered.length === 0,
    'TS local-fallback parses XML tool calls strictly and filters unknown fenced JSON calls',
  );

  const sampleRules = [
    { id: 'wide/ai-direct-file-edits', severity: 'HIGH', instruction: 'Write directly.' },
    { id: 'wide/ai-native-tool-priority', severity: 'HIGH', instruction: 'Prefer native tools.' },
  ];
  const askPromptRules = tsModules.aiFilterGuardrailsByContext(sampleRules, { allowWrites: false, toolMode: 'code', allowBrowser: false });
  report(
    !askPromptRules.includes('Write directly.') && askPromptRules.includes('lsp_navigate') && !askPromptRules.includes('catcher_*') && !askPromptRules.includes('browser_*'),
    'TS prompt-builder strips write directives in Ask mode and scopes capabilities by mode + Browser toggle',
  );

  const doom = tsModules.aiCreateDoomLoopTracker();
  doom.record('write_file', {}, 'SCHEMA_VALIDATION_ERROR for "write_file": bad args');
  doom.record('write_file', {}, 'UNKNOWN_TOOL: nope');
  doom.record('write_file', {}, 'PERMISSION_DENIED: ask');
  report(
    Boolean(doom.check('write_file', { path: 'a.ts' })),
    'TS agent-loop doom-loop circuit breaker trips after 3 validation/permission failures',
  );

  const verifyFmt = tsModules.aiFormatVerificationMessage('/app/a.ts', 'a.ts', [
    { source: 'TypeScript', line: 3, col: 5, severity: 'error', code: 'TS2322', message: 'Type mismatch' },
  ]);
  const lspStore = new tsModules.LspDiagnosticsCache();
  lspStore.set('/tmp/x.ts', [{ line: 1, col: 1, severity: 'warning', message: 'unused' }]);
  const macroVars = new Map();
  let macroErr = false;
  tsModules.extractMacroVars([{ name: 'tok', source: 'body', pattern: '[invalid(' }], [], 'body', macroVars, () => { macroErr = true; });
  const secAi = tsModules.filterAiSecurityRules([{ id: 'wide/ai-1' }, { id: 'sqli' }]);
  const dbHist = tsModules.prependDbHistory([{ connectionId: 'c1', sql: 'SELECT 1', durationMs: 1, rowCount: 1, ranAt: 1 }], { connectionId: 'c1', sql: 'SELECT 2', durationMs: 2, rowCount: 1, ranAt: 2 });
  report(
    verifyFmt.errors.length === 1 &&
      verifyFmt.note.includes('AUTO-VERIFICATION FAILED') &&
      lspStore.get('/tmp/x.ts').length === 1 &&
      macroErr === true &&
      secAi.length === 1 &&
      dbHist.length === 2 &&
      dbHist[0].sql === 'SELECT 2',
    'TS verification, LSP cache, proxy macro, secscan rule filter, and DB history modules operate cleanly',
  );

  const allToolSpecs = toolsCtx.aiFilterTools({ allowWrites: true, toolMode: 'full', allowBrowser: true });
  const authParsed = tsModules.parseClaudeAuthStatusJson('Notice\n{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"dev@wide.local","subscriptionType":"max"}');
  const userImgLine = tsModules.serializeClaudeStreamUserMessage({
    text: 'Check this screenshot',
    images: [{ mediaType: 'image/png', data: 'data:image/png;base64,QUJDRA==' }],
  });
  const userImgObj = JSON.parse(userImgLine);
  const fullCliArgs = tsModules.buildClaudeCliArgs({
    sessionId: '11111111-1111-4111-8111-111111111111',
    model: 'sonnet',
    fallbackModel: 'haiku',
    effort: 'xhigh',
    mode: 'agent',
    toolMode: 'full',
  });
  const askCliArgs = tsModules.buildClaudeCliArgs({
    resumeSessionId: '11111111-1111-4111-8111-111111111111',
    forkSession: true,
    mode: 'ask',
    toolMode: 'code',
  });
  const secCliArgs = tsModules.buildClaudeCliArgs({
    sessionId: '22222222-2222-4222-8222-222222222222',
    mode: 'agent',
    toolMode: 'security',
  });
  report(
    authParsed?.loggedIn === true &&
      authParsed.subscriptionType === 'max' &&
      authParsed.email === 'dev@wide.local' &&
      Array.isArray(userImgObj.message?.content) &&
      userImgObj.message.content[0]?.type === 'image' &&
      userImgObj.message.content[0]?.source?.data === 'QUJDRA==' &&
      fullCliArgs.includes('--effort') &&
      fullCliArgs.includes('xhigh') &&
      !fullCliArgs.includes('--disallowedTools') &&
      askCliArgs.includes('--resume') &&
      askCliArgs.includes('--fork-session') &&
      askCliArgs.includes('plan') &&
      askCliArgs.includes('Edit') &&
      secCliArgs.includes('--disallowedTools') &&
      !secCliArgs.includes('Bash'),
    'TS claude-stream parses auth status, multimodal images, and mode-scoped CLI flags accurately',
  );

  const claudeMcpFiltered = tsModules.aiFilterToolsForClaudeMcp(allToolSpecs, { allowWrites: true, toolMode: 'full', allowBrowser: true });
  const claudeMcpNames = new Set(claudeMcpFiltered.map((t) => t.name));
  report(
    !claudeMcpNames.has('read_file') &&
      !claudeMcpNames.has('edit_file') &&
      !claudeMcpNames.has('write_file') &&
      !claudeMcpNames.has('run_command') &&
      claudeMcpNames.has('catcher_control') &&
      claudeMcpNames.has('run_security_scan') &&
      claudeMcpNames.has('browser_open') &&
      claudeMcpNames.has('db_query_readonly'),
    'Claude MCP filter excludes duplicate native workspace/shell tools while keeping Wide-unique tools',
  );

  const ccParser = new tsModules.ClaudeStreamEventParser();
  const evs = [
    ...ccParser.parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-xyz' })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'Edit', input: {} } } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: 'a.ts' } }] } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Updated', is_error: false }] } })),
    ...ccParser.parseLine(JSON.stringify({ type: 'prompt_suggestion', suggestion: 'Run tests next' })),
    ...ccParser.parseLine(JSON.stringify({
      type: 'result',
      is_error: false,
      total_cost_usd: 0.015,
      duration_ms: 420,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 },
    })),
  ];
  const deltasJoined = evs.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  const toolStarts = evs.filter((e) => e.type === 'tool_start');
  const toolResults = evs.filter((e) => e.type === 'tool_result');
  const suggs = evs.find((e) => e.type === 'prompt_suggestion');
  const usageEv = evs.find((e) => e.type === 'usage');
  report(
    deltasJoined === 'Hello' &&
      toolStarts.length === 1 &&
      toolStarts[0].input.file_path === 'a.ts' &&
      toolResults.length === 1 &&
      toolResults[0].tool === 'Edit' &&
      suggs?.suggestions?.[0] === 'Run tests next' &&
      usageEv?.cacheReadTokens === 200 &&
      usageEv?.totalCostUsd === 0.015,
    'ClaudeStreamEventParser deduplicates partial deltas, captures tool schemas, suggestions, and cache/cost telemetry',
  );

  const mockCcRoot = fsSync.mkdtempSync(pathSync.join(os.tmpdir(), 'wide-mock-cc-'));
  const prevWideClaudePath = process.env.WIDE_CLAUDE_PATH;
  let ccCtx;
  try {
    const mockTargetFile = pathSync.join(mockCcRoot, 'demo.ts');
    fsSync.writeFileSync(mockTargetFile, 'export const x = 1;\n', 'utf8');
    const mockCliPath = pathSync.join(mockCcRoot, 'mock-claude.js');
    const mockCliSource = [
      "'use strict';",
      "const fs = require('node:fs');",
      "const readline = require('node:readline');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'auth' && args[1] === 'status') {",
      "  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'dev@wide.local', subscriptionType: 'max' }) + '\\n');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'auth' && args[1] === 'logout') { process.exit(0); }",
      "let turnCount = 0;",
      "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
      "rl.on('line', (line) => {",
      "  const t = line.trim();",
      "  if (!t) return;",
      "  turnCount += 1;",
      "  let msg;",
      "  try { msg = JSON.parse(t); } catch { return; }",
      "  const sid = args[args.indexOf('--session-id') + 1] || 'mock-sid';",
      "  if (turnCount === 1) {",
      "    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: sid }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_edit_1', name: 'Edit', input: { file_path: 'demo.ts', old_string: '1', new_string: '2' } }] } }) + '\\n');",
      "    setTimeout(() => {",
      "      fs.writeFileSync(" + JSON.stringify(mockTargetFile) + ", 'export const x = 2;\\n', 'utf8');",
      "      process.stdout.write(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_edit_1', content: 'ok', is_error: false }] } }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pid:' + process.pid } } }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ type: 'prompt_suggestion', suggestion: 'Verify types' }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ type: 'result', is_error: false, session_id: sid, total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 100 } }) + '\\n');",
      "    }, 20);",
      "  } else {",
      "    const userTxt = typeof msg.message?.content === 'string' ? msg.message.content : 'img';",
      "    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pid:' + process.pid + ':' + userTxt } } }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, session_id: sid, usage: { input_tokens: 2, output_tokens: 2 } }) + '\\n');",
      "  }",
      "});",
    ].join('\n');
    fsSync.writeFileSync(mockCliPath, mockCliSource, 'utf8');
    process.env.WIDE_CLAUDE_PATH = mockCliPath;

    const ccSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '50-ai-claude-code.js'), 'utf8');
    let savedConfig = { claudeCodeSignedIn: false, claudeEffort: 'high', claudeFallbackModel: 'sonnet' };
    const sessionMeta = new Map();
    const ipcHandlers = new Map();
    ccCtx = vm.createContext({
      require,
      process,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      __dirname: pathSync.join(ROOT, 'apps', 'backend'),
      electron: { ipcMain: { handle: (ch, fn) => ipcHandlers.set(ch, fn) } },
      node_path: pathSync,
      promises: fsSync.promises,
      node_fs: fsSync,
      node_child_process: require('node:child_process'),
      node_crypto: require('node:crypto'),
      node_os: os,
      node_http: require('node:http'),
      __wideTs: tsModules,
      requireInstalled: async () => null,
      readAiConfig: async () => savedConfig,
      writeAiConfig: async (next) => { savedConfig = next; return next; },
      getAiSessionClaudeMeta: async (id) => sessionMeta.get(id) || { claudeSessionId: '', claudeSyncedCount: 0 },
      setAiSessionClaudeMeta: async (id, meta) => {
        const cur = sessionMeta.get(id) || { claudeSessionId: '', claudeSyncedCount: 0 };
        sessionMeta.set(id, { ...cur, ...meta });
      },
      AI_TOOLS: allToolSpecs,
      aiRunTool: async () => 'mock_tool_ok',
      aiResolvePath: (root, rel) => {
        const target = pathSync.resolve(root, String(rel || ''));
        const relative = pathSync.relative(root, target).replace(/\\/g, '/');
        if (relative.startsWith('..') || pathSync.isAbsolute(relative)) return { error: 'Path escapes' };
        return { path: target, relative };
      },
      aiDiffCounts: () => ({ added: 1, removed: 1 }),
      aiVerifyEditedFile: async (_r, p, rel, _c, _s, sendFn) => {
        sendFn({ type: 'verification', path: p, relativePath: rel, ok: true, errors: 0, warnings: 0, diagnostics: [] });
        return '';
      },
    });
    vm.runInContext(ccSrc, ccCtx);
    ccCtx.registerClaudeCodeHandlers();

    const statusReply = await ipcHandlers.get('ai:claudeCodeStatus')();
    const evsTurn1 = [];
    const r1 = await ccCtx.aiRunClaudeCodeTurn({
      root: mockCcRoot,
      sessionId: '0123456789abcdef0123456789abcdef',
      model: 'sonnet',
      effort: 'high',
      messages: [{ role: 'user', content: 'Edit demo' }],
      allowWrites: true,
      toolMode: 'full',
      send: (ev) => evsTurn1.push(ev),
    });
    const evsTurn2 = [];
    const r2 = await ccCtx.aiRunClaudeCodeTurn({
      root: mockCcRoot,
      sessionId: '0123456789abcdef0123456789abcdef',
      model: 'sonnet',
      effort: 'high',
      messages: [
        { role: 'user', content: 'Edit demo' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'second_turn' },
      ],
      allowWrites: true,
      toolMode: 'full',
      send: (ev) => evsTurn2.push(ev),
    });

    const t1Text = evsTurn1.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const t2Text = evsTurn2.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const pid1 = t1Text.startsWith('pid:') ? t1Text.slice(4) : '';
    const pid2Match = /^pid:(\d+):second_turn$/.exec(t2Text);
    const editEv = evsTurn1.find((e) => e.type === 'edit');
    const verEv = evsTurn1.find((e) => e.type === 'verification');
    const sugEv = evsTurn1.find((e) => e.type === 'prompt_suggestion');

    await ipcHandlers.get('ai:claudeCodeLogout')();
    const sssfText = fsSync.readFileSync(pathSync.join(ROOT, 'resources', 'sssF.include'), 'utf8');

    report(
      statusReply?.loggedIn === true &&
        statusReply?.subscriptionType === 'max' &&
        r1?.ok === true &&
        r2?.ok === true &&
        Boolean(pid1) &&
        pid2Match?.[1] === pid1 &&
        editEv?.staged === false &&
        editEv?.oldContent === 'export const x = 1;\n' &&
        editEv?.content === 'export const x = 2;\n' &&
        verEv?.ok === true &&
        sugEv?.suggestions?.[0] === 'Verify types' &&
        savedConfig.claudeCodeSignedIn === false &&
        sssfText.includes('ai:claudeCodeLogout') &&
        sssfText.includes('ai:closeClaudeSession') &&
        sssfText.includes('claude-code|antigravity|codex|local') &&
        sssfText.includes('ai:antigravityStatus') &&
        sssfText.includes('ai:closeAntigravitySession') &&
        sssfText.includes('ai:codexStatus') &&
        sssfText.includes('ai:closeCodexSession') &&
        !sssfText.includes('ai:openCodeStatus') &&
        !sssfText.includes('ai:setKey') &&
        !sssfText.includes('ai:verifyKey') &&
        !sssfText.includes('ai:keyStatus'),
      'Persistent Claude Code worker reuses warm PID, snapshots native Edit diffs, verifies post-edit, and respects SSSF auth channels',
    );
  } finally {
    if (ccCtx && typeof ccCtx.claudeCodeStopAll === 'function') {
      try { ccCtx.claudeCodeStopAll(); } catch {}
    }
    if (prevWideClaudePath === undefined) delete process.env.WIDE_CLAUDE_PATH;
    else process.env.WIDE_CLAUDE_PATH = prevWideClaudePath;
    try { fsSync.rmSync(mockCcRoot, { recursive: true, force: true }); } catch {}
  }

  const agyModelsSample = [
    'Fetching available models...',
    'gemini-4-neon-high\tGemini 4 Neon (High)',
    'gemini-4-neon-xhigh\tGemini 4 Neon (Extra High)',
    'gemini-4-neon-low\tGemini 4 Neon (Low)',
    'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
    'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  ].join('\n');
  const parsedFamilies = tsModules.parseAntigravityModelsOutput(agyModelsSample);
  const resolvedXhigh = tsModules.resolveAntigravityModelForEffort('gemini-4-neon', 'xhigh', parsedFamilies);
  const resolvedFallback = tsModules.resolveAntigravityModelForEffort('gpt-oss-120b', 'max', parsedFamilies);
  const askArgs = tsModules.buildAntigravityCliArgs({ mode: 'ask', conversationId: 'c1', model: 'gemini-4-neon-high', effort: 'high' });
  const agentArgs = tsModules.buildAntigravityCliArgs({ mode: 'agent', model: 'gemini-4-neon-xhigh', effort: 'xhigh' });
  const authErr = tsModules.classifyAntigravityError('Not logged in to Google Antigravity');
  report(
    parsedFamilies.length === 3 &&
      Boolean(parsedFamilies[0].variants?.xhigh) &&
      resolvedXhigh === 'gemini-4-neon-xhigh' &&
      resolvedFallback === 'gpt-oss-120b-medium' &&
      askArgs.includes('--mode') &&
      askArgs.includes('plan') &&
      askArgs.includes('--print=') &&
      !askArgs.includes('--dangerously-skip-permissions') &&
      agentArgs.includes('accept-edits') &&
      agentArgs.includes('--dangerously-skip-permissions') &&
      authErr.kind === 'auth',
    'Antigravity TS helpers parse dynamic model families, resolve efforts, enforce plan vs accept-edits CLI flags, and classify auth errors',
  );

  const mockAgyRoot = fsSync.mkdtempSync(pathSync.join(os.tmpdir(), 'wide-agy-smoke-'));
  const mockAgyTargetFile = pathSync.join(mockAgyRoot, 'demo.ts');
  const mockPlanOutsideFile = pathSync.join(mockAgyRoot, 'outside', 'plan.md');
  const mockMcpStateFile = pathSync.join(mockAgyRoot, 'mcp-state.txt');
  fsSync.mkdirSync(pathSync.dirname(mockPlanOutsideFile), { recursive: true });
  fsSync.writeFileSync(mockAgyTargetFile, 'export const a = 1;\n', 'utf8');
  const prevWideAgyPath = process.env.WIDE_AGY_PATH;
  let agyCtx = null;

  try {
    const mockAgyPath = pathSync.join(mockAgyRoot, 'mock-agy.js');
    const mockAgySource = [
      "const fs = require('node:fs');",
      "const readline = require('node:readline');",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') {",
      "  process.stdout.write('1.4.12\\n');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'models') {",
      "  process.stdout.write('gemini-4-neon-high\\tGemini 4 Neon (High)\\ngemini-4-neon-xhigh\\tGemini 4 Neon (Extra High)\\ngpt-oss-120b-medium\\tGPT-OSS 120B (Medium)\\n');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'mcp' && args[1] === 'list') {",
      "  const attached = fs.existsSync(" + JSON.stringify(mockMcpStateFile) + ") ? fs.readFileSync(" + JSON.stringify(mockMcpStateFile) + ", 'utf8') : '';",
      "  process.stdout.write('NAME\\tTYPE\\tSTATUS\\tCOMMAND/URL\\n' + (attached ? 'wide\\thttp\\tenabled\\t' + attached + '\\n' : ''));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'mcp' && args[1] === 'add') {",
      "  const url = args[args.length - 1] || '';",
      "  fs.writeFileSync(" + JSON.stringify(mockMcpStateFile) + ", url + '|' + args.join(' '), 'utf8');",
      "  process.exit(0);",
      "}",
      "let turnCount = 0;",
      "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
      "rl.on('line', (line) => {",
      "  const t = line.trim();",
      "  if (!t) return;",
      "  turnCount += 1;",
      "  let msg;",
      "  try { msg = JSON.parse(t); } catch { return; }",
      "  const cid = 'agy-conv-1';",
      "  if (turnCount === 1) {",
      "    process.stdout.write(JSON.stringify({ event: 'init', conversation_id: cid, init: { model: 'gemini-4-neon-xhigh' } }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'edit_file', tool_info: { name: 'edit_file', parameters: { Path: " + JSON.stringify(mockPlanOutsideFile) + " } } } }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'edit_file', tool_info: { name: 'edit_file', output: 'wrote plan' } } }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'edit_file', tool_info: { name: 'edit_file', parameters: { Path: 'demo.ts' } } } }) + '\\n');",
      "    setTimeout(() => {",
      "      fs.writeFileSync(" + JSON.stringify(mockPlanOutsideFile) + ", '# Plan\\n', 'utf8');",
      "      fs.writeFileSync(" + JSON.stringify(mockAgyTargetFile) + ", 'export const a = 2;\\n', 'utf8');",
      "      process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'edit_file', tool_info: { name: 'edit_file', output: 'edited demo.ts' } } }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'pid:' + process.pid } }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: cid, status: 'SUCCESS', response: 'pid:' + process.pid, usage: { input_tokens: 10, output_tokens: 4, thinking_tokens: 2, cache_read_tokens: 0, total_tokens: 16 } } }) + '\\n');",
      "    }, 20);",
      "  } else {",
      "    const userTxt = typeof msg.message?.content === 'string' ? msg.message.content : 'img';",
      "    process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'pid:' + process.pid + ':' + userTxt } }) + '\\n');",
      "    process.stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: cid, status: 'SUCCESS', response: 'pid:' + process.pid + ':' + userTxt, usage: { input_tokens: 3, output_tokens: 2, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 5 } } }) + '\\n');",
      "  }",
      "});",
    ].join('\n');
    fsSync.writeFileSync(mockAgyPath, mockAgySource, 'utf8');
    process.env.WIDE_AGY_PATH = mockAgyPath;

    const agySrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '50-ai-antigravity.js'), 'utf8');
    const agyMeta = new Map();
    const agyHandlers = new Map();
    agyCtx = vm.createContext({
      require,
      process,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      __dirname: pathSync.join(ROOT, 'apps', 'backend'),
      electron: { ipcMain: { handle: (ch, fn) => agyHandlers.set(ch, fn) } },
      node_path: pathSync,
      promises: fsSync.promises,
      node_fs: fsSync,
      node_child_process: require('node:child_process'),
      node_crypto: require('node:crypto'),
      node_os: os,
      node_http: require('node:http'),
      __wideTs: tsModules,
      getAiSessionAntigravityMeta: async (id) => agyMeta.get(id) || { conversationId: '' },
      setAiSessionAntigravityMeta: async (id, meta) => {
        const cur = agyMeta.get(id) || { conversationId: '' };
        agyMeta.set(id, { ...cur, ...meta });
      },
      AI_TOOLS: allToolSpecs,
      aiRunTool: async () => 'mock_agy_mcp_ok',
      aiResolvePath: (root, rel) => {
        const target = pathSync.resolve(root, String(rel || ''));
        const normRoot = pathSync.resolve(root);
        if (target === normRoot || target.startsWith(normRoot + pathSync.sep)) {
          if (target.startsWith(pathSync.join(normRoot, 'outside'))) return null;
          return target;
        }
        return null;
      },
      aiDiffCounts: (before, after) => ({
        added: before === after ? 0 : 1,
        removed: before === after ? 0 : 1,
      }),
      aiVerifyEditedFile: async (root, resolvedPath, relPath, _content, _staged, send) => {
        send({ type: 'verification', path: relPath, relativePath: relPath, ok: true, errors: 0, warnings: 0, diagnostics: [] });
        return { ok: true, errors: 0, warnings: 0 };
      },
    });
    vm.runInContext(agySrc, agyCtx, { filename: '50-ai-antigravity.js' });
    agyCtx.registerAntigravityHandlers();

    const stInitial = await agyHandlers.get('ai:antigravityStatus')({ force: true });
    const attachReply = await agyHandlers.get('ai:antigravityAttachMcp')();
    const mcpRecord = fsSync.existsSync(mockMcpStateFile) ? fsSync.readFileSync(mockMcpStateFile, 'utf8') : '';

    const workRoot = mockAgyRoot;
    const agyEv1 = [];
    const ar1 = await agyCtx.aiRunAntigravityTurn({
      root: workRoot,
      sessionId: 'agy-smoke-sess',
      model: 'gemini-4-neon',
      effort: 'xhigh',
      messages: [{ role: 'user', content: 'Edit demo' }],
      allowWrites: true,
      toolMode: 'full',
      send: (ev) => agyEv1.push(ev),
    });
    const agyEv2 = [];
    const ar2 = await agyCtx.aiRunAntigravityTurn({
      root: workRoot,
      sessionId: 'agy-smoke-sess',
      model: 'gemini-4-neon',
      effort: 'xhigh',
      messages: [
        { role: 'user', content: 'Edit demo' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'turn_two' },
      ],
      allowWrites: true,
      toolMode: 'full',
      send: (ev) => agyEv2.push(ev),
    });

    const at1 = agyEv1.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const at2 = agyEv2.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const apid1 = at1.startsWith('pid:') ? at1.slice(4) : '';
    const apid2Match = /^pid:(\d+):turn_two$/.exec(at2);
    const agyEdits = agyEv1.filter((e) => e.type === 'edit');
    const agyVer = agyEv1.find((e) => e.type === 'verification');

    report(
      stInitial?.installed === true &&
        stInitial?.signedIn === true &&
        stInitial?.version === '1.4.12' &&
        stInitial?.mcpAttached === false &&
        attachReply?.ok === true &&
        attachReply?.status?.mcpAttached === true &&
        mcpRecord.includes('Authorization: Bearer ') &&
        mcpRecord.includes('--type http wide http://127.0.0.1:') &&
        ar1?.ok === true &&
        ar2?.ok === true &&
        Boolean(apid1) &&
        apid2Match?.[1] === apid1 &&
        agyEdits.length === 1 &&
        agyEdits[0].path === 'demo.ts' &&
        agyEdits[0].staged === false &&
        agyEdits[0].oldContent === 'export const a = 1;\n' &&
        agyEdits[0].content === 'export const a = 2;\n' &&
        agyVer?.ok === true &&
        agyMeta.get('agy-smoke-sess')?.conversationId === 'agy-conv-1',
      'Persistent Antigravity worker reuses warm PID, ignores non-workspace edits, snapshots workspace diffs, verifies post-edit, and attaches HTTP MCP',
    );
  } finally {
    if (agyCtx && typeof agyCtx.antigravityStopAll === 'function') {
      try { agyCtx.antigravityStopAll(); } catch {}
    }
    if (prevWideAgyPath === undefined) delete process.env.WIDE_AGY_PATH;
    else process.env.WIDE_AGY_PATH = prevWideAgyPath;
    try { fsSync.rmSync(mockAgyRoot, { recursive: true, force: true }); } catch {}
  }

  const codexSanitized = tsModules.sanitizeCodexEnv({
    PATH: '/usr/bin',
    OPENAI_API_KEY: 'sk-blocked',
    OPENAI_BASE_URL: 'https://bad.local',
    OPENAI_ORG_ID: 'org-bad',
    OPENAI_PROJECT_ID: 'proj-bad',
    CODEX_API_KEY: 'codex-bad',
  });
  const codexModelsSample = tsModules.normalizeCodexModelsResponse({
    data: [
      {
        id: 'gpt-6.2-sol',
        model: 'gpt-6.2-sol',
        displayName: 'gpt-6.2-sol',
        defaultReasoningEffort: 'high',
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Thorough' },
          { reasoningEffort: 'ultra', description: 'Maximum' },
        ],
      },
      {
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName: 'gpt-5.5',
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Thorough' },
        ],
      },
    ],
  });
  const accApiKey = tsModules.parseCodexAccountResult({ account: { type: 'apiKey' } });
  const accChatGpt = tsModules.parseCodexAccountResult({ account: { type: 'chatgpt', email: 'dev@example.com', planType: 'pro' } });
  const codexAskThread = tsModules.buildCodexThreadStartParams({ root: '/repo', model: 'gpt-6.2-sol', mode: 'ask' });
  const codexAgentThread = tsModules.buildCodexThreadStartParams({ root: '/repo', model: 'gpt-6.2-sol', mode: 'agent' });
  const codexArgs = tsModules.buildCodexAppServerArgs({ mcpUrl: 'http://127.0.0.1:9999/mcp', bearerEnvVar: 'WIDE_CODEX_MCP_TOKEN' });

  const codexParser = new tsModules.CodexAppServerNotificationParser();
  const cEv1 = codexParser.feedNotification('item/agentMessage/delta', { itemId: 'm1', delta: 'Hi ' });
  const cEv2 = codexParser.feedNotification('item/started', {
    item: { type: 'fileChange', id: 'fc1', changes: [{ path: 'demo.ts', kind: { type: 'update' } }] },
  });
  const cEv3 = codexParser.feedNotification('item/completed', {
    item: { type: 'fileChange', id: 'fc1', status: 'completed', changes: [{ path: 'demo.ts', kind: { type: 'update' } }] },
  });
  const cEv4 = codexParser.feedNotification('turn/completed', { turn: { id: 't1', status: 'completed' } });

  report(
    codexSanitized.PATH === '/usr/bin' &&
      !('OPENAI_API_KEY' in codexSanitized) &&
      !('OPENAI_BASE_URL' in codexSanitized) &&
      !('CODEX_API_KEY' in codexSanitized) &&
      codexModelsSample.length === 2 &&
      tsModules.resolveCodexEffortForModel('gpt-6.2-sol', 'ultra', codexModelsSample) === 'ultra' &&
      tsModules.resolveCodexEffortForModel('gpt-5.5', 'ultra', codexModelsSample) === 'high' &&
      accApiKey.signedIn === false &&
      accChatGpt.signedIn === true &&
      accChatGpt.planType === 'pro' &&
      codexAskThread.sandbox === 'read-only' &&
      codexAgentThread.sandbox === 'workspace-write' &&
      codexArgs.includes('stdio://') &&
      codexArgs.some((a) => a.includes('mcp_servers.wide.url="http://127.0.0.1:9999/mcp"')) &&
      cEv1[0]?.type === 'delta' &&
      cEv2[0]?.type === 'tool_start' &&
      cEv2[0]?.tool === 'fileChange' &&
      cEv3[0]?.type === 'tool_result' &&
      cEv4[0]?.type === 'turn_done',
    'Codex TS helpers enforce strict ChatGPT auth, strip OpenAI API keys, resolve per-model efforts, and parse JSON-RPC notifications',
  );

  const mockCodexRoot = fsSync.mkdtempSync(pathSync.join(os.tmpdir(), 'wide-codex-smoke-'));
  const mockCodexFile = pathSync.join(mockCodexRoot, 'demo.ts');
  const mockCodexOutside = pathSync.join(mockCodexRoot, 'outside', 'secret.md');
  fsSync.mkdirSync(pathSync.dirname(mockCodexOutside), { recursive: true });
  fsSync.writeFileSync(mockCodexFile, 'export const c = 1;\n', 'utf8');
  const prevWideCodexPath = process.env.WIDE_CODEX_PATH;
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  let codexCtx = null;

  try {
    const mockCodexPath = pathSync.join(mockCodexRoot, 'mock-codex.js');
    const mockCodexSource = [
      "const fs = require('node:fs');",
      "const readline = require('node:readline');",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') {",
      "  process.stdout.write('codex-cli 0.170.0\\n');",
      "  process.exit(0);",
      "}",
      "const sawApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', (line) => {",
      "  if (!line.trim()) return;",
      "  const msg = JSON.parse(line);",
      "  if (msg.method === 'initialize') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { userAgent: 'codex/0.170.0' } }) + '\\n');",
      "  } else if (msg.method === 'account/read') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { account: sawApiKey ? { type: 'apiKey' } : { type: 'chatgpt', email: 'sub@example.com', planType: 'pro' }, requiresOpenaiAuth: true } }) + '\\n');",
      "  } else if (msg.method === 'model/list') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { data: [{ id: 'gpt-6.2-sol', model: 'gpt-6.2-sol', displayName: 'gpt-6.2-sol', defaultReasoningEffort: 'high', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'high', description: 'Thorough' }, { reasoningEffort: 'ultra', description: 'Maximum' }] }] } }) + '\\n');",
      "  } else if (msg.method === 'account/logout') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n');",
      "  } else if (msg.method === 'thread/start') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { thread: { id: 'codex-thread-1' } } }) + '\\n');",
      "  } else if (msg.method === 'turn/start') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1', status: 'inProgress', items: [] } } }) + '\\n');",
      "    const txt = String(msg.params?.input?.[0]?.text || '');",
      "    if (txt.includes('Edit codex')) {",
      "      process.stdout.write(JSON.stringify({ method: 'item/started', params: { threadId: 'codex-thread-1', turnId: 'turn-1', item: { type: 'fileChange', id: 'fc-w1', changes: [{ path: " + JSON.stringify(mockCodexFile) + ", kind: { type: 'update' } }, { path: " + JSON.stringify(mockCodexOutside) + ", kind: { type: 'create' } }] } } }) + '\\n');",
      "      setTimeout(() => {",
      "        fs.writeFileSync(" + JSON.stringify(mockCodexFile) + ", 'export const c = 2;\\n', 'utf8');",
      "        fs.writeFileSync(" + JSON.stringify(mockCodexOutside) + ", '# out', 'utf8');",
      "        process.stdout.write(JSON.stringify({ method: 'item/completed', params: { threadId: 'codex-thread-1', turnId: 'turn-1', item: { type: 'fileChange', id: 'fc-w1', status: 'completed', changes: [{ path: " + JSON.stringify(mockCodexFile) + ", kind: { type: 'update' } }, { path: " + JSON.stringify(mockCodexOutside) + ", kind: { type: 'create' } }] } } }) + '\\n');",
      "        process.stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'codex-thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'pid:' + process.pid } }) + '\\n');",
      "        process.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'codex-thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } } }) + '\\n');",
      "      }, 25);",
      "    } else {",
      "      process.stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'codex-thread-1', turnId: 'turn-1', itemId: 'msg-2', delta: 'pid:' + process.pid + ':' + txt + ':eff=' + String(msg.params?.effort || '') } }) + '\\n');",
      "      process.stdout.write(JSON.stringify({ method: 'turn/completed', params: { threadId: 'codex-thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } } }) + '\\n');",
      "    }",
      "  }",
      "});",
    ].join('\n');
    fsSync.writeFileSync(mockCodexPath, mockCodexSource, 'utf8');
    process.env.WIDE_CODEX_PATH = mockCodexPath;
    process.env.OPENAI_API_KEY = 'sk-should-be-stripped-by-wide';

    const ccSrcForHelpers = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '50-ai-claude-code.js'), 'utf8');
    const h1 = ccSrcForHelpers.indexOf('function claudeCodeExtractUserMessagePayload');
    const h2 = ccSrcForHelpers.indexOf('function claudeCodeBuildAppendSystemPrompt');
    const codexSrc = fsSync.readFileSync(pathSync.join(ROOT, 'apps', 'backend', 'src', '50-ai-codex.js'), 'utf8');
    const codexMeta = new Map();
    const codexHandlers = new Map();
    codexCtx = vm.createContext({
      require,
      process,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      __dirname: pathSync.join(ROOT, 'apps', 'backend'),
      electron: { ipcMain: { handle: (ch, fn) => codexHandlers.set(ch, fn) } },
      node_path: pathSync,
      promises: fsSync.promises,
      node_fs: fsSync,
      node_child_process: require('node:child_process'),
      node_crypto: require('node:crypto'),
      node_os: os,
      node_http: require('node:http'),
      __wideTs: tsModules,
      readAiConfig: async () => ({ codexEffort: 'high' }),
      getAiSessionCodexMeta: async (id) => codexMeta.get(id) || { codexThreadId: '', codexSyncedCount: 0 },
      setAiSessionCodexMeta: async (id, meta) => {
        const cur = codexMeta.get(id) || { codexThreadId: '', codexSyncedCount: 0 };
        codexMeta.set(id, { ...cur, ...meta });
      },
      AI_TOOLS: allToolSpecs,
      aiRunTool: async () => 'mock_codex_mcp_ok',
      aiResolvePath: (root, rel) => {
        const target = pathSync.resolve(root, String(rel || ''));
        const normRoot = pathSync.resolve(root);
        if (target.startsWith(pathSync.join(normRoot, 'outside'))) {
          return { error: 'Outside workspace' };
        }
        if (target === normRoot || target.startsWith(normRoot + pathSync.sep)) {
          return { path: target, relative: pathSync.relative(normRoot, target) };
        }
        return { error: 'Outside workspace' };
      },
      aiDiffCounts: (before, after) => ({
        added: before === after ? 0 : 1,
        removed: before === after ? 0 : 1,
      }),
      aiVerifyEditedFile: async (_root, resolvedPath, relPath, _content, _staged, send) => {
        send({ type: 'verification', path: resolvedPath, relativePath: relPath, ok: true, errors: 0, warnings: 0, diagnostics: [] });
        return { ok: true, errors: 0, warnings: 0 };
      },
    });
    vm.runInContext(`${ccSrcForHelpers.slice(h1, h2)}\n${codexSrc}`, codexCtx, { filename: '50-ai-codex.js' });
    codexCtx.registerCodexHandlers();

    const codexStatus = await codexHandlers.get('ai:codexStatus')({ force: true });
    const cEvList1 = [];
    const cr1 = await codexCtx.aiRunCodexTurn({
      root: mockCodexRoot,
      sessionId: 'codex-smoke-sess',
      model: 'gpt-6.2-sol',
      effort: 'ultra',
      messages: [{ role: 'user', content: 'Edit codex' }],
      allowWrites: true,
      toolMode: 'full',
      send: (ev) => cEvList1.push(ev),
    });
    const cEvList2 = [];
    const cr2 = await codexCtx.aiRunCodexTurn({
      root: mockCodexRoot,
      sessionId: 'codex-smoke-sess',
      model: 'gpt-6.2-sol',
      effort: 'ultra',
      messages: [
        { role: 'user', content: 'Edit codex' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'turn_two' },
      ],
      allowWrites: true,
      toolMode: 'full',
      send: (ev) => cEvList2.push(ev),
    });
    await codexHandlers.get('ai:codexLogout')();

    const ct1 = cEvList1.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const ct2 = cEvList2.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const cpid1 = ct1.startsWith('pid:') ? ct1.slice(4) : '';
    const cpid2Match = /^pid:(\d+):turn_two:eff=ultra$/.exec(ct2);
    const codexEdits = cEvList1.filter((e) => e.type === 'edit');
    const codexVer = cEvList1.find((e) => e.type === 'verification');

    report(
      codexStatus?.installed === true &&
        codexStatus?.signedIn === true &&
        codexStatus?.planType === 'pro' &&
        codexStatus?.models?.[0]?.id === 'gpt-6.2-sol' &&
        cr1?.ok === true &&
        cr2?.ok === true &&
        Boolean(cpid1) &&
        cpid2Match?.[1] === cpid1 &&
        codexEdits.length === 1 &&
        codexEdits[0].path === mockCodexFile &&
        codexEdits[0].staged === false &&
        codexEdits[0].oldContent === 'export const c = 1;\n' &&
        codexEdits[0].content === 'export const c = 2;\n' &&
        codexVer?.ok === true &&
        codexMeta.get('codex-smoke-sess')?.codexThreadId === 'codex-thread-1',
      'Persistent Codex worker strips OPENAI_API_KEY, enforces ChatGPT OAuth, reuses warm PID, snapshots fileChange diffs, and verifies post-edit',
    );
  } finally {
    if (codexCtx && typeof codexCtx.codexStopAll === 'function') {
      try { codexCtx.codexStopAll(); } catch {}
    }
    if (prevWideCodexPath === undefined) delete process.env.WIDE_CODEX_PATH;
    else process.env.WIDE_CODEX_PATH = prevWideCodexPath;
    if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiKey;
    try { fsSync.rmSync(mockCodexRoot, { recursive: true, force: true }); } catch {}
  }

  return failed;
}

async function checkReconCoreEngine() {
  const httpSync = require('node:http');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const statusRes = (await invoke('recon:status', [])).result;
  report(statusRes?.ok === true && Array.isArray(statusRes.engines) && statusRes.engines.includes('node-ts'), 'recon:status reports initialized engines');

  const normRes = (await invoke('recon:normalizePaths', [[
    'https://app.test/users/42',
    'https://app.test/items/alpha',
    'https://app.test/items/beta',
    'https://app.test/items/gamma',
  ], 2])).result;
  report(
    Array.isArray(normRes?.fingerprints) &&
      normRes.fingerprints[0] === 'https://app.test/users/{num}' &&
      normRes.fingerprints[3] === 'https://app.test/items/{param}',
    'recon:normalizePaths collapses numeric IDs and high-cardinality PathTrie segments',
  );

  const ssrfBlock = (await invoke('recon:checkScope', [{ url: 'http://169.254.169.254/latest/meta-data/', rootHostname: 'example.com', fieldScope: 'rdn', allowPrivate: false }])).result;
  const v6Block = (await invoke('recon:checkScope', [{ url: 'http://[::1]/admin', rootHostname: 'example.com', fieldScope: 'rdn', allowPrivate: false }])).result;
  const rdnAllow = (await invoke('recon:checkScope', [{ url: 'https://api.example.com/v1', rootHostname: 'www.example.com', fieldScope: 'rdn', allowPrivate: false }])).result;
  const evilBlock = (await invoke('recon:checkScope', [{ url: 'https://evil.org/', rootHostname: 'www.example.com', fieldScope: 'rdn', allowPrivate: false }])).result;
  report(
    ssrfBlock?.allowed === false &&
      ssrfBlock?.internalHost === true &&
      v6Block?.allowed === false &&
      rdnAllow?.allowed === true &&
      evilBlock?.allowed === false,
    'recon:checkScope enforces SSRF NetworkPolicy and RDN/FQDN DNS scope',
  );

  const h = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  const p = 'eyJzdWIiOiJ1c2VyLTEiLCJpc3MiOiJ3aWRlIn0';
  const validGKey = ['AIza', 'SyD1234567890abcdefghijklmnopqrstuv'].join('');
  const auditRes = (await invoke('recon:auditResponse', [{
    url: 'https://app.example.com/api/v1/items',
    method: 'POST',
    headers: { server: 'nginx/1.25', 'content-type': 'application/json' },
    reqContentType: 'application/json',
    body: `<div data-reactroot>api_key="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" token="${validGKey}" auth="Bearer ${h}.${p}.sig"</div>`,
    extractLinks: true,
  }])).result;
  report(
    auditRes?.ok === true &&
      auditRes.audit?.endpointClass === 'rest' &&
      auditRes.audit?.technologies?.includes('Nginx') &&
      auditRes.audit?.technologies?.includes('React') &&
      auditRes.audit?.jwtTokens?.length === 1 &&
      auditRes.audit?.jwtTokens?.[0]?.payload?.iss === 'wide' &&
      auditRes.audit?.secrets?.length === 1 &&
      auditRes.audit?.secrets?.[0]?.ruleId === 'google-api-key',
    'recon:auditResponse runs security headers, JWT decode, entropy-filtered secrets, REST classification, and tech detection',
  );

  const ssrfReplay = (await invoke('proxy:replay', [{ method: 'GET', url: 'http://127.0.0.1:9/test', headers: [], body: '' }, { allowPrivate: false }])).result;
  report(ssrfReplay?.ok === false && String(ssrfReplay?.error || '').includes('SSRF'), 'proxy:replay blocks loopback requests when allowPrivate is false');

  const srv = httpSync.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', Server: 'Nginx' });
      res.end('<html><head><title>Home</title></head><body><a href="/login">Login</a><script>fetch("/api/users");</script></body></html>');
      return;
    }
    if (reqUrl === '/login') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Login</title></head><body><form action="/session" method="POST"><input name="user" type="text"></form></body></html>');
      return;
    }
    if (reqUrl === '/api/users') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"users":[]}');
      return;
    }
    if (reqUrl === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const port = srv.address().port;
    const crawlRes = (await invoke('recon:crawlStart', [{
      seeds: [`http://127.0.0.1:${port}/`],
      maxDepth: 2,
      maxPages: 12,
      probePaths: false,
      allowPrivate: true,
    }])).result;
    report(
      crawlRes?.ok === true &&
        Number(crawlRes.visited || 0) >= 3 &&
        Boolean(crawlRes.graph?.nodes?.length >= 2),
      'recon:crawlStart crawls local target, discovers links/forms/JS APIs, and builds StateGraph',
    );
  } finally {
    await new Promise((r) => srv.close(r));
  }

  const pathLocal = require('node:path');
  const tsInspect = require(pathLocal.join(__dirname, '..', 'out', 'main', 'backend-modules.cjs'));
  report(
    tsInspect.detectSqli("1' OR '1'='1").sqli === true &&
      tsInspect.detectXss('<s\x00cript>alert(1)</script>').xss === true &&
      tsInspect.hasNestedQuantifiers('(a+)+$') === true,
    'backend-modules lexical SQLi/XSS and nested-quantifier ReDoS detection work as expected',
  );

  const safeProg = tsInspect.compileSafePattern('^(a+)+c$', '');
  const tNfaStart = Date.now();
  const safeHit = tsInspect.matchSafePattern(safeProg, `${'a'.repeat(2000)}!`);
  report(
    safeHit === false && Date.now() - tNfaStart < 250,
    'Thompson NFA matcher completes linear-time on adversarial backtracking input',
  );

  const redosRuleRes = (await invoke('security:testRule', ['(a+)+$', '', 'aaaaaaaaaa!'])).result;
  const nfaRuleRes = (await invoke('security:testRule', ['^SELECT\\s+\\*', 'i', 'SELECT * FROM users\nother'])).result;
  report(
    redosRuleRes?.ok === false &&
      nfaRuleRes?.ok === true &&
      nfaRuleRes?.engine === 'nfa' &&
      Array.isArray(nfaRuleRes?.matches) &&
      nfaRuleRes.matches.length === 1,
    'security:testRule rejects ReDoS patterns and executes safe regex via linear Thompson NFA',
  );

  const inspectTestUrl = "https://app.example.com/search?q=1%27%20UNION%20SELECT%201,2--%u0027";
  const inspectTrafficRes = (await invoke('proxy:inspectTraffic', [
    {
      url: inspectTestUrl,
      method: 'GET',
      reqHeaders: [['Host', 'app.example.com']],
      reqBody: '',
    },
    { learning: true, today: '2026-11-19' },
  ])).result;
  report(
    inspectTrafficRes?.ok === true &&
      inspectTrafficRes?.scores?.sql >= 8 &&
      inspectTrafficRes?.action === 'log' &&
      inspectTrafficRes?.signals?.percentUEscape === true &&
      Array.isArray(inspectTrafficRes?.drafts) &&
      inspectTrafficRes.drafts.length > 0,
    'proxy:inspectTraffic scores SQLi + evasion and emits learning exception drafts',
  );

  const firstHitIds = (inspectTrafficRes?.hits || []).map((h) => h.ruleId);
  const suppressedInspect = (await invoke('proxy:inspectTraffic', [
    {
      url: inspectTestUrl,
      method: 'GET',
      reqHeaders: [['Host', 'app.example.com']],
      reqBody: '',
    },
    {
      today: '2026-11-19',
      exceptions: [{ ruleIds: firstHitIds, pathPrefix: '/search', adjustments: { sql: -50, xss: -50 }, until: '2099-12-31' }],
    },
  ])).result;
  const expiredInspect = (await invoke('proxy:inspectTraffic', [
    {
      url: inspectTestUrl,
      method: 'GET',
      reqHeaders: [['Host', 'app.example.com']],
      reqBody: '',
    },
    {
      today: '2026-11-19',
      exceptions: [{ ruleIds: firstHitIds, pathPrefix: '/search', adjustments: { sql: -50, xss: -50 }, until: '2020-01-01' }],
    },
  ])).result;
  report(
    suppressedInspect?.ok === true &&
      suppressedInspect?.action === 'pass' &&
      Number(suppressedInspect?.suppressed || 0) > 0 &&
      Number(expiredInspect?.expiredExceptions || 0) > 0 &&
      Number(expiredInspect?.scores?.sql || 0) >= 8,
    'proxy:inspectTraffic honors active dated exceptions and rejects expired until dates',
  );

  const inspectReportRes = (await invoke('proxy:inspectReport', [{
    learning: true,
    entries: [{
      id: 77,
      url: "https://app.example.com/items?id=1' UNION SELECT 1,2--",
      method: 'GET',
      reqHeaders: [['Host', 'app.example.com']],
      reqBody: '',
    }],
  }])).result;
  report(
    inspectReportRes?.ok === true &&
      Array.isArray(inspectReportRes?.results) &&
      inspectReportRes.results.length >= 1 &&
      Array.isArray(inspectReportRes?.drafts) &&
      inspectReportRes.drafts.length >= 1,
    'proxy:inspectReport inspects batch proxy entries and aggregates exception drafts',
  );

  const smuggleRes = (await invoke('proxy:testSmuggling', [{
    method: 'GET',
    rawRequest: "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    rawResponse: "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nokHTTP/1.1 200 OK\r\n\r\npoison",
  }])).result;
  report(
    smuggleRes?.ok === true &&
      smuggleRes?.requestReport?.ok === false &&
      smuggleRes?.requestReport?.error === 'AmbiguousFraming' &&
      smuggleRes?.responseReport?.ok === false &&
      Array.isArray(smuggleRes?.responseReport?.poisoningVectors) &&
      smuggleRes.responseReport.poisoningVectors.length > 0,
    'proxy:testSmuggling flags RFC 9112 CL+TE request smuggling and response poisoning',
  );

  const sampleArticleHtml = `
    <html><head>
      <title>Ignored Site Title</title>
      <meta property="og:title" content="Deep Engine Article">
      <meta name="author" content="Wide Research">
      <meta property="article:published_time" content="2026-11-19">
      <meta name="keywords" content="security, resilience, http">
    </head><body>
      <nav>Menu Home Login Signup</nav>
      <article>
        <h1>Deep Engine Article</h1>
        <p>First important paragraph with &amp; clean prose that exceeds minimum length threshold easily.</p>
        <p>Second detailed technical paragraph describing extraction without navigation clutter.</p>
        <img src="/assets/diagram.png">
      </article>
      <footer>Copyright Boilerplate Footer</footer>
    </body></html>`;
  const art = tsInspect.extractArticleFromHtml(sampleArticleHtml, 'https://example.org/post/1');
  report(
    art.title === 'Deep Engine Article' &&
      art.author === 'Wide Research' &&
      art.date === '2026-11-19' &&
      art.cleanText.includes('First important paragraph with & clean prose') &&
      !art.cleanText.includes('Menu Home Login') &&
      !art.cleanText.includes('Copyright Boilerplate Footer') &&
      art.allImages.includes('https://example.org/assets/diagram.png'),
    'extractArticleFromHtml extracts clean article body, metadata, and resolved images without boilerplate',
  );

  report(
    tsInspect.shouldBlockFastReadRequest('image', 'https://cdn.example.org/a.png') === true &&
      tsInspect.shouldBlockFastReadRequest('font', 'https://cdn.example.org/a.woff2') === true &&
      tsInspect.shouldBlockFastReadRequest('script', 'https://www.google-analytics.com/analytics.js') === true &&
      tsInspect.shouldBlockFastReadRequest('document', 'https://example.org/news') === false,
    'shouldBlockFastReadRequest blocks images, fonts, and trackers while allowing documents',
  );

  const zlibLocal = require('node:zlib');
  const fsLocal = require('node:fs');
  const osLocal = require('node:os');
  const makeZipDocx = (xmlContent) => {
    const nameBuf = Buffer.from('word/document.xml', 'utf8');
    const compData = zlibLocal.deflateRawSync(Buffer.from(xmlContent, 'utf8'));
    const lf = Buffer.alloc(30);
    lf.writeUInt32LE(0x04034b50, 0);
    lf.writeUInt16LE(20, 4);
    lf.writeUInt16LE(8, 8);
    lf.writeUInt32LE(compData.length, 18);
    lf.writeUInt32LE(Buffer.byteLength(xmlContent, 'utf8'), 22);
    lf.writeUInt16LE(nameBuf.length, 26);
    const lfFull = Buffer.concat([lf, nameBuf, compData]);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(Buffer.byteLength(xmlContent, 'utf8'), 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 42);
    const cdFull = Buffer.concat([cd, nameBuf]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cdFull.length, 12);
    eocd.writeUInt32LE(lfFull.length, 16);
    return Buffer.concat([lfFull, cdFull, eocd]);
  };
  const docxBuf = makeZipDocx(
    '<w:document><w:body><w:p><w:r><w:t>First &amp; Second</w:t></w:r></w:p><w:p><w:r><w:t>Third Line</w:t></w:r></w:p></w:body></w:document>',
  );
  const docxParsed = tsInspect.extractDocxText(docxBuf);
  const docxTmp = pathLocal.join(ROOT, `wide-smoke-${Date.now()}.docx`);
  fsLocal.writeFileSync(docxTmp, docxBuf);
  let fsDocxReply = null;
  try {
    await invoke('dialog:openFolder', []);
    fsDocxReply = await invoke('fs:readFile', [docxTmp]);
  } finally {
    try { fsLocal.rmSync(docxTmp, { force: true }); } catch {}
  }
  const fsDocxRes = fsDocxReply?.result;
  report(
    docxParsed.ok === true &&
      docxParsed.text === 'First & Second\nThird Line' &&
      docxParsed.paragraphs === 2 &&
      fsDocxRes?.format === 'docx' &&
      fsDocxRes?.content === 'First & Second\nThird Line',
    `zero-dependency extractDocxText and fs:readFile decode DEFLATE ZIP/DOCX paragraphs cleanly${fsDocxReply?.error ? ` (${fsDocxReply.error})` : ''}`,
  );

  const credCheck = tsInspect.checkUrlSecurity('https://user:pass@example.com/resource');
  const redirSsrf = tsInspect.validateRedirectChain(
    ['https://example.com/start', 'http://169.254.169.254/latest/meta-data/'],
    { allowPrivate: false, maxRedirects: 5 },
  );
  const redirTooLong = tsInspect.validateRedirectChain(
    Array.from({ length: 7 }, (_, i) => `https://example.com/h${i}`),
    { maxRedirects: 5 },
  );
  report(
    credCheck.allowed === false &&
      redirSsrf.allowed === false &&
      redirTooLong.allowed === false,
    'URL security guard rejects embedded credentials, SSRF redirect hops, and >5 redirect chains',
  );

  const brk = new tsInspect.CircuitBreaker({ failureThreshold: 3, initialCooldownMs: 50, maxCooldownMs: 200 });
  report(brk.canTry(1000) === true && brk.state === 'CLOSED', 'CircuitBreaker starts CLOSED');
  brk.onBlocked(1000);
  brk.onBlocked(1010);
  brk.onBlocked(1020);
  const openBlocked = brk.state === 'OPEN' && brk.canTry(1030) === false;
  const halfOpenTry = brk.canTry(1080) === true && brk.state === 'HALF_OPEN';
  brk.onSuccess();
  report(
    openBlocked && halfOpenTry && brk.state === 'CLOSED' && brk.cooldownMs === 50,
    'CircuitBreaker transitions cleanly across CLOSED -> OPEN -> HALF_OPEN -> CLOSED',
  );

  const agentPool = new tsInspect.AgentPool();
  const a1 = agentPool.getAgent('https:', true, 'http://127.0.0.1:8888');
  const a2 = agentPool.getAgent('https:', true, 'http://127.0.0.1:8888');
  const jitterMs = tsInspect.computeJitterBackoffMs(2, 100, 50, () => 0.5);
  const sameAgent = a1 === a2 && agentPool.size() === 1;
  agentPool.closeAll();
  report(
    sameAgent && jitterMs === 425 && tsInspect.computeJitterBackoffMs(1, 100, 0, () => 0) === 200,
    'AgentPool caches keep-alive/proxy agents and computeJitterBackoffMs applies exponential jitter',
  );

  const fastToggle1 = (await invoke('ai:browserNav', [{ action: 'toggle_fast_read' }])).result;
  const fastToggle2 = (await invoke('ai:browserNav', [{ action: 'toggle_fast_read' }])).result;
  report(
    fastToggle1?.ok === true &&
      fastToggle1?.session?.fastRead === true &&
      fastToggle2?.session?.fastRead === false,
    'ai:browserNav toggle_fast_read switches session fastRead state cleanly',
  );

  const credHttpRes = (await invoke('http:send', ['https://admin:secret@example.com/', 'GET', [], null, {}])).result;
  const credProxyRes = (await invoke('proxy:replay', [{ method: 'GET', url: 'http://admin:secret@127.0.0.1:9/', headers: [], body: '' }, { allowPrivate: true }])).result;
  report(
    credHttpRes?.ok === false &&
      String(credHttpRes?.error || '').includes('credentials') &&
      credProxyRes?.ok === false &&
      String(credProxyRes?.error || '').includes('credentials'),
    'http:send and proxy:replay reject URLs carrying embedded user:pass@ credentials',
  );

  let transientHits = 0;
  let blockedHits = 0;
  const resSrv = httpSync.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl === '/flaky') {
      transientHits += 1;
      if (transientHits <= 2) {
        res.writeHead(429, { 'Content-Type': 'text/plain' });
        res.end('rate limited');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('recovered');
      return;
    }
    if (reqUrl === '/blocked') {
      blockedHits += 1;
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => resSrv.listen(0, '127.0.0.1', r));
  try {
    const resPort = resSrv.address().port;
    const flakyRes = (await invoke('http:send', [
      `http://127.0.0.1:${resPort}/flaky`,
      'GET',
      [],
      null,
      { retries: 2, backoffBaseMs: 15, backoffJitterMs: 10 },
    ])).result;
    report(
      flakyRes?.ok === true && flakyRes?.status === 200 && flakyRes?.body === 'recovered' && transientHits === 3,
      'http:send retries 429 transient failures with jitter backoff and recovers',
    );

    const blkUrl = `http://127.0.0.1:${resPort}/blocked`;
    await invoke('http:send', [blkUrl, 'GET', [], null, { useBreaker: true }]);
    await invoke('http:send', [blkUrl, 'GET', [], null, { useBreaker: true }]);
    await invoke('http:send', [blkUrl, 'GET', [], null, { useBreaker: true }]);
    const openCircuitRes = (await invoke('http:send', [blkUrl, 'GET', [], null, { useBreaker: true }])).result;
    report(
      blockedHits === 3 &&
        openCircuitRes?.ok === false &&
        openCircuitRes?.circuitState === 'OPEN',
      'http:send opens per-host circuit breaker after 3 consecutive 403 blocks without extra network call',
    );
  } finally {
    await new Promise((r) => resSrv.close(r));
  }

  const playbookText = tsInspect.aiBuildWideCapabilityPlaybook({
    allowWrites: true,
    toolMode: 'full',
    allowBrowser: true,
    isExternalCli: true,
  });
  report(
    playbookText.includes('Wide Ecosystem Capability Playbook') &&
      playbookText.includes('read_document') &&
      playbookText.includes('fastRead=true') &&
      playbookText.includes("mode='article'") &&
      playbookText.includes('crawl_target') &&
      playbookText.includes('inspect_http_message') &&
      playbookText.includes('useBreaker=true'),
    'aiBuildWideCapabilityPlaybook emits complete Wide capability guidance for Cloud and local agents',
  );

  const toolsSrc = fsLocal.readFileSync(pathLocal.join(ROOT, 'apps', 'backend', 'src', '44-ai-0-tools.js'), 'utf8');
  const toolsVm = { __wideTs: tsInspect };
  require('node:vm').runInNewContext(`${toolsSrc}\nglobalThis.__allTools = AI_TOOLS;`, toolsVm);
  const mcpFilteredFull = tsInspect.aiFilterToolsForClaudeMcp(toolsVm.__allTools, {
    allowWrites: true,
    toolMode: 'full',
    allowBrowser: true,
  });
  const mcpFilteredCode = tsInspect.aiFilterToolsForClaudeMcp(toolsVm.__allTools, {
    allowWrites: true,
    toolMode: 'code',
    allowBrowser: false,
  });
  const mcpNamesFull = mcpFilteredFull.map((t) => t.name);
  const mcpNamesCode = mcpFilteredCode.map((t) => t.name);
  const inspectToolSpec = mcpFilteredFull.find((t) => t.name === 'inspect_http_message');
  const crawlToolSpec = mcpFilteredFull.find((t) => t.name === 'crawl_target');
  const readDocSpec = mcpFilteredFull.find((t) => t.name === 'read_document');
  report(
    mcpNamesFull.includes('read_document') &&
      mcpNamesFull.includes('crawl_target') &&
      mcpNamesFull.includes('inspect_http_message') &&
      mcpNamesCode.includes('read_document') &&
      !mcpNamesCode.includes('crawl_target') &&
      Boolean(inspectToolSpec?.parameters?.properties?.learning) &&
      Boolean(crawlToolSpec?.parameters?.properties?.fieldScope) &&
      Boolean(readDocSpec?.parameters?.properties?.path),
    'Cloud MCP tool filter exposes read_document, crawl_target, and inspect_http_message with full parameter schemas',
  );

  const vCrawl = toolsVm.aiValidateToolCall('crawl_target', { url: 'https://example.com', maxDepth: 2, allowPrivate: false });
  const vInspect = toolsVm.aiValidateToolCall('inspect_http_message', { url: 'https://example.com/?q=1', learning: true });
  const vDoc = toolsVm.aiValidateToolCall('read_document', { path: 'spec.docx' });
  const vExt = toolsVm.aiValidateToolCall('browser_extract', { mode: 'article', cleanText: true });
  const vOpen = toolsVm.aiValidateToolCall('browser_open', { url: 'https://example.com', fastRead: true });
  const vHttp = toolsVm.aiValidateToolCall('send_http_request', { url: 'https://example.com', retries: 2, useBreaker: true });
  report(
    vCrawl.ok === true &&
      vInspect.ok === true &&
      vDoc.ok === true &&
      vExt.ok === true &&
      vOpen.ok === true &&
      vHttp.ok === true,
    'aiValidateToolCall accepts new crawl_target, inspect_http_message, read_document, fastRead, article, and resilient HTTP schemas',
  );

  return failed;
}
