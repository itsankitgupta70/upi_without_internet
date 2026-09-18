import { Router } from 'express';
import { serverKeyHolder } from '../crypto/serverKeyHolder.js';
import { demoService } from '../services/demoService.js';
import { meshSimulatorService } from '../services/meshSimulatorService.js';
import { bridgeIngestionService } from '../services/bridgeIngestionService.js';
import { idempotencyService } from '../services/idempotencyService.js';
import { accountRepository, transactionRepository } from '../db/repositories.js';
import { MeshPacket } from '../models/MeshPacket.js';

/**
 * ==============================================================================
 * API ROUTES (PUBLIC REST SURFACE)
 * ==============================================================================
 *
 * Exposes all REST endpoints for the dashboard and external bridge nodes.
 *
 * ENDPOINT CATEGORIES:
 * 1. Cryptographic Keys:
 *    - `GET /api/server-key` -> Exposes server's RSA public key in Base64.
 *
 * 2. Mesh Simulator Controls:
 *    - `POST /api/demo/send`  -> Simulates sender phone encrypting & injecting a packet.
 *    - `GET  /api/mesh/state` -> Returns list of devices and packets held by each.
 *    - `POST /api/mesh/gossip`-> Runs 1 round of Bluetooth gossip between phones.
 *    - `POST /api/mesh/flush` -> Bridge nodes upload their held packets simultaneously.
 *    - `POST /api/mesh/reset` -> Clears simulator state and idempotency cache.
 *
 * 3. The Production Ingestion Endpoint:
 *    - `POST /api/bridge/ingest` -> Where real or simulated bridge phones POST packets.
 *
 * 4. Bank Ledger Data:
 *    - `GET /api/accounts`     -> Returns balances for all bank accounts.
 *    - `GET /api/transactions` -> Returns the 20 most recent transactions.
 */

export const apiRouter = Router();

// ==============================================================================
// 1. CRYPTOGRAPHIC KEY ENDPOINT
// ==============================================================================
apiRouter.get('/server-key', (req, res) => {
  res.json({
    publicKey: serverKeyHolder.getPublicKeyBase64(),
    algorithm: 'RSA-2048 / OAEP-SHA256',
    hybridScheme: 'RSA-OAEP encrypts an AES-256-GCM session key'
  });
});

// ==============================================================================
// 2. DEMO SENDER INJECTION
// ==============================================================================
apiRouter.post('/demo/send', (req, res) => {
  try {
    const { senderVpa, receiverVpa, amount, pin, ttl, startDevice } = req.body;

    // Input validation
    if (!senderVpa || !receiverVpa || !amount || !pin) {
      return res.status(400).json({ error: 'senderVpa, receiverVpa, amount, and pin are required' });
    }

    // 1. Simulate sender phone encrypting the payment offline
    const packet = demoService.createPacket(
      senderVpa,
      receiverVpa,
      parseFloat(amount),
      String(pin),
      ttl == null ? 5 : parseInt(ttl, 10)
    );

    // 2. Place packet in the sender's virtual device (defaults to phone-alice)
    const deviceName = startDevice || 'phone-alice';
    meshSimulatorService.inject(deviceName, packet);

    res.json({
      packetId: packet.packetId,
      ciphertextPreview: packet.ciphertext.substring(0, 64) + '...',
      ttl: packet.ttl,
      injectedAt: deviceName
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
// 3. MESH SIMULATOR ENDPOINTS
// ==============================================================================

/**
 * Returns current state of all phones in the mesh and their held packets.
 */
apiRouter.get('/mesh/state', (req, res) => {
  const deviceData = meshSimulatorService.getDevices().map(d => ({
    deviceId: d.getDeviceId(),
    hasInternet: d.getHasInternet(),
    packetCount: d.packetCount(),
    packetIds: d.getHeldPackets().map(p => p.packetId.substring(0, 8))
  }));

  res.json({
    devices: deviceData,
    idempotencyCacheSize: idempotencyService.size()
  });
});

/**
 * Runs one round of Bluetooth gossip: Every device shares packets with peers.
 */
apiRouter.post('/mesh/gossip', (req, res) => {
  const result = meshSimulatorService.gossipOnce();
  res.json({
    transfers: result.transfers,
    deviceCounts: result.deviceCounts
  });
});

/**
 * Simulates bridge devices walking outside and uploading packets concurrently.
 * Exercises concurrent idempotency handling.
 */
apiRouter.post('/mesh/flush', async (req, res) => {
  const uploads = meshSimulatorService.collectBridgeUploads();

  // Execute bridge uploads in parallel via Promise.all
  const results = await Promise.all(
    uploads.map(async up => {
      const hopCount = 5 - up.packet.ttl;
      const ingestResult = bridgeIngestionService.ingest(up.packet, up.bridgeNodeId, hopCount);
      return {
        bridgeNode: up.bridgeNodeId,
        packetId: up.packet.packetId.substring(0, 8),
        outcome: ingestResult.outcome,
        reason: ingestResult.reason || '',
        transactionId: ingestResult.transactionId ?? -1
      };
    })
  );

  res.json({
    uploadsAttempted: uploads.length,
    results
  });
});

/**
 * Resets all virtual devices and clears the server's idempotency cache.
 */
apiRouter.post('/mesh/reset', (req, res) => {
  meshSimulatorService.resetMesh();
  idempotencyService.clear();
  res.json({ status: 'mesh and idempotency cache cleared' });
});

// ==============================================================================
// 4. PRODUCTION INGESTION ENDPOINT
// ==============================================================================

/**
 * THE REAL INGESTION ENDPOINT.
 * In a production Android/iOS app, the phone POSTs directly here when it gains 4G.
 */
apiRouter.post('/bridge/ingest', (req, res) => {
  try {
    const packet = MeshPacket.validate(req.body);
    const bridgeNodeId = req.header('X-Bridge-Node-Id') || 'unknown';
    const hopCount = parseInt(req.header('X-Hop-Count') || '0', 10);

    const result = bridgeIngestionService.ingest(packet, bridgeNodeId, hopCount);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      outcome: 'INVALID',
      packetHash: '?',
      reason: err.message,
      transactionId: null
    });
  }
});

// ==============================================================================
// 5. LEDGER & ACCOUNTS ENDPOINTS
// ==============================================================================

/**
 * Returns all account VPAs and their current balances.
 */
apiRouter.get('/accounts', (req, res) => {
  res.json(accountRepository.findAll());
});

/**
 * Returns recent settled transactions.
 */
apiRouter.get('/transactions', (req, res) => {
  res.json(transactionRepository.findTop20ByOrderByIdDesc());
});
