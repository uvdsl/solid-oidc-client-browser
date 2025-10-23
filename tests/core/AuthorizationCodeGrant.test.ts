// Import the functions to be tested
import { redirectForLogin, onIncomingRedirect } from '../../src/core/AuthorizationCodeGrant';
// Import 'jose' so Jest uses our manual mock
import * as jose from 'jose';
// Import the module to be mocked
import * as DynamicClientRegistration from '../../src/core/DynamicClientRegistration';
import { ClientDetails } from '../../src/core/SessionInformation';

// --- JEST MOCKS ---

// Tell Jest to use the manual mock for 'jose' found in src/core/__mocks__/jose.ts
jest.mock('jose');

// Mock the dynamic client registration module
jest.mock('../../src/core/DynamicClientRegistration', () => ({
  requestDynamicClientRegistration: jest.fn(),
}));


// --- TEST SETUP ---

// Helper to mock window.location
const mockLocation = (url: string) => {
  // We need to re-assign the href for each test that uses it
  Object.defineProperty(window.location, 'href', {
    writable: true,
    value: url,
  });
};


// --- TESTS ---

describe('redirectForLogin', () => {
  const mockOpenIdConfig = {
    issuer: 'https://idp.example.com/',
    authorization_endpoint: 'https://idp.example.com/auth',
    token_endpoint: 'https://idp.example.com/token',
    jwks_uri: 'https://idp.example.com/jwks',
    registration_endpoint: 'https://idp.example.com/register',
  };

  it('should fetch openid-config and redirect with a provided client_id', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOpenIdConfig),
    });
    
    await redirectForLogin('https://idp.example.com/', 'https://app.example.com/redirect', { client_id: 'test-client' } as ClientDetails);

    // 1. Verify openid-config was fetched
    expect(fetch).toHaveBeenCalledWith('https://idp.example.com/.well-known/openid-configuration');

    // 2. Verify sessionStorage was populated
    expect(sessionStorage.setItem).toHaveBeenCalledWith('idp', 'https://idp.example.com/');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('token_endpoint', 'https://idp.example.com/token');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('pkce_code_verifier', expect.any(String));
    expect(sessionStorage.setItem).toHaveBeenCalledWith('csrf_token', 'mock-random-uuid');

    // 3. Verify dynamic registration was NOT called
    expect(DynamicClientRegistration.requestDynamicClientRegistration).not.toHaveBeenCalled();

    // 4. Verify the redirect happened correctly
    const redirectUrl = new URL((window.location.href));
    expect(redirectUrl.origin + redirectUrl.pathname).toBe('https://idp.example.com/auth');
    expect(redirectUrl.searchParams.get('client_id')).toBe('test-client');
  });

  it('should perform dynamic client registration if no client_id is provided', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOpenIdConfig),
    });
    (DynamicClientRegistration.requestDynamicClientRegistration as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ client_id: 'dynamic-client-id' })
    });
    
    await redirectForLogin('https://idp.example.com/', 'https://app.example.com/redirect');

    // 1. Verify dynamic registration was called
    expect(DynamicClientRegistration.requestDynamicClientRegistration).toHaveBeenCalled();

    // 2. Verify the dynamic client_id was stored
    expect(sessionStorage.setItem).toHaveBeenCalledWith('client_id', 'dynamic-client-id');
    
    // 3. Verify the redirect used the dynamic client_id
    const redirectUrl = new URL((window.location.href));
    expect(redirectUrl.searchParams.get('client_id')).toBe('dynamic-client-id');
  });

  it('should throw an error if dynamic registration fails when no client_id is provided', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOpenIdConfig),
    });
    (DynamicClientRegistration.requestDynamicClientRegistration as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(redirectForLogin('https://idp.example.com/', 'https://app.example.com/redirect')).rejects.toThrow(
      'HTTP error! Status: 500'
    );
  });

  it('should throw an error if issuer does not match idp', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...mockOpenIdConfig, issuer: 'https://wrong-idp.com/' }),
    });
    
    await expect(redirectForLogin('https://idp.example.com/', 'https://app.example.com/redirect')).rejects.toThrow(
      'RFC 9207 - iss !== idp - https://wrong-idp.com/ !== https://idp.example.com/'
    );
  });
  
  it('should throw an error if no open-id configuration could be obtained', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false, // Simulate a network or server error
      status: 404,
    });
    
    await expect(redirectForLogin('https://idp.example.com/', 'https://app.example.com/redirect')).rejects.toThrow(
      'HTTP error! Status: 404'
    );
  });
  
  it('must construct a compliant redirect_uri with all required params', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOpenIdConfig),
    });

    await redirectForLogin('https://idp.example.com/', 'https://app.example.com/redirect', { client_id: 'test-client' } as ClientDetails);
    
    const redirectUrl = new URL(window.location.href);
    const params = redirectUrl.searchParams;
    
    expect(params.get('response_type')).toBe('code');
    expect(params.get('redirect_uri')).toBe('https://app.example.com/redirect');
    expect(params.get('scope')).toContain('openid');
    expect(params.get('scope')).toContain('webid');
    expect(params.get('client_id')).toBe('test-client');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).not.toBeNull();
    expect(params.get('state')).not.toBeNull();
    expect(params.get('prompt')).toBe('consent');
  });

  it('should sanitize the redirect_uri by removing fragments while preserving query parameters', async () => {
    // Arrange: Set up mocks and define the URI to be tested.
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOpenIdConfig),
    });
    const uriWithFragmentAndQuery = 'https://app.example.com/redirect?keep=this#but-remove-this';
    const expectedSanitizedUri = 'https://app.example.com/redirect?keep=this';

    // Act: Call the function with the complex URI.
    await redirectForLogin('https://idp.example.com/', uriWithFragmentAndQuery, { client_id: 'test-client' } as ClientDetails);

    // Assert: Verify that the `redirect_uri` parameter sent to the IdP is the sanitized version.
    const finalRedirectUrl = new URL(window.location.href);
    expect(finalRedirectUrl.searchParams.get('redirect_uri')).toBe(expectedSanitizedUri);
  });

  describe('issuer trailing slash relaxation', () => {
    it.each([
      ['https://idp.example.com/', 'https://idp.example.com'], // idp with, issuer without
      ['https://idp.example.com', 'https://idp.example.com/'], // idp without, issuer with
      ['https://idp.example.com/', 'https://idp.example.com/'], // both with
      ['https://idp.example.com', 'https://idp.example.com'],   // both without
    ])('should pass when idp is "%s" and issuer is "%s"', async (idp, issuer) => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockOpenIdConfig, issuer }),
      });

      // We expect this not to throw an iss error and proceed to redirect
      await redirectForLogin(idp, 'https://app.example.com/redirect', { client_id: 'test-client' } as ClientDetails);
      
      // A simple assertion to confirm the function proceeded past the check
      expect(sessionStorage.setItem).toHaveBeenCalledWith('idp', issuer);
    });
  });
});


