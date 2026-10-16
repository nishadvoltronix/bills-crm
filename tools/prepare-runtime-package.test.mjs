import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { inspectRuntimeBytes, prepareRuntimePackage, safeRuntimePath, verifyRuntimePackage } from './prepare-runtime-package.mjs';

test('runtime boundary accepts only selected source/config and refuses private, generated, legacy or traversal paths', () => {
  for (const name of ['backend/src/cli.ts', 'frontend/src/app/page.tsx', 'shared/contracts/src/index.ts',
    'backend/.env.example', 'deploy/ubuntu/crm-api.service']) assert.equal(safeRuntimePath(name), true);
  for (const name of ['../backend/src/cli.ts', '/backend/src/cli.ts', 'backend\\src\\cli.ts', 'C:/file.ts',
    'backend/.env', 'frontend/.env.local', 'backend/src/.env.example', 'backend/src/uploads/file.ts',
    'backend/src/private.php', 'backend/src/a.sqlite', 'backend/src/a.key', 'backend/tests/a.ts',
    'frontend/public/legacy/image.png', 'backend/assets/quotation-pdf/stamp.jpg', 'backend/dist/cli.js',
    '.git/config', 'backend/src/../file.ts', 'backend/src/bad./a.ts', 'backend/src/a.zip']) assert.equal(safeRuntimePath(name), false, name);
});
test('runtime content checks reject renamed binary, credentials and malformed JSON without leaking values', () => {
  for (const bytes of [Buffer.from('SQLite format 3\0private'), Buffer.from('%PDF-1.7'), Buffer.from('export const password = "synthetic-private-password";')]) {
    assert.throws(() => inspectRuntimeBytes('backend/src/file.ts', bytes), error => !error.message.includes('synthetic-private-password'));
  }
  assert.throws(() => inspectRuntimeBytes('backend/src/file.json', Buffer.from('{broken')));
  assert.throws(() => inspectRuntimeBytes('backend/src/file.ts', Buffer.from('arbitrary known match'), () => ['known-secret']));
  assert.doesNotThrow(() => inspectRuntimeBytes('backend/src/file.ts', Buffer.from('export const value = 1;')));
});
test('runtime environment examples require exact reviewed local placeholders and never arbitrary credentials', () => {
  const example = 'CRM_FRONTEND_BACKEND=express\nCRM_EXPRESS_ORIGIN=http://127.0.0.1:3002\nAPP_ORIGIN=http://127.0.0.1:3001\n';
  assert.doesNotThrow(() => inspectRuntimeBytes('frontend/.env.example', Buffer.from(example)));
  assert.throws(() => inspectRuntimeBytes('frontend/.env.example', Buffer.from(example + 'MYSQL_PASSWORD=secret\n')));
});

const backendExample = 'CRM_API_ENVIRONMENT=development\nCRM_API_HOST=127.0.0.1\nCRM_API_PORT=3002\nAPP_ORIGIN=http://127.0.0.1:3001\nCRM_RUNTIME_ENABLE=\nCRM_RUNTIME_PROFILE=\nCRM_MYSQL_NETWORK_DISABLED=1\n';
const frontendExample = 'CRM_FRONTEND_BACKEND=express\nCRM_EXPRESS_ORIGIN=http://127.0.0.1:3002\nAPP_ORIGIN=http://127.0.0.1:3001\n';
const packageFixture = JSON.stringify({ name: 'synthetic-runtime-package', private: true, scripts: {
  'contracts:build': 'node fixture-contracts.js', build: 'node fixture-build.js', start: 'node fixture-start.js',
  'mysql:operator': 'node fixture-operator.js', test: 'node fixture-test.js', 'demo:sqlite:start': 'node fixture-demo.js',
}, dependencies: {} }, null, 2) + '\n';
const fixtureFiles = {
  'backend/package.json': packageFixture,
  'backend/package-lock.json': '{}\n',
  'backend/tsconfig.json': '{}\n',
  'backend/tsconfig.build.json': '{}\n',
  'backend/.env.example': backendExample,
  'frontend/package.json': packageFixture,
  'frontend/package-lock.json': '{}\n',
  'frontend/tsconfig.json': '{}\n',
  'frontend/next.config.ts': 'export default {};\n',
  'frontend/.env.example': frontendExample,
  'shared/contracts/package.json': '{"name":"synthetic-contracts","private":true}\n',
  'shared/contracts/package-lock.json': '{}\n',
  'shared/contracts/tsconfig.json': '{}\n',
  'docs/manual-deployment-guide.md': '# Synthetic manual guide\n',
  'docs/final-release-checklist.md': '# Synthetic checklist\n',
  'docs/mysql-production-operator-guide.md': '# Synthetic operator guide\n',
  'docs/runtime-excluded-assets.md': '# Synthetic asset exclusions\n',
  'docs/staging-acceptance.md': '# Synthetic acceptance\n',
  'docs/backend-production-environment.md': '# Synthetic production configuration\n',
  'backend/src/cli.ts': 'export const syntheticValue = 1;\n',
  'frontend/src/app/page.tsx': 'export default function Page() { return null; }\n',
  'shared/contracts/src/index.ts': 'export type SyntheticContract = { id: string };\n',
  'deploy/ubuntu/fixture.service': '[Service]\nType=simple\n',
};
const known = () => [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function inside(root, name) {
  const filename = resolve(root, name), remainder = relative(root, filename);
  assert.ok(remainder && !isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith('..' + sep));
  return filename;
}

/** These are new synthetic files only. No workspace, Git, actual environment,
 * baseline or credential file is read, copied, mutated or removed. */
function withFixture(run) {
  const temporaryRoot = realpathSync(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, 'crm-runtime-package-test-'));
  try {
    for (const [name, content] of Object.entries(fixtureFiles)) {
      const filename = inside(root, name);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, content, { flag: 'wx' });
    }
    return run(root);
  } finally {
    // Resolve the exact owned target before recursive cleanup, including Windows.
    assert.equal(dirname(resolve(root)), temporaryRoot);
    assert.match(basename(root), /^crm-runtime-package-test-[a-z0-9]+$/i);
    assert.equal(lstatSync(root).isSymbolicLink(), false);
    assert.equal(realpathSync(root), root);
    rmSync(root, { recursive: true, force: true });
  }
}

