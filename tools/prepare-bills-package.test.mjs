import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { billsEnvironmentTemplates, billsRequiredFiles, checkBillsSource, inspectBillsBytes, prepareBillsPackage, safeBillsPath, verifyBillsPackage } from './prepare-bills-package.mjs';
import { reviewedPassiveAssetPaths, reviewedThemeTextPaths } from './audit-publication.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const productionCommon = 'NODE_ENV=production\nAPP_ORIGIN=https://bills.voltronix.ae\nCRM_API_INSTANCE_ID=bills-crm\nCRM_DATABASE_MODE=disabled\nCRM_MYSQL_NETWORK_DISABLED=1\nZOHO_ENABLED=false\nNEXT_TELEMETRY_DISABLED=1\n';
const templateBodies = {
  '.env.example': 'CRM_FRONTEND_BACKEND=express\nCRM_EXPRESS_ORIGIN=http://127.0.0.1:3002\nAPP_ORIGIN=http://127.0.0.1:3001\n',
  'server/.env.example': 'CRM_API_ENVIRONMENT=development\nCRM_API_HOST=127.0.0.1\nCRM_API_PORT=3002\nAPP_ORIGIN=http://127.0.0.1:3001\nCRM_RUNTIME_ENABLE=\nCRM_RUNTIME_PROFILE=\nCRM_MYSQL_NETWORK_DISABLED=1\n',
  'deploy/ubuntu/bills-web.env.example': productionCommon + 'CRM_WEB_HOST=127.0.0.1\nCRM_WEB_PORT=3301\nCRM_FRONTEND_BACKEND=express\nCRM_EXPRESS_ORIGIN=http://127.0.0.1:3302\n',
  'deploy/ubuntu/bills-api.env.example': productionCommon + 'CRM_API_ENVIRONMENT=production\nCRM_API_HOST=127.0.0.1\nCRM_API_PORT=3302\n',
};
function fixture(t) {
  const temporaryRoot = realpathSync(tmpdir()), root = mkdtempSync(join(temporaryRoot, 'bills-package-synthetic-'));
  t.after(() => {
    // Only this test's newly created and resolved temporary directory is removed.
    assert.equal(dirname(resolve(root)), temporaryRoot);
    assert.match(basename(root), /^bills-package-synthetic-[a-z0-9]+$/i);
    assert.equal(lstatSync(root).isSymbolicLink(), false);
    assert.equal(realpathSync(root), root);
    rmSync(root, { recursive: true, force: true });
  });
  const put = (name, bytes) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), bytes); };
  for (const base of ['src', 'server/src', 'server/tests', 'server/scripts', 'server/demo-sqlite', 'tests', 'scripts', 'shared/contracts/src', 'tools']) mkdirSync(join(root, base), { recursive: true });
  for (const name of billsRequiredFiles) {
    // Only the exact already-distributed public/font bytes are used. All source,
    // configuration, records and directories in this fixture are synthetic.
    const bytes = reviewedPassiveAssetPaths.includes(name) || reviewedThemeTextPaths.includes(name)
      ? readFileSync(join(repository, name)) : templateBodies[name] ?? (name.endsWith('.json') ? '{}\n' : '// Synthetic package source\n');
    put(name, bytes);
  }
  put('tools/publication-reviewed-fixtures.json', '[]\n');
  put('server/tests/synthetic.test.ts', 'export const syntheticTest = true;\n');
  put('tools/publication-source-files.json', JSON.stringify([...billsRequiredFiles, 'server/tests/synthetic.test.ts']) + '\n');
  return { root, put, package: () => prepareBillsPackage(root) };
}

test('Bills source paths include necessary source/config/assets and only four exact environment examples', () => {
  for (const path of [...billsRequiredFiles, 'server/tests/synthetic.test.ts', 'src/app/api/[id]/route.ts', 'tools/run-bills.test.mjs']) assert.equal(safeBillsPath(path), true, path);
  for (const path of ['.env', '.env.production', 'server/.env.local', 'server/src/.env.example', 'deploy/ubuntu/bills-web.env',
    'deploy/ubuntu/other.env.example', 'server/src/customer.db', 'server/src/secret.key', 'server/src/private.json',
    'server/src/credentials.json', 'public/legacy/manifest.json', 'public/legacy/assets/images/favicon_voltronix.png',
    'resources/quotation-pdf/stamp.png', 'server/assets/quotation-pdf/sign.jpg', 'node_modules/tool.js', '.git/config',
    'src/uploads/customer.ts', 'src/sessions/session.ts', 'src/.local-data/fixture.ts', 'server/dist/cli.js',
    '../src/x.ts', 'G:/src/x.ts', 'src\\x.ts', 'src/NUL.ts', 'src/file.ts.', 'src//file.ts']) {
    // Ordinary private.json is not categorically private by filename alone;
    // its contents are inspected separately below.
    if (path === 'server/src/private.json') continue;
    assert.equal(safeBillsPath(path), false, path);
  }
  assert.equal(billsEnvironmentTemplates.length, 4);
});