describe('onIncomingRedirect', () => {
    const mockTokenResponse = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
    };

    const mockJwtPayload = {
        iss: 'https://idp.example.com/',
        aud: 'solid',
        client_id: 'test-client',
        cnf: { jkt: 'mock-thumbprint' },
    };

    beforeEach(() => {
        // Pre-populate sessionStorage as if redirectForLogin had run
        sessionStorage.setItem('idp', 'https://idp.example.com/');
        sessionStorage.setItem('csrf_token', 'mock-csrf-token');
        sessionStorage.setItem('pkce_code_verifier', 'mock-pkce-verifier');
        sessionStorage.setItem('token_endpoint', 'https://idp.example.com/token');
        sessionStorage.setItem('jwks_uri', 'https://idp.example.com/jwks');
    });

    it('should do nothing if no authorization code is in the URL', async () => {
        mockLocation('https://app.example.com/redirect');
        const result = await onIncomingRedirect({ client_id: 'test-client' } as ClientDetails);
        expect(result.tokenDetails).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('should successfully exchange the code for tokens and validate them', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTokenResponse),
        });
        (jose.jwtVerify as jest.Mock).mockResolvedValueOnce({ payload: mockJwtPayload });
        (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValueOnce('mock-thumbprint');

        const result = await onIncomingRedirect({ client_id: 'test-client' } as ClientDetails);

        // 1. Verify token endpoint was called
        expect(fetch).toHaveBeenCalledWith('https://idp.example.com/token', expect.any(Object));

        // 2. Verify token was validated
        expect(jose.jwtVerify).toHaveBeenCalled();
        
        // 3. Verify DPoP thumbprint was checked
        expect(jose.calculateJwkThumbprint).toHaveBeenCalled();

        // 4. Verify result contains correct details
        expect(result.tokenDetails?.access_token).toBe('mock-access-token');
        expect(result.idpDetails?.idp).toBe('https://idp.example.com/');
        
        // 5. Verify sessionStorage was cleaned
        expect(sessionStorage.getItem('csrf_token')).toBeNull();
    });

    it('should throw an error on CSRF token mismatch', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=wrong-token&iss=https://idp.example.com/');
        
        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'RFC 6749 - state !== csrf_token - wrong-token !== mock-csrf-token'
        );
    });

    it('should throw an error on DPoP thumbprint mismatch', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTokenResponse),
        });
        (jose.jwtVerify as jest.Mock).mockResolvedValueOnce({ payload: mockJwtPayload });
        (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValueOnce('DIFFERENT-thumbprint'); // This is the key part of the test
        
        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'Access Token validation failed on `jkt`'
        );
    });

    it('should throw an error on iss mismatch', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://wrong-idp.com/');
        
        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'RFC 9207 - iss !== idp - https://wrong-idp.com/ !== https://idp.example.com/'
        );
    });

    it('should throw an error if pkce_code_verifier is missing', async () => {
        sessionStorage.removeItem('pkce_code_verifier');
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');

        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'Could not find in sessionStorage: pkce_code_verifier'
        );
    });

    it('should throw an error if token_endpoint is missing', async () => {
        sessionStorage.removeItem('token_endpoint');
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');

        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'Could not find in sessionStorage: token_endpoint'
        );
    });
    
    it('should throw an error if token request fails', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 401,
        });

        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'HTTP error! Status: 401'
        );
    });
    
    it('should throw an error if jwks_uri is missing', async () => {
        sessionStorage.removeItem('jwks_uri');
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTokenResponse),
        });

        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'Could not find in sessionStorage: jwks_uri'
        );
    });

    it('should throw an error if jwtVerify fails', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTokenResponse),
        });
        (jose.jwtVerify as jest.Mock).mockRejectedValueOnce(new Error('Invalid signature'));

        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'Invalid signature'
        );
    });

    it('should throw an error if client_id in token does not match', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTokenResponse),
        });
        const wrongPayload = { ...mockJwtPayload, client_id: 'wrong-client' };
        (jose.jwtVerify as jest.Mock).mockResolvedValueOnce({ payload: wrongPayload });
        (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValueOnce('mock-thumbprint');

        await expect(onIncomingRedirect({ client_id: 'test-client' } as ClientDetails)).rejects.toThrow(
            'Access Token validation failed on `client_id`'
        );
    });

    it('should throw an error if no client_id is available', async () => {
        mockLocation('https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/');
        
        // Ensure no client_id is passed and none is in sessionStorage
        sessionStorage.removeItem('client_id');
        
        await expect(onIncomingRedirect(undefined)).rejects.toThrow(
          'Access Token Request preparation - Could not find in sessionStorage: client_id (dynamic registration)'
        );
    });

    it('should create clientDetails if none are provided on success', async () => {
        const url = 'https://app.example.com/redirect?code=auth-code&state=mock-csrf-token&iss=https://idp.example.com/';
        mockLocation(url);
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTokenResponse),
        });
        // This test assumes dynamic registration happened, so client_id is in sessionStorage
        sessionStorage.setItem('client_id', 'dynamic-client-id');
        const dynamicPayload = { ...mockJwtPayload, client_id: 'dynamic-client-id' };
        (jose.jwtVerify as jest.Mock).mockResolvedValueOnce({ payload: dynamicPayload });
        (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValueOnce('mock-thumbprint');

        // Call the function without clientDetails
        const result = await onIncomingRedirect(undefined);

        // Assert that the returned clientDetails object was created correctly
        expect(result.clientDetails).toBeDefined();
        expect(result.clientDetails?.client_id).toBe('dynamic-client-id');
        // The URL is captured before it is cleaned, so we expect the full URL.
        expect((result.clientDetails as any).redirect_uris).toEqual(['https://app.example.com/redirect']);
    });
});

