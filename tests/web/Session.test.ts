import { WebWorkerSession, WebWorkerSessionOptions } from '../../src/web/Session';
import { SessionCore } from '../../src/core/Session';
import { RefreshMessageTypes } from '../../src/web/RefreshWorker';
import { SessionIDB } from '../../src/web/SessionDatabase';
import { TokenDetails } from '../../src/core/SessionInformation';

// --- Mocks ---

jest.mock('../../src/web/RefreshWorkerUrl', () => ({
    __esModule: true,
    getWorkerUrl: () => new URL('http://localhost/mocked-from-file.js'),
}));

jest.mock('../../src/core/Session');
jest.mock('../../src/web/SessionDatabase');

const mockSharedWorkerPort = {
    postMessage: jest.fn(),
    onmessage: null as any,
    start: jest.fn(),
};

global.SharedWorker = jest.fn().mockImplementation(() => ({
    port: mockSharedWorkerPort,
})) as jest.Mock;

const mockAddEventListener = jest.spyOn(window, 'addEventListener').mockImplementation(jest.fn());

const mockTokenDetails: TokenDetails = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    dpop_key_pair: { publicKey: 'mockPublicKey', privateKey: 'mockPrivateKey' } as any, // Cast for simplicity
    token_type: "mock-token-type"
};

// --- Tests ---

