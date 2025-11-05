import { decodeJwt } from "jose";
import { renewTokens } from "../core/RefreshTokenGrant";
import { TokenDetails } from "../core/SessionInformation";
import { SessionIDB } from "./SessionDatabase";
import { SessionDatabase } from "../core/SessionDatabase";
import { RefreshMessageTypes } from "./RefreshMessageTypes";

interface SharedWorker { // to make tsc happy
    onconnect: (event: MessageEvent) => void;
}
declare const self: SharedWorker; // to make tsc happy

// A Set to store all connected ports (tabs)
const ports: any = new Set();
const broadcast = (message: string) => {
    for (const p of ports) {
        p.postMessage(message);
    }
};

let refresher: Refresher;

self.onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    ports.add(port);
    // lazy init
    if (!refresher) {
        refresher = new Refresher(broadcast, new SessionIDB());
    }
    // handle messages
    port.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data;
        switch (type) {
            case RefreshMessageTypes.SCHEDULE:
                refresher.handleSchedule(payload);
                break;
            case RefreshMessageTypes.REFRESH:
                refresher.handleRefresh(port);
                break;
            case RefreshMessageTypes.STOP:
                refresher.handleStop();
                break;
            case RefreshMessageTypes.DISCONNECT:
                ports.delete(port);
                break;
        }
    };
    port.onmessageerror = () => ports.delete(port);
    port.start();
};

export class Refresher {
    private tokenDetails?: TokenDetails;
    private exp?: number;
    private refreshTimeout?: any;
    private finalLogoutTimeout?: any;
    private timersAreRunning = false;

    private broadcast: (message: any) => void;
    private database: SessionDatabase;

    private refreshPromise?: Promise<void>;


    constructor(
        broadcast: (message: string) => void,
        database: SessionDatabase
    ) {
        this.broadcast = broadcast;
        this.database = database;
    }

    async handleSchedule(tokenDetails: TokenDetails) {
        this.tokenDetails = tokenDetails;
        this.exp = decodeJwt(this.tokenDetails.access_token).exp;
        this.broadcast({
            type: RefreshMessageTypes.TOKEN_DETAILS,
            payload: { tokenDetails: this.tokenDetails }
        });
        console.log(`[RefreshWorker] Scheduling timers, expiry in ${this.tokenDetails.expires_in}s`);
        this.scheduleTimers(this.tokenDetails.expires_in);
        this.timersAreRunning = true;
    }

    async handleRefresh(requestingPort: any): Promise<void> {
        if (this.tokenDetails && this.exp && !this.isTokenExpired(this.exp)) {
            console.log(`[RefreshWorker] Providing current tokens`);
            requestingPort.postMessage({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: this.tokenDetails }
            });
        } else {
            console.log(`[RefreshWorker] Refreshing tokens`);
            this.performRefresh();
        }
    }

    handleStop() {
        if (!this.tokenDetails) {
            console.log('[RefreshWorker] Received STOP, being idle');
            return;
        }
        this.broadcast({ type: RefreshMessageTypes.EXPIRED });
        this.tokenDetails = undefined;
        this.exp = undefined;
        this.refreshPromise = undefined;
        console.log('[RefreshWorker] Received STOP, clearing timers');
        this.clearAllTimers();
    }

    private async performRefresh() {
        if (this.refreshPromise) {
            console.log('[RefreshWorker] Refresh already in progress, waiting...');
            return this.refreshPromise;
        }

        this.refreshPromise = this.doRefresh();
        return this.refreshPromise;
    }

    private async doRefresh(): Promise<void> {
        try {
            this.tokenDetails = await renewTokens(this.database);
            this.exp = decodeJwt(this.tokenDetails.access_token).exp;

            this.broadcast({
                type: RefreshMessageTypes.TOKEN_DETAILS,
                payload: { tokenDetails: this.tokenDetails }
            });

            console.log(`[RefreshWorker] Token refreshed`);
            console.log(`[RefreshWorker] Scheduling timers, expiry in ${this.tokenDetails.expires_in}s`);
            this.scheduleTimers(this.tokenDetails.expires_in);
        } catch (error: any) {
            this.broadcast({
                type: RefreshMessageTypes.ERROR_ON_REFRESH,
                error: error.message
            });
            console.log(`[RefreshWorker]`, error.message);
        } finally {
            this.refreshPromise = undefined;
        }
    }

    private clearAllTimers() {
        if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
        if (this.finalLogoutTimeout) clearTimeout(this.finalLogoutTimeout);
        this.timersAreRunning = false;
    }

    private scheduleTimers(expiresIn: number) {
        this.clearAllTimers();
        this.timersAreRunning = true;

        const expiresInMs = expiresIn * 1000;
        const REFRESH_THRESHOLD_RATIO = 0.8;
        const MINIMUM_REFRESH_BUFFER_MS = 30 * 1000;

        const timeUntilRefresh = REFRESH_THRESHOLD_RATIO * expiresInMs;
        if (timeUntilRefresh > MINIMUM_REFRESH_BUFFER_MS) {
            this.refreshTimeout = setTimeout(() => this.performRefresh(), timeUntilRefresh);
        }

        const LOGOUT_WARNING_BUFFER_MS = 5 * 1000;
        const timeUntilLogout = expiresInMs - LOGOUT_WARNING_BUFFER_MS;
        this.finalLogoutTimeout = setTimeout(() => {
            this.tokenDetails = undefined;
            this.broadcast({ type: RefreshMessageTypes.EXPIRED });
        }, timeUntilLogout);
    }

    private isTokenExpired(exp: number, bufferSeconds = 0) {
        if (typeof exp !== 'number' || isNaN(exp)) {
            return true;
        }
        const currentTimeSeconds = Math.floor(Date.now() / 1000);
        return exp < (currentTimeSeconds + bufferSeconds);
    }

    protected setTokenDetails(tokenDetails: TokenDetails) {
        this.tokenDetails = tokenDetails;
    }


    // For testing
    getTimersAreRunning() { return this.timersAreRunning; }
    getTokenDetails() { return this.tokenDetails; }
}