import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// Mirrors the previous .eslintrc.json ("extends": "next/core-web-vitals").
// TODO: also spread `eslint-config-next/typescript` once the existing
// no-explicit-any / ban-ts-comment violations in lib/ are fixed.
export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
