import { DereferencableIdClientDetails, DynamicRegistrationClientDetails } from '../core';
import { Session, SessionOptions, SessionCore } from '../core/Session';
import { TokenDetails } from '../core/SessionInformation';
import { RefreshMessageTypes } from './RefreshWorker';
import { SessionIDB } from './SessionDatabase';

// Any provided database via SessionOptions will be ignored.
// Database will be an IndexedDB.
export interface WebWorkerSessionOptions extends SessionOptions {
    onSessionStateChange?: () => void;
    onSessionExpirationWarning?: () => void;
    onSessionExpiration?: () => void;
    workerUrl?: string | URL;
}

/**
 * This Session provides background token refreshing using a Web Worker.
 */
export class WebWorkerSession extends SessionCore {
    private worker: SharedWorker;

    private onSessionStateChange?: () => void;
    private onSessionExpirationWarning?: () => void;
    private onSessionExpiration?: () => void;

    private refreshPromise?: Promise<void>;
    private resolveRefresh?: (() => void);
    private rejectRefresh?: ((reason?: any) => void);

    constructor(
        clientDetails?: DereferencableIdClientDetails | DynamicRegistrationClientDetails,
        sessionOptions?: WebWorkerSessionOptions
    ) {
        const database = new SessionIDB();
        const options = { ...sessionOptions, database };
        super(clientDetails, options);
        this.onSessionStateChange = sessionOptions?.onSessionStateChange;
        this.onSessionExpirationWarning = sessionOptions?.onSessionExpirationWarning;
        this.onSessionExpiration = sessionOptions?.onSessionExpiration;

        // Allow consumer to provide worker URL, or use default
        const workerUrl = sessionOptions?.workerUrl ?? new URL('./RefreshWorker.js', import.meta.url);
        this.worker = new SharedWorker(workerUrl, { type: 'module' });
        this.worker.port.onmessage = (event) => {
            this.handleWorkerMessage(event.data).catch(console.error);
        };
        window.addEventListener('beforeunload', () => {
            this.worker.port.postMessage({ type: RefreshMessageTypes.DISCONNECT });
        });
    }

    private handleWorkerMessage = async (data: any) => {
        const { type, payload, error } = data;
        switch (type) {
            case RefreshMessageTypes.TOKEN_DETAILS:
                await this.setTokenDetails(payload.tokenDetails);
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
                        this.rejectRefresh(new Error("No session to restore."));
                    }
                    this.clearRefreshPromise();
                }
                break;
            case RefreshMessageTypes.EXPIRED:
                await this.logout();
                this.onSessionExpiration?.();
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
            this.worker.port.postMessage({ type: RefreshMessageTypes.SCHEDULE, payload: { expiresIn: this.getExpiresIn() } });
        }
    }

    async restore() {
        this.worker.port.postMessage({ type: RefreshMessageTypes.REFRESH });
        this.refreshPromise = new Promise((resolve, reject) => {
            this.resolveRefresh = resolve;
            this.rejectRefresh = reject;
        });
        return this.refreshPromise;
    }

    async logout() {
        this.worker.port.postMessage({ type: RefreshMessageTypes.STOP });
        await super.logout();
        this.onSessionStateChange?.();
    }

    async authFetch(input: string | URL | Request, init?: RequestInit, dpopPayload?: any) {
        if (this.isExpired()) {
            try {
                if (!this.refreshPromise) {
                    await this.restore(); // Initiate and wait
                } else {
                    await this.refreshPromise; // Wait for already pending
                }
            } catch (refreshError) {
                console.error("Session refresh failed during authFetch:", refreshError);
                throw new Error("Session expired and could not be refreshed.");
            }
        }
        return super.authFetch(input, init, dpopPayload);
    }

      async setTokenDetails(tokenDetails: TokenDetails) {
        await super.setTokenDetails(tokenDetails);
        this.onSessionStateChange?.();
      }
    

    private clearRefreshPromise() {
        this.refreshPromise = undefined;
        this.resolveRefresh = undefined;
        this.rejectRefresh = undefined;
    }

}