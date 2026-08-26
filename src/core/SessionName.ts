/**
 * Support for running more than one session on the same origin.
 *
 * A session name is a static, application-chosen constant (never user input)
 * that namespaces one session's browser storage from another's:
 * the sessionStorage keys of a pending login, and the IndexedDB database
 * (plus the SharedWorker, in the `/web` build) of an established session.
 *
 * Named sessions are namespaced for bookkeeping, NOT isolated from each
 * other: every script running on the origin remains fully trusted, exactly
 * as with a single session.
 */
export const SESSION_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Normalizes a session name.
 * `undefined` and `''` both mean the default, unnamed session,
 * so that an accidentally empty name cannot fork the storage namespace.
 *
 * @param name the session name to normalize
 * @returns the name, or `undefined` for the default session
 * @throws TypeError when the name does not match {@link SESSION_NAME_PATTERN}
 */
export const normalizeSessionName = (name?: string): string | undefined => {
  if (name === undefined || name === "") return undefined;
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new TypeError(
      `Invalid session name '${name}' - expected a static application constant matching ${SESSION_NAME_PATTERN}`
    );
  }
  return name;
};

/**
 * The sessionStorage key for a given session name,
 * e.g. `csrf_token` (default session) or `left:csrf_token` (session `left`).
 * The suffix set is fixed, so prefixed keys of one session
 * can never collide with those of another.
 */
export const storageKey = (name: string | undefined, key: string): string =>
  name ? `${name}:${key}` : key;

/**
 * The IndexedDB database name for a given session name,
 * e.g. `soidc` (default session) or `soidc:left` (session `left`).
 * One database per session: `logout()` clears a whole database,
 * and must only ever clear its own session.
 */
export const databaseName = (name?: string): string =>
  name ? `soidc:${name}` : "soidc";
