const { createHash } = require('node:crypto');

const REFRESH_WORKER_INTEGRITY_PLACEHOLDER = 'sha384-__REFRESH_WORKER_INTEGRITY__';

/**
 * Creates the rollup plugin pair that pins the RefreshWorker bundle's
 * Subresource Integrity hash into the web bundle.
 *
 * The worker bundle must be built first: `computeWorkerIntegrity` hashes the
 * exact emitted bytes of RefreshWorker.js, `injectWorkerIntegrity` then
 * replaces the placeholder in the dedicated integrity module
 * (src/web/RefreshWorkerIntegrity.ts) with that hash while the web bundle
 * is compiled. The hash exists only in the build output.
 *
 */
function createWorkerIntegrityPlugins() {
  const state = { hash: null };

  const computeWorkerIntegrity = {
    name: 'compute-worker-integrity',
    generateBundle(_options, bundle) {
      const code = bundle['RefreshWorker.js'].code;
      state.hash = `sha384-${createHash('sha384').update(code).digest('base64')}`;
      console.log(`RefreshWorker integrity: ${state.hash}`);
    },
  };

  const injectWorkerIntegrity = {
    name: 'inject-worker-integrity',
    transform(code, id) {
      if (!id.endsWith('RefreshWorkerIntegrity.ts')) return null;
      if (state.hash === null) {
        throw new Error('RefreshWorker integrity missing - the RefreshWorker bundle must be built before the web bundle');
      }
      return { code: code.replaceAll(REFRESH_WORKER_INTEGRITY_PLACEHOLDER, state.hash), map: null };
    },
  };

  return { computeWorkerIntegrity, injectWorkerIntegrity };
}

exports.createWorkerIntegrityPlugins = createWorkerIntegrityPlugins;
exports.REFRESH_WORKER_INTEGRITY_PLACEHOLDER = REFRESH_WORKER_INTEGRITY_PLACEHOLDER;
