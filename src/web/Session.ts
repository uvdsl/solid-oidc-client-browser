import { DereferencableIdClientDetails, DynamicRegistrationClientDetails } from '../core';
import { Session, SessionOptions, SessionCore } from '../core/Session';
import { SessionIDB } from './SessionDatabase';

// Any provided database via SessionOptions will be ignored.
// Database will be an IndexedDB.
export interface WebWorkerSessionOptions extends SessionOptions {
    onSessionExpirationWarning?: () => void;
}

/**
 * This Session provides background token refreshing using a Web Worker.
 */
export class WebWorkerSession implements Session {
    private sessionCore: SessionCore;
    private worker: SharedWorker;
    private onSessionExpirationWarning?: () => void;

    constructor(clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails, sessionOptions?: WebWorkerSessionOptions) {
        // create session core and provide it with persistent database
        const database = new SessionIDB();
        const options = { ...sessionOptions, database };
        this.sessionCore = new SessionCore(clientDetails, options);
        // expiration warning
        this.onSessionExpirationWarning = sessionOptions?.onSessionExpirationWarning;
        // Initialize the worker and set up communication
        this.worker = new SharedWorker(new URL('./RefreshWorker.ts', import.meta.url));
        this.worker.port.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'TOKEN_REFRESHED') {
                // When the worker sends new tokens, update the core session's state
                this.sessionCore.setTokenDetails(payload.tokenDetails);
            } else if (type === 'EXPIRATION_WARNING') {
                // If the developer provided a callback, call it.
                if (this.onSessionExpirationWarning) {
                    this.onSessionExpirationWarning();
                }
            } else if (type === 'PLEASE_LOGOUT') {
                // If the worker recommends a logout, execute it.
                this.sessionCore.logout();
            }
        };
    }

    async login(idp: string, redirect_uri: string) {
        return this.sessionCore.login(idp, redirect_uri);
    }

    async handleRedirectFromLogin() {
        await this.sessionCore.handleRedirectFromLogin();
        // If login was successful, tell the worker to start refreshing

        if (this.sessionCore.isActive) {
            this.worker.port.postMessage({ type: 'START', payload: { expiresIn: this.sessionCore.getExpiresIn() } });
        }
    }

    async restore() {
        await this.sessionCore.restore();
        // If restoration was successful, tell the worker to start refreshing
        if (this.sessionCore.isActive) {
            this.worker.port.postMessage({ type: 'START', payload: { expiresIn: this.sessionCore.getExpiresIn() } });
        }
    }

    async logout() {
        // Tell the worker to stop refreshing before clearing session
        this.worker.port.postMessage({ type: 'STOP' });
        await this.sessionCore.logout();
    }

    async authFetch(input: string | URL | Request, init?: RequestInit, dpopPayload?: any) {
        return this.sessionCore.authFetch(input, init, dpopPayload);
    }

    get isActive() {
        return this.sessionCore.isActive;
    }

    get webId() {
        return this.sessionCore.webId;
    }
}