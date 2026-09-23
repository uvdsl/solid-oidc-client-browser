/**
 * A SharedWorker that is created asynchronously so that its script can be
 * fetched and integrity-verified before it is spawned.
 */
export class SecureSharedWorker extends SharedWorker {

  private constructor(scriptURL: string | URL, options: WorkerOptions) {
    super(scriptURL, options);
  }

  static async create(scriptURL: string | URL, integrityHash: string, options: WorkerOptions): Promise<SecureSharedWorker> {
    const storageKey = this.getStorageKey(scriptURL);
    return navigator.locks.request(`solid-oidc:${storageKey}`, async () => {
      const existingUrl = localStorage.getItem(storageKey);

      if (existingUrl) {
        const existing = new SecureSharedWorker(existingUrl, options);
        try {
          return await this.ensureWorkerAlive(existing);
        } catch (e) {
          // this is OK; it just means the stored worker url does not represent a valid worker any more
          // we continue fetching the script and creating a new worker
        }
      }
      const blobUrl = await this.fetchWorkerScript(scriptURL, integrityHash);
      return new SecureSharedWorker(blobUrl, options);
    });
  }

  private static getStorageKey(scriptURL: string | URL) {
    return `secure-shared-worker:${scriptURL}`;
  }

  private static async fetchWorkerScript(scriptURL: string | URL, integrityHash: string) {
    const response = await fetch(scriptURL, {integrity: integrityHash});
    const blobUrl = URL.createObjectURL(new Blob([await response.text()], {type: 'text/javascript'}));
    localStorage.setItem(this.getStorageKey(scriptURL), blobUrl);
    return blobUrl;
  }

  /**
   * Wait for the worker to signal it is alive by receiving a message from it (usually this is the WORKER_ALIVE message
   * directly sent after the worker is started)
   *
   * If the worker signals any error, the promise is rejected.
   */
  private static async ensureWorkerAlive(worker: SecureSharedWorker): Promise<SecureSharedWorker> {
    return new Promise<SecureSharedWorker>((resolve, reject) => {
      worker.addEventListener('error', () => {
        reject(new Error('Existing SecureSharedWorker encountered an error'));
      }, {once: true});
      worker.port.start();
      worker.port.addEventListener('message', (e) => {
        resolve(worker)
      }, {once: true})
    })
  }
}
