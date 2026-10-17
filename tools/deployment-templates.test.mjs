import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('../deploy/ubuntu/', import.meta.url);
const read = name => readFileSync(new URL(name, directory), 'utf8');
const root = '/var/www/bills.voltronix_ae';

function service(name) {
  const source = read(name);
  assert.match(source, /MANUAL TEMPLATE ONLY/);
  const section = source.split('[Service]')[1]?.split('[Install]')[0];
  assert.ok(section);
  return { source, section };
}

test('STATIC Bills units isolate API configuration and preserve other application services', () => {
  const api = service('bills-crm-api.service'), web = service('bills-crm-web.service');
  assert.match(api.section, /^User=bills-crm-api$/m);
  assert.match(web.section, /^User=bills-crm-web$/m);
  assert.match(api.section, /^EnvironmentFile=\/etc\/bills-crm\/backend\.env$/m);
  assert.match(web.section, /^EnvironmentFile=\/etc\/bills-crm\/frontend\.env$/m);
  assert.ok(web.section.includes(`InaccessiblePaths=-${root}/bills-current/server/.local-data`));
  assert.ok(web.section.includes(`InaccessiblePaths=-${root}/bills-current/server/.env`));
  assert.match(web.section, /^InaccessiblePaths=-\/etc\/bills-crm\/backend\.env$/m);
  for (const item of [api, web]) {
    for (const line of ['Environment=NODE_ENV=production', 'ProtectSystem=strict', 'ProtectHome=true',
      'PrivateTmp=true', 'NoNewPrivileges=true', 'UMask=0077', 'Restart=on-failure', 'KillSignal=SIGTERM',
      'TimeoutStopSec=30', 'ProtectProc=invisible', 'CapabilityBoundingSet=', 'AmbientCapabilities=']) {
      assert.ok(item.section.split('\n').includes(line), line);
    }
    assert.doesNotMatch(item.section, /^User=root$|^Environment=.*(?:PASSWORD|TOKEN|SECRET)=/mi);
    assert.ok(item.section.includes(`ReadOnlyPaths=${root}/bills-current`));
    const dependencies = item.source.split('\n').filter(line => /^(?:After|Wants|Requires)=/.test(line));
    for (const line of dependencies) {
      for (const unit of line.slice(line.indexOf('=') + 1).split(' ')) {
        assert.ok(['network-online.target', 'bills-crm-api.service'].includes(unit), unit);
      }
    }
    assert.doesNotMatch(item.source, /\/srv\/voltronix|voltronix-crm|mysql\.service|crm\.voltronix\.ae/);
  }
  assert.doesNotMatch(api.section, /^ReadWritePaths=/m);
  assert.ok(web.section.includes(`ReadWritePaths=${root}/bills-current/.next/cache`));
});

test('STATIC startup uses the per-app Node runtime and strict Bills preflight without provisioning', () => {
  for (const mode of ['api', 'web']) {
    const item = service(`bills-crm-${mode}.service`);
    const commands = item.section.split('\n').filter(line => line.startsWith('Exec'));
    assert.deepEqual(commands, [
      `ExecStartPre=${root}/runtime/node/bin/node ${root}/bills-current/tools/run-bills.mjs check-${mode}`,
      `ExecStart=${root}/runtime/node/bin/node ${root}/bills-current/tools/run-bills.mjs ${mode}`,
    ]);
    assert.doesNotMatch(commands.join('\n'), /\/usr\/bin\/node|\b(?:php|mysql|mysqldump|bash|sh|seed|migrate|reset)\b/);
    assert.doesNotMatch(item.section, /3001|3002/);
  }
});

test('STATIC reviewed service environments keep persistence disabled and agree on Bills API identity', () => {
  const parse = name => Object.fromEntries(read(name).split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const split = line.indexOf('=');
    assert.ok(split > 0);
    return [line.slice(0, split), line.slice(split + 1)];
  }));
  const web = parse('bills-web.env.example'), api = parse('bills-api.env.example');
  for (const config of [web, api]) {
    assert.equal(config.NODE_ENV, 'production');
    assert.equal(config.CRM_DATABASE_MODE, 'disabled');
    assert.equal(config.CRM_MYSQL_NETWORK_DISABLED, '1');
    assert.equal(config.ZOHO_ENABLED, 'false');
    assert.equal(config.NEXT_TELEMETRY_DISABLED, '1');
    assert.equal(config.CRM_API_INSTANCE_ID, 'bills-crm');
    assert.equal(config.APP_ORIGIN, 'https://bills.voltronix.ae');
    assert.ok(Object.keys(config).every(key => !/PASSWORD|TOKEN|SECRET|RUNTIME_PROFILE|RUNTIME_ENABLE/.test(key)));
  }
  assert.equal(web.CRM_EXPRESS_ORIGIN, `http://${api.CRM_API_HOST}:${api.CRM_API_PORT}`);
  assert.equal(web.CRM_WEB_HOST, '127.0.0.1');
  assert.equal(web.CRM_WEB_PORT, '3301');
  assert.equal(api.CRM_API_PORT, '3302');
  assert.equal(web.CRM_API_ENVIRONMENT, undefined);
  assert.equal(api.CRM_EXPRESS_ORIGIN, undefined);
});

