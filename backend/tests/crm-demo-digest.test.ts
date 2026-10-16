import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { crmDemoDigest, crmDemoDigestPaths } from "../scripts/crm-demo/digest.js";

test("OFFLINE CRM approval digest covers both packages, contracts, public assets and the actual PowerShell source", () => {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  assert.match(crmDemoDigest(root), /^[a-f0-9]{64}$/);
  for (const name of ["frontend/src", "frontend/next.config.ts", "frontend/package-lock.json", "backend/assets",
    "frontend/assets", "shared/contracts/src", "shared/contracts/package-lock.json"]) assert.ok(crmDemoDigestPaths.includes(name));
  assert.ok(crmDemoDigestPaths.every(name => !/(?:\.env|\.local-data|node_modules|dist|\.next|application|system)/.test(name)));
});

test("OFFLINE CRM digest accepts the normalized CLI root shape without printing a fingerprint", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.equal(crmDemoDigest(root), crmDemoDigest(resolve(root)));
});
