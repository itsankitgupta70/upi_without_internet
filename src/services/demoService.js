import crypto from 'node:crypto';
import { accountRepository } from '../db/repositories.js';
import { Account } from '../models/Account.js';
import { PaymentInstruction } from '../models/PaymentInstruction.js';
import { MeshPacket } from '../models/MeshPacket.js';
import { hybridCryptoService } from '../crypto/hybridCryptoService.js';
import { serverKeyHolder } from '../crypto/serverKeyHolder.js';

/**
 * ==============================================================================
 * DEMO SERVICE (SIMULATOR FACTORY & SEEDER)
 * ==============================================================================
 *
 * Helper service that:
 * 1. Seeds default demo bank accounts on startup so the system is ready to use immediately.
 * 2. Simulates what happens on a user's smartphone when they send money offline.
 *
 * HOW SENDER PHONE CREATION WORKS (FOR BEGINNERS):
 * - In a physical deployment, this exact code runs locally in the Android/iOS app.
 * - When Alice clicks "Send ₹500" with PIN "1234":
 *   1. Her phone hashes the PIN with SHA-256.
 *   2. Generates a random UUID nonce.
 *   3. Packages sender, receiver, amount, nonce, and current epoch time.
 *   4. Encrypts the payload with the server's RSA public key (cached earlier).
 *   5. Wraps the ciphertext into a MeshPacket with TTL = 5.
 *   6. Broadcasts the packet over Bluetooth to nearby phones!
 */
export class DemoService {
  constructor(
    accounts = accountRepository,
    cryptoService = hybridCryptoService,
    keyHolder = serverKeyHolder
  ) {
    this.accounts = accounts;
    this.crypto = cryptoService;
    this.keyHolder = keyHolder;
    this.seedAccounts();
  }

  /**
   * Seeds demo accounts if the database is currently empty.
   */
  seedAccounts() {
    if (this.accounts.count() === 0) {
      this.accounts.save(new Account('alice@demo', 'Alice', 5000.0));
      this.accounts.save(new Account('bob@demo', 'Bob', 1000.0));
      this.accounts.save(new Account('carol@demo', 'Carol', 2500.0));
      this.accounts.save(new Account('dave@demo', 'Dave', 500.0));
      console.log('[DemoService] Pre-seeded 4 bank accounts: Alice (₹5000), Bob (₹1000), Carol (₹2500), Dave (₹500)');
    }
  }

  /**
   * Simulates a sender smartphone creating an encrypted payment packet while offline.
   *
   * @param {string} senderVpa - Sender VPA (e.g. "alice@demo")
   * @param {string} receiverVpa - Receiver VPA (e.g. "bob@demo")
   * @param {number|string} amount - Transfer amount in INR
   * @param {string} pin - User's 4-digit UPI PIN
   * @param {number} [ttl=5] - Time to live (maximum Bluetooth hops)
   * @returns {MeshPacket} The signed and encrypted over-the-wire packet
   */
  createPacket(senderVpa, receiverVpa, amount, pin, ttl = 5) {
    // 1. Build payment instruction with nonce and timestamp
    const instruction = new PaymentInstruction({
      senderVpa,
      receiverVpa,
      amount,
      pinHash: this.sha256Hex(pin),
      nonce: crypto.randomUUID(),       // Unique UUID guarantees unique ciphertext
      signedAt: Date.now()              // Timestamp for freshness check
    });

    // 2. Encrypt using hybrid RSA-OAEP + AES-256-GCM with server's public key
    const ciphertext = this.crypto.encrypt(instruction, this.keyHolder.getPublicKey());

    // 3. Wrap into gossip wire packet
    return new MeshPacket({
      packetId: crypto.randomUUID(),
      ttl,
      createdAt: Date.now(),
      ciphertext
    });
  }

  /**
   * Computes SHA-256 hexadecimal string of input string.
   */
  sha256Hex(input) {
    return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
  }
}

// Global singleton instance
export const demoService = new DemoService();
