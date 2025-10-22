import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';

/**
 * Factory function to create a Rollup configuration for an entry point.
 * @param {string} entry - The name of the entry point (e.g., 'web' or 'core').
 * @returns {object} A Rollup configuration object.
 */
const createConfig = (entry) => ({
  input: `src/${entry}/index.ts`,        // Entry TypeScript file
  output: [
    {
      file: `dist/esm/${entry}/index.js`,
      format: 'esm',                     // ESM format for browsers
      sourcemap: true,                   // Enable source maps for debugging
    },
    {
      file: `dist/esm/${entry}/index.min.js`,
      format: 'esm',                     // Minified ESM version
      sourcemap: true,                   // Enable source maps
      plugins: [terser()],               // Minify the output for smaller file size
    }
  ],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',       // Use tsconfig.json for compilation
      useTsconfigDeclarationDir: true,   // Ensure type declarations go to dist/types
    }),
    resolve({ 
        browser: true,                   // Specify to resolve modules for browser environment
      }),
  
  ],
  treeshake: true,                        // Enable tree-shaking
  external: [],                           // Do not mark dependencies as external (bundle them)
});

export default [
  createConfig('web'),
  createConfig('core'),
];