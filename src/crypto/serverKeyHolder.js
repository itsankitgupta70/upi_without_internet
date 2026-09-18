import crypto from 'node:crypto';

/**
 * ==============================================================================
 * SERVER KEY HOLDER (ASYMMETRIC RSA KEYPAIR GENERATION)
 * ==============================================================================
 *
 * Manages the server's master cryptographic identity.
 *
 * HOW ASYMMETRIC CRYPTOGRAPHY WORKS (FOR BEGINNERS):
 * - Unlike symmetric encryption where the same password locks and unlocks a door,
 *   asymmetric encryption uses a mathematically linked KEY PAIR:
 *   1. PUBLIC KEY: Can be distributed to everyone in the world. Anyone can use
 *      it to LOCK (encrypt) a message.
 *   2. PRIVATE KEY: Kept strictly secret on the server. Only this key can
 *      UNLOCK (decrypt) messages encrypted with the matching public key.
 *
 * - In our offline UPI architecture:
 *   - The sender phone caches the server's PUBLIC KEY when online.
 *   - When in an offline basement, the phone encrypts its payment with this public key.
 *   - Stranger phones relaying the packet CANNOT read it because none of them
 *     have the private key.
 *   - Only our backend server possesses the PRIVATE KEY and can decrypt it!
 *
 * IN PRODUCTION:
 * - This private key would be safely stored in a Hardware Security Module (HSM)
 *   or cloud key management service (like AWS KMS or HashiCorp Vault), never in memory.
 * - For our self-contained application, we generate a fresh 2048-bit RSA keypair
 *   on startup.
 */

export class ServerKeyHolder {
  constructor() {
    this.keyPair = null;
    this.publicKeyObject = null;
    this.privateKeyObject = null;
    this.publicKeyDer = null;
    this.init();
  }

  /**
   * Generates a 2048-bit RSA keypair on application startup.
   */
  init() {
    // Generate RSA keypair with 2048-bit modulus length
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki', // SubjectPublicKeyInfo (standard X.509 format)
        format: 'der' // Binary encoding
      },
      privateKeyEncoding: {
        type: 'pkcs8', // Standard private key format
        format: 'der'
      }
    });

    this.publicKeyDer = publicKey;
    this.privateKeyDer = privateKey;

    // Create high-performance KeyObjects for cryptographic operations
    this.publicKeyObject = crypto.createPublicKey({
      key: publicKey,
      format: 'der',
      type: 'spki'
    });

    this.privateKeyObject = crypto.createPrivateKey({
      key: privateKey,
      format: 'der',
      type: 'pkcs8'
    });

    const fingerprint = this.getPublicKeyBase64().substring(0, 32) + '...';
    console.log(`[ServerKeyHolder] RSA keypair initialized (2048-bit). Public key fingerprint: ${fingerprint}`);
  }

  /**
   * Returns the server's public key object.
   */
  getPublicKey() {
    return this.publicKeyObject;
  }

  /**
   * Returns the server's private key object.
   */
  getPrivateKey() {
    return this.privateKeyObject;
  }

  /**
   * Returns the server's public key as a Base64 string for delivery via HTTP API.
   */
  getPublicKeyBase64() {
    return this.publicKeyDer.toString('base64');
  }
}

// Export singleton instance so all services share the same keypair
export const serverKeyHolder = new ServerKeyHolder();
