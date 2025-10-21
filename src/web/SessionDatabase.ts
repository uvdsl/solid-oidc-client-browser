import { ISessionDatabase } from "../core/SessionDatabase";
/**
 * A simple IndexedDB wrapper.
 */
export class SessionIDB implements ISessionDatabase {
    private readonly dbName: string;
    private readonly storeName: string;
    private readonly dbVersion: number;
    private db: IDBDatabase | null = null;

    /**
     * Creates a new instance
     * @param dbName The name of the IndexedDB database
     * @param storeName The name of the object store
     * @param dbVersion The database version
     */
    constructor(dbName: string = 'soidc', storeName: string = 'session', dbVersion: number = 1) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbVersion = dbVersion;
    }

    /**
     * Initializes the IndexedDB database
     * @returns Promise that resolves when the database is ready
     */
    public async init(): Promise<SessionIDB> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                reject(new Error(`Database error: ${(event.target as IDBRequest).error}`));
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve(this);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Check if the object store already exists, if not create it
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    /**
     * Stores any value in the database with the given ID as key
     * @param id The identifier/key for the value
     * @param value The value to store
     */
    public async setItem(id: string, value: any): Promise<void> {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName, 'readwrite');
            // Handle transation
            transaction.oncomplete = () => {
                resolve();
            };
            transaction.onerror = (event) => {
                reject(new Error(`Transaction error for setItem(${id},...): ${(event.target as IDBTransaction).error}`));
            };

            transaction.onabort = (event) => {
                reject(new Error(`Transaction aborted for setItem(${id},...): ${(event.target as IDBTransaction).error}`));
            };
            // Perform the request within the transaction
            const store = transaction.objectStore(this.storeName);
            store.put(value, id);
        });
    }

    /**
      * Retrieves a value from the database by ID
      * @param id The identifier/key for the value
      * @returns The stored value or null if not found
      */
    public async getItem(id: string): Promise<any> {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName, 'readonly');
            // Handle transation
            transaction.onerror = (event) => {
                reject(new Error(`Transaction error for getItem(${id}): ${(event.target as IDBTransaction).error}`));
            };

            transaction.onabort = (event) => {
                reject(new Error(`Transaction aborted for getItem(${id}): ${(event.target as IDBTransaction).error}`));
            };
            // Perform the request within the transaction
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);
            request.onsuccess = () => {
                resolve(request.result || null);
            };
        });
    }

    /**
     * Removes an item from the database
     * @param id The identifier of the item to remove
     */
    public async deleteItem(id: string): Promise<void> {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName, 'readwrite');
            // Handle transation
            transaction.oncomplete = () => {
                resolve();
            };
            transaction.onerror = (event) => {
                reject(new Error(`Transaction error for deleteItem(${id}): ${(event.target as IDBTransaction).error}`));
            };

            transaction.onabort = (event) => {
                reject(new Error(`Transaction aborted for deleteItem(${id}): ${(event.target as IDBTransaction).error}`));
            };
            // Perform the request within the transaction
            const store = transaction.objectStore(this.storeName);
            store.delete(id);
        });
    }

    /**
     * Clears all items from the database
     */
    public async clear(): Promise<void> {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName, 'readwrite');
            // Handle transation
            transaction.oncomplete = () => {
                resolve();
            };
            transaction.onerror = (event) => {
                reject(new Error(`Transaction error for clear(): ${(event.target as IDBTransaction).error}`));
            };

            transaction.onabort = (event) => {
                reject(new Error(`Transaction aborted for clear(): ${(event.target as IDBTransaction).error}`));
            };
            // Perform the request within the transaction
            const store = transaction.objectStore(this.storeName);
            store.clear();
        });
    }

    /**
     * Closes the database connection
     */
    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

}