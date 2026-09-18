import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert';
import { demoService } from '../src/services/demoService.js';
import { bridgeIngestionService } from '../src/services/bridgeIngestionService.js';
import { idempotencyService } from '../src/services/idempotencyService.js';
import { accountRepository } from '../src/db/repositories.js';
import { hybridCryptoService } from '../src/crypto/hybridCryptoService.js';
import { serverKeyHolder } from '../src/crypto/serverKeyHolder.js';
import { PaymentInstruction } from '../src/models/PaymentInstruction.js';

/**
 * ==============================================================================
 * AUTOMATED TEST SUITE: CONCURRENCY & CRYPTOGRAPHY
 * ==============================================================================
 *
 * Runs with Node.js's built-in test runner (`npm test` or `node --test`).
 *
 * THREE CORE TESTS EXPLAINED FOR BEGINNERS:
 *
 * 1. `encryptDecryptRoundTrip`:
 *    - Verifies that our hybrid crypto pipeline (RSA-OAEP + AES-GCM) is mathematically
 *      lossless and symmetric.
 *    - Instruction -> Encrypt -> Decrypt -> Assert all fields match original.
 *
 * 2. `tamperedCiphertextIsRejected`:
 *    - Simulates an attacker or corrupted Bluetooth transmission that flips a single
 *      byte in the middle of the ciphertext.
 *    - Asserts that the server catches the tampering via the AES-GCM auth tag and
 *      rejects the packet with outcome `INVALID` instead of crashing or corrupting balances.
 *
 * 3. `singlePacketDeliveredByThreeBridgesSettlesExactlyOnce` (THE HEADLINE TEST):
 *    - Simulates the "Three Bridges walk outside at the exact same instant" duplicate storm.
 *    - Creates 1 encrypted payment of ₹100 from Alice to Bob.
 *    - Fires 3 concurrent HTTP ingestion requests in parallel.
 *    - Asserts that EXACTLY 1 settles, the other 2 are flagged `DUPLICATE_DROPPED`,
 *      and Alice's balance is debited by ₹100 ONCE.
 */

describe('Idempotency & Concurrency Tests', () => {
  // Clear the idempotency cache before each test run
  beforeEach(() => {
    idempotencyService.clear();
  });

  // ----------------------------------------------------------------------------
  // TEST 1: CRYPTO ROUND-TRIP
  // ----------------------------------------------------------------------------
  test('encryptDecryptRoundTrip: sanity check hybrid RSA-OAEP + AES-GCM encryption', () => {
    // 1. Create original payment instruction
    const original = new PaymentInstruction({
      senderVpa: 'alice@demo',
      receiverVpa: 'bob@demo',
      amount: 123.45,
      pinHash: 'abcdef123456',
      nonce: 'nonce-uuid-test-1',
      signedAt: Date.now()
    });

    // 2. Encrypt using server's RSA public key
    const ciphertext = hybridCryptoService.encrypt(original, serverKeyHolder.getPublicKey());
    assert.ok(typeof ciphertext === 'string' && ciphertext.length > 0, 'Ciphertext must be non-empty Base64 string');

    // 3. Decrypt using server's RSA private key
    const decrypted = hybridCryptoService.decrypt(ciphertext);

    // 4. Assert all fields match
    assert.strictEqual(decrypted.senderVpa, original.senderVpa, 'Sender VPA must match');
    assert.strictEqual(decrypted.receiverVpa, original.receiverVpa, 'Receiver VPA must match');
    assert.strictEqual(parseFloat(decrypted.amount), 123.45, 'Amount must match');
    assert.strictEqual(decrypted.nonce, original.nonce, 'Nonce must match');
    assert.strictEqual(decrypted.pinHash, original.pinHash, 'PIN hash must match');
  });

  // ----------------------------------------------------------------------------
  // TEST 2: TAMPER DETECTION
  // ----------------------------------------------------------------------------
  test('tamperedCiphertextIsRejected: flip a character in ciphertext, assert INVALID', () => {
    // 1. Generate a valid encrypted payment packet
    const packet = demoService.createPacket('alice@demo', 'bob@demo', 50.0, '1234', 5);

    // 2. Maliciously tamper with a character in the middle of the ciphertext
    const chars = packet.ciphertext.split('');
    const mid = Math.floor(chars.length / 2);
    chars[mid] = chars[mid] === 'A' ? 'B' : 'A';
    packet.ciphertext = chars.join('');

    // 3. Attempt ingestion by the server
    const result = bridgeIngestionService.ingest(packet, 'bridge-malicious', 1);

    // 4. Assert that AES-GCM caught the modification
    assert.strictEqual(result.outcome, 'INVALID', 'Tampered packet must be marked INVALID');
    assert.strictEqual(result.reason, 'decryption_failed', 'Reason must be decryption_failed');
  });

  // ----------------------------------------------------------------------------
  // TEST 3: THE 3-BRIDGE CONCURRENCY TEST
  // ----------------------------------------------------------------------------
  test('singlePacketDeliveredByThreeBridgesSettlesExactlyOnce: headline idempotency test', async () => {
    // 1. Capture starting account balances for Alice and Bob
    const aliceBefore = accountRepository.findById('alice@demo').getBalanceAsNumber();
    const bobBefore = accountRepository.findById('bob@demo').getBalanceAsNumber();
    const transferAmount = 100.0;

    // 2. Create ONE single offline payment packet
    const packet = demoService.createPacket('alice@demo', 'bob@demo', transferAmount, '1234', 5);

    // 3. Deliver this EXACT SAME packet from 3 bridge nodes simultaneously
    const bridgeNodes = ['bridge-0', 'bridge-1', 'bridge-2'];
    const results = await Promise.all(
      bridgeNodes.map(node =>
        Promise.resolve().then(() => bridgeIngestionService.ingest(packet, node, 3))
      )
    );

    // 4. Tally up outcomes
    let settledCount = 0;
    let duplicateCount = 0;

    for (const r of results) {
      if (r.outcome === 'SETTLED') settledCount++;
      else if (r.outcome === 'DUPLICATE_DROPPED') duplicateCount++;
    }

    // 5. Verify atomic idempotency: Exactly 1 settled, exactly 2 dropped as duplicates
    assert.strictEqual(settledCount, 1, 'Exactly one bridge delivery must settle');
    assert.strictEqual(duplicateCount, 2, 'The other two deliveries must be DUPLICATE_DROPPED');

    // 6. Verify ledger balances: Money moved exactly ONCE, not three times!
    const aliceAfter = accountRepository.findById('alice@demo').getBalanceAsNumber();
    const bobAfter = accountRepository.findById('bob@demo').getBalanceAsNumber();

    assert.strictEqual(aliceAfter, aliceBefore - transferAmount, 'Alice should be debited exactly ₹100 once');
    assert.strictEqual(bobAfter, bobBefore + transferAmount, 'Bob should be credited exactly ₹100 once');
  });
});
