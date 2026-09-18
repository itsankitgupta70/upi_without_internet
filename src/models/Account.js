/**
 * ==============================================================================
 * ACCOUNT MODEL
 * ==============================================================================
 *
 * Represents a simulated user's bank account.
 * In a real UPI system, account balances live inside core banking systems (CBS),
 * not inside an application server. For our self-contained offline mesh demo,
 * our backend acts as the authoritative ledger.
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * 1. VPA (Virtual Payment Address):
 *    The identifier used to send and receive UPI payments (e.g., "alice@demo").
 *    It acts like an email address mapped to a bank account.
 *
 * 2. Balance precision:
 *    Currency amounts must be tracked precisely without floating-point rounding
 *    errors (e.g., 0.1 + 0.2 = 0.30000000000000004 in binary math). We format
 *    balances with two decimal places (e.g. "5000.00").
 *
 * 3. Optimistic Locking (the `version` field):
 *    Imagine two transfers try to debit Alice's balance at the exact same millisecond:
 *    - Transfer A reads balance ₹5000 (version 0).
 *    - Transfer B reads balance ₹5000 (version 0).
 *    - Transfer A subtracts ₹500, writes ₹4500, and increments version to 1.
 *    - Transfer B now tries to write ₹4800 expecting version 0, but sees version 1!
 *    - Transfer B fails with an OptimisticLockException instead of silently
 *      overwriting Alice's balance. This prevents "lost updates".
 */
export class Account {
  /**
   * @param {string} vpa - Virtual Payment Address, e.g. "alice@demo"
   * @param {string} holderName - Human-readable name of the account holder
   * @param {number|string} balance - Account balance in Indian Rupees (INR)
   * @param {number} [version=0] - Optimistic locking counter
   */
  constructor(vpa, holderName, balance, version = 0) {
    this.vpa = vpa;
    this.holderName = holderName;
    // Always store as a clean 2-decimal string to avoid floating-point display issues
    this.balance = typeof balance === 'number' ? balance.toFixed(2) : balance;
    this.version = version;
  }

  /**
   * Helper to retrieve balance as a numeric float for mathematical calculations.
   */
  getBalanceAsNumber() {
    return parseFloat(this.balance);
  }

  /**
   * Helper to update balance from a calculated number, formatted to 2 decimals.
   */
  setBalanceFromNumber(num) {
    this.balance = num.toFixed(2);
  }
}
