import axios from "axios";

/**
 * When the client does not have a webid profile document, use this.
 *
 * @param registration_endpoint
 * @param redirect__uris
 * @returns
 */
const requestDynamicClientRegistration = async (
  registration_endpoint: string,
  redirect__uris: string[]
) => {
  // prepare dynamic client registration
  const client_registration_request_body = {
    redirect_uris: redirect__uris,
    grant_types: ["authorization_code", "refresh_token"],
    id_token_signed_response_alg: "ES256",
    token_endpoint_auth_method: "client_secret_basic", // also works with value "none" if you do not provide "client_secret" on token request
    application_type: "web",
    subject_type: "public",
  };
  // register
  return axios({
    url: registration_endpoint,
    method: "post",
    data: client_registration_request_body,
  });
};

export { requestDynamicClientRegistration };
