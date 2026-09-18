import { VirtualDevice } from './virtualDevice.js';
import { MeshPacket } from '../models/MeshPacket.js';

/**
 * ==============================================================================
 * MESH SIMULATOR SERVICE (EPIDEMIC GOSSIP ROUTING)
 * ==============================================================================
 *
 * Simulates a peer-to-peer Bluetooth Low Energy (BLE) mesh network.
 *
 * HOW GOSSIP PROTOCOLS WORK (FOR BEGINNERS):
 * - In a mesh network, there is no central Wi-Fi router or cell tower in the basement.
 * - Instead, devices use "gossip" (epidemic routing):
 *   Whenever Device A comes within Bluetooth range of Device B, Device A says:
 *   "Here are the encrypted packets I'm holding. Do you have these?"
 * - Device B accepts any new packets, decrements their TTL, and stores them.
 * - As people walk past each other, the packet travels from phone to phone
 *   like a digital rumor.
 *
 * THE DEFAULT SIMULATOR SCENARIO:
 * - 4 offline phones trapped in an underground basement:
 *   - `phone-alice` (Sender)
 *   - `phone-stranger1`
 *   - `phone-stranger2`
 *   - `phone-stranger3`
 * - 1 phone near the exit with 4G internet connectivity:
 *   - `phone-bridge`
 */
export class MeshSimulatorService {
  constructor() {
    this.devices = new Map();
    this.seedDefaultDevices();
  }

  /**
   * Initializes the default network topology.
   */
  seedDefaultDevices() {
    this.devices.set('phone-alice', new VirtualDevice('phone-alice', false));
    this.devices.set('phone-stranger1', new VirtualDevice('phone-stranger1', false));
    this.devices.set('phone-stranger2', new VirtualDevice('phone-stranger2', false));
    this.devices.set('phone-stranger3', new VirtualDevice('phone-stranger3', false));
    this.devices.set('phone-bridge', new VirtualDevice('phone-bridge', true));
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  getDevice(id) {
    return this.devices.get(id);
  }

  /**
   * Simulates the sender phone creating a packet and saving it into its own memory.
   *
   * @param {string} senderDeviceId - e.g. "phone-alice"
   * @param {MeshPacket} packet - The newly signed & encrypted mesh packet
   */
  inject(senderDeviceId, packet) {
    const sender = this.devices.get(senderDeviceId);
    if (!sender) {
      throw new Error(`Unknown device: ${senderDeviceId}`);
    }
    sender.hold(packet);
    console.log(
      `[MeshSimulatorService] Packet ${packet.packetId.substring(0, 8)} injected at ${senderDeviceId} (TTL=${packet.ttl})`
    );
  }

  /**
   * Simulates one round of Bluetooth gossip across all devices in range.
   *
   * In a single round:
   * 1. We take a snapshot of what each phone holds at the start of the round.
   * 2. For every phone holding a packet, it shares that packet with all neighboring phones.
   * 3. The receiving phone creates a copy with TTL decremented by 1.
   * 4. If a packet has TTL <= 0, it stays on the current phone but is not forwarded further.
   *
   * @returns {{ transfers: number, deviceCounts: Object<string, number> }}
   */
  gossipOnce() {
    let transfers = 0;
    const deviceList = Array.from(this.devices.values());

    // Step 1: Snapshot current state so packets don't instantly jump through 5 hops in 1 step
    const snapshot = new Map();
    for (const d of deviceList) {
      snapshot.set(d.getDeviceId(), [...d.getHeldPackets()]);
    }

    // Step 2: Iterate over all devices and their held packets
    for (const src of deviceList) {
      const packets = snapshot.get(src.getDeviceId()) || [];
      for (const pkt of packets) {
        // If TTL has expired, this packet cannot be forwarded further
        if (pkt.ttl <= 0) continue;

        // Step 3: Broadcast packet to all peer devices
        for (const dst of deviceList) {
          if (dst === src) continue; // Don't forward to yourself
          if (dst.holds(pkt.packetId)) continue; // Peer already holds this packet

          // Create a new packet copy with TTL decremented by 1
          const copy = new MeshPacket({
            packetId: pkt.packetId,
            ttl: pkt.ttl - 1,
            createdAt: pkt.createdAt,
            ciphertext: pkt.ciphertext
          });

          dst.hold(copy);
          transfers++;
        }
      }
    }

    console.log(`[MeshSimulatorService] Gossip round complete: ${transfers} packet transfers`);
    return {
      transfers,
      deviceCounts: this.snapshotMap()
    };
  }

  /**
   * Returns a map of deviceId -> number of held packets.
   */
  snapshotMap() {
    const map = {};
    for (const d of this.devices.values()) {
      map[d.getDeviceId()] = d.packetCount();
    }
    return map;
  }

  /**
   * Finds all packets held by phones that currently have internet connectivity.
   * These are the packets ready to be uploaded to our backend server!
   *
   * @returns {Array<{ bridgeNodeId: string, packet: MeshPacket }>}
   */
  collectBridgeUploads() {
    const uploads = [];
    for (const d of this.devices.values()) {
      if (!d.getHasInternet()) continue; // Skip offline phones
      for (const pkt of d.getHeldPackets()) {
        uploads.push({
          bridgeNodeId: d.getDeviceId(),
          packet: pkt
        });
      }
    }
    return uploads;
  }

  /**
   * Resets all devices, clearing their stored packets.
   */
  resetMesh() {
    for (const d of this.devices.values()) {
      d.clear();
    }
    console.log('[MeshSimulatorService] All virtual devices cleared');
  }
}

// Global singleton instance
export const meshSimulatorService = new MeshSimulatorService();
