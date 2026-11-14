// ESLint (flat config) for the Node collector port — T-4 (LST-283).
// typescript-eslint recommended only: the runtime keeps zero dependencies
// (same discipline as the Python package, whose only hard dep is PyYAML).
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "parity/dist/**", "parity/out/**"] },
  {
    files: ["**/*.ts", "**/*.mts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // A genuinely unused binding is exactly the class of bug that shipped in
      // web/js once already (see the root eslint.config.js header); keep it loud.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
