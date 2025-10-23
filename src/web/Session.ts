import { DereferencableIdClientDetails, DynamicRegistrationClientDetails } from '../core';
import { Session, SessionOptions, SessionCore } from '../core/Session';
import { SessionIDB } from './SessionDatabase';

// Any provided database via SessionOptions will be ignored.
// Database will be an IndexedDB.
export interface WebWorkerSessionOptions extends SessionOptions {
    workerUrl?: string | URL;
    onSessionExpirationWarning?: () => void;
    onSessionExpiration?: () => void;
}

/**
 * This Session provides background token refreshing using a Web Worker.
 */
export class WebWorkerSession implements Session {
    private sessionCore: SessionCore;
    private worker: SharedWorker;
    private onSessionExpirationWarning?: () => void;
    private onSessionExpiration?: () => void;

    constructor(
        clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails,
        sessionOptions?: WebWorkerSessionOptions
    ) {
        const database = new SessionIDB();
        const options = { ...sessionOptions, database };
        this.sessionCore = new SessionCore(clientDetails, options);
        this.onSessionExpirationWarning = sessionOptions?.onSessionExpirationWarning;
        this.onSessionExpiration = sessionOptions?.onSessionExpiration;

        // Allow consumer to provide worker URL, or use default
        const workerUrl = sessionOptions?.workerUrl ?? new URL('./RefreshWorker.js', import.meta.url);
        this.worker = new SharedWorker(workerUrl, { type: 'module' });
        this.worker.port.onmessage = (event) => {
            this.handleWorkerMessage(event.data).catch(console.error);
        };
        window.addEventListener('beforeunload', () => {
            this.worker.port.postMessage({ type: 'DISCONNECT' });
        });
    }

    private handleWorkerMessage = async (data: any) => {
        const { type, payload } = data;
        switch (type) {
            case 'TOKEN_REFRESHED':
                await this.sessionCore.setTokenDetails(payload.tokenDetails);
                break;
            case 'EXPIRATION_WARNING':
                this.onSessionExpirationWarning?.();
                break;
            case 'PLEASE_LOGOUT':
                await this.sessionCore.logout();
                this.onSessionExpiration?.();
                break;
        }
    };

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