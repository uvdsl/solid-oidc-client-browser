import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import { createWorkerIntegrityPlugins } from './scripts/worker-integrity.js';

const { computeWorkerIntegrity, injectWorkerIntegrity } = createWorkerIntegrityPlugins();

const createConfig = (entry, extraPlugins = []) => ({
  input: `src/${entry}/index.ts`,
  output: [
    {
      file: `dist/esm/${entry}/index.js`,
      format: 'esm',
      sourcemap: true,
    },
    {
      file: `dist/esm/${entry}/index.min.js`,
      format: 'esm',
      sourcemap: true,
      plugins: [terser()],
    },
  ],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      useTsconfigDeclarationDir: true,
    }),
    resolve({ browser: true }),
    ...extraPlugins,
  ],
  treeshake: true,
});

export default [
  {
    input: 'src/web/RefreshWorker.ts',
    output: {
      file: 'dist/esm/web/RefreshWorker.js',
      format: 'esm',
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        // no need to generate declaration files for the worker
        tsconfigOverride: { compilerOptions: { declaration: false } }
      }),
      resolve({ browser: true }),
      computeWorkerIntegrity,
    ],
  },
  createConfig('core'),
  createConfig('web', [injectWorkerIntegrity]),
];