describe('WebWorkerSession', () => {
    let session: WebWorkerSession;
    let mockOnSessionStateChange: jest.Mock;
    let mockOnSessionExpiration: jest.Mock;
    let mockOnSessionExpirationWarning: jest.Mock;

    const createSession = (options?: Partial<WebWorkerSessionOptions>) => {
        return new WebWorkerSession(undefined, {
            onSessionStateChange: mockOnSessionStateChange,
            onSessionExpiration: mockOnSessionExpiration,
            onSessionExpirationWarning: mockOnSessionExpirationWarning,
            ...options,
        });
    };

    const triggerWorkerMessage = async (data: any) => {
        await mockSharedWorkerPort.onmessage({ data });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockSharedWorkerPort.onmessage = null;

        mockOnSessionStateChange = jest.fn();
        mockOnSessionExpiration = jest.fn();
        mockOnSessionExpirationWarning = jest.fn();

        jest.spyOn(SessionCore.prototype, 'handleRedirectFromLogin').mockResolvedValue(undefined);
        jest.spyOn(SessionCore.prototype, 'logout').mockResolvedValue(undefined);
        jest.spyOn(SessionCore.prototype as any, 'setTokenDetails').mockResolvedValue(undefined);
        jest.spyOn(SessionCore.prototype as any, 'getTokenDetails').mockReturnValue(mockTokenDetails);

        Object.defineProperty(SessionCore.prototype, 'isActive', {
            get: jest.fn(() => true),
            configurable: true,
        });

        session = createSession();
    });

    describe('Constructor', () => {
        it('should create a SharedWorker with default URL', () => {
            expect(SharedWorker).toHaveBeenCalledWith(
                expect.any(URL),
                { type: 'module' }
            );
        });

        it('should create a SharedWorker with custom workerUrl', () => {
            const customUrl = 'http://custom.worker/url';
            createSession({ workerUrl: customUrl });

            expect(SharedWorker).toHaveBeenCalledWith(customUrl, { type: 'module' });
        });

        it('should create SessionIDB and pass to parent', () => {
            expect(SessionIDB).toHaveBeenCalled();
            expect(SessionCore).toHaveBeenCalledWith(
                undefined,
                expect.objectContaining({
                    database: expect.any(SessionIDB),
                })
            );
        });

        it('should store callback handlers', () => {
            expect((session as any).onSessionExpirationWarning).toBe(mockOnSessionExpirationWarning);
            expect((session as any).onSessionExpiration).toBe(mockOnSessionExpiration);
        });

        it('should assign onmessage handler to worker port', () => {
            expect(mockSharedWorkerPort.onmessage).toBeInstanceOf(Function);
        });

        it('should register beforeunload event listener', () => {
            expect(mockAddEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
        });

        it('should handle missing session options gracefully', () => {
            expect(() => new WebWorkerSession()).not.toThrow();
        });
    });

    describe('beforeunload event', () => {
        it('should post DISCONNECT message when window unloads', () => {
            const beforeUnloadHandler = mockAddEventListener.mock.calls.find(
                call => call[0] === 'beforeunload'
            )?.[1] as Function;

            expect(beforeUnloadHandler).toBeDefined();
            beforeUnloadHandler();

            expect(mockSharedWorkerPort.postMessage).toHaveBeenCalledWith({
                type: RefreshMessageTypes.DISCONNECT,
            });
        });
    });

    describe('handleRedirectFromLogin', () => {
        beforeEach(() => {
            jest.spyOn(session, 'getExpiresIn').mockReturnValue(3600);
        });

        it('should call parent handleRedirectFromLogin', async () => {
            await session.handleRedirectFromLogin();
            expect(SessionCore.prototype.handleRedirectFromLogin).toHaveBeenCalledTimes(1);
        });

        it('should schedule refresh when session is active', async () => {
            await session.handleRedirectFromLogin();

            expect(mockSharedWorkerPort.postMessage).toHaveBeenCalledWith({
                type: RefreshMessageTypes.SCHEDULE,
                payload: mockTokenDetails,
            });
        });

        it('should not schedule refresh when session is inactive', async () => {
            Object.defineProperty(session, 'isActive', {
                get: () => false,
                configurable: true,
            });

            await session.handleRedirectFromLogin();

            expect(mockSharedWorkerPort.postMessage).not.toHaveBeenCalled();
        });
    });

    describe('logout', () => {
        it('should post STOP message to worker', async () => {
            await session.logout();

            expect(mockSharedWorkerPort.postMessage).toHaveBeenCalledWith({
                type: RefreshMessageTypes.STOP,
            });
        });

        it('should call parent logout', async () => {
            await session.logout();
            expect(SessionCore.prototype.logout).toHaveBeenCalledTimes(1);
        });

        it('should post STOP before calling parent logout', async () => {
            const callOrder: string[] = [];

            mockSharedWorkerPort.postMessage.mockImplementation(() => {
                callOrder.push('STOP');
            });

            (SessionCore.prototype.logout as jest.Mock).mockImplementation(async () => {
                callOrder.push('logout');
            });

            await session.logout();

            expect(callOrder).toEqual(['STOP', 'logout']);
        });
    });

    describe('restore', () => {
        it('should post REFRESH message to worker', () => {
            session.restore();

            expect(mockSharedWorkerPort.postMessage).toHaveBeenCalledWith({
                type: RefreshMessageTypes.REFRESH,
            });
        });

        it('should return a promise', () => {
            const result = session.restore();
            expect(result).toBeInstanceOf(Promise);
        });

        it('should create new promise for each restore call', () => {
            const promise1 = session.restore();
            const promise2 = session.restore();

            expect(promise1).not.toBe(promise2);
        });
    });

    describe('handleWorkerMessage - TOKEN_DETAILS', () => {
        const mockTokenDetails = { access_token: 'token', expires_in: 3600 };

        it('should call setTokenDetails with payload', async () => {
            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails },
            });

            expect((session as any).setTokenDetails).toHaveBeenCalledWith(mockTokenDetails);
        });

        it('should resolve restore promise', async () => {
            const restorePromise = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails },
            });

            await expect(restorePromise).resolves.toBeUndefined();
        });

        it('should call onSessionStateChange when isActive changes from false to true', async () => {
            const isActiveSpy = jest.spyOn(session, 'isActive', 'get');
            isActiveSpy.mockReturnValueOnce(false).mockReturnValueOnce(true);
            (session as any).onSessionStateChange = mockOnSessionStateChange;

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails },
            });

            expect(mockOnSessionStateChange).toHaveBeenCalledTimes(1);
        });

        it('should call onSessionStateChange when isActive changes from true to false', async () => {
            const isActiveSpy = jest.spyOn(session, 'isActive', 'get');
            isActiveSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
            (session as any).onSessionStateChange = mockOnSessionStateChange;

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails },
            });

            expect(mockOnSessionStateChange).toHaveBeenCalledTimes(1);
        });

        it('should not call onSessionStateChange when isActive stays true', async () => {
            const isActiveSpy = jest.spyOn(session, 'isActive', 'get');
            isActiveSpy.mockReturnValue(true);
            (session as any).onSessionStateChange = mockOnSessionStateChange;

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails },
            });

            expect(mockOnSessionStateChange).not.toHaveBeenCalled();
        });

        it('should not call onSessionStateChange when isActive stays false', async () => {
            const isActiveSpy = jest.spyOn(session, 'isActive', 'get');
            isActiveSpy.mockReturnValue(false);
            (session as any).onSessionStateChange = mockOnSessionStateChange;

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails },
            });

            expect(mockOnSessionStateChange).not.toHaveBeenCalled();
        });

        it('should handle message when no restore promise exists', async () => {
            await expect(
                triggerWorkerMessage({
                    type: RefreshMessageTypes.TOKEN_DETAILS,
                    payload: { tokenDetails: mockTokenDetails },
                })
            ).resolves.not.toThrow();
        });
    });

    describe('handleWorkerMessage - ERROR_ON_REFRESH', () => {
        it('should call onSessionExpirationWarning when session is active', async () => {
            Object.defineProperty(session, 'isActive', {
                get: () => true,
                configurable: true,
            });

            await triggerWorkerMessage({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
                error: 'Refresh failed',
            });

            expect(mockOnSessionExpirationWarning).toHaveBeenCalledTimes(1);
        });

        it('should not call onSessionExpirationWarning when session is inactive', async () => {
            Object.defineProperty(session, 'isActive', {
                get: () => false,
                configurable: true,
            });

            await triggerWorkerMessage({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
                error: 'Refresh failed',
            });

            expect(mockOnSessionExpirationWarning).not.toHaveBeenCalled();
        });

        it('should reject restore promise with custom error when session is active', async () => {
            Object.defineProperty(session, 'isActive', {
                get: () => true,
                configurable: true,
            });

            const restorePromise = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
                error: 'Custom error message',
            });

            await expect(restorePromise).rejects.toThrow('Custom error message');
        });

        it('should reject restore promise with default error when session is active and no error provided', async () => {
            Object.defineProperty(session, 'isActive', {
                get: () => true,
                configurable: true,
            });

            const restorePromise = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
            });

            await expect(restorePromise).rejects.toThrow('Token refresh failed');
        });

        it('should reject restore promise with "No session to restore" when session is inactive', async () => {
            Object.defineProperty(session, 'isActive', {
                get: () => false,
                configurable: true,
            });

            const restorePromise = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
                error: 'Some error',
            });

            await expect(restorePromise).rejects.toThrow('No session to restore');
        });

        it('should handle message when no restore promise exists', async () => {
            await expect(
                triggerWorkerMessage({
                    type: RefreshMessageTypes.ERROR_ON_REFRESH,
                    error: 'Error',
                })
            ).resolves.not.toThrow();
        });
    });

    describe('handleWorkerMessage - EXPIRED', () => {
        it('should call onSessionExpiration', async () => {
            await triggerWorkerMessage({
                type: RefreshMessageTypes.EXPIRED,
            });

            expect(mockOnSessionExpiration).toHaveBeenCalledTimes(1);
        });

        it('should call logout', async () => {
            await triggerWorkerMessage({
                type: RefreshMessageTypes.EXPIRED,
            });

            expect(session.logout).toHaveBeenCalledTimes(1);
        });

        it('should reject restore promise with custom error', async () => {
            const restorePromise = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.EXPIRED,
                error: 'Session expired',
            });

            await expect(restorePromise).rejects.toThrow('Session expired');
        });

        it('should reject restore promise with default error when none provided', async () => {
            const restorePromise = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.EXPIRED,
            });

            await expect(restorePromise).rejects.toThrow('Token refresh failed');
        });

        it('should handle message when no restore promise exists', async () => {
            await expect(
                triggerWorkerMessage({
                    type: RefreshMessageTypes.EXPIRED,
                })
            ).resolves.not.toThrow();
        });

        it('should call onSessionExpiration before logout', async () => {
            const callOrder: string[] = [];

            mockOnSessionExpiration.mockImplementation(() => {
                callOrder.push('onSessionExpiration');
            });

            (SessionCore.prototype.logout as jest.Mock).mockImplementation(async () => {
                callOrder.push('logout');
            });

            await triggerWorkerMessage({
                type: RefreshMessageTypes.EXPIRED,
            });

            expect(callOrder).toEqual(['onSessionExpiration', 'logout']);
        });
    });

    describe('error handling', () => {
        it('should catch and log errors from handleWorkerMessage', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            (session as any).setTokenDetails = jest.fn().mockRejectedValue(new Error('Test error'));

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: {} },
            });

            // Give async error handler time to execute
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('integration scenarios', () => {
        it('should handle logout called before restore completes', async () => {
            const restorePromise = session.restore();
            await session.logout();

            expect(mockSharedWorkerPort.postMessage).toHaveBeenCalledWith({
                type: RefreshMessageTypes.STOP,
            });

            // Restore promise should still be pending
            expect(restorePromise).toBeInstanceOf(Promise);
        });

        it('should handle multiple sequential restore calls', async () => {
            const promise1 = session.restore();
            const promise2 = session.restore();

            await triggerWorkerMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: {} },
            });

            // Only the second promise should resolve (it overwrites the first)
            await expect(promise2).resolves.toBeUndefined();
        });
    });
});