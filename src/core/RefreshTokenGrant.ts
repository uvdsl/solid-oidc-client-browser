import {
  GenerateKeyPairResult,
  KeyLike,
  SignJWT,
  calculateJwkThumbprint,
  createRemoteJWKSet,
  exportJWK,
  jwtVerify,
} from "jose";
import { TokenDetails } from "./SessionInformation";
import { SessionDatabase } from "./SessionDatabase";

const renewTokens = async (sessionDatabase: SessionDatabase) => {
  // remember session details
  try {

    await sessionDatabase.init();
    const client_id = await sessionDatabase.getItem("client_id") as string;
    const token_endpoint = await sessionDatabase.getItem("token_endpoint") as string;
    const key_pair = await sessionDatabase.getItem("dpop_keypair") as GenerateKeyPairResult<KeyLike>;
    const refresh_token = await sessionDatabase.getItem("refresh_token") as string;

    if (client_id === null || token_endpoint === null || key_pair === null || refresh_token === null) {
      // we can not restore the old session
      throw new Error("Could not refresh tokens: details missing from database.");
    }

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
    const idp = await sessionDatabase.getItem("idp") as string;
    if (idp === null) {
      throw new Error(
        "Access Token validation preparation - Could not find in sessionDatabase: idp"
      );
    }
    const jwks_uri = await sessionDatabase.getItem("jwks_uri") as string;
    if (jwks_uri === null) {
      throw new Error(
        "Access Token validation preparation - Could not find in sessionDatabase: jwks_uri"
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
    if ((payload["cnf"] as any)["jkt"] !== dpopThumbprint) {
      throw new Error(
        "Access Token validation failed on `jkt`: jkt !== DPoP thumbprint - " + (payload["cnf"] as any)["jkt"] + " !== " + dpopThumbprint
      );
    }
    // check client_id
    if (payload["client_id"] !== client_id) {
      throw new Error(
        "Access Token validation failed on `client_id`: JWT payload !== client_id - " + payload["client_id"] + " !== " + client_id
      );
    }

    // set new refresh token for token rotation
    await sessionDatabase.setItem("refresh_token", token_response["refresh_token"]);

    return {
      ...token_response,
      dpop_key_pair: key_pair,
    } as TokenDetails;
  } finally {
    sessionDatabase.close();
  }
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
