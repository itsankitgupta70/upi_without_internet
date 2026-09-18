/**
 * ==============================================================================
 * PAYMENT INSTRUCTION (DECRYPTED INNER PAYLOAD)
 * ==============================================================================
 *
 * This is the cleartext payload that is hidden inside MeshPacket.ciphertext.
 * Only the server's private key can decrypt this information.
 *
 * CRITICAL SECURITY FIELDS EXPLAINED FOR BEGINNERS:
 * 1. `nonce` (Number Used ONCE):
 *    Imagine Alice pays Bob ₹100 twice in a row:
 *    - Both payments have sender = "alice@demo", receiver = "bob@demo", amount = 100.
 *    - Without a nonce, both payments would have identical plaintext!
 *    - By adding a fresh, random UUID nonce to each payment, every payment intent
 *      produces a completely unique ciphertext.
 *    - This allows the server to distinguish between two intentional identical
 *      payments vs an accidental duplicate network transmission!
 *
 * 2. `signedAt`:
 *    Epoch timestamp recorded by the sender's device when signing offline.
 *    The server uses this to enforce a freshness window (max 24 hours).
 *    If an attacker snoops on a ciphertext and tries to upload it 3 weeks later,
 *    the server rejects it as stale.
 *
 * 3. `pinHash`:
 *    The SHA-256 hash of the sender's 4-digit UPI PIN. In a real banking app,
 *    the bank verifies this hash against customer records before releasing funds.
 */

export class PaymentInstruction {
  /**
   * @param {Object} data
   * @param {string} data.senderVpa - Sender VPA, e.g. "alice@demo"
   * @param {string} data.receiverVpa - Receiver VPA, e.g. "bob@demo"
   * @param {number|string} data.amount - Amount to transfer in INR
   * @param {string} data.pinHash - SHA-256 hash of user's UPI PIN
   * @param {string} data.nonce - Unique random UUID
   * @param {number} data.signedAt - Epoch milliseconds when created offline
   */
  constructor({ senderVpa, receiverVpa, amount, pinHash, nonce, signedAt }) {
    this.senderVpa = senderVpa;
    this.receiverVpa = receiverVpa;
    this.amount = typeof amount === 'number' ? amount.toFixed(2) : amount;
    this.pinHash = pinHash;
    this.nonce = nonce;
    this.signedAt = signedAt;
  }
}
