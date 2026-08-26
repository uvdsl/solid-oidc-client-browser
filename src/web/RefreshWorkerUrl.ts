// extracting this from Session.ts such that the jest tests would compile :)

// Bump when the worker's storage derivation or message protocol changes.
// The version query busts stale HTTP caches for NAMED sessions: a named
// session must never run pre-namespacing worker bytes, which would bind it
// to the default database. The unnamed session keeps the unversioned URL,
// byte-identical to previous releases.
export const WORKER_COMPAT_VERSION = 1;

export const getWorkerUrl = (sessionName?: string) =>
    sessionName
        ? new URL(`./RefreshWorker.js?v=${WORKER_COMPAT_VERSION}`, import.meta.url)
        : new URL('./RefreshWorker.js', import.meta.url);
