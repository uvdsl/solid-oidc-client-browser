import { renewTokens } from "../core/RefreshTokenGrant";
import { SessionIDB } from "./SessionDatabase";

// A Set to store all connected ports (tabs)
const ports: any = new Set();
let refreshTimeout: any;
let finalLogoutTimeout: any;
let timersAreRunning = false;

// @ts-ignore
self.onconnect = (event: any) => {
    const port = event.ports[0];
    // Add each new connection to our set of ports
    ports.add(port);

    port.onmessage = (event: any) => {
        const { type, payload } = event.data;

        if (type === 'START' && !timersAreRunning) {
            console.log(`RefreshWorker: Received START, scheduling timers, expiry in ${payload.expiresIn}s`);
            scheduleTimers(payload.expiresIn);
            timersAreRunning = true;
        }

        if (type === 'STOP') {
            console.log('RefreshWorker: Received STOP, clearing timers.');
            clearAllTimers();
        }

        // Listen for a message from the tab that it's closing
        if (type === 'DISCONNECT') {
            ports.delete(port);
        }
    };

    port.start();
};

function broadcast(message: any) {
    console.log(`RefreshWorker: Broadcasting message of type ${message.type} to ${ports.size} port(s).`);
    for (const port of ports) {
        port.postMessage(message);
    }
}

async function performRefresh() {
    const database = new SessionIDB();
    try {
        const tokenDetails = await renewTokens(database);

        // On success, broadcast the new token details to ALL tabs
        broadcast({ type: 'TOKEN_REFRESHED', payload: { tokenDetails } });

        // Reschedule the next cycle
        console.log(`RefreshWorker: Token refreshed, scheduling timers, expiry in ${tokenDetails.expires_in}s`);
        scheduleTimers(tokenDetails.expires_in);
    } catch (error: any) {
        // If refresh fails, warn ALL tabs
        broadcast({ type: 'EXPIRATION_WARNING', error: error.message });
    }
}

function clearAllTimers() {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    if (finalLogoutTimeout) clearTimeout(finalLogoutTimeout);
    timersAreRunning = false;
}

function scheduleTimers(expiresIn: number) {
    clearAllTimers(); // Clear any existing timers before setting new ones
    timersAreRunning = true;

    const expiresInMs = expiresIn * 1000;

    // Schedule refresh (e.g., 120 seconds before expiration)
    const timeUntilRefresh = 0.8 * expiresInMs;

    if (timeUntilRefresh > 30) {
        refreshTimeout = setTimeout(performRefresh, timeUntilRefresh);
    }

    // Schedule final logout warning (e.g., 5 seconds before expiration)
    const logoutBufferMs = 5 * 1000;
    const timeUntilLogout = expiresInMs - logoutBufferMs;

    finalLogoutTimeout = setTimeout(() => {
        // Broadcast the logout warning to ALL tabs
        broadcast({ type: 'PLEASE_LOGOUT' });
    }, timeUntilLogout);
}