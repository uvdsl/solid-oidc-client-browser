import {
  GenerateKeyPairResult,
  KeyLike,
  SignJWT,
  calculateJwkThumbprint,
  createRemoteJWKSet,
  exportJWK,
  jwtVerify,
} from "jose";
import { SessionTokenInformation } from "./SessionTokenInformation";

const renewTokens = async () => {
  const client_id = sessionStorage.getItem("client_id");
  const refresh_token = sessionStorage.getItem("refresh_token");
  const token_endpoint = sessionStorage.getItem("token_endpoint");
  if (!client_id || !refresh_token || !token_endpoint) {
    // we can not restore the old session
    throw new Error("Cannot renew tokens");
  }
  // RFC 9449 DPoP
  // const key_pair = await generateKeyPair("ES256");
  const privateKeyJwkString = sessionStorage.getItem("dpop_private_key");
  const publicKeyJwkString = sessionStorage.getItem("dpop_public_key");
  if (!privateKeyJwkString || !publicKeyJwkString) {
    console.log("No DPoP keypair to re-use.")
    return;
  }
  const privateKeyJwk = JSON.parse(privateKeyJwkString);
  const publicKeyJwk = JSON.parse(publicKeyJwkString);
  const publicKey = await window.crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    publicKeyJwk.key_ops || ['verify']
  );
  const privateKey = await window.crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    privateKeyJwk.key_ops || ['sign']
  );
  const key_pair = { privateKey, publicKey } as GenerateKeyPairResult<KeyLike>;

  const token_response =
    await requestFreshTokens(
      refresh_token,
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
  const idp = sessionStorage.getItem("idp");
  if (idp === null) {
    throw new Error(
      "Access Token validation preparation - Could not find in sessionStorage: idp"
    );
  }
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

  // set new refresh token for token rotation
  sessionStorage.setItem("refresh_token", token_response["refresh_token"]);

  return {
    ...token_response,
    dpop_key_pair: key_pair,
  } as SessionTokenInformation;
};

/**
 * Request an dpop-bound access token from a token endpoint using a refresh token
 * @param authorization_code
 * @param pkce_code_verifier
 * @param redirect_uri
 * @param client_id
 * @param token_endpoint
 * @param key_pair
 * @returns
 */
const requestFreshTokens = async (
  refresh_token: string,
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
        grant_type: "refresh_token",
        refresh_token,
        client_id
      }),
    });
};

export { renewTokens };
