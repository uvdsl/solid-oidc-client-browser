import { createRemoteJWKSet, generateKeyPair, jwtVerify, exportJWK, SignJWT, GenerateKeyPairResult, KeyLike, calculateJwkThumbprint } from "jose";
import { requestDynamicClientRegistration } from "./DynamicClientRegistration";
import { ClientDetails, DynamicRegistrationClientDetails, IdentityProviderDetails, SessionInformation, TokenDetails } from "./SessionInformation";
import { SessionDatabase } from "./SessionDatabase";

/**
 * Login with the idp, using a provided `client_id` or dynamic client registration if none provided.
 *
 * @param idp
 * @param redirect_uri
 */
const redirectForLogin = async (idp: string, redirect_uri: string, client_details?: ClientDetails) => {
  // RFC 6749 - Section 3.1.2 - sanitize redirect_uri
  const redirect_uri_ = new URL(redirect_uri);
  const redirect_uri_sane = redirect_uri_.origin + redirect_uri_.pathname + redirect_uri_.search;
  // RFC 9207 iss check: remember the identity provider (idp) / issuer (iss)
  sessionStorage.setItem("idp", idp);
  // lookup openid configuration of idp
  const idp_origin = new URL(idp).origin
  const openid_configuration =
    await fetch(`${idp_origin}/.well-known/openid-configuration`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      });
  // remember token endpoint
  sessionStorage.setItem(
    "token_endpoint",
    openid_configuration["token_endpoint"]
  );
  // remember jwks_uri for later token verification
  sessionStorage.setItem(
    "jwks_uri",
    openid_configuration["jwks_uri"]
  );

  let client_id = client_details?.client_id;
  // no client_id => attempt dynamic registration
  if (!client_id) {
    // use registration endpoint
    const registration_endpoint = openid_configuration["registration_endpoint"];
    // get client registration
    const client_registration =
      await requestDynamicClientRegistration(
        registration_endpoint,
        client_details as DynamicRegistrationClientDetails ?? { redirect_uris: [redirect_uri_sane] }
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    client_id = client_registration["client_id"];
    // remember client_id
    sessionStorage.setItem("client_id", client_id!);
  }

  // RFC 7636 PKCE, remember code verifer
  const { pkce_code_verifier, pkce_code_challenge } = await getPKCEcode();
  sessionStorage.setItem("pkce_code_verifier", pkce_code_verifier);

  // RFC 6749 OAuth 2.0 - CSRF token
  const csrf_token = window.crypto.randomUUID();
  sessionStorage.setItem("csrf_token", csrf_token);

  // redirect to idp
  const redirect_to_idp =
    openid_configuration["authorization_endpoint"] +
    `?response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirect_uri_sane)}` +
    `&scope=openid offline_access webid` +
    `&client_id=${client_id}` +
    `&code_challenge_method=S256` +
    `&code_challenge=${pkce_code_challenge}` +
    `&state=${csrf_token}` +
    `&prompt=consent`; // this query parameter value MUST be present for CSS v7 to issue a refresh token ( // TODO open issue because prompting is the default behaviour but without this query param no refresh token is provided despite the "remember this client" box being checked)

  window.location.href = redirect_to_idp;
};

/**
 * RFC 7636 PKCE
 * @returns PKCE code verifier and PKCE code challenge
 */
const getPKCEcode = async () => {
  // create random string as PKCE code verifier
  const pkce_code_verifier =
    window.crypto.randomUUID() + "-" + window.crypto.randomUUID();
  // hash the verifier and base64URL encode as PKCE code challenge
  const digest = new Uint8Array(
    await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pkce_code_verifier)
    )
  );
  const pkce_code_challenge = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { pkce_code_verifier, pkce_code_challenge };
};

/**
 * On incoming redirect from OpenID provider (idp/iss),
 * URL contains authrization code, issuer (idp) and state (csrf token),
 * get an access token for the authrization code.
 */
