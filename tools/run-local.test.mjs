import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { localEnvironment, localPorts, projectRoot, serverCommand } from './run-local.mjs';

test('root local launcher chooses distinct loopback defaults and validates explicit ports', () => {
  assert.deepEqual(localPorts([]), { web: 3001, api: 3002 });
  assert.deepEqual(localPorts(['--web-port=3101', '--api-port=3102']), { web: 3101, api: 3102 });
  for (const args of [['--api-port=3001'], ['--web-port=80'], ['--api-port=65536'], ['--api-port=3002', '--api-port=3003'], ['--host=0.0.0.0']]) assert.throws(() => localPorts(args));
});

test('local child environment removes inherited database, integrations and public secret candidates', () => {
  const result = localEnvironment({ PATH: 'retained', CRM_RUNTIME_ENABLE: '1', CRM_MYSQL_PASSWORD: 'synthetic', ZOHO_REFRESH_TOKEN: 'synthetic', NEXT_PUBLIC_TEST: 'synthetic', NODE_OPTIONS: '--inspect', APP_ORIGIN: 'https://invalid.example' }, localPorts([]), true);
  assert.equal(result.PATH, 'retained'); assert.equal(result.NODE_ENV, 'production');
  assert.equal(result.CRM_FRONTEND_BACKEND, 'express'); assert.equal(result.CRM_EXPRESS_ORIGIN, 'http://127.0.0.1:3002');
  assert.equal(result.APP_ORIGIN, 'http://127.0.0.1:3001'); assert.equal(result.CRM_MYSQL_NETWORK_DISABLED, '1');
  assert.equal(result.ZOHO_ENABLED, 'false');
  for (const key of ['CRM_RUNTIME_ENABLE', 'CRM_MYSQL_PASSWORD', 'ZOHO_REFRESH_TOKEN', 'NEXT_PUBLIC_TEST', 'NODE_OPTIONS']) assert.equal(result[key], undefined);
});

test('server suites retain isolated cwd without requiring a server package or shell', () => {
  for (const name of ['test:server', 'test:demo', 'test:mysql-auth:offline']) {
    const command = serverCommand(name, []);
    assert.match(command.cwd, /[\\/]server$/); assert.equal(command.args[0], '--import');
    assert.ok(command.args.includes('--test')); assert.throws(() => serverCommand(name, ['unexpected']));
  }
});

test('explicit operational wrappers reject traversal and separate source/built entrypoints', () => {
  assert.ok(serverCommand('server:script', ['scripts/zoho-setup.ts', '--check']).args.includes('--check'));
  for (const path of ['../backend/scripts/zoho-setup.ts', '/scripts/zoho-setup.ts', 'scripts/../src/cli.ts', 'scripts/unknown.ts']) assert.throws(() => serverCommand('server:script', [path]));
  assert.throws(() => serverCommand('server:built', ['scripts/zoho-setup.ts']));
  assert.throws(() => serverCommand('server:script', ['dist/cli.js']));
});

test('credential-free Express foundation serves live health but never claims database readiness', { timeout: 20_000 }, async () => {
  const reserve = createServer();
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const web = port === 3001 ? 3003 : 3001;
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./run-local.mjs', import.meta.url)),
    'api:foundation-dev', `--api-port=${port}`, `--web-port=${web}`],
  { cwd: projectRoot, env: localEnvironment(process.env, { web, api: port }), windowsHide: true, stdio: 'pipe' });
  const closed = new Promise(resolve => child.once('close', resolve));
  let started = false;
  child.stdout.on('data', bytes => { if (bytes.toString().includes('Express listening at')) started = true; });
  child.stderr.resume();
  try {
    for (let count = 0; count < 100 && !started && child.exitCode === null; count++) await delay(100);
    assert.ok(started, 'Real Express foundation starts without a database profile');
    const live = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`);
    assert.equal(live.status, 200); assert.deepEqual(await live.json(), { status: 'running' });
    const ready = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`);
    assert.equal(ready.status, 503); assert.deepEqual(await ready.json(), { status: 'unavailable' });
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await closed;
  }
});
