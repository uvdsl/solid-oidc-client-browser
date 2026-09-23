# Changelog

All notable changes to this project will be documented in this file.

If you have any questions, see the issues and discussions (e.g. [#18](https://github.com/uvdsl/solid-oidc-client-browser/issues/18))

## Unreleased

### ✨ Features (Added)

- **Secure Refresh Worker**: The refresh worker is fetched with a Subresource Integrity (SRI) hash that is computed at build time.

## [0.2.3] - 2026-06-18

### 🐛 Fixed

- **Context loss in `authFetch`**: Permanently bound the `authFetch` method to the session instance in the constructor. This allows developers to pass `session.authFetch` directly as a custom fetch callback to third-party libraries (such as `rdf-dereference.js`) without losing the `this` context and triggering `undefined` errors. (Fixes [#26](https://github.com/uvdsl/solid-oidc-client-browser/issues/26))

## [0.2.2] - 2025-12-16

### ✨ Features (Added)

- **Exposed the `SessionIDB`**, an IndexedDB-based implementation of the `SessionDatabase` interface, such that it can be used out-of-the-box in a `SessionCore`, the Session implementation of the `core` library version.

### 🐛 Fixed

- **Removed requirement for `id_token_signed_response_alg: ES256`** in dynamic client registration, which resulted in being unable to authenticate with servers that do not support that algorithm, e.g. NSS (related to [#14](https://github.com/uvdsl/solid-oidc-client-browser/issues/14)).

## [0.2.1] - 2025-11-05

### ✨ Features (Added)

- **Event-Driven Session Management**: The Session class now extends the standard EventTarget, allowing for modern, flexible event handling (e.g., addEventListener).

- Introduces three new session lifecycle events via the SessionEvents enum:

  - **STATE_CHANGE**: Fires on login, logout, or token refresh. Event detail includes `{ isActive: boolean, webId?: string }`.

  - **EXPIRATION_WARNING**: Fires when automatic token refresh fails, but the session is not yet expired. Event detail includes `{ expires_in: number }`.

  - **EXPIRATION**: Fires when the session has definitively expired.

### ♻️ Changed

- For backward compatibility, the original `onSessionStateChange`, `onSessionExpirationWarning`, and `onSessionExpiration` callbacks in SessionOptions are now powered by the new EventTarget system.

(Changes based on Pull Request [#20](https://github.com/uvdsl/solid-oidc-client-browser/issues/20), addresses [#19](https://github.com/uvdsl/solid-oidc-client-browser/issues/19))

### 🐛 Fixed

- **Side-effect-free imports**: Server-side rendering does not longer trigger execution of web worker code. (Fixes [#21](https://github.com/uvdsl/solid-oidc-client-browser/issues/21)).

## [0.2.0] - 2025-10-29

### ♻️ Changed (Core Refactor)

- Major internal refactor to decouple core session logic from browser-specific implementations (like IndexedDB).

- The default Session (for web) now uses a SharedWorker to manage token refreshing in the background.

- Session state changes (login, logout, token updates) are now automatically synchronized across all open browser tabs.

### 🐛 Fixed

- **Reliable Token Refresh**: The new SharedWorker architecture ensures that tokens are reliably refreshed even when tabs are inactive or hibernating, resolving issues where sessions would become stale. (Fixes [#13](https://github.com/uvdsl/solid-oidc-client-browser/issues/13))

### ✨ Features (Added)

- A new core entry point (`@uvdsl/solid-oidc-client-browser/core`) is now available for advanced use cases requiring custom session storage or refresh lifecycle management (e.g., in browser extensions).

### ⚠️ Important Notes

- **Framework Reactivity**: While this version introduces no breaking API changes, the move to a SharedWorker for token refreshing (to fix cross-tab and hibernation issues) may affect reactivity in frameworks like Vue or React. Because the worker runs in a separate thread, changes to the session object (like token refreshes) may not be automatically detected by your framework's reactivity system. To fix this, please use the `onSessionStateChange` callback in SessionOptions to manually update your application's state. See the Vue Usage Example for a recommended pattern. Please also note that a corresponding issue has already been raised ([#19](https://github.com/uvdsl/solid-oidc-client-browser/issues/19)).

- **CDN support**: Loading a web worker via CDN is not allowed. Currently, the best option for CDN is to keep using version `0.1.3`.

(Changes based on Pull Request [#17](https://github.com/uvdsl/solid-oidc-client-browser/issues/17))

## [0.1.3] - 2025-10-20

### 🐛 Fixed

- **DPoP ath Mismatch**: Fixed a critical bug where the access token hash (ath) was not being recalculated after a token refresh. This caused all subsequent authenticated requests to fail with a 401 Unauthorized error. (Fixes [#16](https://github.com/uvdsl/solid-oidc-client-browser/issues/16))

## [0.1.2] - 2025-09-23

### 🐛 Fixed

- Relaxes validation for Identity Provider (IdP) URL input to better handle variations. (Fixes [#15](https://github.com/uvdsl/solid-oidc-client-browser/issues/15), also related to [#10](https://github.com/uvdsl/solid-oidc-client-browser/issues/10))

## [0.1.1] - 2025-08-01

### 🐛 Fixed

- Resolves an issue related to session restoration logic. (Fixes [#11](https://github.com/uvdsl/solid-oidc-client-browser/issues/11))

## [0.1.0] - 2025-05-19

### ♻️ Changed

- **Separation of Concerns**: Extracted session restoration logic from `handleRedirectFromLogin` into its own `session.restore()` method. This makes the login flow clearer and gives developers explicit control over when to restore a session.

- Refactored ClientDetails and internal file naming for clarity.

### ✨ Features (Added)

- Adds the `ath` (Access Token Hash) claim to DPoP tokens, enhancing security.

## [0.0.11] - 2025-05-15

### ✨ Features (Added)

- Introduced initial token refresh capabilities and session deactivation logic.

## [0.0.10] - 2025-05-06

### ✨ Features (Added)

- Enhanced client information handling.

- Added support for client details during dynamic registration.

- Added support for using a dereferenceable `client_id` (Client ID URL) as an alternative to dynamic registration.

## [0.0.9] - 2025-05-05

### ♻️ Changed

- Uses IndexedDB to store the non-extractable DPoP KeyPair, which is now correctly remembered for use in the RefreshTokenGrant.

- Sets `token_endpoint_auth_method` to `none` for public clients during RefreshTokenGrant, as required by the spec. (Addresses [#6](https://github.com/uvdsl/solid-oidc-client-browser/issues/6) via Pull Request [#9](https://github.com/uvdsl/solid-oidc-client-browser/issues/9))

## [0.0.8] - 2025-05-02

### 🐛 Fixed

- **Token Rotation**: Ensured that the new `refresh_token` is correctly saved after a successful token refresh. (Pull Request [#5](https://github.com/uvdsl/solid-oidc-client-browser/issues/5))

- **Hotfix**: Corrects the handling of the Identity Provider (IdP) URL during OIDC configuration discovery and `iss` (issuer) validation. (Fixes [#8](https://github.com/uvdsl/solid-oidc-client-browser/issues/8))

## [0.0.7] - 2025-04-22

### ♻️ Changed

- Removed superfluous n3 dependency.

- Removed axios dependency (see 0.0.6).

## [0.0.6] - 2025-04-22

### ♻️ Changed

- Replaced axios dependency with the browser's native `window.fetch`, reducing bundle size.

## [0.0.5] - 2025-04-22

### ✨ Features (Added)

- Added validation for `id_token` and `access_token` claims (e.g., `iss`, `aud`, DPoP `jkt`). (Fixes [#2](https://github.com/uvdsl/solid-oidc-client-browser/issues/2))

### 🐛 Fixed

- Fixed incorrect error logging for the state check (CSRF protection) during the authorization code flow. (Fixes [#1](https://github.com/uvdsl/solid-oidc-client-browser/issues/1))

## [0.0.4] - 2025-04-18

### ♻️ Changed

- Updated publishing setup to use Rollup for bundling and tree-shaking.

- Removed CJS (CommonJS) output in favor of ESM (ES Modules).

## [0.0.1] - 2025-01-24

- Initial commit and first functional release.