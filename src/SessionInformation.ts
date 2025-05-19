import { GenerateKeyPairResult, KeyLike } from "jose";

export interface SessionInformation {
  clientDetails: ClientDetails
  idpDetails?: IdentityProviderDetails
  tokenDetails?: TokenDetails
}

// including details for dynamic client registration (RFC 7591)
// omitting jwks_uri and jwks because this is used in a browser-based app (private keys would be exposed anyway)
/**
 * Explicit union of ′ClientIdDetails′ and ClientDynamicRegistrationDetails′.
 */
export interface ClientDetails {
  redirect_uris: string[];
  client_id?: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  software_id?: string; // not the `client id`!
  software_version?: string;
}


export interface DereferencableIdClientDetails {
  client_id: string
}

export interface DynamicRegistrationClientDetails {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  software_id?: string; // not the `client id`!
  software_version?: string;
}

export interface IdentityProviderDetails {
  idp: string;
  jwks_uri?: string;
  token_endpoint?: string;
}

export interface TokenDetails {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in: number;
  token_type: string;
  dpop_key_pair: GenerateKeyPairResult<KeyLike>;
}