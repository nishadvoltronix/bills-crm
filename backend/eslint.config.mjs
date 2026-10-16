import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", ".local-data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.ts"], rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "no-restricted-imports": ["error", { patterns: [
      { group: ["next", "next/*", "server-only", "better-sqlite3", "sqlite3", "mariadb", "@/server/*", "**/nextjs/**", "**/frontend/**"], message: "Backend cannot import Next, SQLite, MariaDB or cross-package server sources." }
    ] }],
  } },
  // Explicit local demo reuses the frozen SQLite services. Production src,
  // scripts and package boundaries retain the original import restrictions.
  { files: ["demo-sqlite/**/*.ts"], rules: { "no-restricted-imports": "off" } },
);