const onIncomingRedirect = async (client_details?: ClientDetails) => {
  const url = new URL(window.location.href);
  // authorization code
  const authorization_code = url.searchParams.get("code");
  // if no code, session remains unauthenticated at this point
  if (authorization_code === null) {
    return { clientDetails: client_details } as SessionInformation;;
  }
  // RFC 9207 issuer check
  const idp = sessionStorage.getItem("idp");
  if (idp === null || url.searchParams.get("iss") != idp) {
    throw new Error(
      "RFC 9207 - iss != idp - " + url.searchParams.get("iss") + " != " + idp
    );
  }
  // RFC 6749 OAuth 2.0
  if (url.searchParams.get("state") != sessionStorage.getItem("csrf_token")) {
    throw new Error(
      "RFC 6749 - state != csrf_token - " + url.searchParams.get("state") + " != " + sessionStorage.getItem("csrf_token")
    );
  }
  // remove redirect query parameters from URL
  url.searchParams.delete("iss");
  url.searchParams.delete("state");
  url.searchParams.delete("code");
  window.history.pushState({}, document.title, url.toString());

  // prepare token request
  const pkce_code_verifier = sessionStorage.getItem("pkce_code_verifier");
  if (pkce_code_verifier === null) {
    throw new Error(
      "Access Token Request preparation - Could not find in sessionStorage: pkce_code_verifier"
    );
  }
  const client_id = client_details?.client_id || sessionStorage.getItem("client_id");
  if (!client_id) {
    throw new Error(
      "Access Token Request preparation - Could not find in sessionStorage: client_id (dynamic registration)"
    );
  }
  const token_endpoint = sessionStorage.getItem("token_endpoint");
  if (token_endpoint === null) {
    throw new Error(
      "Access Token Request preparation - Could not find in sessionStorage: token_endpoint"
    );
  }

  // RFC 9449 DPoP
  const key_pair = await generateKeyPair("ES256");
  // get access token
  const token_response =
    await requestAccessToken(
      authorization_code,
      pkce_code_verifier,
      url.toString(),
      client_id,
      token_endpoint,
      key_pair
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      });

  // verify access_token // ! Solid-OIDC specification says it should be a dpop-bound `id token` but implementations provide a dpop-bound `access token`
  const accessToken = token_response["access_token"];
  const jwks_uri = sessionStorage.getItem("jwks_uri");
  if (jwks_uri === null) {
    throw new Error(
      "Access Token validation preparation - Could not find in sessionStorage: jwks_uri"
    );
  }
  const jwks = createRemoteJWKSet(new URL(jwks_uri));
  const { payload } = await jwtVerify(accessToken, jwks, {
    issuer: idp,  // RFC 9207
    audience: "solid", // RFC 7519 // ! "solid" as per implementations ...
    // exp, nbf, iat - handled automatically
  });
  // check dpop thumbprint
  const dpopThumbprint = await calculateJwkThumbprint(await exportJWK(key_pair.publicKey))
  if ((payload["cnf"] as any)["jkt"] != dpopThumbprint) {
    throw new Error(
      "Access Token validation failed on `jkt`: jkt != DPoP thumbprint - " + (payload["cnf"] as any)["jkt"] + " != " + dpopThumbprint
    );
  }
  // check client_id
  if (payload["client_id"] != client_id) {
    throw new Error(
      "Access Token validation failed on `client_id`: JWT payload != client_id - " + payload["client_id"] + " != " + client_id
    );
  }

  // summarise session info
  const token_details = { ...token_response, dpop_key_pair: key_pair } as TokenDetails;
  const idp_details = { idp, jwks_uri, token_endpoint } as IdentityProviderDetails
  if (!client_details) client_details = { redirect_uris: [window.location.href] };
  client_details.client_id = client_id;

  // to remember for session restore
  const sessionDatabase = await new SessionDatabase().init();
  await Promise.all([
    sessionDatabase.setItem("idp", idp),
    sessionDatabase.setItem("jwks_uri", jwks_uri),
    sessionDatabase.setItem("token_endpoint", token_endpoint),
    sessionDatabase.setItem("client_id", client_id),
    sessionDatabase.setItem("dpop_keypair", key_pair),
    sessionDatabase.setItem("refresh_token", token_response["refresh_token"])
  ]);
  sessionDatabase.close();

  // clean session storage
  sessionStorage.removeItem("csrf_token");
  sessionStorage.removeItem("pkce_code_verifier");
  sessionStorage.removeItem("idp");
  sessionStorage.removeItem("jwks_uri");
  sessionStorage.removeItem("token_endpoint");
  sessionStorage.removeItem("client_id");

  // return session information
  return {
    clientDetails: client_details,
    idpDetails: idp_details,
    tokenDetails: token_details
  } as SessionInformation;
};


/**
 * Request an dpop-bound access token from a token endpoint
 * @param authorization_code
 * @param pkce_code_verifier
 * @param redirect_uri
 * @param client_id
 * @param token_endpoint
 * @param key_pair
 * @returns
 */
const requestAccessToken = async (
  authorization_code: string,
  pkce_code_verifier: string,
  redirect_uri: string,
  client_id: string,
  token_endpoint: string,
  key_pair: GenerateKeyPairResult<KeyLike>
) => {
  // prepare public key to bind access token to
  const jwk_public_key = await exportJWK(key_pair.publicKey);
  jwk_public_key.alg = "ES256";
  // sign the access token request DPoP token
  const dpop = await new SignJWT({
    htu: token_endpoint,
    htm: "POST",
  })
    .setIssuedAt()
    .setJti(window.crypto.randomUUID())
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: jwk_public_key,
    })
    .sign(key_pair.privateKey);

  return fetch(
    token_endpoint,
    {
      method: "POST",
      headers: {
        dpop,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorization_code,
        code_verifier: pkce_code_verifier,
        redirect_uri: redirect_uri,
        client_id: client_id,
      }),
    });
};

export { redirectForLogin, onIncomingRedirect };
