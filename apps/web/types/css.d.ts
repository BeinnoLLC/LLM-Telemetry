/** Plain-CSS side-effect imports (app/globals.css) — ambient declaration.
 *
 * `tsc` 6.x (resolved from the workspace root node_modules) reports TS2882 on
 * `import "./globals.css"` because nothing declares the `*.css` module family
 * for side-effect imports; `next`'s own typings cover CSS *modules* only.
 * LLMTELEMET-285: added after apps/web typecheck failed on the migration
 * branch with "Cannot find module or type declarations for side-effect import
 * of './globals.css'" while the same sources passed under tsc 5.9.3.
 */
declare module "*.css";