test('Bills example templates require disabled database/Zoho and approved endpoints', () => {
  for (const [path, bytes] of Object.entries(templateBodies)) assert.deepEqual(inspectBillsBytes(path, Buffer.from(bytes)), []);
  for (const body of [productionCommon.replace('disabled', 'native') + 'CRM_API_ENVIRONMENT=production\nCRM_API_HOST=127.0.0.1\nCRM_API_PORT=3302\n',
    templateBodies['deploy/ubuntu/bills-api.env.example'].replace('ZOHO_ENABLED=false', 'ZOHO_ENABLED=true'),
    templateBodies['deploy/ubuntu/bills-web.env.example'].replace(':3302', ':3002')]) {
    assert.ok(inspectBillsBytes(body.includes('CRM_WEB_PORT') ? 'deploy/ubuntu/bills-web.env.example' : 'deploy/ubuntu/bills-api.env.example', Buffer.from(body)).length);
  }
});

test('Bills scans reject credential material, private JSON and renamed binaries without returning contents', () => {
  const sensitive = 'synthetic-packager-credential';
  for (const [name, bytes] of [
    ['server/src/example.ts', Buffer.from(`const password = "${sensitive}";`)],
    ['server/src/example.json', Buffer.from('{"access_token":"synthetic-value"}')],
    ['server/src/example.ts', Buffer.from('SQLite format 3\0synthetic')],
    ['server/src/example.ts', Buffer.from('-----BEGIN PRIVATE KEY-----')],
    ['server/src/example.ts', Buffer.from('INSERT INTO synthetic VALUES (1);')],
  ]) {
    const findings = inspectBillsBytes(name, bytes);
    assert.ok(findings.length);
    assert.ok(!JSON.stringify(findings).includes(sensitive));
  }
  const asset = 'public/legacy/assets/images/logo-voltronix.png';
  assert.ok(inspectBillsBytes(asset, Buffer.from('renamed synthetic upload')).includes('unreviewed-passive-asset-bytes'));
});

test('Bills synthetic credential exceptions require reviewed exact bytes/path/category and never cover runtime source', () => {
  const path = 'server/tests/synthetic.test.ts', bytes = Buffer.from('const password = "synthetic-only-fixture";');
  const reviewedFixtures = [{ path, sha256: digest(bytes), categories: ['literal-password-candidate'] }];
  assert.deepEqual(inspectBillsBytes(path, bytes, { reviewedFixtures }), []);
  assert.ok(inspectBillsBytes(path, Buffer.concat([bytes, Buffer.from('\n')]), { reviewedFixtures }).length);
  assert.ok(inspectBillsBytes('server/tests/other.test.ts', bytes, { reviewedFixtures }).length);
  assert.throws(() => inspectBillsBytes('server/src/example.ts', bytes, { reviewedFixtures: [{ ...reviewedFixtures[0], path: 'server/src/example.ts' }] }));
  assert.ok(inspectBillsBytes(path, bytes, { reviewedFixtures, knownCredentials: () => ['synthetic-known-match'] }).length);
});

test('Bills source package preserves source, includes tests and UI/fonts, and produces reproducible verified ZIPs', t => {
  const f = fixture(t), before = digest(readFileSync(join(f.root, 'package.json')));
  const first = f.package(), second = f.package();
  assert.notEqual(first.output, second.output);
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.equal(first.productionAccepted, false);
  const manifest = JSON.parse(readFileSync(join(f.root, first.output, 'bills-crm-source/FILE-MANIFEST.json'), 'utf8'));
  assert.deepEqual(manifest.files.map(item => item.path), [...billsRequiredFiles, 'server/tests/synthetic.test.ts'].sort());
  assert.equal(manifest.scannerScope.historicalCredentialScan, false);
  assert.equal(manifest.scannerScope.historicalPrivateCopyScan, false);
  assert.equal(verifyBillsPackage(f.root, first.output).status, 'VERIFIED_BILLS_SOURCE_PACKAGE');
  assert.equal(digest(readFileSync(join(f.root, 'package.json'))), before);
});

