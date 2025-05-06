import { SignJWT, decodeJwt, exportJWK } from "jose";
import {
  redirectForLogin,
  onIncomingRedirect,
} from "./AuthorizationCodeGrantFlow";
import { ClientDetails, SessionInformation } from "./SessionInformation";
import { renewTokens } from "./RefreshTokenGrant";
import { SessionDatabase } from "./SessionDatabase";

export class Session {

  private sessionInformation: SessionInformation;
  private isActive_: boolean = false;
  private webId_?: string | undefined = undefined;

  /**
   * Create a new session. You must call `init(clientDetails: ClientDetails)` to initialize it.
   *
   * Example:
   * ```ts
   * const session = await new Session().init(clientDetails);
   * ```
   */
  constructor(clientDetails?: ClientDetails) {
    this.sessionInformation = { clientDetails } as SessionInformation;
  }

  /**
   * Redirect the user for login to their IDP.
   *
   * @throws Error if the session has not been initialized.
   */
  async login(idp: string, redirect_uri: string) {
    await redirectForLogin(idp, redirect_uri, this.sessionInformation.clientDetails)
  }

  /**
   * Clears all session-related information, including IDP details and tokens.
   * This logs the user out.
   * Client details are preserved. 
   */
  async logout() {
    // clean session data
    this.sessionInformation.idpDetails = undefined;
    this.sessionInformation.tokenDetails = undefined;
    this.isActive_ = false;
    this.webId_ = undefined;
    // only preserve client_id if URI
    if (this.sessionInformation.clientDetails?.client_id)
      try {
        new URL(this.sessionInformation.clientDetails.client_id)
      } catch (_) {
        this.sessionInformation.clientDetails.client_id = undefined
      }
    // clean session database
    const sessionDatabase = await new SessionDatabase().init()
    await sessionDatabase.clear();
    sessionDatabase.close();
  }

  /**
   * Handles the redirect from the Identity Provider after a login attempt.
   * It attempts to retrieve tokens using the authorization code, or restores
   * a session using a refresh token if available. 
   */
  async handleRedirectFromLogin() {
    // Case 1 - Redirect after Authorization Code Grant // memory via sessionStorage
    const newSessionInfo = await onIncomingRedirect(this.sessionInformation.clientDetails)
    // Case 2 - Restore session using Refresh Token Grant // memory via IndexedDB
    if (!newSessionInfo.tokenDetails) {
      // renew tokens in RefreshTokenGrant
      newSessionInfo.tokenDetails = await renewTokens()
        .catch((error) => {
          // anything missing or wrong => abort, could not restore session.
          this.logout();
          return undefined;
        });
    }
    // Case 3 - still no session - we remain unauthenticated
    if (!newSessionInfo.tokenDetails) {
      return;
    }
    // Case 1 & 2 => we got a session
    this.sessionInformation = newSessionInfo;
    this.isActive_ = true;
    this.webId_ = decodeJwt(this.sessionInformation.tokenDetails!.access_token)[
      "webid"
    ] as string;


  }

  /**
   * Creates a signed DPoP (Demonstration of Proof-of-Possession) token.
   *
   * @param payload The payload to include in the DPoP token. By default, it includes `htu` (HTTP target URI) and `htm` (HTTP method).
   * @returns A promise that resolves to the signed DPoP token string.
   * @throws Error if the session has not been initialized - if no token details are available.
   */
  private async createSignedDPoPToken(payload: any) {
    if (this.sessionInformation.tokenDetails == undefined) {
      throw new Error("Session not established.");
    }
    const jwk_public_key = await exportJWK(
      this.sessionInformation.tokenDetails.dpop_key_pair.publicKey
    );
    return new SignJWT(payload)
      .setIssuedAt()
      .setJti(window.crypto.randomUUID())
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: jwk_public_key,
      })
      .sign(this.sessionInformation.tokenDetails.dpop_key_pair.privateKey);
  }

  /**
   * Makes an HTTP fetch request. 
   * If a session is active, it includes the DPoP token and the access token in the `Authorization` header.
   *
   * @param input The URL or Request object to fetch.
   * @param init Optional fetch request options (RequestInit). Headers for `Authorization` and `DPoP` will be overwritten if a session is active.
   * @param dpopPayload Optional payload for the DPoP token. If provided, it overrides the default `htu` and `htm` claims.
   * @returns A promise that resolves to the fetch Response.
   */
  async authFetch(input: string | URL | globalThis.Request, init?: RequestInit, dpopPayload?: any) {
    // prepare authenticated call using a DPoP token (either provided payload, or default)
    let url: URL;
    let method: string;
    let headers: Headers;

    if (input instanceof Request) {
      url = new URL(input.url);
      method = init?.method || input?.method || 'GET';
      headers = new Headers(input.headers);
    } else {
      init = init || {};
      url = new URL(input.toString());
      method = init.method || 'GET';
      headers = init.headers ? new Headers(init.headers) : new Headers();
    }

    // create DPoP token, and add tokens to request
    if (this.sessionInformation.tokenDetails) {
      dpopPayload = dpopPayload ?? {
        htu: `${url.origin}${url.pathname}`,
        htm: method.toUpperCase()
      };
      const dpop = await this.createSignedDPoPToken(dpopPayload);
      headers.set("dpop", dpop);
      headers.set("authorization", `DPoP ${this.sessionInformation.tokenDetails.access_token}`);
    }

    // check explicitly; to avoid unexpected behaviour
    if (input instanceof Request) { // clone the provided request, and override the headers
      return fetch(new Request(input, { ...init, headers }));
    }
    // just override the headers
    return fetch(url, { ...init, headers });
  }

  get isActive() {
    return this.isActive_;
  }

  get webId() {
    return this.webId_;
  }
}
