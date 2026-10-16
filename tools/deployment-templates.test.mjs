import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('../deploy/ubuntu/', import.meta.url);
const read = name => readFileSync(new URL(name, directory), 'utf8');

function service(name) {
  const source = read(name);
  assert.match(source, /MANUAL TEMPLATE ONLY/);
  const section = source.split('[Service]')[1]?.split('[Install]')[0];
  assert.ok(section);
  return { source, section };
}

test('STATIC deployment units isolate backend credentials from the frontend service identity', () => {
  const api = service('voltronix-crm-api.service'), web = service('voltronix-crm-web.service');
  assert.match(api.section, /^User=voltronix-crm-api$/m);
  assert.match(web.section, /^User=voltronix-crm-web$/m);
  assert.match(api.section, /^EnvironmentFile=\/etc\/voltronix-crm\/backend\.env$/m);
  assert.match(web.section, /^EnvironmentFile=\/etc\/voltronix-crm\/frontend\.env$/m);
  assert.match(web.section, /^InaccessiblePaths=-\/srv\/voltronix-crm\/current\/backend\/\.local-data$/m);
  assert.match(web.section, /^InaccessiblePaths=-\/etc\/voltronix-crm\/backend\.env$/m);
  assert.match(api.section, /^InaccessiblePaths=.*mysql-crm-migration\.json$/m);
  for (const item of [api, web]) {
    for (const line of ['Environment=NODE_ENV=production', 'ProtectSystem=strict', 'ProtectHome=true',
      'PrivateTmp=true', 'NoNewPrivileges=true', 'UMask=0077', 'Restart=on-failure', 'KillSignal=SIGTERM',
      'TimeoutStopSec=30', 'ProtectProc=invisible', 'CapabilityBoundingSet=', 'AmbientCapabilities=']) {
      assert.ok(item.section.split('\n').includes(line), line);
    }
    assert.doesNotMatch(item.section, /^User=root$|^Environment=.*(?:PASSWORD|TOKEN|SECRET)=/mi);
    assert.match(item.section, /^ReadOnlyPaths=\/srv\/voltronix-crm\/current$/m);
  }
  assert.doesNotMatch(api.section, /^ReadWritePaths=/m);
  assert.match(web.section, /^ReadWritePaths=\/srv\/voltronix-crm\/current\/frontend\/\.next\/cache$/m);
});

test('STATIC service startup uses built Node packages without migration, shell provisioning or PHP', () => {
  const api = service('voltronix-crm-api.service'), web = service('voltronix-crm-web.service');
  assert.match(api.section, /^ExecStart=\/usr\/bin\/node \/srv\/voltronix-crm\/current\/backend\/dist\/cli\.js$/m);
  assert.match(web.section, /^ExecStart=\/usr\/bin\/node .*\/next start --hostname 127\.0\.0\.1 --port 3001$/m);
  for (const item of [api, web]) {
    const commands = item.section.split('\n').filter(line => line.startsWith('Exec'));
    assert.equal(commands.length, 2);
    assert.ok(commands[0].startsWith('ExecStartPre=/usr/bin/test -f '));
    assert.doesNotMatch(commands.join('\n'), /\b(?:php|mysql|mysqldump|bash|sh|seed|migrate|reset)\b/);
  }
});

test('STATIC Nginx sends public application traffic only to private Next with no fabricated proxy authority', () => {
  const source = read('nginx.conf.example');
  assert.match(source, /MANUAL TEMPLATE ONLY/);
  assert.match(source, /server 127\.0\.0\.1:3001;/);
  assert.deepEqual([...source.matchAll(/^\s*proxy_pass\s+([^;]+);/gm)].map(match => match[1]), ['http://voltronix_crm_next']);
  assert.match(source, /^\s*proxy_set_header Host crm\.example\.invalid;$/m);
  for (const name of ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Real-IP']) {
    assert.ok(source.includes(`proxy_set_header ${name} "";`));
  }
  assert.doesNotMatch(source, /^\s*proxy_set_header (?:Origin|Cookie|Sec-Fetch-Site|X-CSRF-Token)\s/im);
  assert.match(source, /location \^~ \/api\/v1\/ \{ return 404; \}/);
  assert.match(source, /client_max_body_size 52m;/);
  assert.match(source, /proxy_request_buffering off;/);
  assert.match(source, /proxy_buffering off;/);
  assert.match(source, /proxy_cache off;/);
  assert.doesNotMatch(source, /^\s*(?:fastcgi_pass|uwsgi_pass|proxy_hide_header Content-Security-Policy)\b/m);
});

test('STATIC Nginx TLS and access-log policy retains protected-download isolation and no request contents', () => {
  const source = read('nginx.conf.example');
  assert.match(source, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(source, /ssl_certificate \/etc\/letsencrypt\/live\/crm\.example\.invalid\/fullchain\.pem;/);
  assert.match(source, /ssl_certificate_key \/etc\/letsencrypt\/live\/crm\.example\.invalid\/privkey\.pem;/);
  assert.match(source, /add_header Strict-Transport-Security "max-age=31536000" always;/);
  assert.match(source, /frame-ancestors 'none'/);
  const logFormat = /log_format voltronix_crm_safe ([\s\S]*?);/.exec(source)?.[1];
  assert.ok(logFormat);
  assert.doesNotMatch(logFormat, /\$(?:request(?:\b|_(?!method\b|time\b))|args|query_string|uri|cookie|http_|remote_addr)/);
  assert.match(logFormat, /\$status/);
  assert.match(logFormat, /\$upstream_status/);
  assert.match(source, /error_log stderr crit;/);
  assert.match(source, /error records cannot use the redacted access format and can include a URI/);
});
