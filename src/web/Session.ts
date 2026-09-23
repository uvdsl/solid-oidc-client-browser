import { DereferencableIdClientDetails, DynamicRegistrationClientDetails } from '../core';
import { SessionOptions, SessionCore } from '../core/Session';
import { getWorkerUrl } from './RefreshWorkerUrl';
import { REFRESH_WORKER_INTEGRITY } from './RefreshWorkerIntegrity';
import { RefreshMessageTypes } from './RefreshMessageTypes';
import { SessionIDB } from './SessionDatabase';
import {SecureSharedWorker} from "./SecureSharedWorker";

// Any provided database via SessionOptions will be ignored.
// Database will be an IndexedDB.
export interface WebWorkerSessionOptions extends SessionOptions {
    workerUrl?: string | URL;
}

/**
 * This Session provides background token refreshing using a Web Worker.
 */
export class WebWorkerSession extends SessionCore {

    private workerPromise: Promise<SharedWorker>;

    constructor(
        clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails,
        sessionOptions?: WebWorkerSessionOptions
    ) {
        const database = new SessionIDB();
        const options = { ...sessionOptions, database };
        super(clientDetails, options);
        this.workerPromise = this.initWorker(sessionOptions);
    }

    private async initWorker(sessionOptions?: WebWorkerSessionOptions): Promise<SharedWorker> {
        // Allow consumer to provide worker URL, or use default
        const worker = sessionOptions?.workerUrl
            ? new SharedWorker(sessionOptions.workerUrl, { type: 'module' })
            : await SecureSharedWorker.create(getWorkerUrl(), REFRESH_WORKER_INTEGRITY, { type: 'module' });
        worker.port.onmessage = (event) => {
            this.handleWorkerMessage(event.data).catch(console.error);
        };
        window.addEventListener('beforeunload', () => {
            worker.port.postMessage({ type: RefreshMessageTypes.DISCONNECT });
        });
        return worker;
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
            const worker = await this.workerPromise;
            worker.port.postMessage({
                type: RefreshMessageTypes.SCHEDULE,
                payload: { ...this.getTokenDetails(), expires_in: this.getExpiresIn() }
            });
        }
    }

    async restore() {
        const worker = await this.workerPromise;
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = new Promise((resolve, reject) => {
            this.resolveRefresh = resolve;
            this.rejectRefresh = reject;
        });
        worker.port.postMessage({ type: RefreshMessageTypes.REFRESH });
        return this.refreshPromise;
    }

    async logout() {
        const worker = await this.workerPromise;
        worker.port.postMessage({ type: RefreshMessageTypes.STOP });
        await super.logout();
    }

}