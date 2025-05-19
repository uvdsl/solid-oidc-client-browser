import { SignJWT, decodeJwt, exportJWK } from "jose";
import {
  redirectForLogin,
  onIncomingRedirect,
} from "./AuthorizationCodeGrant";
import { DynamicRegistrationClientDetails, DereferencableIdClientDetails, SessionInformation } from "./SessionInformation";
import { renewTokens } from "./RefreshTokenGrant";
import { SessionDatabase } from "./SessionDatabase";

export interface SessionOptions {
  onSessionExpirationWarning: () => void;
}
export class Session {

  private sessionInformation: SessionInformation;
  private isActive_: boolean = false;
  private webId_?: string = undefined;
  private currentAth_?: string = undefined;
  private tokenRefreshTimeout?: any;
  private sessionDeactivateTimeout?: any;
  private onSessionExpirationWarning?: () => void;

  /**
   * Create a new session.
   */
  constructor(clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails, sessionOptions?: SessionOptions) {
    this.sessionInformation = { clientDetails } as SessionInformation;
    this.onSessionExpirationWarning = sessionOptions?.onSessionExpirationWarning;
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
    // clear timeouts
    if (this.sessionDeactivateTimeout)
      clearTimeout(this.sessionDeactivateTimeout);
    this.sessionDeactivateTimeout = undefined;
    if (this.tokenRefreshTimeout)
      clearTimeout(this.tokenRefreshTimeout);
    this.tokenRefreshTimeout = undefined;
    // clean session data
    this.sessionInformation.idpDetails = undefined;
    this.sessionInformation.tokenDetails = undefined;
    this.isActive_ = false;
    this.webId_ = undefined;
    // only preserve client_id if URI
    if (this.sessionInformation.clientDetails?.client_id)
      try {
        new URL(this.sessionInformation.clientDetails.client_id);
      } catch (_) {
        this.sessionInformation.clientDetails.client_id = undefined;
      }
    // clean session database
    const sessionDatabase = await new SessionDatabase().init();
    await sessionDatabase.clear();
    sessionDatabase.close();
  }

  /**
   * Handles the redirect from the identity provider after a login attempt.
   * It attempts to retrieve tokens using the authorization code.
   */
  async handleRedirectFromLogin() {
    // Redirect after Authorization Code Grant // memory via sessionStorage
    const newSessionInfo = await onIncomingRedirect(this.sessionInformation.clientDetails);
    // no session - we remain unauthenticated
    if (!newSessionInfo.tokenDetails) {
      return;
    }
    // we got a session
    this.sessionInformation = newSessionInfo;
    await this.setSessionDetails();
  }

  /**
   * Handles session restoration using the refresh token grant.
   * Silently fails if session could not be restored (maybe there was no session in the first place).
   */
  async restore() {
    // Restore session using Refresh Token Grant // memory via IndexedDB
    await renewTokens()
      .then(tokenDetails => {
        // got new tokens
        this.sessionInformation.tokenDetails = tokenDetails;
        // set session information
        return this.setSessionDetails();
      })
      // anything missing or wrong => abort, could not restore session.
      .catch(_ => { }); // fail silently
  }


  /**
   * Creates a signed DPoP (Demonstration of Proof-of-Possession) token.
   *
   * @param payload The payload to include in the DPoP token. By default, it includes `htu` (HTTP target URI) and `htm` (HTTP method).
   * @returns A promise that resolves to the signed DPoP token string.
   * @throws Error if the session has not been initialized - if no token details are available.
   */
  private async createSignedDPoPToken(payload: any) {
    if (!this.sessionInformation.tokenDetails || !this.currentAth_) {
      throw new Error("Session not established.");
    }
    payload.ath = this.currentAth_;
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

  //
  // Helper Methods
  //

  /**
   * Set the session to active if there is an access token.
   */
  private async setSessionDetails() {
    // check for access token 
    if (!this.sessionInformation.tokenDetails?.access_token) {
      this.logout();
    }
    // generate ath
    this.currentAth_ = await this.computeAth(this.sessionInformation.tokenDetails!.access_token)
    // check for active session
    this.webId_ = decodeJwt(this.sessionInformation.tokenDetails!.access_token)[
      "webid"
    ] as string;
    this.isActive_ = this.webId !== undefined
    // deactivating session when token expire
    this.setSessionDeactivateTimeout();
    // refreshing tokens
    this.setTokenRefreshTimeout();
  }

  private setSessionDeactivateTimeout() {
    const deactivate_buffer_seconds = 5;
    const timeUntilDeactivate = (this.sessionInformation.tokenDetails!.expires_in - deactivate_buffer_seconds) * 1000;
    if (this.sessionDeactivateTimeout)
      clearTimeout(this.sessionDeactivateTimeout);
    this.sessionDeactivateTimeout = setTimeout(() => this.logout(), timeUntilDeactivate)
  }

  private setTokenRefreshTimeout() {
    const refresh_buffer_seconds = 95;
    const timeUntilRefresh = (this.sessionInformation.tokenDetails!.expires_in - refresh_buffer_seconds) * 1000;
    if (this.tokenRefreshTimeout)
      clearTimeout(this.tokenRefreshTimeout);
    this.tokenRefreshTimeout = setTimeout(async () => {
      const newTokens = await renewTokens()
        .catch((error) => {
          // anything missing or wrong => could not renew tokens.
          if (this.onSessionExpirationWarning)
            this.onSessionExpirationWarning();
          return undefined;
        })
      if (!newTokens) {
        return;
      }
      this.sessionInformation.tokenDetails = newTokens;
      this.setSessionDeactivateTimeout();
      this.setTokenRefreshTimeout();
    }, timeUntilRefresh);
  }

  /**
   * RFC 9449 - Hash of the access token
   */
  private async computeAth(accessToken: string): Promise<string> {
    // Convert the ASCII string of the token to a Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(accessToken); // ASCII by default
    // Compute SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    // Convert ArrayBuffer to base64url string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const base64 = btoa(String.fromCharCode(...hashArray));
    // Convert base64 to base64url
    const base64url = base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return base64url;
  }
}