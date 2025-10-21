/**
 * A simple storage interface to a generic key-value database.
 * For an implementation, please see eg `../web/SessionDatabase`.
 */
export interface ISessionDatabase {

    /**
     * Initializes the database
     * @returns Promise that resolves when the database is ready
     */
    init(): Promise<ISessionDatabase> ;

    /**
     * Stores any value in the database with the given ID as key
     * @param id The identifier/key for the value
     * @param value The value to store
     */
    setItem(id: string, value: any): Promise<void>; 

    /**
      * Retrieves a value from the database by ID
      * @param id The identifier/key for the value
      * @returns The stored value or null if not found
      */
    getItem(id: string): Promise<any> ;

    /**
     * Removes an item from the database
     * @param id The identifier of the item to remove
     */
    deleteItem(id: string): Promise<void> ;

    /**
     * Clears all items from the database
     */
    clear(): Promise<void> ;

    /**
     * Closes the database connection
     */
    close(): void ;

}