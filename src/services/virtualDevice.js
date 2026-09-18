/**
 * ==============================================================================
 * VIRTUAL DEVICE MODEL (SIMULATED SMARTPHONE)
 * ==============================================================================
 *
 * Represents a single smartphone in our simulated Bluetooth mesh network.
 *
 * WHY SIMULATE DEVICES (FOR BEGINNERS):
 * - Testing real Bluetooth mesh networks requires carrying 5 physical Android phones
 *   into an underground basement and walking around!
 * - In software engineering, we build a simulator so we can test the entire
 *   network topology, multi-hop routing, and edge cases right on a laptop.
 *
 * EACH DEVICE HAS:
 * - `deviceId`: Name of the phone (e.g. "phone-alice", "phone-bridge").
 * - `hasInternet`: Boolean indicating whether this phone has mobile data/Wi-Fi.
 *   - Offline phones (`false`) can only communicate locally via Bluetooth.
 *   - Bridge phones (`true`) can upload data directly to our backend server.
 * - `heldPackets`: In-memory storage of all mesh packets currently cached on this phone.
 */
export class VirtualDevice {
  /**
   * @param {string} deviceId - Unique device identifier
   * @param {boolean} hasInternet - True if device currently has internet access
   */
  constructor(deviceId, hasInternet) {
    this.deviceId = deviceId;
    this.hasInternet = hasInternet;
    this.heldPackets = new Map(); // packetId -> MeshPacket
  }

  getDeviceId() {
    return this.deviceId;
  }

  getHasInternet() {
    return this.hasInternet;
  }

  /**
   * Stores a newly received packet on this phone.
   * If the phone has already seen this packetId, it ignores it.
   */
  hold(packet) {
    if (!this.heldPackets.has(packet.packetId)) {
      this.heldPackets.set(packet.packetId, packet);
    }
  }

  /**
   * Returns an array of all packets currently held on this device.
   */
  getHeldPackets() {
    return Array.from(this.heldPackets.values());
  }

  /**
   * Checks if this device already holds a packet with the specified packetId.
   */
  holds(packetId) {
    return this.heldPackets.has(packetId);
  }

  /**
   * Returns how many packets are stored on this device.
   */
  packetCount() {
    return this.heldPackets.size;
  }

  /**
   * Erases all held packets (used during demo resets).
   */
  clear() {
    this.heldPackets.clear();
  }
}
