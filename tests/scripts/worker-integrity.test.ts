import {createWorkerIntegrityPlugins} from '../../scripts/worker-integrity';

describe('worker integrity plugins', () => {
  it('hashes the emitted RefreshWorker bundle bytes (SRI format)', () => {
    const {computeWorkerIntegrity, injectWorkerIntegrity} = createWorkerIntegrityPlugins();

    computeWorkerIntegrity.generateBundle({}, ({
      'RefreshWorker.js': {type: 'chunk', code: 'export const foo = "bar";\n'},
    }));

    const srcCode = `export const REFRESH_WORKER_INTEGRITY = 'sha384-__REFRESH_WORKER_INTEGRITY__';\n`;
    const result = injectWorkerIntegrity.transform(srcCode, '/path/to/RefreshWorkerIntegrity.ts');
    expect(result?.code).toBe(
      `export const REFRESH_WORKER_INTEGRITY = 'sha384-IIDM7Jl15qLtFn20HvdhVZDZk8D7f88Rl0tWVhkJpoAba6oNAH7TEAVOuDL0VKjb';\n`
    );
  });

  it('throws an error if hash has not been computed', () => {
    const {injectWorkerIntegrity} = createWorkerIntegrityPlugins();

    expect(() =>
      injectWorkerIntegrity.transform("irrelevant", '/project/src/web/RefreshWorkerIntegrity.ts')
    ).toThrow('RefreshWorker integrity missing - the RefreshWorker bundle must be built before the web bundle');
  });

  it('ignores scripts other than RefreshWorkerIntegrity.ts', () => {
    const {injectWorkerIntegrity} = createWorkerIntegrityPlugins();
    const result = injectWorkerIntegrity.transform("irrelevant", '/project/src/web/Other.ts');
    expect(result).toBeNull();
  });
});
