# Solid OIDC Client Browser

This library implements a very simple version of the Solid OIDC protocol:

- [x] AuthorizationCodeGrant
- [x] with PKCE
- [x] with `iss` check (TODO double check if necessary to check token iss as well)
- [x] with dynamic client registration (TODO support provided `client_id` and client profile documents)
- [x] RefreshTokenGrant to renew a session
- [ ] Unsure about storage. Currently, `client_id`, `client_secret`, `refresh_token` and `token_endpoint` are stored in `sessionStorage`. I see that other implementations store the session state in `localStorage` - no idea if that is deemed secure nowadays.

## Example usage in a Vue app

I use [Vue](https://vuejs.org/) for my apps. If you want to see how this library is used in a Vue app, look at my [Solid App Template (Vue Edition)](https://github.com/uvdsl/solid-app-template-vue).

Here is a quick usage example. It should (TM) work the same with the other frameworks... Let me know.

```ts
import { reactive } from "vue";
import { Session } from "@uvdsl/solid-oidc-client-browser";

interface IuseSolidSession {
  session: Session;
  restoreSession: () => Promise<void>;
}

const session = reactive(new Session());

async function restoreSession() {
  await session.handleRedirectFromLogin();
}

export const useSolidSession = () => {
  return {
    session,
    restoreSession,
  } as IuseSolidSession;
};
```

Usage in a component, e.g. with a login button, logout button
```ts
// call on a button click
const redirect_uri = window.location.href;
const idp = "your IDP";
session.login(idp, redirect_uri);

// in code that is being executed
// to handle the redirect after login
restoreSession().then(() => console.log("Logged in:", session.webId));


// call on a button click
session.logout();
```

Once authenticated, you can use `session.authFetch` to fetch data from the Web using authenticated requests.
There is a small library that provides [Solid Requests](https://github.com/uvdsl/solid-requests) for get, post, put, delete on resources, and even to create resources with the correct LDP link header, and to create containers with the correct link header - for your convenience.

If you don't want to dabble with parsing the retrieved RDF data manually, check out the [Solid RDF Store](https://github.com/uvdsl/solid-rdf-store).
You can use the `session` object in that store to let the store fetch (authenticated) RDF data from the Web and have reactive query results, i.e. results that can update reactively when query underlying data changes.

---

[Initial version](https://github.com/DATEV-Research/Solid-B2B-showcase-libs) co-authored by [@dschraudner](https://github.com/dschraudner) and [@uvdsl](https://github.com/uvdsl) for the [MANDAT project](https://github.com/mandat-project), and first released by [DATEV Research](https://github.com/DATEV-Research).

