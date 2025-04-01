import axios from "axios";
import { generateKeyPair } from "jose";
import { requestDynamicClientRegistration } from "./requestDynamicClientRegistration";
import { requestAccessToken } from "./requestAccessToken";
import { SessionTokenInformation } from "./SessionTokenInformation";

/**
 * Login with the idp, using dynamic client registration.
 * TODO generalise to use a provided client webid
 * TODO generalise to use provided client_id und client_secret
 *
 * @param idp
 * @param redirect_uri
 */
const redirectForLogin = async (idp: string, redirect_uri: string) => {
  // RFC 9207 iss check: remember the identity provider (idp) / issuer (iss)
  sessionStorage.setItem("idp", idp);
  // lookup openid configuration of idp
  const openid_configuration = (
    await axios.get(`${idp}/.well-known/openid-configuration`)
  ).data;
  // remember token endpoint
  sessionStorage.setItem(
    "token_endpoint",
    openid_configuration["token_endpoint"]
  );
  const registration_endpoint = openid_configuration["registration_endpoint"];

  // get client registration
  const client_registration = (
    await requestDynamicClientRegistration(registration_endpoint, [
      redirect_uri,
    ])
  ).data;

  // remember client_id and client_secret
  const client_id = client_registration["client_id"];
  sessionStorage.setItem("client_id", client_id);
  const client_secret = client_registration["client_secret"];
  sessionStorage.setItem("client_secret", client_secret);

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
    `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
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
const onIncomingRedirect = async () => {
  const url = new URL(window.location.href);
  // authorization code
  const authorization_code = url.searchParams.get("code");
  if (authorization_code === null) {
    return undefined;
  }
  // RFC 9207 issuer check
  const idp = sessionStorage.getItem("idp");
  if (
    idp === null ||
    url.searchParams.get("iss") != idp + (idp.endsWith("/") ? "" : "/")
    // TODO do we need to check within the token?
    // In OpenID Connect [OIDC.Core] flows where an ID Token is returned from the authorization endpoint, the value in the iss parameter MUST always be identical to the iss claim in the ID Token.
  ) {
    throw new Error(
      "RFC 9207 - iss != idp - " + url.searchParams.get("iss") + " != " + idp
    );
  }
  // RFC 6749 OAuth 2.0
  if (url.searchParams.get("state") != sessionStorage.getItem("csrf_token")) {
    throw new Error(
      "RFC 6749 - state != csrf_token - " +
        url.searchParams.get("iss") +
        " != " +
        sessionStorage.getItem("csrf_token")
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
  const client_id = sessionStorage.getItem("client_id");
  if (client_id === null) {
    throw new Error(
      "Access Token Request preparation - Could not find in sessionStorage: client_id"
    );
  }
  const client_secret = sessionStorage.getItem("client_secret");
  if (client_secret === null) {
    throw new Error(
      "Access Token Request preparation - Could not find in sessionStorage: client_secret"
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
  const token_response = (
    await requestAccessToken(
      authorization_code,
      pkce_code_verifier,
      url.toString(),
      client_id,
      client_secret,
      token_endpoint,
      key_pair
    )
  ).data;

  // clean session storage
  // sessionStorage.removeItem("idp");
  sessionStorage.removeItem("csrf_token");
  sessionStorage.removeItem("pkce_code_verifier");
  // sessionStorage.removeItem("client_id");
  // sessionStorage.removeItem("client_secret");
  // sessionStorage.removeItem("token_endpoint");

  // remember refresh_token for session
  sessionStorage.setItem("refresh_token", token_response["refresh_token"]);
  
  // return client login information
  return {
    ...token_response,
    dpop_key_pair: key_pair,
  } as SessionTokenInformation;
};

export { redirectForLogin, onIncomingRedirect };
