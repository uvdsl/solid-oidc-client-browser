import { SignJWT, decodeJwt, exportJWK } from "jose";
import { redirectForLogin, onIncomingRedirect } from "./AuthorizationCodeGrant";
import { renewTokens } from "./RefreshTokenGrant";
import { ISessionDatabase } from "./SessionDatabase";
import { DynamicRegistrationClientDetails, DereferencableIdClientDetails, SessionInformation, TokenDetails } from "./SessionInformation";


export interface ISessionOptions {
  database?: ISessionDatabase
}

export interface ISession {

  /**
   * Redirect the user for login to their IDP.
   */
  login(idp: string, redirect_uri: string): Promise<void>;

  /**
   * Handles the redirect from the identity provider after a login attempt.
   * It attempts to retrieve tokens using the authorization code.
   */
  handleRedirectFromLogin(): Promise<void>;

  /**
   * Handles session restoration using the refresh token grant.
   */
  restore(): Promise<void>;

  /**
   * This logs the user out.
   * Clears all session-related information, including IDP details and tokens.
   * Client details may be preserved. 
   */
  logout(): Promise<void>;

  /**
   * Makes an HTTP fetch request. 
   * If a session is active, it includes the DPoP token and the access token in the `Authorization` header.
   *
   * @param input The URL or Request object to fetch.
   * @param init Optional fetch request options (RequestInit). Headers for `Authorization` and `DPoP` will be overwritten if a session is active.
   * @param dpopPayload Optional payload for the DPoP token. If provided, it overrides the default `htu` and `htm` claims.
   * @returns A promise that resolves to the fetch Response.
   */
  authFetch(input: string | URL | globalThis.Request, init?: RequestInit, dpopPayload?: any): Promise<Response>;

}


//
//
//  Basic implementation
//
//

/**
 * The CoreSession class manages session state and core logic but does not handle the refresh lifecycle.
 * It provides the {@link ISessionOptions} to provide a database to be able to restore a session.
 * That database can be re-used by (your!) surrounding implementation to handle the refresh lifecycle.
 * If no database was provided, refresh information cannot be persisted, and thus token refresh is not possible in this case.
 * 
 * If you are building a web app, use the {@link WebSession} provided in `../web/Session`.
 */
export class SessionCore implements ISession {
  private isActive_: boolean = false;
  private webId_?: string = undefined;
  private currentAth_?: string = undefined;

  private information: SessionInformation;
  private database?: ISessionDatabase;

  constructor(clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails, sessionOptions?: ISessionOptions) {
    this.information = { clientDetails } as SessionInformation;
    this.database = sessionOptions?.database
  }

  async login(idp: string, redirect_uri: string) {
    await redirectForLogin(idp, redirect_uri, this.information.clientDetails)
  }

  /**
   * Handles the redirect from the identity provider after a login attempt.
   * It attempts to retrieve tokens using the authorization code.
   * Upon success, it tries to persist information to refresh tokens in the session database.
   * If no database was provided, no information is persisted.
   */
  async handleRedirectFromLogin() {
    // Redirect after Authorization Code Grant // memory via sessionStorage
    const newSessionInfo = await onIncomingRedirect(this.information.clientDetails);
    // no session - we remain unauthenticated
    if (!newSessionInfo.tokenDetails) return;
    // we got a session
    this.information = newSessionInfo;
    await this._updateSessionDetailsFromToken(this.information.tokenDetails?.access_token);
    // and persist refresh token details
    if (this.database) {
      await this.database.init();
      await Promise.all([
        this.database.setItem("idp", this.information.idpDetails?.idp),
        this.database.setItem("jwks_uri", this.information.idpDetails?.jwks_uri),
        this.database.setItem("token_endpoint", this.information.idpDetails?.token_endpoint),
        this.database.setItem("client_id", this.information.clientDetails.client_id),
        this.database.setItem("dpop_keypair", this.information.tokenDetails?.dpop_key_pair),
        this.database.setItem("refresh_token", this.information.tokenDetails?.refresh_token),
      ]);
      this.database.close();
    }
  }

