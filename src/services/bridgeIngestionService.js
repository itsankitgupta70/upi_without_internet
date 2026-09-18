import { config } from '../config.js';
import { hybridCryptoService } from '../crypto/hybridCryptoService.js';
import { idempotencyService } from './idempotencyService.js';
import { settlementService } from './settlementService.js';

/**
 * ==============================================================================
 * INGESTION RESULT WRAPPER
 * ==============================================================================
 *
 * Represents the standardized outcome returned to the bridge node:
 * - "SETTLED": Transaction succeeded, funds transferred, ledger recorded.
 * - "DUPLICATE_DROPPED": Another bridge node already delivered this packet; safely ignored.
 * - "INVALID": Decryption failed (tampered packet) or freshness window expired (replay).
 */
export class IngestResult {
  constructor(outcome, packetHash, reason = null, transactionId = null) {
    this.outcome = outcome;
    this.packetHash = packetHash;
    this.reason = reason;
    this.transactionId = transactionId;
  }

  static settled(hash, tx) {
    return new IngestResult('SETTLED', hash, null, tx.id);
  }

  static duplicate(hash) {
    return new IngestResult('DUPLICATE_DROPPED', hash, null, null);
  }

  static invalid(hash, reason) {
    return new IngestResult('INVALID', hash, reason, null);
  }
}

/**
 * ==============================================================================
 * BRIDGE INGESTION SERVICE (THE PRODUCTION INGESTION PIPELINE)
 * ==============================================================================
 *
 * This is the central brain of our backend server.
 * When a bridge phone walks outside and gets 4G, it HTTP POSTs its held packets
 * to `/api/bridge/ingest`.
 *
 * THE 5-STEP PIPELINE EXPLAINED FOR BEGINNERS:
 *
 *   [ Bridge POSTs Packet ]
 *              │
 *              ▼
 *   [Step 1: Compute SHA-256(ciphertext)]
 *              │
 *              ▼
 *   [Step 2: Idempotency Gate (claim hash)]
 *              ├──▶ Already seen? ──▶ Return DUPLICATE_DROPPED (Stop immediately!)
 *              ▼ First time?
 *   [Step 3: Decrypt Hybrid Ciphertext]
 *              ├──▶ Tag mismatch/tampered? ──▶ Return INVALID (decryption_failed)
 *              ▼ Decrypted OK
 *   [Step 4: Freshness Check (replay protection)]
 *              ├──▶ Older than 24 hours? ──▶ Return INVALID (stale_packet)
 *              ├──▶ From the future? ────▶ Return INVALID (future_dated)
 *              ▼ Fresh!
 *   [Step 5: Settlement Service]
 *              └──▶ Debit Sender, Credit Receiver, Record Ledger Row ──▶ Return SETTLED
 */
export class BridgeIngestionService {
  constructor(
    crypto = hybridCryptoService,
    idempotency = idempotencyService,
    settlement = settlementService,
    maxAgeSeconds = config.packetMaxAgeSeconds,
    clockSkewTolerance = config.clockSkewToleranceSeconds
  ) {
    this.crypto = crypto;
    this.idempotency = idempotency;
    this.settlement = settlement;
    this.maxAgeSeconds = maxAgeSeconds;
    this.clockSkewTolerance = clockSkewTolerance;
  }

  /**
   * Ingests and processes an incoming mesh packet from a bridge device.
   *
   * @param {MeshPacket|Object} packet - The mesh packet received over the wire
   * @param {string} bridgeNodeId - Device ID of the uploading bridge
   * @param {number} hopCount - How many Bluetooth hops the packet traveled
   * @returns {IngestResult}
   */
  ingest(packet, bridgeNodeId = 'unknown', hopCount = 0) {
    try {
      // ------------------------------------------------------------------------
      // STEP 1: Compute the SHA-256 Hash of the Ciphertext
      // ------------------------------------------------------------------------
      const packetHash = this.crypto.hashCiphertext(packet.ciphertext);

      // ------------------------------------------------------------------------
      // STEP 2: The Idempotency Gate
      // ------------------------------------------------------------------------
      // If 3 bridge nodes uploaded this same packet concurrently, exactly one
      // will successfully claim() it. The other two return false here.
      if (!this.idempotency.claim(packetHash)) {
        console.log(
          `[BridgeIngestionService] DUPLICATE packet ${packetHash.substring(0, 12)}... from bridge ${bridgeNodeId} — dropped`
        );
        return IngestResult.duplicate(packetHash);
      }

      // ------------------------------------------------------------------------
      // STEP 3: Decrypt and Authenticate the Payload
      // ------------------------------------------------------------------------
      // Decrypts using the server's private RSA key + AES-GCM session key.
      // If an intermediate stranger tampered with even a single bit of the packet,
      // AES-GCM's authentication tag will fail and throw an exception.
      let instruction;
      try {
        instruction = this.crypto.decrypt(packet.ciphertext);
      } catch (err) {
        console.warn(
          `[BridgeIngestionService] Decryption failed for packet ${packetHash.substring(0, 12)}...: ${err.message}`
        );
        return IngestResult.invalid(packetHash, 'decryption_failed');
      }

      // ------------------------------------------------------------------------
      // STEP 4: Freshness Check (Replay Protection)
      // ------------------------------------------------------------------------
      // Check how old the packet is compared to when the sender originally signed it.
      const ageSeconds = (Date.now() - instruction.signedAt) / 1000;

      // Reject packets older than 24 hours
      if (ageSeconds > this.maxAgeSeconds) {
        console.warn(
          `[BridgeIngestionService] Packet ${packetHash.substring(0, 12)}... too old (${Math.round(ageSeconds)}s), rejected`
        );
        return IngestResult.invalid(packetHash, 'stale_packet');
      }

      // Reject packets dated far into the future (clock manipulation attempt)
      if (ageSeconds < -this.clockSkewTolerance) {
        console.warn(
          `[BridgeIngestionService] Packet ${packetHash.substring(0, 12)}... future-dated, rejected`
        );
        return IngestResult.invalid(packetHash, 'future_dated');
      }

      // ------------------------------------------------------------------------
      // STEP 5: Settle Transaction on the Ledger
      // ------------------------------------------------------------------------
      // Executes debit/credit transfer inside an atomic transaction.
      const tx = this.settlement.settle(instruction, packetHash, bridgeNodeId, hopCount);
      return IngestResult.settled(packetHash, tx);

    } catch (err) {
      console.error(`[BridgeIngestionService] Ingestion error: ${err.message}`, err);
      return IngestResult.invalid('?', `internal_error: ${err.message}`);
    }
  }
}

// Global singleton instance
export const bridgeIngestionService = new BridgeIngestionService();
