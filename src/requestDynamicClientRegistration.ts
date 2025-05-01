/**
 * When the client does not have a webid profile document, use this.
 *
 * @param registration_endpoint
 * @param redirect_uris
 * @returns
 */
const requestDynamicClientRegistration = async (
  registration_endpoint: string,
  redirect_uris: string[]
) => {
  // prepare dynamic client registration
  const client_registration_request_body = {
    redirect_uris: redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    id_token_signed_response_alg: "ES256",
    token_endpoint_auth_method: "none", // best current practice in combination with PKCE code
    application_type: "web",
    subject_type: "public",
  };
  // register
  return fetch(
    registration_endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(client_registration_request_body),
    }
  );
};

export { requestDynamicClientRegistration };
