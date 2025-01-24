# Solid OIDC Client Browser

This library implements a very simple version of the Solid OIDC protocol:

- [x] AuthorizationCodeGrant
- [x] with PKCE
- [x] with `iss` check (TODO double check if necessary to check token iss as well)
- [x] with dynamic client registration (TODO support provided `client_id` and client profile documents)
- [x] RefreshTokenGrant to renew a session
- [ ] Unsure about storage. Currently, `client_id`, `client_secret`, `refresh_token` and `token_endpoint` are stored in `sessionStorage`. I see that other implementations store the session state in `localStorage` - no idea if that is deemed secure nowadays.

---

[Initial version](https://github.com/DATEV-Research/Solid-B2B-showcase-libs) co-authored by [@dschraudner](https://github.com/dschraudner) and [@uvdsl](https://github.com/uvdsl) for the [MANDAT project](https://github.com/mandat-project), and first released by [DATEV Research](https://github.com/DATEV-Research).

