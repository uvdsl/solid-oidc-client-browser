![NPM Version](https://img.shields.io/npm/v/%40uvdsl%2Fsolid-oidc-client-browser)

# Solid OIDC Client Browser

This library implements a very simple version of the Solid OIDC protocol:

- [x] AuthorizationCodeGrant
- [x] with PKCE (RFC 7636)
- [x] with `iss` check (RFC 9207)
- [x] with provided `client_id` (dereferencable to client profile document)
- [x] with dynamic client registration 
- [x] RefreshTokenGrant to renew tokens and to restore a session

Good to know (see also the [security considerations](#security-considerations)):
- [x] Uses [sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) in the AuthorizationCodeGrant to temporarily store session information like `idp`, `client_id`, `pkce_code_verifier`, and `csrf_token`. The storage is origin-bound and tab-bound. 
- [x] Uses the [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) to store session information like `idp`, `client_id`, `refesh_token`, and the (non-extractable) DPoP KeyPair which was used in the AuthorizationCodeGrant. These are later re-used in the RefreshTokenGrant to renew the tokens or to restore a session.

## Installation
You can use this library in your project. Let me know how you get on with it! :rocket:

#### as `npm` package
```sh
npm install @uvdsl/solid-oidc-client-browser
```

#### via a CDN provider
For the minified version...
```html
<script type="module" src="https://unpkg.com/@uvdsl/solid-oidc-client-browser@0.0.11/dist/esm/index.min.js"></script>
```

And the regular version...
```html
<script type="module" src="https://unpkg.com/@uvdsl/solid-oidc-client-browser@0.0.11/dist/esm/index.js"></script>
```
Do not forget to adjust the version to the one you want! The latest version is displayed at the top of the README in the `npm` badge.

## Example usage

You can use this library along the lines of these examples:

#### in a simple HTML page with JavaScript

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Solid Login Page</title>
    <script type="module" src="https://unpkg.com/@uvdsl/solid-oidc-client-browser@0.0.11/dist/esm/index.min.js"></script>
</head>

<body>
    <div class="container">
        <h1>Solid Login Demo</h1>
        <p>Click the button below to log in with your Solid identity provider (solidcommunity.net)</p>
        <p id="welcome-message">Welcome to the application</p>
        <div id="user-info" class="user-info">
            <p>WebID: <span id="webid">not logged in.</span></p>
        </div>
        <button id="loginButton">Login with Solid</button>
        <button id="logoutButton">Logout</button>
    </div>

    <script>
        // Initialize the session
        let session;

        document.addEventListener('DOMContentLoaded', async () => {
            // Import the Session class from the library
            const module = await import('https://unpkg.com/@uvdsl/solid-oidc-client-browser@0.0.11/dist/esm/index.min.js');
            const Session = module.Session;

            // Create a new session
            session = new Session();

            // Set up the login button
            document.getElementById('loginButton').addEventListener('click', () => {
                // Use a default IDP or let user specify one
                const idp = "https://solidcommunity.net/"; // Default IDP - you can change this
                const redirect_uri = window.location.href;

                // Redirect to login
                session.login(idp, redirect_uri);
            });

            // Set up the logout button
            document.getElementById('logoutButton').addEventListener('click', () => {
                session.logout();
                // Update the UI
                document.getElementById('webid').textContent = "not logged in.";
                document.getElementById('welcome-message').textContent =
                    "You're not logged in.";
            });

            
            try {
                // either: handle redirect after login
                await session.handleRedirectFromLogin();
                // or: try to restore the session
                await session.restore();

                // Update the UI
                if (session.webId) {
                    document.getElementById('webid').textContent = session.webId;
                    document.getElementById('welcome-message').textContent =
                        `Welcome! You are logged in.`;
                } else {
                    document.getElementById('welcome-message').textContent =
                        "You're not logged in.";
                }
            } catch (error) {
                console.error("Error restoring session:", error);
                document.getElementById('welcome-message').textContent =
                    "Error restoring session. Please try logging in again.";
            }

        });
    </script>
</body>

</html>
```

For a multi-page application, see this [example](https://github.com/uvdsl/solid-oidc-client-browser/issues/4#issuecomment-2841098732).

#### in a Single Page Application (SPA), e.g. using Vue

I use [Vue](https://vuejs.org/) for my apps. If you want to see how this library is used in a Vue app, look at my [Solid App Template (Vue Edition)](https://github.com/uvdsl/solid-app-template-vue). It should (TM) work the same with the other frameworks. Here is a quick usage example:

Defining a `useSolidSession` composable e.g. located in `./composables/useSolidSession`
```ts
import { reactive } from "vue";
import { Session } from "@uvdsl/solid-oidc-client-browser";

interface IuseSolidSession {
  session: Session;
}

const session = reactive(new Session());

export const useSolidSession = () => {
  return { session } as IuseSolidSession;
};
```

Usage in a component, e.g. with a login button, logout button, ...
```ts
import { useSolidSession } from './composables/useSolidSession';
const { session, restoreSession } = useSolidSession();

// call on a button click
const redirect_uri = window.location.href;
const idp = "your IDP";
session.login(idp, redirect_uri);

// in code that is being executed
// to handle the redirect after login
session.handleRedirectFromLogin();
// if no redirect, restore the session
session.restore();
// let's have a look if we have a session
watch(() => session.isActive, () => console.log("Logged in:", session.webId), { immediate: true });

// call on a button click
session.logout();
```

#### After logging in ...

Once authenticated, you can use `session.authFetch` to fetch data from the Web using authenticated requests.
If the session is not yet authenticated, `session.authFetch` behaves like `window.fetch`.

There is a small library that provides [Solid Requests](https://github.com/uvdsl/solid-requests) for get, post, put, delete on resources, and even to create resources with the correct LDP link header, and to create containers with the correct link header - for your convenience.

If you don't want to dabble with parsing the retrieved RDF data manually, check out the [Solid RDF Store](https://github.com/uvdsl/solid-rdf-store).
You can use the `session` object in that store to let the store fetch (authenticated) RDF data from the Web and have reactive query results, i.e. results that can update reactively when query underlying data changes.


## Security Considerations

For a discussion around security considerations for this library see also the issues: [#3](https://github.com/uvdsl/solid-oidc-client-browser/issues/3) and [#6](https://github.com/uvdsl/solid-oidc-client-browser/issues/6). We provide a digest here:

#### Status Quo: `IndexedDB API`

We chose an `IndexedDB` over `localStorage` or `sessionStorage` because:
To renew tokens, the token request (in a RefreshTokenGrant) must contain a DPoP token signed by the same DPoP private key that was used on the initial token request (in the initial AuthorizationCodeGrant) for the session.
To persist this private key, we would need to make it extractable.
This means that if an attacker gains access to `localStorage` or `sessionStorage`, they are able to take the `refresh_token` and the private key, and re-use both outside of the context of the compromised application.

We use an `IndexedDB` which allows us to store the non-extractable DPoP KeyPair. This keypair cannot be extracted from the Browser's security context.
This means that, if an attacker gains access to our IndexedDB, they can obtain a fresh set of tokens and thus have successfully established a valid user session (using the DPoP keypair from the `IndexedDB`). 
But they do not fully control the DPoP KeyPair. They cannot extract the DPoP KeyPair and send it away. They can only operate within the compromised application.

#### Why not rely on "Silent Authentication"?

Currently, CSS/Pivot and ESS (afaik) set session cookies with `SameSite=None`
- which in turn allows silent authentication via iframes and popups 
- which in turn allows an attacker upon successful JS execution in a compromised application to execute silent authentication in the background without interuption
- which in turn results in a set of tokens bound to an attacker controlled and thus certainly extractable DPoP keypair
- which in turn allows the attacker to re-use the session outside of the compromised application.

#### Hosting multiple Solid Apps on the same origin (at different paths)

Despite the fact that the current setup allows for multi-page applications on the same origin, we need to carefully review the security implications.

For a multi-page app (see this [example](https://github.com/uvdsl/solid-oidc-client-browser/issues/4#issuecomment-2841098732)), we are golden, we only have one Solid App (client) running on the origin. We thus only have on `client_id`, that we need to consider.

Now, the crux: 
If you consider a multi-page app to actually be comprised of two (or more) Solid Apps (with distinct `client_id`s ), then it is possible for one Solid App to hijack the session of the other Solid App:
While `sessionStorage` does not persist after the tab is closed and is not available across tabs, it is still possible that when moving between the two Solid Apps on the same origin in the same tab (similar to moving between pages of the multi-page app served in that origin) the existing refresh token from Solid App 1 can be re-used by Solid App 2 to retrieve fresh tokens (just like the multi-page app does). So now Solid App 2 actually has tokens with the `client_id` of Solid App 1.

This is a problem from a security perspective: If a resource on a Solid Pod has been restricted via [ACP](https://solid.github.io/authorization-panel/acp-specification/) to only be accessible for Solid App 1 but not Solid App 2, the resource can still be accessed by Solid App 2 using the just obtained token (outlined above).

Therefore, I would like to suggest to adhere to the origin-centered security perspective that aligns with the browsers' security mechanisms.

If you want to serve multiple Solid Apps under the same origin, I'd suggest you consider this composition one mutli-page app with one overreaching `client_id`. This way, it is explicit that the different Solid Apps are really just one compositional app living in the same security context / within the same security boundaries enforced by the browser.

If you think that the two Solid Apps should still have distinct `client_id`, then I strongly suggest you consider the browsers' security mechansims, and thus see that the two disinct Solid Apps would live in the same security context, and thus exhibit a security issue. Therefore, I would strongly recommend in this case to consider serving the two Solid Apps from distinct origins - which aligns the conceptual model of distinct apps with the security model of the browsers: each distinct Solid App / client thus resides in its distinct security context. See also this [comment](https://github.com/uvdsl/solid-oidc-client-browser/issues/3#issuecomment-2841667805) for more details.

To summarise the point: The question on multiple apps on the same origin is to be answered by considering the conceptual relation of the multiple apps with regards to the browers' security mechansims. 


We - as in this library - cannot manage distinct sessions via the `IndexedDB API` securely. Not because we do not want to but because the browser does not provide us a more granular and secure (!) option. Of course, we could provide different databases for different paths on an origin.
But all these databases would still be accessible from any path on the origin.

Do you really want distinct logins and distinct sessions? This is not a question of concept but a question of security. You MUST deploy the apps on different origins.

---

[Initial version](https://github.com/DATEV-Research/Solid-B2B-showcase-libs) co-authored by [@dschraudner](https://github.com/dschraudner) and [@uvdsl](https://github.com/uvdsl) for the [MANDAT project](https://github.com/mandat-project), and first released by [DATEV Research](https://github.com/DATEV-Research).

