// SecureSharedWorker extends the global SharedWorker at module load,
// so the mock must be installed before the imports below are evaluated.
(global as any).SharedWorker = jest.fn().mockImplementation(() => {
  const port: any = { start: jest.fn(), addEventListener: jest.fn() };
  const worker: any = {
    port,
    addEventListener: jest.fn(),
    signalAlive: () => port.addEventListener.mock.calls[0]?.[1]?.({ data: { type: RefreshMessageTypes.WORKER_ALIVE } }),
    signalError: () => worker.addEventListener.mock.calls[0][1]({ type: 'error' }),
  };
  return worker;
});

const acquireLock = jest.fn((name: string, callback: () => Promise<any>) => callback());
(global.navigator as any).locks = { request: acquireLock };

import {SecureSharedWorker} from "../../src/web/SecureSharedWorker";
import {RefreshMessageTypes} from "../../src/web/RefreshMessageTypes";
import {randomUUID} from 'crypto';

const WORKER_SCRIPT = 'self.onmessage = () => {};';
URL.createObjectURL = jest.fn(() => `blob:https://app.test/${randomUUID()}`);

describe('SecuredSharedWorker', () => {

  beforeEach(() => {
    localStorage.clear();
    acquireLock.mockClear();
    (SharedWorker as jest.Mock).mockClear();
    (URL.createObjectURL as jest.Mock).mockClear();
    (fetch as jest.Mock).mockClear();
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(WORKER_SCRIPT),
    });
  });

  const mintedBlobUrl = () => (URL.createObjectURL as jest.Mock).mock.results[0].value as string;

  const latestFakeWorker = () => {
    const results = (SharedWorker as jest.Mock).mock.results;
    return results[results.length - 1].value;
  };

  it('fetches the worker script with integrity check', async () => {
    // when a SecureSharedWorker is created with a script URL and integrity hash
    await SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });

    // then the script is fetched using an integrity check
    expect(fetch).toHaveBeenCalledWith("https://cdn.example/worker.js", { integrity: "fake-hash-123" });
  });

  it('spawns a SharedWorker with a blob URL built from the fetched script', async () => {
    // when the SecureSharedWorker is created
    await SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });

    // then the fetched script is used to create a freshly minted blob URL
    const blobUrl = mintedBlobUrl();
    const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/javascript');
    expect(await new Response(blob).text()).toBe(WORKER_SCRIPT);

    // and the SharedWorker is created with that blob URL
    expect(SharedWorker).toHaveBeenCalledTimes(1);
    expect(SharedWorker).toHaveBeenCalledWith(blobUrl, { type: 'module' });
  });

  it('connects to an existing shared worker when it signals WORKER_ALIVE', async () => {
    // given a first tab fetched the script and spawned the worker from its blob URL
    await SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });
    const firstTabBlobUrl = mintedBlobUrl();
    expect(fetch).toHaveBeenCalledTimes(1);

    // when a second tab creates a SecureSharedWorker for the same script
    (SharedWorker as jest.Mock).mockClear();
    (fetch as jest.Mock).mockClear();
    (URL.createObjectURL as jest.Mock).mockClear();
    const workerPromise = SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });

    // and the worker signals that it is alive
    const connectedWorker = latestFakeWorker();
    connectedWorker.signalAlive();

    // then the existing worker is connected
    const worker = await workerPromise;
    expect(worker).toBe(connectedWorker);

    // and it was constructed from the SAME stored blob URL — no fetch, no new blob URL
    expect(fetch).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(SharedWorker).toHaveBeenCalledTimes(1);
    expect(SharedWorker).toHaveBeenCalledWith(firstTabBlobUrl, { type: 'module' });
  });

  it('mints a fresh blob URL when connecting to the stored worker fails', async () => {
    // given a first tab fetched the script and spawned the worker from its blob URL
    await SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });
    const deadBlobUrl = mintedBlobUrl();

    // and a new tab creates a SecureSharedWorker for the same script
    (SharedWorker as jest.Mock).mockClear();
    (fetch as jest.Mock).mockClear();
    (URL.createObjectURL as jest.Mock).mockClear();
    const workerPromise = SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });

    // but the first tab was closed before, so that the worker died
    const deadWorker = latestFakeWorker();
    expect(SharedWorker).toHaveBeenCalledTimes(1);
    expect(SharedWorker).toHaveBeenCalledWith(deadBlobUrl, { type: 'module' });
    deadWorker.signalError();

    // then the script is fetched again and a fresh blob URL is minted
    const worker = await workerPromise;
    expect(fetch).toHaveBeenCalledWith("https://cdn.example/worker.js", { integrity: "fake-hash-123" });
    expect(URL.createObjectURL).toHaveBeenCalled();
    const freshBlobUrl = mintedBlobUrl();
    expect(freshBlobUrl).not.toBe(deadBlobUrl);

    // and the fresh blob URL replaces the dead one in storage —
    // so the next tab re-uses it instead of recovering again
    expect(localStorage.getItem(`secure-shared-worker:https://cdn.example/worker.js`)).toBe(freshBlobUrl);

    // and create() hands back the newly connected worker
    expect(worker).not.toBe(deadWorker);
    expect(SharedWorker).toHaveBeenCalledWith(freshBlobUrl, { type: 'module' });
    expect(worker).toBe(latestFakeWorker());
  });

  it('rejects when the worker script cannot be fetched', async () => {
    // given no stored blob URL and a CDN that does not serve the script
    // (network failure or integrity mismatch both reject the fetch)
    (fetch as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'));

    // when a SecureSharedWorker is created
    // then it rejects — no blob is minted and no worker is constructed
    await expect(SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' }))
      .rejects.toThrow('Failed to fetch');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(SharedWorker).not.toHaveBeenCalled();
  });

  it('serializes concurrent creates through a single lock per script', async () => {
    // when two tabs create a SecureSharedWorker concurrently (e.g. session restore at browser start)
    const firstTab = SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });
    const secondTab = SecureSharedWorker.create("https://cdn.example/worker.js", "fake-hash-123", { type: 'module' });
    await Promise.all([firstTab, secondTab]);

    // then both worker creations ran inside the same lock
    // so that the platform serializes both,
    // and the second tab finds the stored blob URL instead of minting its own worker
    expect(acquireLock).toHaveBeenCalledTimes(2);
    const [firstName, secondName] = acquireLock.mock.calls.map(([name]) => name);
    expect(firstName).toBe('solid-oidc:secure-shared-worker:https://cdn.example/worker.js');
    expect(secondName).toBe(firstName);
  });

  it('does not re-use the blob URL if a different worker script is used', async () => {
    // given a first tab fetched the script and spawned the worker from its blob URL
    await SecureSharedWorker.create("https://cdn.example/worker1.js", "fake-hash-1", { type: 'module' });
    const firstTabBlobUrl = mintedBlobUrl();
    expect(fetch).toHaveBeenCalledTimes(1);

    // when a second tab creates a SecureSharedWorker for a different script
    (SharedWorker as jest.Mock).mockClear();
    (fetch as jest.Mock).mockClear();
    (URL.createObjectURL as jest.Mock).mockClear();
    await SecureSharedWorker.create("https://cdn.example/worker2.js", "fake-hash-2", { type: 'module' });

    // then it fetches the other script and connects a new worker to a new blob URL
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();
    const secondTabBlobUrl = mintedBlobUrl();
    expect(SharedWorker).toHaveBeenCalledWith(secondTabBlobUrl, { type: 'module' });
    expect(firstTabBlobUrl).not.toBe(secondTabBlobUrl);
  });
});