test('STATIC Bills Nginx routes only its exact host to the explicit private web example port', () => {
  const source = read('nginx.conf.example');
  assert.match(source, /MANUAL TEMPLATE ONLY/);
  assert.match(source, /server 127\.0\.0\.1:3301;/);
  assert.deepEqual([...source.matchAll(/^\s*proxy_pass\s+([^;]+);/gm)].map(match => match[1]), ['http://bills_crm_next']);
  assert.deepEqual([...source.matchAll(/^\s*server_name\s+([^;]+);/gm)].map(match => match[1]), ['bills.voltronix.ae', 'bills.voltronix.ae']);
  assert.match(source, /^\s*proxy_set_header Host bills\.voltronix\.ae;$/m);
  assert.doesNotMatch(source, /^\s*listen .*default_server|crm\.voltronix\.ae|127\.0\.0\.1:300[12]/m);
  for (const name of ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Real-IP']) {
    assert.ok(source.includes(`proxy_set_header ${name} "";`));
  }
  assert.doesNotMatch(source, /^\s*proxy_set_header (?:Origin|Cookie|Sec-Fetch-Site|X-CSRF-Token)\s/im);
  assert.match(source, /location \^~ \/api\/v1\/ \{ return 404; \}/);
  const sourceTreeRule = source.split('\n').find(line => line.includes('server|src|resources|tests|scripts|node_modules'));
  assert.ok(sourceTreeRule?.includes('backend|frontend'));
  assert.ok(sourceTreeRule.includes('{ return 404; }'));
  assert.match(source, /client_max_body_size 52m;/);
  for (const setting of ['proxy_request_buffering off;', 'proxy_buffering off;', 'proxy_cache off;', 'proxy_connect_timeout 3s;', 'proxy_read_timeout 35s;']) assert.ok(source.includes(setting));
  assert.doesNotMatch(source, /^\s*(?:fastcgi_pass|uwsgi_pass|alias|proxy_hide_header Content-Security-Policy)\b/m);
});

test('STATIC TLS and logs avoid request contents and leave HSTS for verified HTTPS acceptance', () => {
  const source = read('nginx.conf.example');
  assert.match(source, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(source, /ssl_certificate \/etc\/letsencrypt\/live\/bills\.voltronix\.ae\/fullchain\.pem;/);
  assert.match(source, /ssl_certificate_key \/etc\/letsencrypt\/live\/bills\.voltronix\.ae\/privkey\.pem;/);
  assert.doesNotMatch(source, /^\s*add_header Strict-Transport-Security/m);
  assert.match(source, /# add_header Strict-Transport-Security "max-age=31536000" always;/);
  assert.match(source, /frame-ancestors 'none'/);
  const logFormat = /log_format bills_crm_safe ([\s\S]*?);/.exec(source)?.[1];
  assert.ok(logFormat);
  assert.doesNotMatch(logFormat, /\$(?:request(?:\b|_(?!method\b|time\b))|args|query_string|uri|cookie|http_|remote_addr)/);
  assert.match(logFormat, /\$status/);
  assert.match(logFormat, /\$upstream_status/);
  assert.match(source, /error_log stderr crit;/);
  assert.match(source, /error records cannot use the redacted access format and can include a URI/);
});

test('STATIC operator guide keeps database activation blocked and rollback scoped to Bills', () => {
  const guide = readFileSync(new URL('../docs/manual-deployment-guide.md', import.meta.url), 'utf8');
  assert.match(guide, /None of these server commands was run/);
  assert.match(guide, /CRM_DATABASE_MODE=disabled CRM_MYSQL_NETWORK_DISABLED=1 ZOHO_ENABLED=false/);
  assert.match(guide, /sudo systemctl stop bills-crm-web\.service bills-crm-api\.service/);
  assert.match(guide, /sudo nginx -t/);
  assert.doesNotMatch(guide, /(?:npm run|node\s+\S+)\s+(?:mysql:migrate|db:migrate|sqlite:migrate|mysql:operator|zoho:setup)/);
  assert.doesNotMatch(guide, /systemctl\s+(?:stop|restart|disable)\s+(?:nginx|mysql|crm\b|voltronix-crm)/);
  assert.doesNotMatch(guide, /rm\s+-rf|git\s+(?:clean|reset\s+--hard)|sudo\s+(?:chown|chmod)\s+-R/);
});
