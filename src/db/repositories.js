import { db } from './inMemoryDb.js';

/**
 * ==============================================================================
 * REPOSITORIES (DATA ACCESS LAYER)
 * ==============================================================================
 *
 * Implements the Repository Design Pattern.
 *
 * WHY USE REPOSITORIES (FOR BEGINNERS):
 * - Separation of Concerns: Your business logic (services) should not care
 *   whether data is saved in memory, SQLite, MongoDB, or PostgreSQL.
 * - Repositories provide clean, descriptive methods like `findById()` or `save()`
 *   so the rest of the application remains modular and testable.
 */

/**
 * AccountRepository: Encapsulates all database operations for user accounts.
 */
export class AccountRepository {
  constructor(database = db) {
    this.db = database;
  }

  findById(vpa) {
    return this.db.findAccountByVpa(vpa);
  }

  findAll() {
    return this.db.findAllAccounts();
  }

  save(account) {
    return this.db.saveAccount(account);
  }

  count() {
    return this.db.countAccounts();
  }
}

/**
 * TransactionRepository: Encapsulates database operations for the permanent ledger.
 */
export class TransactionRepository {
  constructor(database = db) {
    this.db = database;
  }

  save(tx) {
    return this.db.saveTransaction(tx);
  }

  findTop20ByOrderByIdDesc() {
    return this.db.findTop20Transactions();
  }

  existsByPacketHash(packetHash) {
    return this.db.existsByPacketHash(packetHash);
  }
}

// Export singleton instances
export const accountRepository = new AccountRepository();
export const transactionRepository = new TransactionRepository();
