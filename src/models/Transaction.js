/**
 * ==============================================================================
 * TRANSACTION MODEL (IMMUTABLE LEDGER RECORD)
 * ==============================================================================
 *
 * Represents an immutable audit record of a payment that was processed.
 * Once written into the database, transaction rows are never updated or deleted.
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * 1. Immutability:
 *    In financial systems, transaction ledgers are strictly append-only.
 *    You never modify past records; you only append new ones.
 *
 * 2. signedAt vs settledAt:
 *    - signedAt: The exact timestamp when the sender's phone created and signed
 *      the payment packet while completely OFFLINE in the basement.
 *    - settledAt: The timestamp when the bridge phone walked outside into 4G
 *      coverage and the backend server actually executed the ledger transfer.
 *
 * 3. packetHash:
 *    The SHA-256 cryptographic hash of the encrypted payload. This serves as
 *    our unique idempotency key. Even if multiple bridge nodes upload the same
 *    packet at once, this unique constraint ensures it settles at most once.
 *
 * 4. hopCount & bridgeNodeId:
 *    Metadata indicating how many Bluetooth hops the packet took across the
 *    mesh network, and which phone had internet access to upload it.
 */

export const TransactionStatus = {
  SETTLED: 'SETTLED',   // Funds were successfully debited from sender and credited to receiver
  REJECTED: 'REJECTED'  // Payment failed (e.g., sender had insufficient balance)
};

export class Transaction {
  /**
   * @param {Object} data
   * @param {number} [data.id] - Sequential unique transaction ID
   * @param {string} data.packetHash - SHA-256 hex string of the encrypted payload
   * @param {string} data.senderVpa - Who sent the payment (e.g., "alice@demo")
   * @param {string} data.receiverVpa - Who received the payment (e.g., "bob@demo")
   * @param {string|number} data.amount - Payment amount in INR
   * @param {string} data.signedAt - ISO timestamp when sender signed offline
   * @param {string} data.settledAt - ISO timestamp when server settled
   * @param {string} data.bridgeNodeId - Phone ID that uploaded to backend
   * @param {number} data.hopCount - Number of peer devices it hopped through
   * @param {string} data.status - SETTLED or REJECTED
   */
  constructor({
    id,
    packetHash,
    senderVpa,
    receiverVpa,
    amount,
    signedAt,
    settledAt,
    bridgeNodeId,
    hopCount,
    status
  }) {
    this.id = id;
    this.packetHash = packetHash;
    this.senderVpa = senderVpa;
    this.receiverVpa = receiverVpa;
    this.amount = typeof amount === 'number' ? amount.toFixed(2) : amount;
    this.signedAt = signedAt;
    this.settledAt = settledAt;
    this.bridgeNodeId = bridgeNodeId;
    this.hopCount = hopCount;
    this.status = status;
  }
}