test('synthetic runtime package create/verify includes the exact manifest and preserves every source byte', () => withFixture(root => {
  const original = Object.fromEntries(Object.keys(fixtureFiles).map(name => [name, digest(readFileSync(inside(root, name)))]));
  const created = prepareRuntimePackage(root, known);
  assert.equal(created.status, 'SOURCE_RUNTIME_CANDIDATE_NOT_PRODUCTION_ACCEPTED');
  assert.equal(created.files, Object.keys(fixtureFiles).length);
  assert.match(created.output, /^release\/runtime-[a-f0-9-]{36}$/);
  const output = inside(root, created.output), manifest = JSON.parse(readFileSync(inside(output, 'runtime-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.map(item => item.path), Object.keys(fixtureFiles).sort());
  assert.deepEqual(verifyRuntimePackage(root, created.output, known), {
    status: 'VERIFIED_RUNTIME_SOURCE_CONTENTS', files: created.files, secretValuesDisclosed: false, productionAccepted: false,
  });
  const transformed = manifest.files.filter(item => item.transformed).map(item => item.path);
  assert.deepEqual(transformed, ['backend/package.json', 'frontend/package.json']);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(inside(output, 'backend/package.json'), 'utf8')).scripts),
    ['contracts:build', 'build', 'start', 'mysql:operator']);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(inside(output, 'frontend/package.json'), 'utf8')).scripts),
    ['contracts:build', 'build', 'start']);
  for (const [name, hash] of Object.entries(original)) assert.equal(digest(readFileSync(inside(root, name))), hash);
}));

test('runtime verification rejects changed output bytes despite an otherwise valid source and manifest', () => withFixture(root => {
  const created = prepareRuntimePackage(root, known), output = inside(root, created.output);
  writeFileSync(inside(output, 'backend/src/cli.ts'), 'export const syntheticValue = 2;\n');
  assert.throws(() => verifyRuntimePackage(root, created.output, known), /Runtime manifest mismatch/);
}));

test('runtime verification rejects deleting a required output file together with its manifest entry', () => withFixture(root => {
  const created = prepareRuntimePackage(root, known), output = inside(root, created.output);
  const filename = inside(output, 'runtime-manifest.json'), manifest = JSON.parse(readFileSync(filename, 'utf8'));
  const selected = inside(output, 'backend/src/cli.ts');
  assert.equal(lstatSync(selected).isFile(), true);
  unlinkSync(selected);
  manifest.files = manifest.files.filter(item => item.path !== 'backend/src/cli.ts');
  writeFileSync(filename, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(() => verifyRuntimePackage(root, created.output, known), /Runtime manifest refused/);
}));

test('runtime verification rejects an added unlisted secret-like fixture without exposing its contents', () => withFixture(root => {
  const created = prepareRuntimePackage(root, known), output = inside(root, created.output);
  writeFileSync(inside(output, 'backend/src/accidental-secrets.json'), '{"password":"synthetic-private-value-not-a-credential"}\n', { flag: 'wx' });
  assert.throws(() => verifyRuntimePackage(root, created.output, known), error =>
    error.message === 'Runtime extra file.' && !error.message.includes('synthetic-private-value'));
}));

test('runtime verification rejects an added empty directory, including a private-named directory', () => {
  for (const name of ['unreviewed-directory', '.private']) withFixture(root => {
    const created = prepareRuntimePackage(root, known), output = inside(root, created.output);
    mkdirSync(inside(output, name));
    assert.throws(() => verifyRuntimePackage(root, created.output, known), /Runtime extra directory/);
  });
});

test('runtime creation and verification reject directory links rather than following them into another tree', () => {
  for (const phase of ['create', 'verify']) withFixture(root => {
    // Both the target and link are inside this uniquely owned temporary tree.
    // Windows junctions require no symbolic-link privilege; Node reports them
    // as symbolic links and cleanup never targets any external directory.
    const target = inside(root, 'synthetic-link-target');
    mkdirSync(target); writeFileSync(join(target, 'fixture.ts'), 'export const synthetic = true;\n', { flag: 'wx' });
    const created = phase === 'verify' ? prepareRuntimePackage(root, known) : undefined;
    const destinationRoot = created ? inside(root, created.output) : root;
    const destination = inside(destinationRoot, 'backend/src/linked');
    symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(lstatSync(destination).isSymbolicLink(), true);
    if (created) assert.throws(() => verifyRuntimePackage(root, created.output, known), /Runtime extra link/);
    else assert.throws(() => prepareRuntimePackage(root, known), /Runtime source link refused/);
    assert.equal(readFileSync(join(target, 'fixture.ts'), 'utf8'), 'export const synthetic = true;\n');
  });
});

test('runtime verification rejects a changed original after capture rather than treating stale package evidence as current', () => withFixture(root => {
  const created = prepareRuntimePackage(root, known);
  writeFileSync(inside(root, 'backend/src/cli.ts'), 'export const syntheticValue = 2;\n');
  assert.throws(() => verifyRuntimePackage(root, created.output, known), /Runtime source changed after capture/);
}));
