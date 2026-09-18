import { Account } from '../models/Account.js';
import { Transaction } from '../models/Transaction.js';

/**
 * ==============================================================================
 * IN-MEMORY TRANSACTIONAL DATABASE
 * ==============================================================================
 *
 * Provides a lightweight, high-performance in-memory database for accounts
 * and the transaction ledger with zero external dependencies.
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * 1. Why In-Memory?
 *    For learning, local demos, and automated testing, an in-memory database
 *    runs instantly without requiring PostgreSQL, MySQL, or Docker.
 *
 * 2. ACID Transactions (Atomicity):
 *    "All-or-Nothing" execution. When transferring money from Alice to Bob:
 *    - Step 1: Subtract ₹500 from Alice.
 *    - Step 2: Add ₹500 to Bob.
 *    - Step 3: Insert ledger row.
 *    If Step 3 crashes, or if Alice runs out of funds, the entire transaction
 *    must ROLL BACK so Alice never loses money without Bob receiving it.
 *
 * 3. Rollback via State Snapshots:
 *    Before executing a transaction callback, `runTransaction()` creates a deep
 *    snapshot of the database. If an error is thrown, the state is restored to
 *    the snapshot instantly.
 *
 * 4. Unique Constraint on `packetHash`:
 *    Guarantees that a payment with the same ciphertext hash can never be inserted
 *    into the `transactions` table twice (database-level defense in depth).
 */
export class InMemoryDb {
  constructor() {
    // Map of vpa -> Account object
    this.accounts = new Map();

    // Array of Transaction objects
    this.transactions = [];

    // Set of settled packet hashes for O(1) duplicate checks (unique index)
    this.txPacketHashes = new Set();

    // Auto-increment primary key for transactions
    this.nextTxId = 1;
  }

  /**
   * Executes a callback within an atomic transaction.
   * If any exception is thrown, all changes made inside the callback are discarded.
   *
   * @param {Function} callback - The transaction logic to run
   * @returns {*} Return value of the callback
   */
  runTransaction(callback) {
    // Take a snapshot of the current state before running the transaction
    const accountsSnapshot = new Map();
    for (const [vpa, acc] of this.accounts.entries()) {
      accountsSnapshot.set(vpa, new Account(acc.vpa, acc.holderName, acc.balance, acc.version));
    }
    const txCountSnapshot = this.transactions.length;
    const packetHashesSnapshot = new Set(this.txPacketHashes);
    const nextIdSnapshot = this.nextTxId;

    try {
      // Execute the database operations
      const result = callback();
      return result;
    } catch (err) {
      // An error occurred: Revert back to the exact snapshot state
      this.accounts = accountsSnapshot;
      this.transactions.length = txCountSnapshot;
      this.txPacketHashes = packetHashesSnapshot;
      this.nextTxId = nextIdSnapshot;
      throw err; // Re-throw so caller knows the transaction failed
    }
  }

  // ============================================================================
  // ACCOUNT OPERATIONS
  // ============================================================================

  /**
   * Finds an account by its unique VPA.
   * Returns a clone to prevent accidental outside mutation.
   */
  findAccountByVpa(vpa) {
    const acc = this.accounts.get(vpa);
    if (!acc) return null;
    return new Account(acc.vpa, acc.holderName, acc.balance, acc.version);
  }

  /**
   * Returns all registered accounts.
   */
  findAllAccounts() {
    return Array.from(this.accounts.values()).map(
      acc => new Account(acc.vpa, acc.holderName, acc.balance, acc.version)
    );
  }

  /**
   * Saves or updates an account with optimistic locking check.
   */
  saveAccount(account) {
    const existing = this.accounts.get(account.vpa);
    if (existing) {
      // Optimistic locking verification: Ensure version hasn't changed since reading
      if (existing.version !== account.version) {
        throw new Error(
          `OptimisticLockException: Account ${account.vpa} was modified concurrently by another thread`
        );
      }
      account.version = (account.version || 0) + 1;
    } else {
      account.version = 0;
    }
    this.accounts.set(account.vpa, new Account(account.vpa, account.holderName, account.balance, account.version));
    return this.accounts.get(account.vpa);
  }

  // ============================================================================
  // TRANSACTION OPERATIONS
  // ============================================================================

  /**
   * Inserts a settled or rejected transaction into the permanent ledger.
   * Enforces uniqueness on packetHash.
   */
  saveTransaction(txData) {
    // Unique index check: defense-in-depth against duplicate writes
    if (this.txPacketHashes.has(txData.packetHash)) {
      throw new Error(`DataIntegrityViolation: Duplicate entry for packetHash '${txData.packetHash}'`);
    }

    const id = this.nextTxId++;
    const transaction = new Transaction({
      ...txData,
      id
    });

    this.transactions.push(transaction);
    this.txPacketHashes.add(txData.packetHash);
    return transaction;
  }

  /**
   * Returns the most recent 20 transactions in descending order of ID.
   */
  findTop20Transactions() {
    return [...this.transactions]
      .sort((a, b) => b.id - a.id)
      .slice(0, 20);
  }

  /**
   * Checks whether a transaction with this packetHash already exists.
   */
  existsByPacketHash(packetHash) {
    return this.txPacketHashes.has(packetHash);
  }

  /**
   * Returns total number of accounts.
   */
  countAccounts() {
    return this.accounts.size;
  }

  /**
   * Clears all tables (used during tests or reset).
   */
  clear() {
    this.accounts.clear();
    this.transactions = [];
    this.txPacketHashes.clear();
    this.nextTxId = 1;
  }
}

// Global database instance
export const db = new InMemoryDb();
