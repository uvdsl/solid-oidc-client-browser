import { SignJWT, decodeJwt, exportJWK } from "jose";
import { redirectForLogin, onIncomingRedirect } from "./AuthorizationCodeGrant";
import { renewTokens } from "./RefreshTokenGrant";
import { SessionDatabase } from "./SessionDatabase";
import { DynamicRegistrationClientDetails, DereferencableIdClientDetails, SessionInformation, TokenDetails } from "./SessionInformation";


export interface SessionOptions {
  database?: SessionDatabase
  onSessionStateChange?: () => void;
}

/**
 * The Session interface.
 * 
 */
export interface Session {

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
 * The SessionCore class manages session state and core logic but does not handle the refresh lifecycle.
 * It receives {@link SessionOptions} with a database to be able to restore a session.
 * That database can be re-used by (your!) surrounding implementation to handle the refresh lifecycle.
 * If no database was provided, refresh information cannot be stored, and thus token refresh (via the refresh token grant) is not possible in this case.
 * 
 * If you are building a web app, use the Session implementation provided in the default `/web` version of this library.
 */
export class SessionCore implements Session {
  private isActive_: boolean = false;
  private exp_?: number;
  private webId_?: string = undefined;
  private currentAth_?: string = undefined;

  protected onSessionStateChange?: () => void;

  private information: SessionInformation;
  private database?: SessionDatabase;

  protected refreshPromise?: Promise<void>;
  protected resolveRefresh?: (() => void);
  protected rejectRefresh?: ((reason?: any) => void);

  constructor(clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails, sessionOptions?: SessionOptions) {
    this.information = { clientDetails } as SessionInformation;
    this.database = sessionOptions?.database
    this.onSessionStateChange = sessionOptions?.onSessionStateChange;
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
    const newSessionInfo = await onIncomingRedirect(this.information.clientDetails, this.database);
    // no session - we remain unauthenticated
    if (!newSessionInfo.tokenDetails) return;
    // we got a session
    this.information.clientDetails = newSessionInfo.clientDetails
    this.information.idpDetails = newSessionInfo.idpDetails;
    await this.setTokenDetails(newSessionInfo.tokenDetails)
    // callback state change 
    this.onSessionStateChange?.(); // we logged in
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

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = new Promise((resolve, reject) => {
      this.resolveRefresh = resolve;
      this.rejectRefresh = reject;
    });

    // Restore session using Refresh Token Grant 
    const wasActive = this.isActive
    renewTokens(this.database)
      .then(tokenDetails => { return this.setTokenDetails(tokenDetails); })
      .then(() => { this.resolveRefresh!(); })
      .catch(error => {
        if (this.isActive) {
          this.rejectRefresh!(new Error(error || 'Token refresh failed'));
          // do not change state (yet), let the app decide if they want to logout or if they just want to retry.
        } else {
          this.rejectRefresh!(new Error("No session to restore."));
        }
      }).finally(() => {
        this.clearRefreshPromise();
        if (wasActive !== this.isActive) this.onSessionStateChange?.();
      })

    return this.refreshPromise;
  }

  /**
   * This logs the user out.
   * Clears all session-related information, including IDP details and tokens.
   * Client ID is preserved if it is a URI. 
   */
  async logout() {
    // clean session data
    this.isActive_ = false;
    this.exp_ = undefined;
    this.webId_ = undefined;
    this.currentAth_ = undefined;
    this.information.idpDetails = undefined;
    this.information.tokenDetails = undefined;
    // client details are preserved
    if (this.refreshPromise && this.rejectRefresh) {
      this.rejectRefresh(new Error('Logout during token refresh.'));
      this.clearRefreshPromise();
    }
    // clean session database
    if (this.database) {
      await this.database.init();
      await this.database.clear();
      this.database.close();
    }
    // callback state change
    this.onSessionStateChange?.(); // we logged out
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

    // if there is not session established, just delegate to the default fetch
    if (!this.isActive) {
      return fetch(input, init);
    }

    // TODO
    // TODO do HEAD request to check if authentication is actually required, only then include tokens
    // TODO

    // prepare authenticated call using a DPoP token (either provided payload, or default)

    let url: URL;
    let method: string;
    let headers: Headers;
    // wrangle fetch input parameters into place
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
    await this._renewTokensIfExpired();
    dpopPayload = dpopPayload ?? {
      htu: `${url.origin}${url.pathname}`,
      htm: method.toUpperCase()
    };
    const dpop = await this._createSignedDPoPToken(dpopPayload);
    // overwrite headers: authorization, dpop
    headers.set("dpop", dpop);
    headers.set("authorization", `DPoP ${this.information.tokenDetails!.access_token}`);

    // check explicitly; to avoid unexpected behaviour
    if (input instanceof Request) { // clone the provided request, and override the headers
      return fetch(new Request(input, { ...init, headers }));
    }
    // just override the headers
    return fetch(url, { ...init, headers });
  }

  // 
  // Setters
  //

  protected async setTokenDetails(tokenDetails: TokenDetails) {
    this.information.tokenDetails = tokenDetails;
    await this._updateSessionDetailsFromToken(tokenDetails.access_token)
  }

  protected clearRefreshPromise() {
    this.refreshPromise = undefined;
    this.resolveRefresh = undefined;
    this.rejectRefresh = undefined;
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

  getExpiresIn() {
    return this.information.tokenDetails!.expires_in ?? -1;
  }

  isExpired() {
    if (!this.exp_) return true;
    return this._isTokenExpired(this.exp_);
  }


  //
  // Helpers
  //

  /**
   * Check if the current token is expired (which may happen during device/browser/tab hibernation),
   * and if expired, restore the session.
   */
  private async _renewTokensIfExpired(): Promise<void> {
    if (this.isExpired()) {
      if (!this.refreshPromise) {
        await this.restore(); // Initiate and wait
      } else {
        await this.refreshPromise; // Wait for already pending
      }
    }
  }

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
      await this.logout();
      return;
    }
    try {
      const decodedToken = decodeJwt(access_token);
      const webId = decodedToken.webid as string | undefined;
      if (!webId) {
        throw new Error('Missing webid claim in access token');
      }
      const exp = decodedToken.exp
      if (!exp) {
        throw new Error('Missing exp claim in access token');
      }
      this.currentAth_ = await this._computeAth(access_token); // must be done before session set to active
      this.webId_ = webId;
      this.exp_ = exp;
      this.isActive_ = true;
    } catch (error) {
      await this.logout();
    }
  }

  /**
    * Checks if a JWT expiration timestamp ('exp') has passed.
    */
  private _isTokenExpired(exp: number, bufferSeconds = 0) {
    if (typeof exp !== 'number' || isNaN(exp)) {
      return true;
    }
    const currentTimeSeconds = Math.floor(Date.now() / 1000);
    return exp < (currentTimeSeconds + bufferSeconds);
  }
}
