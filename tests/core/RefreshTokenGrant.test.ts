// Import the function to be tested
import { renewTokens } from '../../src/core/RefreshTokenGrant';
// Import dependencies needed for testing and mocking
import * as jose from 'jose'; // Jest will use the manual mock
import { SessionDatabase } from '../../src/core/SessionDatabase'; // Import the type/interface

// --- JEST MOCKS ---

// Tell Jest to use the manual mock for 'jose'
jest.mock('jose');

// --- TESTS ---

describe('renewTokens', () => {
  // Define mock data reusable across tests
  const mockDbData = {
    client_id: 'test-client',
    token_endpoint: 'https://idp.example.com/token',
    dpop_keypair: { publicKey: 'mockPublicKey', privateKey: 'mockPrivateKey' },
    refresh_token: 'old-refresh-token',
    idp: 'https://idp.example.com/',
    jwks_uri: 'https://idp.example.com/jwks',
  };

  const mockNewTokenResponse = {
    access_token: 'new-access-token',
    refresh_token: 'new-refresh-token',
    expires_in: 3600,
  };

  const mockJwtPayload = {
    iss: 'https://idp.example.com/',
    aud: 'solid',
    client_id: 'test-client',
    cnf: { jkt: 'mock-thumbprint' },
  };

  // Define a clear type for our mock database object
  let mockDb: jest.Mocked<SessionDatabase>;

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();

    // Create a direct mock of the SessionDatabase interface
    mockDb = {
      init: jest.fn().mockResolvedValue(undefined),
      // Simplified getItem implementation directly returning mock data
      getItem: jest.fn().mockImplementation(async (key: string) => {
        // Return a fresh copy of the data each time to avoid test interference
        const data = { ...mockDbData };
        return data[key as keyof typeof data] || null;
      }),
      setItem: jest.fn().mockResolvedValue(undefined),
      deleteItem: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Mock successful fetch by default
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockNewTokenResponse),
    });
    // Mock successful jose validation by default
    (jose.jwtVerify as jest.Mock).mockResolvedValue({ payload: mockJwtPayload });
    (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValue('mock-thumbprint');
    // Ensure createRemoteJWKSet returns a mock function/object
    (jose.createRemoteJWKSet as jest.Mock).mockReturnValue(jest.fn());
  });

  describe('database interactions', () => {
    it('should call init on the provided database object', async () => {
      await renewTokens(mockDb);
      expect(mockDb.init).toHaveBeenCalledTimes(1);
    });

    it('should fetch required data using getItem', async () => {
      await renewTokens(mockDb);
      expect(mockDb.getItem).toHaveBeenCalledWith('client_id');
      expect(mockDb.getItem).toHaveBeenCalledWith('token_endpoint');
      expect(mockDb.getItem).toHaveBeenCalledWith('dpop_keypair');
      expect(mockDb.getItem).toHaveBeenCalledWith('refresh_token');
    });

    it('should call close on the provided database object on success', async () => {
      await renewTokens(mockDb);
      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should call close if token request fails', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 400 });
      // Use try-catch to allow execution flow check after expected error
      try {
        await renewTokens(mockDb);
      } catch (e) {
        // Expected error
      }
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should call close even if initial db read fails', async () => {
      mockDb.getItem.mockImplementation(async (key: string) => {
        if (key === 'refresh_token') return null;
        const data = { ...mockDbData };
        return data[key as keyof typeof data] || null;
      });

      await expect(renewTokens(mockDb)).rejects.toThrow(
        'Could not refresh tokens: details missing from database.'
      );

      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should call close even if setItem fails', async () => {
      mockDb.setItem.mockRejectedValueOnce(new Error('Database write failed'));

      await expect(renewTokens(mockDb)).rejects.toThrow('Database write failed');

      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should call close even if JWT validation fails', async () => {
      (jose.jwtVerify as jest.Mock).mockRejectedValueOnce(new Error('Invalid JWT'));

      await expect(renewTokens(mockDb)).rejects.toThrow('Invalid JWT');

      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should call close on successful token refresh', async () => {
      await renewTokens(mockDb);

      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('token request', () => {
    it('should make a POST request to the token endpoint with correct parameters', async () => {
      await renewTokens(mockDb);

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://idp.example.com/token');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

      const body = new URLSearchParams(options.body);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh-token');
      expect(body.get('client_id')).toBe('test-client');
    });

    it('should generate a DPoP token with correct claims and key', async () => {
      // Arrange: Need to retrieve the actual key pair data for verification
      const keyPair = await mockDb.getItem('dpop_keypair');
      // Get the expected JWK object *as returned by the mock*
      const expectedBaseJwk = await jose.exportJWK(keyPair.publicKey);

      // Act
      await renewTokens(mockDb);

      // Assert
      expect(jose.SignJWT).toHaveBeenCalled();
      const constructorPayload = (jose.SignJWT as jest.Mock).mock.calls[0][0];
      expect(constructorPayload).toEqual({
        htu: 'https://idp.example.com/token',
        htm: 'POST',
      });

      const signJwtInstance = (jose.SignJWT as jest.Mock).mock.results[0].value;
      expect(signJwtInstance.setIssuedAt).toHaveBeenCalled();
      expect(signJwtInstance.setJti).toHaveBeenCalled();
      expect(signJwtInstance.setProtectedHeader).toHaveBeenCalledWith(
        expect.objectContaining({
          alg: 'ES256',
          typ: 'dpop+jwt',
          jwk: { ...expectedBaseJwk, alg: 'ES256' },
        })
      );
      expect(signJwtInstance.sign).toHaveBeenCalledWith(keyPair.privateKey);

      const [, options] = (fetch as jest.Mock).mock.calls[0];
      expect(options.headers.dpop).toBe('mocked.dpop.token');
    });
  });

  describe('token validation', () => {
    it('should validate the received access token using jose', async () => {
      // Arrange: Need the JWKS URI for assertion
      const jwksUri = await mockDb.getItem('jwks_uri');
      const mockKeySet = jest.fn(); // Mock the function returned by createRemoteJWKSet
      (jose.createRemoteJWKSet as jest.Mock).mockReturnValue(mockKeySet);
      const keyPair = await mockDb.getItem('dpop_keypair');

      // Act
      await renewTokens(mockDb);

      // Assert
      expect(mockDb.getItem).toHaveBeenCalledWith('idp');
      expect(mockDb.getItem).toHaveBeenCalledWith('jwks_uri');
      expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(new URL(jwksUri));
      expect(jose.jwtVerify).toHaveBeenCalledWith(
        mockNewTokenResponse.access_token,
        mockKeySet, // Assert the function returned by createRemoteJWKSet was used
        { issuer: mockDbData.idp, audience: 'solid' }
      );
      expect(jose.calculateJwkThumbprint).toHaveBeenCalledWith(await jose.exportJWK(keyPair.publicKey));
    });
  });

  describe('successful refresh', () => {
    it('should update the refresh token using setItem', async () => {
      await renewTokens(mockDb);
      expect(mockDb.setItem).toHaveBeenCalledWith('refresh_token', mockNewTokenResponse.refresh_token);
    });

    it('should replace the old refresh token with the new one', async () => {
      // Arrange: We need a mutable copy of data for this test
      const mutableDbData = { ...mockDbData };
      mockDb.getItem.mockImplementation(async (key: string) => mutableDbData[key as keyof typeof mutableDbData] || null);
      mockDb.setItem.mockImplementation(async (key: string, value: any) => {
        mutableDbData[key as keyof typeof mutableDbData] = value;
      });

      // Act
      await renewTokens(mockDb);

      // Assert
      expect(mutableDbData.refresh_token).toBe(mockNewTokenResponse.refresh_token);
      expect(mutableDbData.refresh_token).not.toBe('old-refresh-token'); // Verify it changed
    });


    it('should return the new token details including the original key pair', async () => {
      const result = await renewTokens(mockDb);
      expect(result.access_token).toBe(mockNewTokenResponse.access_token);
      expect(result.refresh_token).toBe(mockNewTokenResponse.refresh_token);
      expect(result.dpop_key_pair).toEqual(mockDbData.dpop_keypair);
    });
  });

  describe('error handling', () => {
    // Helper function to modify mockDb.getItem for specific error tests
    const setupMissingDbItem = (missingKey: string) => {
      mockDb.getItem.mockImplementation(async (key: string) => {
        if (key === missingKey) return null;
        // Use a fresh copy of data for getItem
        const data = { ...mockDbData };
        return data[key as keyof typeof data] || null;
      });
    };

    it.each([
      'client_id',
      'token_endpoint',
      'dpop_keypair',
      'refresh_token',
    ])('should throw an error if %s is missing from the database', async (missingKey) => {
      setupMissingDbItem(missingKey);
      await expect(renewTokens(mockDb)).rejects.toThrow(
        'Could not refresh tokens: details missing from database.'
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should throw an error if the token request fails', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
      await expect(renewTokens(mockDb)).rejects.toThrow('HTTP error! Status: 400');
    });

    it('should throw an error if idp is missing for validation', async () => {
      setupMissingDbItem('idp');
      await expect(renewTokens(mockDb)).rejects.toThrow('Could not find in sessionDatabase: idp');
    });

    it('should throw an error if jwks_uri is missing for validation', async () => {
      setupMissingDbItem('jwks_uri');
      await expect(renewTokens(mockDb)).rejects.toThrow('Could not find in sessionDatabase: jwks_uri');
    });

    it('should throw an error if jwtVerify fails', async () => {
      (jose.jwtVerify as jest.Mock).mockRejectedValueOnce(new Error('Invalid JWT'));
      await expect(renewTokens(mockDb)).rejects.toThrow('Invalid JWT');
    });

    it('should throw an error if DPoP thumbprint validation fails', async () => {
      (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValueOnce('wrong-thumbprint');
      await expect(renewTokens(mockDb)).rejects.toThrow('Access Token validation failed on `jkt`');
    });

    it('should throw an error if client_id validation fails', async () => {
      (jose.jwtVerify as jest.Mock).mockResolvedValueOnce({
        payload: { ...mockJwtPayload, client_id: 'wrong-client' },
      });
      await expect(renewTokens(mockDb)).rejects.toThrow('Access Token validation failed on `client_id`');
    });
  });
});