  /**
   * Handles session restoration using the refresh token grant.
   * Silently fails if session could not be restored (maybe there was no session in the first place).
   */
  async restore() {
    if (!this.database) {
      throw new Error(
        "Could not refresh tokens: missing database. Provide database in sessionOption."
      )
    }

    // Restore session using Refresh Token Grant 
    await renewTokens(this.database)
      .then(tokenDetails => {
        // got new tokens
        return this.setTokenDetails(tokenDetails);
      })
      // anything missing or wrong => abort, could not restore session.
      .catch(_ => { }); // fail silently
  }

  /**
   * This logs the user out.
   * Clears all session-related information, including IDP details and tokens.
   * Client ID is preserved if it is a URI. 
   */
  async logout() {
    // clean session data
    this.isActive_ = false;
    this.webId_ = undefined;
    this.currentAth_ = undefined;
    this.information.idpDetails = undefined;
    this.information.tokenDetails = undefined;
    // only preserve client_id if URI
    if (this.information.clientDetails?.client_id)
      try {
        new URL(this.information.clientDetails.client_id);
      } catch (_) {
        this.information.clientDetails.client_id = undefined;
      }
    // clean session database
    if (this.database) {
      await this.database.init();
      await this.database.clear();
      this.database.close();
    }
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
    if (this.information.tokenDetails) {
      dpopPayload = dpopPayload ?? {
        htu: `${url.origin}${url.pathname}`,
        htm: method.toUpperCase()
      };
      const dpop = await this._createSignedDPoPToken(dpopPayload);
      headers.set("dpop", dpop);
      headers.set("authorization", `DPoP ${this.information.tokenDetails.access_token}`);
    }

    // check explicitly; to avoid unexpected behaviour
    if (input instanceof Request) { // clone the provided request, and override the headers
      return fetch(new Request(input, { ...init, headers }));
    }
    // just override the headers
    return fetch(url, { ...init, headers });
  }

  //
  // Helper Methods
  //

  /**
   * Set the session to active if there is an access token.
   */


  /**
   * RFC 9449 - Hash of the access token
   */
  private async _computeAth(accessToken: string): Promise<string> {
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

  /**
 * Creates a signed DPoP (Demonstration of Proof-of-Possession) token.
 *
 * @param payload The payload to include in the DPoP token. By default, it includes `htu` (HTTP target URI) and `htm` (HTTP method).
 * @returns A promise that resolves to the signed DPoP token string.
 * @throws Error if the session has not been initialized - if no token details are available.
 */
  private async _createSignedDPoPToken(payload: any) {
    if (!this.information.tokenDetails || !this.currentAth_) {
      throw new Error("Session not established.");
    }
    payload.ath = this.currentAth_;
    const jwk_public_key = await exportJWK(
      this.information.tokenDetails.dpop_key_pair.publicKey
    );
    return new SignJWT(payload)
      .setIssuedAt()
      .setJti(window.crypto.randomUUID())
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: jwk_public_key,
      })
      .sign(this.information.tokenDetails.dpop_key_pair.privateKey);
  }


  private async _updateSessionDetailsFromToken(access_token?: string) {
    if (!access_token) {
      this.logout();
      return;
    }
    this.webId_ = decodeJwt(access_token)["webid"] as string;
    this.isActive_ = this.webId !== undefined
    this.currentAth_ = await this._computeAth(this.information.tokenDetails!.access_token)
  }


  //
  // Getters
  //

  get isActive() {
    return this.isActive_;
  }

  get webId() {
    return this.webId_;
  }

  setTokenDetails(tokenDetails: TokenDetails) {
    this.information.tokenDetails = tokenDetails;
    this._updateSessionDetailsFromToken(tokenDetails.access_token)
  }

  getExpiresIn() {
    const logoutBuffer = 5;
    return (this.information.tokenDetails!.expires_in ?? -1) - logoutBuffer;
  }

}
