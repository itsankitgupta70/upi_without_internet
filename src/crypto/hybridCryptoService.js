import crypto from 'node:crypto';
import { serverKeyHolder } from './serverKeyHolder.js';
import { PaymentInstruction } from '../models/PaymentInstruction.js';

// Constant sizes for binary wire packing
const RSA_ENCRYPTED_KEY_BYTES = 256; // 2048-bit RSA key produces exactly 256 bytes of ciphertext
const GCM_IV_BYTES = 12;             // AES-GCM standard initialization vector is 12 bytes (96 bits)
const GCM_TAG_BYTES = 16;            // AES-GCM authentication tag is 16 bytes (128 bits)

/**
 * ==============================================================================
 * HYBRID CRYPTOGRAPHY SERVICE (RSA-2048 OAEP + AES-256-GCM)
 * ==============================================================================
 *
 * This service implements the same encryption architecture used by HTTPS/TLS,
 * Signal, and PGP: Hybrid Encryption.
 *
 * WHY HYBRID ENCRYPTION IS NEEDED (FOR BEGINNERS):
 * 1. RSA is slow and has a strict size limit:
 *    A 2048-bit RSA key can only encrypt up to ~214 to 245 bytes of data at a time.
 *    Our JSON payment instruction with signatures, certificates, and VPAs could
 *    easily exceed that limit.
 *
 * 2. AES is fast and has no size limit:
 *    Symmetric AES encryption can encrypt gigabytes of data in milliseconds.
 *    However, both sender and receiver must share the same secret key beforehand.
 *
 * 3. The Hybrid Solution:
 *    - Step A: Generate a brand new, random 256-bit AES key (the "session key")
 *              specifically for this one single payment.
 *    - Step B: Encrypt the large JSON payment instruction using this AES key with
 *              AES-256-GCM.
 *    - Step C: Encrypt only the small 32-byte AES key using the server's RSA Public Key
 *              (using RSA-OAEP padding).
 *    - Step D: Combine everything into one single binary package:
 *              [256B RSA-encrypted AES key] + [12B IV] + [AES ciphertext] + [16B Auth Tag]
 *    - Step E: Base64 encode the combined package for safe transmission over text protocols.
 *
 * WHY AES-GCM (AUTHENTICATED ENCRYPTION)?
 * - Normal encryption only hides data; it does not stop an attacker from modifying it!
 * - AES-GCM generates a 16-byte cryptographic "Authentication Tag" alongside ciphertext.
 * - If any stranger changes even a single bit of the packet in transit, decryption
 *   will immediately throw an error and refuse to process the payment!
 */
export class HybridCryptoService {
  constructor(keyHolder = serverKeyHolder) {
    this.keyHolder = keyHolder;
  }

  /**
   * Encrypt a PaymentInstruction with the server's RSA public key.
   * Simulates what runs inside the sender's phone when they click "Send".
   *
   * @param {PaymentInstruction|Object} instruction - The cleartext payment data
   * @param {crypto.KeyObject} [serverPublicKey] - Server's public key
   * @returns {string} Base64 encoded hybrid encrypted string
   */
  encrypt(instruction, serverPublicKey = this.keyHolder.getPublicKey()) {
    // 1. Serialize cleartext payment instruction into UTF-8 JSON bytes
    const jsonStr = JSON.stringify(instruction);
    const plaintext = Buffer.from(jsonStr, 'utf8');

    // 2. Generate a random, one-time 256-bit (32 bytes) AES session key
    const aesKey = crypto.randomBytes(32);

    // 3. Generate a random 12-byte Initialization Vector (IV) for GCM mode
    // (Never reuse an IV with the same AES key!)
    const iv = crypto.randomBytes(GCM_IV_BYTES);

    // 4. Encrypt the payload using AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const aesCiphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16-byte authentication tag

    // 5. Encrypt the AES session key using the server's RSA public key with OAEP padding
    const encryptedAesKey = crypto.publicEncrypt(
      {
        key: serverPublicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256' // Optimal Asymmetric Encryption Padding with SHA-256
      },
      aesKey
    );

    // 6. Pack into wire format:
    // [256 bytes RSA key][12 bytes IV][AES ciphertext][16 bytes Auth Tag]
    const packed = Buffer.concat([encryptedAesKey, iv, aesCiphertext, authTag]);

    // 7. Convert to Base64 string for easy transmission over HTTP/JSON
    return packed.toString('base64');
  }

  /**
   * Decrypt Base64 ciphertext with the server's RSA private key.
   * Runs on the server when a bridge node uploads a packet.
   *
   * @param {string} base64Ciphertext - The Base64 string from MeshPacket
   * @returns {PaymentInstruction} Decrypted and parsed payment instruction
   * @throws {Error} If tampered, wrong key, or corrupt data
   */
  decrypt(base64Ciphertext) {
    // 1. Decode Base64 string back into raw bytes
    const all = Buffer.from(base64Ciphertext, 'base64');

    // Minimum valid length check
    if (all.length < RSA_ENCRYPTED_KEY_BYTES + GCM_IV_BYTES + GCM_TAG_BYTES) {
      throw new Error('Ciphertext payload is truncated or too short to be valid');
    }

    // 2. Unpack binary fields according to our wire protocol layout
    const encryptedAesKey = all.subarray(0, RSA_ENCRYPTED_KEY_BYTES);
    const iv = all.subarray(RSA_ENCRYPTED_KEY_BYTES, RSA_ENCRYPTED_KEY_BYTES + GCM_IV_BYTES);
    const aesCiphertext = all.subarray(
      RSA_ENCRYPTED_KEY_BYTES + GCM_IV_BYTES,
      all.length - GCM_TAG_BYTES
    );
    const authTag = all.subarray(all.length - GCM_TAG_BYTES);

    // 3. RSA-decrypt the 256-byte blob using the server's private key to recover the AES key
    const aesKey = crypto.privateDecrypt(
      {
        key: this.keyHolder.getPrivateKey(),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      encryptedAesKey
    );

    // 4. AES-GCM decrypt the payload AND verify the authentication tag
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);

    // If any byte of the ciphertext, IV, or auth tag was tampered with,
    // decipher.final() will immediately throw an authentication error!
    const plaintext = Buffer.concat([decipher.update(aesCiphertext), decipher.final()]);

    // 5. Parse the decrypted UTF-8 JSON back into a PaymentInstruction object
    const parsed = JSON.parse(plaintext.toString('utf8'));
    return new PaymentInstruction(parsed);
  }

  /**
   * Computes the SHA-256 hash of the Base64 ciphertext.
   * THIS IS OUR IDEMPOTENCY KEY.
   *
   * WHY HASH THE CIPHERTEXT (FOR BEGINNERS):
   * - Hashing the ciphertext allows us to check for duplicates BEFORE spending
   *   expensive CPU cycles on RSA decryption.
   * - Two transmissions of the exact same payment will have identical ciphertexts,
   *   and therefore produce identical SHA-256 hashes.
   * - Attackers cannot forge a new valid ciphertext with the same hash.
   *
   * @param {string} base64Ciphertext
   * @returns {string} 64-character SHA-256 hexadecimal string
   */
  hashCiphertext(base64Ciphertext) {
    return crypto.createHash('sha256').update(base64Ciphertext, 'utf8').digest('hex');
  }
}

// Singleton instance
export const hybridCryptoService = new HybridCryptoService();
