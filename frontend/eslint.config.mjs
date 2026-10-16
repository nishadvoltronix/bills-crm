import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ts.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "@next/next": next, "react-hooks": hooks },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      ...hooks.configs.recommended.rules,
    },
  },
  globalIgnores([".next/**", "out/**", "next-env.d.ts", ".private/**", ".local-data/**"]),
]);
