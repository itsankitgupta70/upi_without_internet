import { db } from '../db/inMemoryDb.js';
import { accountRepository, transactionRepository } from '../db/repositories.js';
import { TransactionStatus } from '../models/Transaction.js';

/**
 * ==============================================================================
 * SETTLEMENT SERVICE (LEDGER EXECUTION)
 * ==============================================================================
 *
 * Handles the actual transfer of funds between user accounts and records the
 * permanent audit trail in the transaction ledger.
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * 1. What is "Settlement"?
 *    - In payment systems, an "authorization" or "instruction" is just a message
 *      saying "Alice promises to pay Bob ₹500".
 *    - "Settlement" is the moment money actually moves from Alice's account to Bob's.
 *
 * 2. Balance Verification:
 *    - What if Alice only had ₹100 in her account when creating the offline packet?
 *    - When the packet reaches the backend, the settlement engine checks her balance.
 *    - If she has less than ₹500, the transfer fails gracefully and is permanently
 *      recorded with status `REJECTED`.
 *
 * 3. Atomic Guarantee:
 *    The entire debit + credit + transaction log is executed inside `db.runTransaction()`.
 *    If anything crashes mid-way, all changes are rolled back automatically.
 */
export class SettlementService {
  constructor(
    database = db,
    accounts = accountRepository,
    transactions = transactionRepository
  ) {
    this.db = database;
    this.accounts = accounts;
    this.transactions = transactions;
  }

  /**
   * Settles a verified payment instruction.
   *
   * @param {PaymentInstruction} instruction - Decrypted payment data
   * @param {string} packetHash - SHA-256 hex string of the ciphertext
   * @param {string} bridgeNodeId - Identifier of the bridge device that uploaded it
   * @param {number} hopCount - Number of Bluetooth hops the packet took
   * @returns {Transaction} The resulting Transaction record
   */
  settle(instruction, packetHash, bridgeNodeId, hopCount) {
    // Run everything inside an atomic database transaction
    return this.db.runTransaction(() => {
      // 1. Verify that sender account exists
      const sender = this.accounts.findById(instruction.senderVpa);
      if (!sender) {
        throw new Error(`Unknown sender VPA: ${instruction.senderVpa}`);
      }

      // 2. Verify that receiver account exists
      const receiver = this.accounts.findById(instruction.receiverVpa);
      if (!receiver) {
        throw new Error(`Unknown receiver VPA: ${instruction.receiverVpa}`);
      }

      // 3. Verify that the amount is valid and positive
      const amount = parseFloat(instruction.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Payment amount must be a positive number');
      }

      const senderBalance = sender.getBalanceAsNumber();

      // 4. Check for sufficient funds
      if (senderBalance < amount) {
        console.warn(
          `[SettlementService] Insufficient funds: ${sender.vpa} has ₹${senderBalance}, tried to send ₹${amount}`
        );
        // Record as REJECTED in the ledger
        return this.recordRejected(instruction, packetHash, bridgeNodeId, hopCount);
      }

      // 5. Execute atomic transfer: Debit sender, Credit receiver
      sender.setBalanceFromNumber(senderBalance - amount);
      receiver.setBalanceFromNumber(receiver.getBalanceAsNumber() + amount);

      // Save updated balances
      this.accounts.save(sender);
      this.accounts.save(receiver);

      // 6. Write permanent ledger entry with status SETTLED
      const tx = this.transactions.save({
        packetHash,
        senderVpa: instruction.senderVpa,
        receiverVpa: instruction.receiverVpa,
        amount,
        signedAt: new Date(instruction.signedAt).toISOString(),
        settledAt: new Date().toISOString(),
        bridgeNodeId,
        hopCount,
        status: TransactionStatus.SETTLED
      });

      console.log(
        `[SettlementService] SETTLED ₹${amount} from ${sender.vpa} to ${receiver.vpa} (packetHash=${packetHash.substring(0, 12)}..., bridge=${bridgeNodeId}, hops=${hopCount})`
      );

      return tx;
    });
  }

  /**
   * Records a failed payment in the ledger without moving any funds.
   */
  recordRejected(instruction, packetHash, bridgeNodeId, hopCount) {
    return this.transactions.save({
      packetHash,
      senderVpa: instruction.senderVpa,
      receiverVpa: instruction.receiverVpa,
      amount: parseFloat(instruction.amount),
      signedAt: new Date(instruction.signedAt).toISOString(),
      settledAt: new Date().toISOString(),
      bridgeNodeId,
      hopCount,
      status: TransactionStatus.REJECTED
    });
  }
}

// Global singleton instance
export const settlementService = new SettlementService();
