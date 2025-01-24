import { GenerateKeyPairResult, KeyLike } from "jose";

export interface SessionTokenInformation {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  expires: number;
  token_type: string;
  dpop_key_pair: GenerateKeyPairResult<KeyLike>;
}
