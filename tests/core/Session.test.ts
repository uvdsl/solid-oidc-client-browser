// Import the class to be tested and necessary types
import { SessionCore, SessionEvents, SessionOptions } from '../../src/core/Session';
import { SessionDatabase } from '../../src/core/SessionDatabase';
import { ClientDetails, SessionInformation, TokenDetails, DynamicRegistrationClientDetails, DereferencableIdClientDetails } from '../../src/core/SessionInformation';

// Import functions/modules to be mocked
import * as AuthCodeGrant from '../../src/core/AuthorizationCodeGrant';
import * as RefreshGrant from '../../src/core/RefreshTokenGrant';
import * as jose from 'jose'; // Jest uses the manual mock

// --- JEST MOCKS ---

// Mock the grant modules
jest.mock('../../src/core/AuthorizationCodeGrant');
jest.mock('../../src/core/RefreshTokenGrant');

// Use the manual mock for jose
jest.mock('jose');

// --- TESTS ---

describe('SessionCore', () => {
    // --- Test Data & Mocks ---
    let mockDb: jest.Mocked<SessionDatabase>;
    const mockClientDetails: DereferencableIdClientDetails = { client_id: 'https://app.example/profile' };
    const mockDynamicClientDetails: DynamicRegistrationClientDetails = { redirect_uris: ['https://app.example/callback'] };
    const mockTokenDetails: TokenDetails = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        dpop_key_pair: { publicKey: 'mockPublicKey', privateKey: 'mockPrivateKey' } as any, // Cast for simplicity
        token_type: "mock-token-type"
    };
    const mockSessionInfo: SessionInformation = {
        clientDetails: { ...mockClientDetails, client_id: 'resolved-client-id' } as ClientDetails, // Simulate resolved client_id
        idpDetails: {
            idp: 'https://idp.example.com/',
            jwks_uri: 'https://idp.example.com/jwks',
            token_endpoint: 'https://idp.example.com/token',
        },
        tokenDetails: mockTokenDetails,
    };

    // --- Helper Functions ---

    /** Helper to create SessionCore instance */
    const createSession = (
        clientDetails: DereferencableIdClientDetails | undefined = mockClientDetails,
        options: SessionOptions = {}
    ) => {
        return new SessionCore(clientDetails, { database: mockDb, ...options });
    };

    /** Helper function to set up an active session state for tests */
    const activateSession = async (session: SessionCore) => {
        const client_id = (session as any).information.clientDetails.client_id;

        // 1. Set the session info that would be present
        (session as any).information = { ...mockSessionInfo };
        (session as any).information.clientDetails.client_id = client_id;

        // 2. Mock the internal _computeAth method, as it depends on `window.crypto`
        // which is not available in the JSDOM test environment.
        const computeAthSpy = jest.spyOn(session as any, '_computeAth')
            .mockResolvedValueOnce('mock-ath-value');

        // 3. Now, call the real method to set internal state (isActive, webId, currentAth)
        await (session as any)._updateSessionDetailsFromToken(mockTokenDetails.access_token);

        // 4. Reset mocks that were just called during activation
        (fetch as jest.Mock).mockClear();
        (jose.SignJWT as jest.Mock).mockClear();
        computeAthSpy.mockClear(); // Clear this spy too
        (jose.decodeJwt as jest.Mock).mockClear(); // This is also called by _updateSessionDetailsFromToken
    };

    const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));


    beforeEach(() => {
        // Restore all spies and mocks defined with jest.spyOn or jest.fn()
        jest.restoreAllMocks();
        // Clear mocks created with jest.mock (like AuthCodeGrant, RefreshGrant)
        jest.clearAllMocks();

        // Create a fresh mock database for each test
        mockDb = {
            init: jest.fn().mockResolvedValue(undefined),
            getItem: jest.fn().mockResolvedValue(null), // Default to returning null
            setItem: jest.fn().mockResolvedValue(undefined),
            deleteItem: jest.fn().mockResolvedValue(undefined),
            clear: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        };

        // Mock jose decodeJwt used in _updateSessionDetailsFromToken
        (jose.decodeJwt as jest.Mock).mockReturnValue({ webid: 'https://alice.example/card#me', exp: Math.floor(Date.now() / 1000) + 3600 });
        // Mock jose exportJWK needed for _createSignedDPoPToken
        (jose.exportJWK as jest.Mock).mockResolvedValue({ kty: 'EC' });
        // Mock _computeAth dependency (mocking crypto directly is complex)
        // Mocking calculateJwkThumbprint as a stand-in if _computeAth relies on it
        // Or directly mock _computeAth if needed and possible
        // Let's assume _computeAth works correctly based on crypto polyfills/mocks in setup
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }); // Default fetch mock
    });

    // --- Constructor Tests ---
    describe('constructor', () => {
        it('should initialize with inactive state and undefined webId', () => {
            const session = createSession();
            expect(session.isActive).toBe(false);
            expect(session.webId).toBeUndefined();
        });

        it('should store the provided clientDetails', () => {
            const session = createSession(mockClientDetails);
            expect((session as any).information.clientDetails).toEqual(mockClientDetails);
        });

        it('should store the provided database', () => {
            const session = createSession(mockClientDetails, { database: mockDb });
            expect((session as any).database).toBe(mockDb);
        });

        it('should work without a database', () => {
            const session = new SessionCore(mockClientDetails); // Instantiate directly without db
            expect((session as any).database).toBeUndefined();
        });
    });

    // --- Login Tests ---
    describe('login', () => {
        it('should call redirectForLogin with correct parameters', async () => {
            const session = createSession();
            await session.login('https://idp.example', 'https://app.example/callback');
            expect(AuthCodeGrant.redirectForLogin).toHaveBeenCalledTimes(1);
            expect(AuthCodeGrant.redirectForLogin).toHaveBeenCalledWith(
                'https://idp.example',
                'https://app.example/callback',
                mockClientDetails
            );
        });
    });

    // --- handleRedirectFromLogin Tests ---
    describe('handleRedirectFromLogin', () => {
        it('should call onIncomingRedirect and update state on success', async () => {
            // Arrange
            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce(mockSessionInfo);
            const session = createSession();

            // Act
            await session.handleRedirectFromLogin();

            // Assert
            expect(AuthCodeGrant.onIncomingRedirect).toHaveBeenCalledTimes(1);
            expect(AuthCodeGrant.onIncomingRedirect).toHaveBeenCalledWith(mockClientDetails, mockDb);
            expect(session.isActive).toBe(true);
            expect(session.webId).toBe('https://alice.example/card#me');
            expect((session as any).information).toEqual(mockSessionInfo);
        });

        it('should remain inactive if onIncomingRedirect returns no token details', async () => {
            // Arrange
            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce({
                clientDetails: mockClientDetails // No tokenDetails
            });
            const session = createSession();

            // Act
            await session.handleRedirectFromLogin();

            // Assert
            expect(session.isActive).toBe(false);
            expect(session.webId).toBeUndefined();
            expect(mockDb.setItem).not.toHaveBeenCalled();
        });

    });

    // --- Restore Tests ---
    describe('restore', () => {
        it('should throw an error if no database is provided', async () => {
            const session = new SessionCore(mockClientDetails); // No database
            await expect(session.restore()).rejects.toThrow('Could not refresh tokens: missing database.');
        });

        it('should call renewTokens and update state on success', async () => {
            // Arrange
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
            const session = createSession();

            // Act
            await session.restore();

            // Assert
            expect(RefreshGrant.renewTokens).toHaveBeenCalledTimes(1);
            expect(RefreshGrant.renewTokens).toHaveBeenCalledWith(mockDb);
            expect(session.isActive).toBe(true);
            expect(session.webId).toBe('https://alice.example/card#me');
            expect((session as any).information.tokenDetails).toEqual(mockTokenDetails);
        });

        it('should remain inactive if renewTokens fails silently', async () => {
            // Arrange
            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(new Error('Refresh failed'));
            const session = createSession();
            const setTokenDetailsSpy = jest.spyOn(session as any, 'setTokenDetails');

            // Act
            await expect(session.restore()).rejects.toThrow('No session to restore.');

            // Assert
            expect(RefreshGrant.renewTokens).toHaveBeenCalledTimes(1);
            expect(session.isActive).toBe(false);
            expect(session.webId).toBeUndefined();
            expect(setTokenDetailsSpy).not.toHaveBeenCalled();
        });

        it('should reuse existing refresh promise if called multiple times', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
            const session = createSession();

            const promise1 = session.restore();
            const promise2 = session.restore();
            const promise3 = session.restore();

            await Promise.all([promise1, promise2, promise3]);

            expect(RefreshGrant.renewTokens).toHaveBeenCalledTimes(1);
        });

        it('should reject with error if renewTokens fails while session is active', async () => {
            const session = createSession();
            await activateSession(session);

            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(new Error('Token refresh failed'));

            await expect(session.restore()).rejects.toThrow('Token refresh failed');
            expect(session.isActive).toBe(true); // Session should remain active
        });
    });

    // --- Logout Tests ---
    describe('logout', () => {
        // Use activateSession helper in beforeEach for logout tests
        beforeEach(async () => {
            const tempSession = createSession(); // Need instance to activate
            await activateSession(tempSession);
            // Reset mocks possibly called during activation
            jest.clearAllMocks();
            // Re-mock database for specific logout checks
            mockDb = {
                init: jest.fn().mockResolvedValue(undefined),
                getItem: jest.fn().mockResolvedValue(null),
                setItem: jest.fn().mockResolvedValue(undefined),
                deleteItem: jest.fn().mockResolvedValue(undefined),
                clear: jest.fn().mockResolvedValue(undefined),
                close: jest.fn().mockResolvedValue(undefined),
            };
        });

        it('should reset session state', async () => {
            const session = createSession();
            await activateSession(session); // Ensure session is active before logout

            await session.logout();

            expect(session.isActive).toBe(false);
            expect(session.webId).toBeUndefined();
            expect((session as any).information.tokenDetails).toBeUndefined();
            expect((session as any).information.idpDetails).toBeUndefined();
        });

        it('should clear the database if provided', async () => {
            const session = createSession(mockClientDetails, { database: mockDb });
            await activateSession(session); // Ensure session is active

            await session.logout();

            expect(mockDb.clear).toHaveBeenCalledTimes(1);
        });

        it('should not attempt database clear if no database is provided', async () => {
            const session = new SessionCore(mockClientDetails); // No database
            await activateSession(session); // Ensure session is active

            await session.logout();

            // Need fresh mockDb instance to check calls for THIS test
            const freshMockDb = { clear: jest.fn() };
            expect(freshMockDb.clear).not.toHaveBeenCalled();
        });

        it('should preserve client_id if it is a URI', async () => {
            const session = createSession({ client_id: 'https://app.example/id' } as DereferencableIdClientDetails);
            await activateSession(session);

            await session.logout();

            expect((session as any).information.clientDetails.client_id).toBe('https://app.example/id');
        });

        it('should preserve client_id if it is not a URI', async () => {
            const session = createSession({ client_id: 'not-a-uri' } as DereferencableIdClientDetails);
            await activateSession(session);

            await session.logout();

            expect((session as any).information.clientDetails.client_id).toBe('not-a-uri');
        });

        it('should reject refresh promise if logout is called during token refresh', async () => {
            const session = createSession();

            let resolveRenew: any;
            (RefreshGrant.renewTokens as jest.Mock).mockReturnValueOnce(
                new Promise(resolve => { resolveRenew = resolve; })
            );

            const restorePromise = session.restore();
            await session.logout();

            await expect(restorePromise).rejects.toThrow('Logout during token refresh.');
        });
    });

    // --- authFetch Tests ---
    describe('authFetch', () => {
        const testUrl = 'https://resource.example/data';

        it('should add Authorization and DPoP headers when session is active', async () => {
            // Arrange
            const session = createSession();
            await activateSession(session);

            // Act
            await session.authFetch(testUrl);

            // Assert
            expect(fetch).toHaveBeenCalledTimes(1);
            const [, options] = (fetch as jest.Mock).mock.calls[0];
            const headers = options.headers as Headers; // Cast for type safety
            expect(headers.get('authorization')).toBe(`DPoP ${mockTokenDetails.access_token}`);
            expect(headers.get('dpop')).toBe('mocked.dpop.token');
            expect(jose.SignJWT).toHaveBeenCalled();
        });

        it('should NOT add Authorization headers when session is inactive', async () => {
            // Arrange
            const session = createSession();
            // No activateSession call needed, starts inactive

            // Act
            await session.authFetch(testUrl, { headers: new Headers() });

            // Assert
            expect(fetch).toHaveBeenCalledTimes(1);
            const [, options] = (fetch as jest.Mock).mock.calls[0];
            const headers = options.headers as Headers;
            expect(headers.get('authorization')).toBeNull();
            expect(headers.get('dpop')).toBeNull();
            expect(jose.SignJWT).not.toHaveBeenCalled();
        });

        it('should pass through init options correctly, preserving custom headers', async () => {
            // Arrange
            const session = createSession();
            await activateSession(session);
            const initOptions = {
                method: 'POST',
                body: 'test body',
                headers: new Headers({ // Use Headers object for proper testing
                    'Content-Type': 'text/plain',
                    'X-Custom': 'value',
                    'authorization': 'some-other-auth' // Test overwrite
                }),
            };

            // Act
            await session.authFetch(testUrl, initOptions);

            // Assert
            expect(fetch).toHaveBeenCalledTimes(1);
            const [, options] = (fetch as jest.Mock).mock.calls[0];
            const headers = options.headers as Headers;
            expect(options.method).toBe('POST');
            expect(options.body).toBe('test body');
            expect(headers.get('Content-Type')).toBe('text/plain');
            expect(headers.get('X-Custom')).toBe('value');
            // Verify auth headers overwrite/add correctly
            expect(headers.get('authorization')).toBe(`DPoP ${mockTokenDetails.access_token}`);
            expect(headers.get('dpop')).toBe('mocked.dpop.token');
        });

        it('should handle Request object as input', async () => {
            // Arrange
            const session = createSession();
            await activateSession(session);
            const request = new Request(testUrl, { method: 'PUT', headers: { 'X-Req': 'req-val' } });

            // Act
            await session.authFetch(request);

            // Assert
            expect(fetch).toHaveBeenCalledTimes(1);
            const [requestArg] = (fetch as jest.Mock).mock.calls[0];
            expect(requestArg).toBeInstanceOf(Request);
            expect(requestArg.method).toBe('PUT');
            expect(requestArg.headers.get('X-Req')).toBe('req-val');
            expect(requestArg.headers.get('authorization')).toBe(`DPoP ${mockTokenDetails.access_token}`);
            expect(requestArg.headers.get('dpop')).toBe('mocked.dpop.token');
        });

        it('should renew tokens if expired before making request', async () => {
            const session = createSession();
            await activateSession(session);

            // Make token expired
            const pastExp = Math.floor(Date.now() / 1000) - 100;
            (session as any).exp_ = pastExp;

            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

            await session.authFetch('https://resource.example/data');

            expect(RefreshGrant.renewTokens).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should wait for pending refresh before making request', async () => {
            const session = createSession();
            await activateSession(session);

            // Make token expired
            (session as any).exp_ = Math.floor(Date.now() / 1000) - 100;

            let resolveRenew: any;
            (RefreshGrant.renewTokens as jest.Mock).mockReturnValueOnce(
                new Promise(resolve => {
                    resolveRenew = () => resolve(mockTokenDetails);
                })
            );

            const fetchPromise = session.authFetch('https://resource.example/data');

            // Verify restore was called but fetch hasn't completed yet
            expect(RefreshGrant.renewTokens).toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();

            resolveRenew();
            await fetchPromise;

            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should wait for pending refresh for multiple requests', async () => {
            const session = createSession();
            await activateSession(session);

            // Make token expired
            (session as any).exp_ = Math.floor(Date.now() / 1000) - 100;

            let resolveRenew: any;
            (RefreshGrant.renewTokens as jest.Mock).mockReturnValueOnce(
                new Promise(resolve => {
                    resolveRenew = () => resolve(mockTokenDetails);
                })
            );

            const fetchPromise1 = session.authFetch('https://resource.example/data1');
            const fetchPromise2 = session.authFetch('https://resource.example/data2');

            // Verify restore was called but fetch hasn't completed yet
            expect(RefreshGrant.renewTokens).toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();

            resolveRenew();
            await Promise.all([fetchPromise1, fetchPromise2]);

            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should use custom dpopPayload when provided', async () => {
            const session = createSession();
            await activateSession(session);

            const customPayload = { htu: 'custom-uri', htm: 'CUSTOM', custom: 'value' };

            await session.authFetch('https://resource.example/data', {}, customPayload);

            expect(jose.SignJWT).toHaveBeenCalled();

            // Verify the payload passed to SignJWT includes custom fields
            const payload = (jose.SignJWT as jest.Mock).mock.calls[0][0];
            expect(payload).toMatchObject(customPayload);
            expect(payload.ath).toBe('mock-ath-value');
        });

        it('should handle URL object as input', async () => {
            const session = createSession();
            await activateSession(session);

            const url = new URL('https://resource.example/data');
            await session.authFetch(url);

            expect(fetch).toHaveBeenCalledTimes(1);
            const [fetchUrl] = (fetch as jest.Mock).mock.calls[0];
            expect(fetchUrl).toBeInstanceOf(URL);
        });
        describe('authFetch edge cases', () => {
            it('should handle authFetch with URL object and custom method in init', async () => {
                const session = createSession();
                await activateSession(session);

                const url = new URL('https://resource.example/data');
                await session.authFetch(url, { method: 'DELETE' });

                expect(jose.SignJWT).toHaveBeenCalled();
                const payload = (jose.SignJWT as jest.Mock).mock.calls[0][0];
                expect(payload.htm).toBe('DELETE');
            });

            it('should handle Request with different method in init overriding Request method', async () => {
                const session = createSession();
                await activateSession(session);

                const request = new Request('https://resource.example/data', { method: 'GET' });
                await session.authFetch(request, { method: 'POST' });

                const payload = (jose.SignJWT as jest.Mock).mock.calls[0][0];
                expect(payload.htm).toBe('POST');
            });
        });

        describe('getExpiresIn edge cases', () => {
            it('should return -1 when tokenDetails is undefined', () => {
                const session = createSession();
                expect((session as any).getExpiresIn()).toBe(-1);
            });
        });

        describe('restore edge cases', () => {
            it('should handle multiple concurrent restore calls when first call fails', async () => {
                const session = createSession();

                (RefreshGrant.renewTokens as jest.Mock)
                    .mockRejectedValueOnce(new Error('First failure'))
                    .mockResolvedValueOnce(mockTokenDetails);

                await expect(session.restore()).rejects.toThrow('No session to restore');

                // Second attempt should work
                await session.restore();
                expect(session.isActive).toBe(true);
            });
        });
    });

    // --- setTokenDetails Tests ---
    describe('setTokenDetails', () => {
        it('should update internal token details', () => {
            const session = createSession();

            (session as any).setTokenDetails(mockTokenDetails);
            expect((session as any).information.tokenDetails).toEqual(mockTokenDetails);
        });

        it('setTokenDetails should update session state on success', async () => {
            // Arrange
            const session = createSession();

            // Mock the dependencies of the private method that setTokenDetails calls

            // Spy on the internal _computeAth method to mock its implementation
            const computeAthSpy = jest.spyOn(session as any, '_computeAth')
                .mockResolvedValueOnce('mock-ath-value');

            // Act
            await (session as any).setTokenDetails(mockTokenDetails);

            // Assert
            // Check that the state was set correctly
            expect(session.isActive).toBe(true);
            expect(session.webId).toBe('https://alice.example/card#me');
            expect((session as any).currentAth_).toBe('mock-ath-value');
            expect(jose.decodeJwt).toHaveBeenCalledWith(mockTokenDetails.access_token);
            expect(computeAthSpy).toHaveBeenCalledWith(mockTokenDetails.access_token);
            expect(session.isExpired()).toBe(false);
        });
    });

    // --- getExpiresIn Tests ---
    describe('getExpiresIn', () => {
        it('should calculate remaining time correctly (returns seconds)', () => {
            const session = createSession();
            const ttl = 900;
            (session as any).exp_ = Math.floor(Date.now() / 1000) + ttl;
            expect((session as any).getExpiresIn()).toBe(ttl);
        });

        it('should return a negative value if expires_in is missing or invalid', () => {
            const session = createSession();

            (session as any).setTokenDetails({ ...mockTokenDetails, expires_in: undefined } as any);
            expect((session as any).getExpiresIn()).toBeLessThan(0);

            (session as any).setTokenDetails({ ...mockTokenDetails, expires_in: null } as any);
            expect((session as any).getExpiresIn()).toBeLessThan(0);
        });
    });

    describe('onSessionStateChange callback', () => {
        it('should call onSessionStateChange when login succeeds', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: callback
            });

            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce(mockSessionInfo);
            await session.handleRedirectFromLogin();

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should call onSessionStateChange when restore succeeds', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: callback
            });
            expect(session.isActive).toBe(false);

            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
            await session.restore();
            await flushPromises();

            expect(session.isActive).toBe(true);

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should NOT call onSessionStateChange when restore succeeds but state does not change', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: callback
            });
            await activateSession(session);
            expect(session.isActive).toBe(true); // Session is already active

            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

            await session.restore();

            // State didn't change (was active, still active)
            expect(session.isActive).toBe(true);
            // Callback should NOT be called
            expect(callback).not.toHaveBeenCalled();
        });

        it('should call onSessionStateChange on logout', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: callback
            });
            await activateSession(session);
            callback.mockClear();

            await session.logout();

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should not call onSessionStateChange if restore fails and session was not active', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: callback
            });

            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(new Error('Refresh failed'));
            await expect(session.restore()).rejects.toThrow();

            expect(callback).not.toHaveBeenCalled();
        });

        it('should not call onSessionStateChange if restore fails while session is already active', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: callback
            });
            await activateSession(session);
            callback.mockClear();

            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(new Error('Refresh failed'));

            await expect(session.restore()).rejects.toThrow('Refresh failed');
            expect(session.isActive).toBe(true);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should not call onSessionStateChange when handleRedirectFromLogin returns no tokens', async () => {
            const callback = jest.fn();
            const session = createSession(mockClientDetails, {
                onSessionStateChange: callback
            });

            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce({
                clientDetails: mockClientDetails
            });

            await session.handleRedirectFromLogin();

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('isExpired', () => {
        it('should return true when no exp is set', () => {
            const session = createSession();
            expect(session.isExpired()).toBe(true);
        });

        it('should return true when token is expired', async () => {
            const session = createSession();
            const pastExp = Math.floor(Date.now() / 1000) - 100;
            (jose.decodeJwt as jest.Mock).mockReturnValueOnce({
                webid: 'https://alice.example/card#me',
                exp: pastExp
            });

            await (session as any).setTokenDetails(mockTokenDetails);
            expect(session.isExpired()).toBe(true);
        });

        it('should return false when token is not expired', async () => {
            const session = createSession();
            const futureExp = Math.floor(Date.now() / 1000) + 3600;
            (jose.decodeJwt as jest.Mock).mockReturnValueOnce({
                webid: 'https://alice.example/card#me',
                exp: futureExp
            });

            await (session as any).setTokenDetails(mockTokenDetails);
            expect(session.isExpired()).toBe(false);
        });
    });

    describe('error propagation', () => {
        it('should propagate errors from onIncomingRedirect', async () => {
            const error = new Error('Invalid authorization code');
            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockRejectedValueOnce(error);
            const session = createSession();

            await expect(session.handleRedirectFromLogin()).rejects.toThrow('Invalid authorization code');
            expect(session.isActive).toBe(false);
        });

        it('should reject authFetch if token renewal fails', async () => {
            const session = createSession();
            await activateSession(session);
            (session as any).exp_ = Math.floor(Date.now() / 1000) - 100;

            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(new Error('Refresh denied'));

            await expect(session.authFetch('https://resource.example/data'))
                .rejects.toThrow('Refresh denied');
        });

        it('should propagate underlying fetch errors', async () => {
            const session = createSession();
            await activateSession(session);

            (fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network error'));

            await expect(session.authFetch('https://resource.example/data'))
                .rejects.toThrow('Network error');
        });
    });

    // --- Event Handling and Callbacks Tests ---
    describe('Event Handling and Callbacks', () => {
        // Helper to let promise chains in the SUT resolve fully
        const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

        // 1. Test the new EventTarget interface
        it('should dispatch STATE_CHANGE event when login succeeds', async () => {
            const listener = jest.fn();
            const session = createSession();
            session.addEventListener(SessionEvents.STATE_CHANGE, listener);

            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce(mockSessionInfo);
            await session.handleRedirectFromLogin();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(expect.any(CustomEvent));
        });

        it('should dispatch STATE_CHANGE event when restore changes state from inactive to active', async () => {
            const listener = jest.fn();
            const session = createSession();
            session.addEventListener(SessionEvents.STATE_CHANGE, listener);
            expect(session.isActive).toBe(false);

            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
            await session.restore();
            await flushPromises(); // The event is dispatched in a .finally() block

            expect(session.isActive).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should dispatch STATE_CHANGE event on logout', async () => {
            const listener = jest.fn();
            const session = createSession();
            await activateSession(session); // Start with an active session
            session.addEventListener(SessionEvents.STATE_CHANGE, listener);

            await session.logout();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should NOT dispatch STATE_CHANGE event when restore succeeds but state does not change', async () => {
            const listener = jest.fn();
            const session = createSession();
            await activateSession(session); // Session is already active
            session.addEventListener(SessionEvents.STATE_CHANGE, listener);

            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
            await session.restore();
            await flushPromises();

            // State didn't change (was active, is still active)
            expect(listener).not.toHaveBeenCalled();
        });

        it('should NOT dispatch STATE_CHANGE event if handleRedirectFromLogin returns no tokens', async () => {
            const listener = jest.fn();
            const session = createSession();
            session.addEventListener(SessionEvents.STATE_CHANGE, listener);

            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce({
                clientDetails: mockClientDetails // No tokens
            });
            await session.handleRedirectFromLogin();

            expect(listener).not.toHaveBeenCalled();
        });

        // 2. Test for backward compatibility with the old callback
        it('should call the legacy onSessionStateChange callback on successful login', async () => {
            const legacyCallback = jest.fn();
            const session = createSession(mockClientDetails, {
                database: mockDb,
                onSessionStateChange: legacyCallback
            });

            (AuthCodeGrant.onIncomingRedirect as jest.Mock).mockResolvedValueOnce(mockSessionInfo);
            await session.handleRedirectFromLogin();

            expect(legacyCallback).toHaveBeenCalledTimes(1);
        });
    });
});

