import { DereferencableIdClientDetails, DynamicRegistrationClientDetails } from '../core';
import { SessionOptions, SessionCore } from '../core/Session';
import { databaseName, normalizeSessionName } from '../core/SessionName';
import { getWorkerUrl } from './RefreshWorkerUrl';
import { RefreshMessageTypes } from './RefreshMessageTypes';
import { SessionIDB } from './SessionDatabase';

// Any provided database via SessionOptions will be ignored.
// Database will be an IndexedDB, one database per session name.
export interface WebWorkerSessionOptions extends SessionOptions {
    workerUrl?: string | URL;
}

/**
 * This Session provides background token refreshing using a Web Worker.
 * A named session (see {@link SessionOptions.name}) gets its own IndexedDB
 * and its own SharedWorker, so several sessions can coexist on one origin.
 */
export class WebWorkerSession extends SessionCore {
    private worker: SharedWorker;
    // The database name this session expects its worker to be bound to.
    // Sent with SCHEDULE/REFRESH so a mismatched worker fails loudly
    // instead of serving tokens from another session's database.
    private dbName: string;

    constructor(
        clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails,
        sessionOptions?: WebWorkerSessionOptions
    ) {
        const name = normalizeSessionName(sessionOptions?.name);
        const database = new SessionIDB(databaseName(name));
        const options = { ...sessionOptions, name, database };
        super(clientDetails, options);
        this.dbName = databaseName(name);

        // Allow consumer to provide worker URL, or use default
        const workerUrl = sessionOptions?.workerUrl ?? getWorkerUrl(name)
        // SharedWorker identity is (origin, URL, name): a named session gets
        // its own worker, bound to its own database via the worker's self.name.
        this.worker = name
            ? new SharedWorker(workerUrl, { type: 'module', name })
            : new SharedWorker(workerUrl, { type: 'module' });
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
                    this.dispatchStateChangeEvent();
                if (this.refreshPromise && this.resolveRefresh) {
                    this.resolveRefresh();
                    this.clearRefreshPromise();
                }
                break;
            case RefreshMessageTypes.ERROR_ON_REFRESH:
                if (this.isActive)
                    this.dispatchExpirationWarningEvent();
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
                    this.dispatchExpirationEvent();
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
            this.worker.port.postMessage({
                type: RefreshMessageTypes.SCHEDULE,
                payload: { ...this.getTokenDetails(), expires_in: this.getExpiresIn(), dbName: this.dbName }
            });
        }
    }

    async restore() {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = new Promise((resolve, reject) => {
            this.resolveRefresh = resolve;
            this.rejectRefresh = reject;
        });
        this.worker.port.postMessage({ type: RefreshMessageTypes.REFRESH, payload: { dbName: this.dbName } });
        return this.refreshPromise;
    }

    async logout() {
        this.worker.port.postMessage({ type: RefreshMessageTypes.STOP });
        await super.logout();
    }

}