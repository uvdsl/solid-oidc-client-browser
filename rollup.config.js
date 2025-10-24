import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';

const createConfig = (entry) => ({
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
  ],
  treeshake: true,
});

export default [
  createConfig('core'),
  createConfig('web'),
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
    ],
  },
];