test('Bills packaging excludes actual environments, private storage and old originals without reading their content', t => {
  const f = fixture(t);
  for (const name of ['.env', '.env.production', 'server/.env', 'server/src/uploads/customer.json', 'server/src/sessions/session.json',
    'server/src/.local-data/private.json', 'node_modules/secret.js', 'server/dist/cli.js', 'public/legacy/manifest.json',
    'public/legacy/assets/images/favicon_voltronix.png', 'resources/quotation-pdf/stamp.png']) f.put(name, 'PRIVATE_SYNTHETIC_CONTENT');
  const created = prepareBillsPackage(f.root, { knownCredentials: bytes => bytes.includes(Buffer.from('PRIVATE_SYNTHETIC_CONTENT')) ? ['synthetic-known-match'] : [] });
  const manifest = JSON.parse(readFileSync(join(f.root, created.output, 'bills-crm-source/FILE-MANIFEST.json'), 'utf8'));
  assert.equal(manifest.files.length, billsRequiredFiles.length + 1);
});

test('Bills source check refuses unknown credentials and stale fixture hashes before creating output', t => {
  const f = fixture(t), bytes = 'const password = "synthetic-unreviewed-value";\n';
  f.put('server/tests/synthetic.test.ts', bytes);
  const result = checkBillsSource(f.root);
  assert.equal(result.status, 'SOURCE_CHECK_REFUSED');
  assert.deepEqual(result.rejected, [{ path: 'server/tests/synthetic.test.ts', reasons: ['literal-password-candidate'] }]);
  assert.throws(() => f.package(), /content checks refused/);
  assert.ok(!JSON.stringify(result).includes('synthetic-unreviewed-value'));
});

test('Bills frozen source paths refuse an unreviewed ordinary-looking data file', t => {
  const f = fixture(t);
  f.put('server/src/customer-record.json', '{"name":"invented customer row"}\n');
  assert.throws(() => f.package(), /Unreviewed file/);
});

test('Bills package refuses missing build configuration and required UI/font assets', t => {
  for (const name of ['tsconfig.server.build.json', 'public/legacy/assets/css/plugins/fonts/tabler-icons.woff2']) {
    const f = fixture(t);
    unlinkSync(join(f.root, name));
    assert.throws(() => f.package());
  }
});

test('Bills package refuses source hard links and directory symlinks', t => {
  const f = fixture(t);
  linkSync(join(f.root, 'src/app/page.tsx'), join(f.root, 'owned-hard-link'));
  assert.throws(() => f.package(), /links/);
  const second = fixture(t);
  try { symlinkSync(join(second.root, 'src'), join(second.root, 'server/src/linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Symlink creation unavailable; hard-link refusal was tested.'); return; } throw error; }
  assert.throws(() => second.package(), /link/);
});

test('Bills package verification refuses modified output, source changes, extra files and empty directories', t => {
  const mutations = [
    (f, output) => f.put(`${output}/bills-crm-source/server/src/cli.ts`, '// Changed output\n'),
    f => f.put('server/src/cli.ts', '// Changed source\n'),
    (f, output) => f.put(`${output}/unexpected.txt`, 'extra'),
    (f, output) => mkdirSync(join(f.root, output, 'bills-crm-source/extra-empty')),
    (f, output) => unlinkSync(join(f.root, output, 'bills-crm-source/tsconfig.json')),
  ];
  for (const mutate of mutations) {
    const f = fixture(t), { output } = f.package();
    mutate(f, output);
    assert.throws(() => verifyBillsPackage(f.root, output));
  }
});

test('Bills archive verification rejects tampering even with a recomputed archive checksum', t => {
  const f = fixture(t), { output } = f.package();
  const bytes = Buffer.concat([readFileSync(join(f.root, output, 'bills-crm-source.zip')), Buffer.from('extra')]);
  f.put(`${output}/bills-crm-source.zip`, bytes);
  f.put(`${output}/bills-crm-source.zip.sha256`, `${digest(bytes)}  bills-crm-source.zip\n`);
  assert.throws(() => verifyBillsPackage(f.root, output), /archive contents differ/);
});

test('Bills verifier refuses forged manifests and output/source link replacement', t => {
  const f = fixture(t), { output } = f.package();
  const filename = `${output}/bills-crm-source/FILE-MANIFEST.json`;
  const manifest = JSON.parse(readFileSync(join(f.root, filename), 'utf8'));
  manifest.files = manifest.files.filter(item => item.path !== 'tsconfig.json');
  f.put(filename, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(() => verifyBillsPackage(f.root, output), /manifest differs/);
  const second = fixture(t), built = second.package();
  linkSync(join(second.root, built.output, 'bills-crm-source/README.md'), join(second.root, 'extra-hard-link'));
  assert.throws(() => verifyBillsPackage(second.root, built.output), /links/);
});

test('Bills verification target is confined to a newly generated release directory', t => {
  const f = fixture(t);
  for (const directory of ['.', '..', '../release/bills-source-x', 'release/runtime-x', 'release/bills-source-../x', 'G:/existing']) assert.throws(() => verifyBillsPackage(f.root, directory), /target refused/);
});
