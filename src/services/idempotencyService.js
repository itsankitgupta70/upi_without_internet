import { config } from '../config.js';

/**
 * ==============================================================================
 * IDEMPOTENCY SERVICE (DUPLICATE-STORM PROTECTION)
 * ==============================================================================
 *
 * This is the critical gatekeeper that solves the duplicate delivery problem.
 *
 * WHAT IS IDEMPOTENCY (FOR BEGINNERS)?
 * - In mathematics, an operation is idempotent if f(f(x)) = f(x).
 *   Example: Pressing the "Elevator Call" button 10 times does not summon 10 elevators.
 * - In banking, if a network retry causes the server to receive your "Send ₹500"
 *   request three times, the bank must only debit your account ONCE, not three times!
 *
 * THE "THREE BRIDGES" SCENARIO:
 * 1. Alice sends ₹500 to Bob while offline.
 * 2. The packet gossips across the mesh network until 3 stranger phones all hold a copy.
 * 3. All 3 phones walk outside into 4G coverage at the exact same second.
 * 4. All 3 phones upload the packet to `/api/bridge/ingest` simultaneously!
 * 5. If we naively process all 3 requests, Alice gets debited ₹1500 instead of ₹500!
 *
 * HOW THIS SERVICE FIXES IT:
 * - Before doing any work, the server calculates the SHA-256 hash of the ciphertext.
 * - The server calls `idempotencyService.claim(packetHash)`.
 * - If the hash has NEVER been seen:
 *     It stores the hash and returns `true`. The caller proceeds to settle.
 * - If the hash HAS already been seen:
 *     It immediately returns `false`. The duplicate is dropped right away!
 * - In production, this Map is replaced with Redis: `SET key NX EX 86400`
 *   (SET if Not eXists with a 24-hour expiration).
 */
export class IdempotencyService {
  constructor(ttlSeconds = config.idempotencyTtlSeconds) {
    // Map of packetHash (string) -> timestamp (epoch millis)
    this.seen = new Map();
    this.ttlSeconds = ttlSeconds;

    // Periodic cleanup timer: Runs every 60 seconds to evict old hashes past their TTL
    this.cleanupInterval = setInterval(() => {
      this.evictExpired();
    }, 60_000);

    // unref() ensures this background timer doesn't keep the Node.js process alive if it wants to shut down
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Tries to claim a packet hash.
   * Atomically checks if the hash has been claimed.
   *
   * @param {string} packetHash - SHA-256 hex string of the ciphertext
   * @returns {boolean} true if this caller is the FIRST to claim; false if it is a duplicate
   */
  claim(packetHash) {
    const now = Date.now();

    // Check if another bridge already claimed this packet
    if (this.seen.has(packetHash)) {
      return false; // Duplicate dropped!
    }

    // First time seeing this packet: Claim it now
    this.seen.set(packetHash, now);
    return true; // Proceed to settle!
  }

  /**
   * Returns current count of cached hashes.
   */
  size() {
    return this.seen.size;
  }

  /**
   * Removes cached entries older than our TTL window (24 hours)
   * so memory does not grow infinitely.
   */
  evictExpired() {
    const cutoff = Date.now() - this.ttlSeconds * 1000;
    for (const [hash, timestamp] of this.seen.entries()) {
      if (timestamp < cutoff) {
        this.seen.delete(hash);
      }
    }
  }

  /**
   * Test/demo helper: clears the cache.
   */
  clear() {
    this.seen.clear();
  }

  /**
   * Cleanup timer when shutting down.
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Global singleton instance
export const idempotencyService = new IdempotencyService();
