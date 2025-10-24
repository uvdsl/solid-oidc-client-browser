import { decodeJwt } from "jose";
import { renewTokens } from "../core/RefreshTokenGrant";
import { TokenDetails } from "../core/SessionInformation";
import { SessionIDB } from "./SessionDatabase";

export enum RefreshMessageTypes {
    SCHEDULE = 'SCHEDULE',
    REFRESH = 'REFRESH',
    STOP = 'STOP',
    DISCONNECT = 'DISCONNECT',
    TOKEN_DETAILS = 'TOKEN_DETAILS',
    ERROR_ON_REFRESH = 'ERROR_ON_REFRESH',
    EXPIRED = 'EXPIRED'
}

interface SharedWorker { // to make tsc happy
    onconnect: (event: MessageEvent) => void;
}
declare const self: SharedWorker; // to make tsc happy

// A Set to store all connected ports (tabs)
const ports: any = new Set();
let refreshTimeout: any;
let finalLogoutTimeout: any;
let timersAreRunning = false;
let tokenDetails: TokenDetails | undefined = undefined;
let exp: number | undefined;

self.onconnect = (event: any) => {
    const port = event.ports[0];
    ports.add(port);

    port.onmessage = (event: any) => {
        const { type, payload } = event.data;

        if (type === RefreshMessageTypes.SCHEDULE && !timersAreRunning) {
            console.log(`RefreshWorker: Scheduling timers, expiry in ${payload.expiresIn}s`);
            scheduleTimers(payload.expiresIn);
            timersAreRunning = true;
        }

        if (type === RefreshMessageTypes.REFRESH) {
            if (tokenDetails && exp && !isTokenExpired(exp)) {
                console.log(`RefreshWorker: Provide current tokens to requesting port`);
                port.postMessage({ type: RefreshMessageTypes.TOKEN_DETAILS, payload: { tokenDetails } });
            } else {
                console.log(`RefreshWorker: Refreshing tokens`);
                performRefresh();
            }
        }

        if (type === RefreshMessageTypes.STOP) {
            console.log('RefreshWorker: Received STOP, clearing timers.');
            tokenDetails = undefined;
            exp = undefined;
            clearAllTimers();
        }

        if (type === RefreshMessageTypes.DISCONNECT) {
            ports.delete(port);
        }
    };

    port.start();

    port.onmessageerror = () => {
        console.log('Port error, removing');
        ports.delete(port);
    };
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
        tokenDetails = await renewTokens(database);
        exp = decodeJwt(tokenDetails.access_token).exp;
        // On success, broadcast the new token details to ALL tabs
        broadcast({ type: RefreshMessageTypes.TOKEN_DETAILS, payload: { tokenDetails } });
        
        // Reschedule the next cycle
        console.log(`RefreshWorker: Token refreshed, scheduling timers, expiry in ${tokenDetails.expires_in}s`);
        scheduleTimers(tokenDetails.expires_in);
    } catch (error: any) {
        // If refresh fails, warn ALL tabs
        broadcast({ type: RefreshMessageTypes.ERROR_ON_REFRESH, error: error.message });
    }
}

function clearAllTimers() {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    if (finalLogoutTimeout) clearTimeout(finalLogoutTimeout);
    timersAreRunning = false;
}

function scheduleTimers(expiresIn: number) {
    clearAllTimers();
    timersAreRunning = true;

    const expiresInMs = expiresIn * 1000;
    const REFRESH_THRESHOLD_RATIO = 0.8;
    const MINIMUM_REFRESH_BUFFER_MS = 30 * 1000;

    const timeUntilRefresh = REFRESH_THRESHOLD_RATIO * expiresInMs;
    if (timeUntilRefresh > MINIMUM_REFRESH_BUFFER_MS) {
        refreshTimeout = setTimeout(performRefresh, timeUntilRefresh);
    }

    const LOGOUT_WARNING_BUFFER_MS = 5 * 1000;
    const timeUntilLogout = expiresInMs - LOGOUT_WARNING_BUFFER_MS;
    finalLogoutTimeout = setTimeout(() => {
        tokenDetails = undefined;
        broadcast({ type: RefreshMessageTypes.EXPIRED });
    }, timeUntilLogout);
}

function isTokenExpired(exp: number, bufferSeconds = 0) {
    if (typeof exp !== 'number' || isNaN(exp)) {
      return true;
    }
    const currentTimeSeconds = Math.floor(Date.now() / 1000);
    return exp < (currentTimeSeconds + bufferSeconds);
  }