import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { isLocalPersistence } from "@voltronix/crm-contracts";

test("local persistence discriminator accepts only explicit demo and MySQL provenance", () => {
  assert.equal(isLocalPersistence("local-mysql"), true);
  assert.equal(isLocalPersistence("local-demo"), true);
  for (const value of [undefined, null, "mysql", "unavailable", "zoho", true]) assert.equal(isLocalPersistence(value), false);
});

test("OFFLINE MySQL and SQLite write controls retain explicit capabilities and no-sync notices", { timeout: 30_000 }, async () => {
  const origin = "http://127.0.0.1:39992";
  const bundle = await build({ stdin: {
    contents: "import {createRoot} from 'react-dom/client';import {DealForm} from './src/components/crm/deal-form';import {ProductCreate} from './src/components/crm/products';createRoot(document.getElementById('root')).render(<><DealForm/><ProductCreate/></>);",
    loader: "tsx", resolveDir: process.cwd(),
  }, bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-stubs", setup(api) {
    api.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("navigation")
      ? "export function useRouter(){return{refresh(){},push(){}}}"
      : "import React from'react';export default function Link(props){return React.createElement('a',props)}", loader: "js", resolveDir: process.cwd() }));
  } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["unavailable", "local-mysql", "local-demo", "revoked"] as const) {
      const page = await browser.newPage({ serviceWorkers: "block" }), failures: string[] = [];
      page.on("pageerror", error => failures.push(error.message));
      await page.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== "GET") { failures.push("Unexpected request"); return route.abort(); }
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<!DOCTYPE html><html><body><div id='root'></div><script src='/component.js'></script></body></html>" });
        if (url.pathname === "/component.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0]!.text });
        if (url.pathname === "/api/capabilities") return route.fulfill({ json: {
          persistence: mode === "revoked" ? "local-mysql" : mode, localWorkflow: true,
          productCreate: mode !== "revoked", dealCreate: mode !== "revoked", leadNotes: false, integrationAvailable: false,
        } });
        failures.push("Unexpected path"); return route.abort();
      });
      await page.goto(origin);
      await page.waitForFunction(() => !document.body.textContent?.includes("Loading available"));
      const enabled = mode === "local-mysql" || mode === "local-demo";
      assert.equal(await page.getByRole("button", { name: "Save Deal", exact: true }).isEnabled(), enabled);
      assert.equal(await page.getByRole("button", { name: "Save Item", exact: true }).isEnabled(), enabled);
      if (enabled) assert.match(await page.locator("body").innerText(), /not synchronized with Zoho/);
      assert.deepEqual(failures, []); await page.close();
    }
  } finally { await browser.close(); }
});
