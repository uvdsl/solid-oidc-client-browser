import { renewTokens } from "../core/RefreshTokenGrant";
import { SessionIDB } from "./SessionDatabase";

let refreshTimeout: any;
let finalLogoutTimeout: any;

self.onmessage = (event) => {
    const { type, payload } = event.data;
    if (type === 'START') {
        // Use the received 'expiresIn' value to start the first scheduling cycle
        scheduleTimers(payload.expiresIn);
    }
    if (type === 'STOP') {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        if (finalLogoutTimeout) clearTimeout(finalLogoutTimeout);
    }
};

async function performRefresh() {
    const database = new SessionIDB();
    try {
        // The worker gets the refresh token itself from the database
        const tokenDetails = await renewTokens(database);
        // On success, post the complete new token details back to the main thread
        self.postMessage({ type: 'TOKEN_REFRESHED', payload: { tokenDetails } });
        // Reschedule the next cycle using the new token's lifetime
        scheduleTimers(tokenDetails.expires_in);
    } catch (error: any) {
        // The refresh failed. The finalLogoutTimeout is still ticking.
        self.postMessage({ type: 'EXPIRATION_WARNING', error: error.message });
    }
}


/**
 * Schedules timers based on a given lifetime in seconds.
 */
function scheduleTimers(expiresIn: number) {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    if (finalLogoutTimeout) clearTimeout(finalLogoutTimeout);

    const expiresInMs = expiresIn * 1000;
    
    // Schedule refresh (e.g., 120 seconds before expiration)
    const refreshBufferMs = 120 * 1000;
    const timeUntilRefresh = expiresInMs - refreshBufferMs;

    if (timeUntilRefresh > 0) {
        refreshTimeout = setTimeout(performRefresh, timeUntilRefresh);
    }

    // Schedule final logout (e.g., 5 seconds before expiration)
    const logoutBufferMs = 5 * 1000;
    const timeUntilLogout = expiresInMs - logoutBufferMs;

    if (timeUntilLogout > 0) {
        finalLogoutTimeout = setTimeout(() => {
            self.postMessage({ type: 'PLEASE_LOGOUT' });
        }, timeUntilLogout);
    }
}

