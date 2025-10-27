import { DereferencableIdClientDetails, DynamicRegistrationClientDetails } from '../core';
import { SessionOptions, SessionCore } from '../core/Session';
import { getMetaUrl } from './RefreshWorkerUrl';
import { RefreshMessageTypes } from './RefreshWorker';
import { SessionIDB } from './SessionDatabase';

// Any provided database via SessionOptions will be ignored.
// Database will be an IndexedDB.
export interface WebWorkerSessionOptions extends SessionOptions {
    onSessionExpirationWarning?: () => void;
    onSessionExpiration?: () => void;
    workerUrl?: string | URL;
}

/**
 * This Session provides background token refreshing using a Web Worker.
 */
export class WebWorkerSession extends SessionCore {
    private worker: SharedWorker;

    private onSessionExpirationWarning?: () => void;
    private onSessionExpiration?: () => void;

    constructor(
        clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails,
        sessionOptions?: WebWorkerSessionOptions
    ) {
        const database = new SessionIDB();
        const options = { ...sessionOptions, database };
        super(clientDetails, options);
        this.onSessionExpirationWarning = sessionOptions?.onSessionExpirationWarning;
        this.onSessionExpiration = sessionOptions?.onSessionExpiration;

        // Allow consumer to provide worker URL, or use default
        const workerUrl = sessionOptions?.workerUrl ?? new URL('./RefreshWorker.js', getMetaUrl());
        this.worker = new SharedWorker(workerUrl, { type: 'module' });
        this.worker.port.onmessage = (event) => {
            this.handleWorkerMessage(event.data).catch(console.error);
        };
        window.addEventListener('beforeunload', () => {
            this.worker.port.postMessage({ type: RefreshMessageTypes.DISCONNECT });
        });
    }

    private async handleWorkerMessage(data: any) {
        const { type, payload, error } = data;
        switch (type) {
            case RefreshMessageTypes.TOKEN_DETAILS:
                const wasActive = this.isActive;
                await this.setTokenDetails(payload.tokenDetails);
                if (wasActive !== this.isActive)
                    this.onSessionStateChange?.();
                if (this.refreshPromise && this.resolveRefresh) {
                    this.resolveRefresh();
                    this.clearRefreshPromise();
                }
                break;
            case RefreshMessageTypes.ERROR_ON_REFRESH:
                if (this.isActive)
                    this.onSessionExpirationWarning?.();
                if (this.refreshPromise && this.rejectRefresh) {
                    if (this.isActive) {
                        this.rejectRefresh(new Error(error || 'Token refresh failed'));
                    } else {
                        this.rejectRefresh(new Error("No session to restore"));
                    }
                    this.clearRefreshPromise();
                }
                break;
            case RefreshMessageTypes.EXPIRED:
                if (this.isActive) {
                    this.onSessionExpiration?.();
                    await this.logout();
                }
                if (this.refreshPromise && this.rejectRefresh) {
                    this.rejectRefresh(new Error(error || 'Token refresh failed'));
                    this.clearRefreshPromise();
                }
                break;
        }
    };


    async handleRedirectFromLogin() {
        await super.handleRedirectFromLogin();
        if (this.isActive) { // If login was successful, tell the worker to schedule refreshing
            this.worker.port.postMessage({ type: RefreshMessageTypes.SCHEDULE, payload: this.getTokenDetails() });
        }
    }

    async restore() {
        this.refreshPromise = new Promise((resolve, reject) => {
            this.resolveRefresh = resolve;
            this.rejectRefresh = reject;
        });
        this.worker.port.postMessage({ type: RefreshMessageTypes.REFRESH });
        return this.refreshPromise;
    }

    async logout() {
        this.worker.port.postMessage({ type: RefreshMessageTypes.STOP });
        await super.logout();
    }

}