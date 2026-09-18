/**
 * ==============================================================================
 * MESH PACKET (OVER-THE-WIRE DATA FORMAT)
 * ==============================================================================
 *
 * This represents the physical packet transmitted from phone to phone over
 * Bluetooth Low Energy (BLE) or Wi-Fi Direct.
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * 1. Outer Header vs Inner Ciphertext:
 *    - The outer fields (`packetId`, `ttl`, `createdAt`) are unencrypted.
 *      Intermediary phones (strangers) need to read these fields so they know
 *      whether they have already seen this packet and how many hops remain.
 *    - The `ciphertext` field is completely encrypted with the server's public key.
 *      Strangers' phones carry this payload, but CANNOT read the amount,
 *      sender, receiver, or PIN!
 *
 * 2. TTL (Time To Live):
 *    Every time a phone relays a packet to another phone, it decrements the TTL
 *    by 1 (e.g., from 5 -> 4 -> 3...). When TTL reaches 0, the packet is no
 *    longer forwarded. This prevents packets from cycling endlessly through the mesh.
 *
 * 3. Why we don't trust `packetId` for server settlement:
 *    A rogue or buggy intermediate device could change `packetId` to a new random UUID.
 *    Therefore, the server ignores `packetId` for deduplication and instead hashes
 *    the authenticated `ciphertext`.
 */

export class MeshPacket {
  /**
   * @param {Object} data
   * @param {string} data.packetId - Random UUID used by phones to drop immediate gossip duplicates
   * @param {number} data.ttl - Number of hops remaining before forwarding stops (default 5)
   * @param {number} data.createdAt - Epoch milliseconds when the packet was created
   * @param {string} data.ciphertext - Base64 encoded hybrid encrypted payload
   */
  constructor({ packetId, ttl = 5, createdAt = Date.now(), ciphertext }) {
    this.packetId = packetId;
    this.ttl = ttl;
    this.createdAt = createdAt;
    this.ciphertext = ciphertext;
  }

  /**
   * Validates incoming HTTP request bodies before processing.
   * Throws friendly descriptive errors if fields are missing or invalid.
   */
  static validate(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Packet payload must be a valid JSON object');
    }
    if (!data.packetId || typeof data.packetId !== 'string') {
      throw new Error('Field "packetId" (string) is required');
    }
    if (typeof data.ttl !== 'number' || data.ttl < 0) {
      throw new Error('Field "ttl" must be a non-negative number');
    }
    if (typeof data.createdAt !== 'number') {
      throw new Error('Field "createdAt" must be an epoch millisecond number');
    }
    if (!data.ciphertext || typeof data.ciphertext !== 'string') {
      throw new Error('Field "ciphertext" (Base64 string) is required');
    }
    return new MeshPacket(data);
  }
}
