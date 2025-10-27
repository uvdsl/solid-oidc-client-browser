import { Refresher, RefreshMessageTypes } from '../../src/web/RefreshWorker';
import * as RefreshGrant from '../../src/core/RefreshTokenGrant';
import * as jose from 'jose';
import { SessionDatabase } from '../../src/core/SessionDatabase';

jest.mock('../../src/core/RefreshTokenGrant');
jest.mock('jose');
jest.useFakeTimers();

describe('Refresher', () => {
    let mockBroadcast: jest.Mock;
    let mockDb: jest.Mocked<SessionDatabase>;
    let refresher: Refresher;
    let mockPort: jest.Mocked<any>;

    const mockTokenDetails = {
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expires_in: 3600,
        dpop_key_pair: { publicKey: 'mock', privateKey: 'mock' } as any,
        token_type: 'DPoP'
    };

    const createMockTokenDetails = (overrides = {}) => ({
        ...mockTokenDetails,
        ...overrides
    });

    const advanceToRefreshTime = (expiresIn: number) => {
        jest.advanceTimersByTime(expiresIn * 1000 * 0.8);
    };

    const advanceToLogoutTime = (expiresIn: number) => {
        jest.advanceTimersByTime((expiresIn * 1000) - (5 * 1000));
    };

    beforeEach(() => {
        mockBroadcast = jest.fn();
        mockDb = {
            init: jest.fn().mockResolvedValue(undefined),
            getItem: jest.fn().mockResolvedValue(null),
            setItem: jest.fn().mockResolvedValue(undefined),
            deleteItem: jest.fn().mockResolvedValue(undefined),
            clear: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        };

        refresher = new Refresher(mockBroadcast, mockDb);

        (jose.decodeJwt as jest.Mock).mockReturnValue({
            exp: Math.floor(Date.now() / 1000) + 3600
        });

        mockPort = { postMessage: jest.fn() };

        jest.spyOn(global, 'setTimeout');
        jest.spyOn(global, 'clearTimeout');
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with broadcast and database', () => {
            expect(refresher).toBeInstanceOf(Refresher);
            expect(refresher.getTimersAreRunning()).toBe(false);
            expect(refresher.getTokenDetails()).toBeUndefined();
        });
    });

    describe('handleSchedule', () => {
        it('should schedule refresh and logout timers on first call', async () => {
            await refresher.handleSchedule(3600);

            expect(refresher.getTimersAreRunning()).toBe(true);
            expect(setTimeout).toHaveBeenCalledTimes(2);
        });

        it('should not schedule timers if already running', async () => {
            await refresher.handleSchedule(3600);
            jest.clearAllMocks();

            await refresher.handleSchedule(3600);

            expect(setTimeout).not.toHaveBeenCalled();
            expect(refresher.getTimersAreRunning()).toBe(true);
        });

        it('should schedule refresh at 80% of expiry time', async () => {
            const expiresIn = 1000;
            await refresher.handleSchedule(expiresIn);

            const expectedRefreshTime = expiresIn * 1000 * 0.8;
            expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                expectedRefreshTime
            );
        });

        it('should schedule logout at expiry minus 5 second buffer', async () => {
            const expiresIn = 1000;
            await refresher.handleSchedule(expiresIn);

            const expectedLogoutTime = (expiresIn * 1000) - (5 * 1000);
            expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                expectedLogoutTime
            );
        });

        it('should not schedule refresh if time is below 30 second minimum buffer', async () => {
            await refresher.handleSchedule(30);

            // Should only schedule logout timer, not refresh (30s * 0.8 = 24s < 30s minimum)
            expect(setTimeout).toHaveBeenCalledTimes(1);
        });

        it('should schedule refresh when exactly at minimum buffer threshold', async () => {
            // 37.5 seconds * 0.8 = 30 seconds (exactly at threshold)
            await refresher.handleSchedule(37.5);

            expect(setTimeout).toHaveBeenCalledTimes(1); // Still only logout since not > 30s
        });

        it('should schedule refresh when above minimum buffer threshold', async () => {
            // 40 seconds * 0.8 = 32 seconds (above 30s threshold)
            await refresher.handleSchedule(40);

            expect(setTimeout).toHaveBeenCalledTimes(2); // Both refresh and logout
        });

        it('should handle very large expiry times', async () => {
            const largeExpiry = 86400; // 24 hours
            await refresher.handleSchedule(largeExpiry);

            expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                largeExpiry * 1000 * 0.8
            );
        });

        it('should handle very small expiry times', async () => {
            await refresher.handleSchedule(10);

            // 10s * 0.8 = 8s < 30s minimum, so only logout timer
            expect(setTimeout).toHaveBeenCalledTimes(1);
        });
    });

    describe('handleRefresh', () => {
        describe('with cached valid tokens', () => {
            beforeEach(async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
                await refresher.handleSchedule(3600);
                advanceToRefreshTime(3600);
                await Promise.resolve();
                mockBroadcast.mockClear();
                mockPort.postMessage.mockClear();
            });

            it('should return cached tokens if still valid', async () => {
                await refresher.handleRefresh(mockPort);

                expect(mockPort.postMessage).toHaveBeenCalledWith({
                    type: RefreshMessageTypes.TOKEN_DETAILS,
                    payload: { tokenDetails: mockTokenDetails }
                });
            });

            it('should not call renewTokens if tokens are valid', async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockClear();
                
                await refresher.handleRefresh(mockPort);

                expect(RefreshGrant.renewTokens).not.toHaveBeenCalled();
            });

            it('should not broadcast when returning cached tokens', async () => {
                await refresher.handleRefresh(mockPort);

                expect(mockBroadcast).not.toHaveBeenCalled();
            });
        });

        describe('with no cached tokens', () => {
            it('should perform refresh when tokenDetails is undefined', async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

                await refresher.handleRefresh(mockPort);

                expect(RefreshGrant.renewTokens).toHaveBeenCalledWith(mockDb);
            });

            it('should broadcast new tokens on successful refresh', async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                expect(mockBroadcast).toHaveBeenCalledWith({
                    type: RefreshMessageTypes.TOKEN_DETAILS,
                    payload: { tokenDetails: mockTokenDetails }
                });
            });

            it('should schedule new timers after successful refresh', async () => {
                const newTokens = createMockTokenDetails({ expires_in: 7200 });
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(newTokens);

                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                // clearTimeout called twice (old timers) + setTimeout called twice (new timers)
                expect(setTimeout).toHaveBeenCalledWith(
                    expect.any(Function),
                    7200 * 1000 * 0.8
                );
            });
        });

        describe('with expired tokens', () => {
            it('should perform refresh if tokens are expired', async () => {
                (jose.decodeJwt as jest.Mock).mockReturnValue({
                    exp: Math.floor(Date.now() / 1000) - 100
                });
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

                await refresher.handleRefresh(mockPort);

                expect(RefreshGrant.renewTokens).toHaveBeenCalledWith(mockDb);
            });

            it('should decode JWT to check expiry', async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
                
                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                expect(jose.decodeJwt).toHaveBeenCalledWith(mockTokenDetails.access_token);
            });
        });

        describe('error handling', () => {
            it('should broadcast error on refresh failure', async () => {
                const error = new Error('Refresh failed');
                (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(error);

                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                expect(mockBroadcast).toHaveBeenCalledWith({
                    type: RefreshMessageTypes.ERROR_ON_REFRESH,
                    error: 'Refresh failed'
                });
            });

            it('should broadcast error message from error object', async () => {
                const error = new Error('Custom error message');
                (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(error);

                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                expect(mockBroadcast).toHaveBeenCalledWith({
                    type: RefreshMessageTypes.ERROR_ON_REFRESH,
                    error: 'Custom error message'
                });
            });

            it('should not schedule new timers on refresh failure', async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(
                    new Error('Refresh failed')
                );
                jest.clearAllMocks();

                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                expect(setTimeout).not.toHaveBeenCalled();
            });

            it('should not send TOKEN_DETAILS to requesting port on failure', async () => {
                (RefreshGrant.renewTokens as jest.Mock).mockRejectedValueOnce(
                    new Error('Refresh failed')
                );

                await refresher.handleRefresh(mockPort);
                await Promise.resolve();

                expect(mockPort.postMessage).not.toHaveBeenCalledWith(
                    expect.objectContaining({ type: RefreshMessageTypes.TOKEN_DETAILS })
                );
            });
        });

        describe('token expiry edge cases', () => {
            it('should handle token with invalid exp claim', async () => {
                (jose.decodeJwt as jest.Mock).mockReturnValue({ exp: NaN });
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

                await refresher.handleRefresh(mockPort);

                expect(RefreshGrant.renewTokens).toHaveBeenCalled();
            });

            it('should handle token with undefined exp claim', async () => {
                (jose.decodeJwt as jest.Mock).mockReturnValue({ exp: undefined });
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

                await refresher.handleRefresh(mockPort);

                expect(RefreshGrant.renewTokens).toHaveBeenCalled();
            });

            it('should handle token with string exp claim', async () => {
                (jose.decodeJwt as jest.Mock).mockReturnValue({ exp: "invalid" as any });
                (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);

                await refresher.handleRefresh(mockPort);

                expect(RefreshGrant.renewTokens).toHaveBeenCalled();
            });
        });
    });

    describe('handleStop', () => {
        it('should clear all timers', async () => {
            await refresher.handleSchedule(3600);
            jest.clearAllMocks();

            refresher.handleStop();

            expect(clearTimeout).toHaveBeenCalledTimes(2);
        });

        it('should reset timersAreRunning flag', async () => {
            await refresher.handleSchedule(3600);

            refresher.handleStop();

            expect(refresher.getTimersAreRunning()).toBe(false);
        });

        it('should clear tokenDetails', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValueOnce(mockTokenDetails);
            await refresher.handleSchedule(3600);
            advanceToRefreshTime(3600);
            await Promise.resolve();

            refresher.handleStop();

            expect(refresher.getTokenDetails()).toBeUndefined();
        });

        it('should allow rescheduling after stop', async () => {
            await refresher.handleSchedule(3600);
            refresher.handleStop();
            jest.clearAllMocks();

            await refresher.handleSchedule(3600);

            expect(setTimeout).toHaveBeenCalledTimes(2);
            expect(refresher.getTimersAreRunning()).toBe(true);
        });

        it('should be safe to call multiple times', () => {
            refresher.handleStop();
            refresher.handleStop();

            expect(refresher.getTimersAreRunning()).toBe(false);
        });

        it('should be safe to call without scheduled timers', () => {
            expect(() => refresher.handleStop()).not.toThrow();
        });
    });

    describe('automatic refresh timer', () => {
        it('should automatically refresh tokens at scheduled time', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValue(mockTokenDetails);

            await refresher.handleSchedule(1000);
            advanceToRefreshTime(1000);
            await Promise.resolve();

            expect(RefreshGrant.renewTokens).toHaveBeenCalledWith(mockDb);
        });

        it('should broadcast TOKEN_DETAILS after automatic refresh', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValue(mockTokenDetails);

            await refresher.handleSchedule(1000);
            advanceToRefreshTime(1000);
            await Promise.resolve();

            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails }
            });
        });

        it('should reschedule timers after successful automatic refresh', async () => {
            const newTokens = createMockTokenDetails({ expires_in: 2000 });
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValue(newTokens);

            await refresher.handleSchedule(1000);
            jest.clearAllMocks();
            
            advanceToRefreshTime(1000);
            await Promise.resolve();

            // Should reschedule with new expiry time
            expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                2000 * 1000 * 0.8
            );
        });

        it('should broadcast ERROR_ON_REFRESH if automatic refresh fails', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValue(
                new Error('Network error')
            );

            await refresher.handleSchedule(1000);
            advanceToRefreshTime(1000);
            await Promise.resolve();

            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
                error: 'Network error'
            });
        });

        it('should not reschedule if automatic refresh fails', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockRejectedValue(
                new Error('Network error')
            );

            await refresher.handleSchedule(1000);
            jest.clearAllMocks();
            
            advanceToRefreshTime(1000);
            await Promise.resolve();

            // Should not have rescheduled new timers
            expect(setTimeout).not.toHaveBeenCalled();
        });
    });

    describe('automatic logout timer', () => {
        it('should broadcast EXPIRED at final logout time', async () => {
            await refresher.handleSchedule(1000);

            advanceToLogoutTime(1000);

            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.EXPIRED
            });
        });

        it('should clear tokenDetails at logout time', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValue(mockTokenDetails);
            await refresher.handleSchedule(1000);
            
            // Advance to refresh time (800s)
            advanceToRefreshTime(1000);
            await Promise.resolve();

            // After refresh, new timers are scheduled with mockTokenDetails.expires_in = 3600s
            // Logout happens at 3600s - 5s = 3595s from the refresh
            jest.advanceTimersByTime((3600 - 5) * 1000);

            expect(refresher.getTokenDetails()).toBeUndefined();
        });

        it('should trigger logout before expiry with 5 second buffer', async () => {
            const expiresIn = 1000;
            await refresher.handleSchedule(expiresIn);

            const expectedTime = (expiresIn * 1000) - (5 * 1000);
            jest.advanceTimersByTime(expectedTime);

            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.EXPIRED
            });
        });
    });

    describe('integration scenarios', () => {
        it('should handle full refresh cycle', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValue(mockTokenDetails);

            // Initial schedule
            await refresher.handleSchedule(1000);
            expect(refresher.getTimersAreRunning()).toBe(true);

            // Wait for automatic refresh (at 800s)
            advanceToRefreshTime(1000);
            await Promise.resolve();
            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails }
            });

            mockBroadcast.mockClear();

            // Wait for logout (from 800s to 995s = 195s more)
            // After refresh, new timers are scheduled based on mockTokenDetails.expires_in (3600s)
            // So we need to advance to 3595s (3600 - 5) from the refresh point
            jest.advanceTimersByTime((3600 - 5) * 1000);
            
            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.EXPIRED
            });
        });

        it('should handle manual refresh during scheduled refresh cycle', async () => {
            (RefreshGrant.renewTokens as jest.Mock)
                .mockResolvedValueOnce(mockTokenDetails)
                .mockResolvedValueOnce(createMockTokenDetails({ access_token: 'manual-token' }));

            await refresher.handleSchedule(1000);
            advanceToRefreshTime(1000);
            await Promise.resolve();
            mockBroadcast.mockClear();

            // Manual refresh should return cached tokens
            await refresher.handleRefresh(mockPort);

            expect(mockPort.postMessage).toHaveBeenCalledWith({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: mockTokenDetails }
            });
            expect(RefreshGrant.renewTokens).toHaveBeenCalledTimes(1); // Only automatic refresh
        });

        it('should handle stop during active timers', async () => {
            (RefreshGrant.renewTokens as jest.Mock).mockResolvedValue(mockTokenDetails);

            await refresher.handleSchedule(1000);
            refresher.handleStop();

            // Advance past refresh time
            advanceToRefreshTime(1000);
            await Promise.resolve();

            // Should not have refreshed since timers were stopped
            expect(RefreshGrant.renewTokens).not.toHaveBeenCalled();
        });

        it('should handle multiple refresh attempts with different expiry times', async () => {
            const firstTokens = createMockTokenDetails({ 
                expires_in: 1000,
                access_token: 'first-token'
            });
            const secondTokens = createMockTokenDetails({ 
                expires_in: 2000,
                access_token: 'second-token'
            });
            
            // Mock renewTokens to return different tokens each time
            const renewTokensMock = RefreshGrant.renewTokens as jest.Mock;
            renewTokensMock.mockReset(); // Clear any previous mock state
            renewTokensMock
                .mockResolvedValueOnce(firstTokens)
                .mockResolvedValueOnce(secondTokens);
            
            // Mock JWT decode to return appropriate exp values
            const decodeJwtMock = jose.decodeJwt as jest.Mock;
            const baseTime = Math.floor(Date.now() / 1000);
            decodeJwtMock.mockReset(); // Clear any previous mock state
            decodeJwtMock
                .mockReturnValueOnce({ exp: baseTime + 1000 })
                .mockReturnValueOnce({ exp: baseTime + 2000 });

            // Step 1: Initial schedule with 1000s - schedules refresh at 800s
            await refresher.handleSchedule(1000);
            
            // Step 2: Advance to first refresh time (800s)
            jest.advanceTimersByTime(800 * 1000);
            await Promise.resolve();

            // Step 3: First refresh completes, broadcasts firstTokens
            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: firstTokens }
            });

            // After first refresh, timers rescheduled with firstTokens.expires_in = 1000s
            // Next refresh at: 1000 * 0.8 = 800s from now
            mockBroadcast.mockClear();
            
            // Step 4: Advance to second refresh time
            jest.advanceTimersByTime(800 * 1000);
            await Promise.resolve();

            // Step 5: Second refresh completes, broadcasts secondTokens
            expect(mockBroadcast).toHaveBeenCalledWith({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: secondTokens }
            });
        });
    });

    describe('timer management', () => {
        it('should clear previous timers when rescheduling', async () => {
            await refresher.handleSchedule(1000);

            refresher.handleStop();
            
            await refresher.handleSchedule(2000);

            // clearTimeout should have been called by both handleStop and the new scheduleTimers
            expect(clearTimeout).toHaveBeenCalled();
            expect(setTimeout).toHaveBeenCalledTimes(4); // 2 from first schedule + 2 from second
        });

        it('should only run one refresh timer at a time', async () => {
            await refresher.handleSchedule(1000);
            
            // Try to schedule again
            await refresher.handleSchedule(2000);

            // Should still only have 2 timers (from first schedule)
            expect(setTimeout).toHaveBeenCalledTimes(2);
        });
    });
});