import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Explicit file set so `eslint .` lints the TypeScript sources (ESLint 9
  // flat config only lints files matched by some config's `files`).
  { files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
      "test-results/**",
      "playwright-report/**",
    ],
  },
];

export default eslintConfig;
