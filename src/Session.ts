import { SignJWT, decodeJwt, exportJWK } from "jose";
import {
  redirectForLogin,
  onIncomingRedirect,
} from "./AuthorizationCodeGrantFlow";
import { SessionTokenInformation } from "./SessionTokenInformation";
import { renewTokens } from "./RefreshTokenGrant";

export class Session {
  private tokenInformation: SessionTokenInformation | undefined;
  private isActive_ = false;
  private webId_: string | undefined = undefined;

  login = redirectForLogin;

  logout() {
    this.tokenInformation = undefined;
    this.isActive_ = false;
    this.webId_ = undefined;
    // clean session storage
    sessionStorage.removeItem("idp");
    sessionStorage.removeItem("client_id");
    sessionStorage.removeItem("client_secret");
    sessionStorage.removeItem("token_endpoint");
    sessionStorage.removeItem("refresh_token");
  }

  handleRedirectFromLogin() {
    return onIncomingRedirect().then(async (sessionInfo) => {
      if (!sessionInfo) {
        // try refresh
        sessionInfo = await renewTokens().catch((_) => {
          return undefined;
        });
      }
      if (!sessionInfo) {
        // still no session
        return;
      }
      // we got a sessionInfo
      this.tokenInformation = sessionInfo;
      this.isActive_ = true;
      this.webId_ = decodeJwt(this.tokenInformation.access_token)[
        "webid"
      ] as string;
    });
  }

  private async createSignedDPoPToken(payload: any) {
    if (this.tokenInformation == undefined) {
      throw new Error("Session not established.");
    }
    const jwk_public_key = await exportJWK(
      this.tokenInformation.dpop_key_pair.publicKey
    );
    return new SignJWT(payload)
      .setIssuedAt()
      .setJti(window.crypto.randomUUID())
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: jwk_public_key,
      })
      .sign(this.tokenInformation.dpop_key_pair.privateKey);
  }

  /**
   * Make fetch requests.
   * If session is established, authenticated requests are made.
   *
   * @param init the fetch request options (RequestInit) to use (authorization header, dpop header will be overwritten in active session)
   * @param dpopPayload optional, the payload of the dpop token to use (overwrites the default behaviour of `htu=config.url` and `htm=config.method`)
   * @returns fetch response
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
    if (this.tokenInformation) {
      dpopPayload = dpopPayload ?? {
        htu: `${url.origin}${url.pathname}`,
        htm: method.toUpperCase()
      };
      const dpop = await this.createSignedDPoPToken(dpopPayload);
      headers.set("dpop", dpop);
      headers.set("authorization", `DPoP ${this.tokenInformation.access_token}`);
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
