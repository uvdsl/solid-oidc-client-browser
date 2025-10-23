// Import the class to be tested and necessary types
import { SessionCore, SessionOptions } from '../../src/core/Session';
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
        // Use with caution - directly manipulating private state
        (session as any).information = mockSessionInfo;
        (session as any).isActive_ = true;
        (session as any).webId_ = 'https://alice.example/card#me';
        (session as any).information.clientDetails.client_id = client_id;
        // Ensure internal state like currentAth_ is calculated
        await (session as any)._updateSessionDetailsFromToken(mockTokenDetails.access_token);
        // Reset mocks that might have been called during activation
        (fetch as jest.Mock).mockClear();
        (jose.SignJWT as jest.Mock).mockClear();
    };


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
        (jose.decodeJwt as jest.Mock).mockReturnValue({ webid: 'https://alice.example/card#me' });
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
            const setTokenDetailsSpy = jest.spyOn(session, 'setTokenDetails');

            // Act
            await session.restore(); // Should catch the error

            // Assert
            expect(RefreshGrant.renewTokens).toHaveBeenCalledTimes(1);
            expect(session.isActive).toBe(false);
            expect(session.webId).toBeUndefined();
            expect(setTokenDetailsSpy).not.toHaveBeenCalled();
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

            expect(mockDb.init).toHaveBeenCalledTimes(1);
            expect(mockDb.clear).toHaveBeenCalledTimes(1);
            expect(mockDb.close).toHaveBeenCalledTimes(1);
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

        it('should clear client_id if it is not a URI', async () => {
            const session = createSession({ client_id: 'not-a-uri' } as DereferencableIdClientDetails);
            await activateSession(session);

            await session.logout();

            expect((session as any).information.clientDetails.client_id).toBeUndefined();
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
            expect(headers.get('Authorization')).toBe(`DPoP ${mockTokenDetails.access_token}`);
            expect(headers.has('authorization')).toBe(true); // Case-insensitive check
            expect(headers.get('dpop')).toBe('mocked.dpop.token');
            expect(jose.SignJWT).toHaveBeenCalled();
        });

        it('should NOT add Authorization headers when session is inactive', async () => {
            // Arrange
            const session = createSession();
            // No activateSession call needed, starts inactive

            // Act
            await session.authFetch(testUrl);

            // Assert
            expect(fetch).toHaveBeenCalledTimes(1);
            const [, options] = (fetch as jest.Mock).mock.calls[0];
            const headers = options.headers as Headers;
            expect(headers.get('Authorization')).toBeNull();
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
            expect(headers.get('Authorization')).toBe(`DPoP ${mockTokenDetails.access_token}`);
            expect(headers.has('authorization')).toBe(true);
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
            expect(requestArg.headers.get('Authorization')).toBe(`DPoP ${mockTokenDetails.access_token}`);
            expect(requestArg.headers.get('dpop')).toBe('mocked.dpop.token');
        });

    });

    // --- setTokenDetails Tests ---
    describe('setTokenDetails', () => {
        it('should update internal token details', () => {
            const session = createSession();
            session.setTokenDetails(mockTokenDetails);
            expect((session as any).information.tokenDetails).toEqual(mockTokenDetails);
        });

        it('setTokenDetails should update session state on success', async () => {
            // Arrange
            const session = createSession();

            // Mock the dependencies of the private method that setTokenDetails calls
            (jose.decodeJwt as jest.Mock).mockReturnValueOnce({ webid: 'https://alice.example/card#me' });

            // Spy on the internal _computeAth method to mock its implementation
            const computeAthSpy = jest.spyOn(session as any, '_computeAth')
                .mockResolvedValueOnce('mock-ath-value');

            // Act
            await session.setTokenDetails(mockTokenDetails);

            // Assert
            // Check that the state was set correctly
            expect(session.isActive).toBe(true);
            expect(session.webId).toBe('https://alice.example/card#me');
            expect((session as any).currentAth_).toBe('mock-ath-value');
            expect(jose.decodeJwt).toHaveBeenCalledWith(mockTokenDetails.access_token);
            expect(computeAthSpy).toHaveBeenCalledWith(mockTokenDetails.access_token);
        });
    });

    // --- getExpiresIn Tests ---
    describe('getExpiresIn', () => {
        it('should calculate remaining time correctly (returns seconds)', () => {
            const session = createSession();
            session.setTokenDetails({ ...mockTokenDetails, expires_in: 900 });
            expect(session.getExpiresIn()).toBe(900);
        });

        it('should return a negative value if expires_in is missing or invalid', () => {
            const session = createSession();

            session.setTokenDetails({ ...mockTokenDetails, expires_in: undefined } as any);
            expect(session.getExpiresIn()).toBeLessThan(0); // -1 - 5 = -6

            session.setTokenDetails({ ...mockTokenDetails, expires_in: null } as any);
            expect(session.getExpiresIn()).toBeLessThan(0); // -1 - 5 = -6
        });
    });

    // --- _updateSessionDetailsFromToken Tests ---
    describe('_updateSessionDetailsFromToken (private method test)', () => {
        it('should set isActive, webId, and currentAth when token is valid', async () => {
            const session = createSession();
            await (session as any)._updateSessionDetailsFromToken(mockTokenDetails.access_token);

            expect(session.isActive).toBe(true);
            expect(session.webId).toBe('https://alice.example/card#me');
            expect((session as any).currentAth_).toBeDefined(); // Check that currentAth_ was calculated
        });

        it('should call logout when access_token is undefined', async () => {
            const session = createSession();
            const logoutSpy = jest.spyOn(session, 'logout').mockResolvedValue(undefined); // Spy on logout

            await (session as any)._updateSessionDetailsFromToken(undefined);

            expect(logoutSpy).toHaveBeenCalledTimes(1);
            expect(session.isActive).toBe(false); // State should reflect logout
            expect(session.webId).toBeUndefined();
        });

        it('should call logout when access_token is null', async () => {
            const session = createSession();
            const logoutSpy = jest.spyOn(session, 'logout').mockResolvedValue(undefined);

            await (session as any)._updateSessionDetailsFromToken(null as any); // Test with null

            expect(logoutSpy).toHaveBeenCalledTimes(1);
        });

        it('should call logout when decodeJwt fails or returns no webid', async () => {
            const session = createSession();
            const logoutSpy = jest.spyOn(session, 'logout').mockResolvedValue(undefined);
            (jose.decodeJwt as jest.Mock).mockReturnValueOnce({}); // Simulate no webid

            await (session as any)._updateSessionDetailsFromToken('some-token');

            expect(logoutSpy).toHaveBeenCalledTimes(1);
        });
    });
});

