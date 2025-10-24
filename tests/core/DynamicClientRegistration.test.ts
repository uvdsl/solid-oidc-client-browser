// DynamicClientRegistration.test.ts
import { requestDynamicClientRegistration } from '../../src/core/DynamicClientRegistration';
import { DynamicRegistrationClientDetails } from '../../src/core/SessionInformation';

// --- JEST MOCKS ---
// fetch is already mocked globally in jest-setup.ts

// --- TEST SETUP & HELPERS ---

/**
 * Creates a minimal client details object for testing.
 */
const createClientDetails = (overrides: Partial<DynamicRegistrationClientDetails> = {}): DynamicRegistrationClientDetails => ({
  redirect_uris: ['https://app.example.com/redirect'],
  ...overrides,
});

/**
 * Parses the fetch body to verify JSON structure.
 * @param fetchMock The mocked fetch function
 */
const getLastFetchBody = (fetchMock: jest.Mock) => {
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(lastCall[1].body);
};

// --- TESTS ---

describe('requestDynamicClientRegistration', () => {
  const registrationEndpoint = 'https://idp.example.com/register';

  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  describe('successful registration', () => {
    it('should make a POST request to the registration endpoint', async () => {
      // Arrange
      const clientDetails = createClientDetails();
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ client_id: 'registered-client-id' }),
      });

      // Act
      await requestDynamicClientRegistration(registrationEndpoint, clientDetails);

      // Assert
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        registrationEndpoint,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should include all required OAuth 2.0 dynamic registration fields', async () => {
      // Arrange
      const clientDetails = createClientDetails();
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ client_id: 'test-client' }),
      });

      // Act
      await requestDynamicClientRegistration(registrationEndpoint, clientDetails);

      // Assert
      const requestBody = getLastFetchBody(fetch as jest.Mock);
      expect(requestBody).toMatchObject({
        redirect_uris: ['https://app.example.com/redirect'],
        grant_types: ['authorization_code', 'refresh_token'],
        id_token_signed_response_alg: 'ES256',
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        subject_type: 'public',
      });
    });

    it('should preserve additional client_details fields passed in', async () => {
      // Arrange
      const clientDetails = createClientDetails({
        client_name: 'My App',
        logo_uri: 'https://app.example.com/logo.png',
      });
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ client_id: 'test-client' }),
      });

      // Act
      await requestDynamicClientRegistration(registrationEndpoint, clientDetails);

      // Assert
      const requestBody = getLastFetchBody(fetch as jest.Mock);
      expect(requestBody.client_name).toBe('My App');
      expect(requestBody.logo_uri).toBe('https://app.example.com/logo.png');
    });

    it('should return the fetch response without processing', async () => {
      // Arrange
      const clientDetails = createClientDetails();
      const mockResponse = {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ client_id: 'new-client', client_secret: 'secret' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

      // Act
      const result = await requestDynamicClientRegistration(registrationEndpoint, clientDetails);

      // Assert
      expect(result).toBe(mockResponse);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
    });
  });

  describe('error handling', () => {
    it('should return the error response when registration fails', async () => {
      // Arrange
      const clientDetails = createClientDetails();
      const mockErrorResponse = {
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_redirect_uri' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockErrorResponse);

      // Act
      const result = await requestDynamicClientRegistration(registrationEndpoint, clientDetails);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should propagate network errors', async () => {
      // Arrange
      const clientDetails = createClientDetails();
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      // Act & Assert
      await expect(
        requestDynamicClientRegistration(registrationEndpoint, clientDetails)
      ).rejects.toThrow('Network error');
    });
  });
});

