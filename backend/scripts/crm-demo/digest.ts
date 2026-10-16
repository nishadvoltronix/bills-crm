import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertOrdinaryPath } from "../mysql-auth/files.js";
import { CrmDemoRefusal } from "./guard.js";

export const crmDemoDigestPaths = Object.freeze([
  "backend/src", "backend/scripts", "backend/tests", "backend/assets", "backend/package.json", "backend/package-lock.json",
  "backend/tsconfig.json", "backend/tsconfig.build.json", "backend/eslint.config.mjs",
  "frontend/src", "frontend/scripts", "frontend/tests", "frontend/assets", "frontend/package.json", "frontend/package-lock.json",
  "frontend/next.config.ts", "frontend/tsconfig.json", "frontend/eslint.config.mjs",
  "shared/contracts/src", "shared/contracts/package.json", "shared/contracts/package-lock.json", "shared/contracts/tsconfig.json",
]);

/** Bind both packages/contracts/public PDF assets to an approval. Fixed roots
 * only: no .env/private/operator/SQL/database/build/package-cache discovery.
 * Fingerprint remains private; this function never writes or logs it. */
export function crmDemoDigest(packageRoot: string): string {
  try {
    const workspace = resolve(packageRoot, ".."), digest = createHash("sha256");
    let total = 0, files = 0;
    const visit = (path: string) => {
      assertOrdinaryPath(workspace, path);
      const name = relative(workspace, path).replaceAll("\\", "/"), stat = lstatSync(path);
      if (name.split("/").some(part => part.startsWith(".") || ["node_modules", "backups"].includes(part))) throw new Error();
      if (stat.isDirectory()) { for (const child of readdirSync(path).sort()) visit(join(path, child)); return; }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2_000_000 || ++files > 5_000
        || (total += stat.size) > 50_000_000 || !/\.(?:ts|tsx|mjs|js|json|css|md|txt|rst|ps1|svg|png|jpe?g|ttf|woff2?|ico)$/i.test(name)) throw new Error();
      digest.update(name + "\0").update(readFileSync(path)).update("\0");
    };
    for (const name of crmDemoDigestPaths) visit(join(workspace, name));
    return digest.digest("hex");
  } catch { throw new CrmDemoRefusal("OWNERSHIP"); }
}
