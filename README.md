# UPI Offline Mesh

A Node.js backend demonstrating **offline UPI payments routed through a peer-to-peer Bluetooth mesh network**.

Imagine you are in an underground basement or stadium with zero cellular connectivity. You need to pay your friend ₹500. Your phone cryptographically signs and encrypts the payment, broadcasts it over Bluetooth to nearby phones, and the packet hops device-to-device until *some* phone walks outside, catches a 4G connection, and uploads it to the backend server. The server verifies the cryptographic authentication tag, deduplicates identical deliveries, and settles the ledger.

This repository contains the **server-side banking engine**, an **epidemic Bluetooth mesh simulator**, and an **interactive real-time dashboard** allowing you to test the complete end-to-end payment pipeline locally.

> **Beginner Friendly:** Every source file in this project is documented with comprehensive, beginner-friendly comments. Concepts like Asymmetric RSA, AES-GCM Authenticated Encryption, Optimistic Locking, and Idempotency are explained step-by-step so anyone can understand how the code works.

---

## Table of Contents

1. [What This Project Solves](#what-this-project-solves)
2. [Quick Start (Run in 2 Minutes)](#quick-start-run-in-2-minutes)
3. [The 3-Step Demo Flow](#the-3-step-demo-flow)
4. [Architecture & Security Blueprint](#architecture--security-blueprint)
5. [The Three Hard Problems & Their Solutions](#the-three-hard-problems--their-solutions)
6. [Codebase & File Structure](#codebase--file-structure)
7. [API Reference](#api-reference)
8. [Automated Concurrency Tests](#automated-concurrency-tests)
9. [What's NOT Real (Production Considerations)](#whats-not-real-production-considerations)

---

## What This Project Solves

Traditional digital payment rails (UPI, credit cards, banking APIs) require an active internet connection at both ends at the exact moment of payment. If either the merchant or customer is in an area with zero signal (parking garages, rural zones, disaster sites), the transaction fails.

This project proves three core engineering principles:

1. **Untrusted Intermediaries Cannot Read or Alter Payments:**
   Stranger devices relay your transaction packet without ever seeing the amount, sender, receiver, or PIN. If any intermediary tampers with even a single bit of the packet, the server's cryptographic authentication tag check fails immediately.
2. **Atomic Idempotency (The Duplicate-Storm Solution):**
   If 3 different bridge phones receive the same payment packet in the mesh and all walk outside into 4G coverage at the same second, they will simultaneously upload the packet. The server's idempotency engine guarantees that the payment settles **exactly once** and drops duplicate deliveries before touching the balance ledger.
3. **Replay & Stale Attack Prevention:**
   A fresh nonce and signed timestamp ensure that old packets intercepted weeks ago cannot be replayed.

---

## Quick Start (Run in 2 Minutes)

### Prerequisites

- **Node.js v18 or newer** (v18, v20, or v24). Check with `node -v`.
- **npm** (comes with Node.js).
- No external databases, no Docker, and no C++ compilers required.

### 1. Install Dependencies

Open a terminal in the project folder:

```bash
npm install
```

### 2. Start the Application

```bash
npm start
```

You should see output similar to:

```text
[ServerKeyHolder] RSA keypair initialized (2048-bit). Public key fingerprint: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
[DemoService] Pre-seeded 4 bank accounts: Alice (₹5000), Bob (₹1000), Carol (₹2500), Dave (₹500)

======================================================
📡 UPI Offline Mesh — Server Started Successfully!
🌐 Live Dashboard UI : http://localhost:8080
🔑 RSA Public Key   : http://localhost:8080/api/server-key
📱 Mesh Status      : http://localhost:8080/api/mesh/state
======================================================
```

### 3. Open the Dashboard

Open your browser to:

**http://localhost:8080**

### 4. Run the Automated Tests

To execute the concurrency and cryptographic test suite:

```bash
npm test
```

---

## The 3-Step Demo Flow

The dashboard allows you to walk through the entire pipeline:

```
[ Step 1: Compose Offline Payment ] 
           │ (Phone encrypts payload with Bank's Public Key)
           ▼
[ Step 2: Run Bluetooth Gossip ]
           │ (Packet hops peer-to-peer across phones, TTL decrements)
           ▼
[ Step 3: Bridge Phone Uploads (4G) ]
           │ (Phone with internet uploads to backend server)
           ▼
[ Result: Ledger Settled & Deduplicated ]
```

### Step 1 — Compose Offline Payment
- Choose sender (`alice@demo`), receiver (`bob@demo`), amount (`500`), and PIN (`1234`).
- Click **"📤 Inject into Mesh"**.
- This simulates Alice's phone creating an offline payment instruction, generating a random UUID nonce, encrypting the instruction with the server's RSA public key (hybrid RSA-OAEP + AES-256-GCM), and storing it in `phone-alice` with TTL = 5.

### Step 2 — Run Bluetooth Gossip
- Click **"🔄 Run Gossip Round"**.
- Each round simulates nearby phones exchanging packets within Bluetooth range.
- With each hop, the Time-To-Live (TTL) decrements by 1 to prevent endless cycling.
- After 1 or 2 rounds, all devices hold copies of the packet.

### Step 3 — Bridge Phone Uploads (4G)
- Click **"📡 Upload from Bridge Phone"**.
- `phone-bridge` (the device with active 4G) uploads its held packet to the server endpoint `/api/bridge/ingest`.
- The server checks the idempotency cache, decrypts the payload, verifies the GCM authentication tag, checks the timestamp freshness, and debits Alice while crediting Bob.
- If you click the upload button again, the server detects the duplicate hash and flags it as `DUPLICATE_DROPPED` without moving funds.

---

## Architecture & Security Blueprint

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SENDER PHONE (Offline)                          │
│  PaymentInstruction { sender, receiver, amount, pinHash, nonce, time } │
│              │                                                         │
│              ▼ Encrypt with Server RSA Public Key                      │
│   MeshPacket { packetId, ttl, createdAt, ciphertext }                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Bluetooth Gossip
                                    ▼
       ┌──────────┐   Hop   ┌──────────┐   Hop   ┌──────────┐
       │Stranger 1│ ──────▶ │Stranger 2│ ──────▶ │  Bridge  │ ◀── Walks outside
       └──────────┘         └──────────┘         └────┬─────┘     gets 4G
                                                      │
                                                      ▼ HTTPS POST
┌────────────────────────────────────────────────────────────────────────┐
│                     BACKEND SERVER ENGINE                              │
│                                                                        │
│  /api/bridge/ingest                                                    │
│       │                                                                │
│       ▼                                                                │
│  [1] Hash ciphertext using SHA-256                                     │
│       │                                                                │
│       ▼                                                                │
│  [2] IdempotencyService.claim(hash) ◀── Atomic check-and-set.          │
│       │                                 Duplicates dropped immediately │
│       ▼                                                                │
│  [3] HybridCryptoService.decrypt(ciphertext)                           │
│       │  - Unwraps AES session key using Server RSA Private Key        │
│       │  - Decrypts JSON and verifies 16-byte AES-GCM Auth Tag         │
│       │  - Any bit flip / tampering throws an authentication error     │
│       ▼                                                                │
│  [4] Freshness check: signedAt must be within the last 24 hours        │
│       │                                                                │
│       ▼                                                                │
│  [5] SettlementService.settle()                                        │
│       - Checks sender balance                                          │
│       - Atomic debit sender & credit receiver in transactional ledger   │
│       - Optimistic locking check prevents concurrent balance overwrite │
└────────────────────────────────────────────────────────────────────────┘
```

---

## The Three Hard Problems & Their Solutions

### Problem 1: Untrusted Intermediaries
*If a random stranger's phone relays my payment, what stops them from reading the amount or modifying the receiver?*

**Solution: Hybrid Authenticated Encryption (RSA-OAEP + AES-256-GCM)**
- RSA can only encrypt small payloads (~245 bytes), but our payment payload can be larger.
- The sender generates a random 256-bit AES key, encrypts the payment JSON with **AES-256-GCM**, and then encrypts only the 32-byte AES key with the server's **RSA-2048 Public Key**.
- Wire layout: `[256B RSA key][12B IV][AES ciphertext][16B Auth Tag]`.
- **AES-GCM includes a 16-byte cryptographic authentication tag.** If any intermediary changes even one bit in the packet, decryption fails immediately with `INVALID: decryption_failed`.

### Problem 2: The Duplicate-Storm
*What happens when 3 bridge phones carrying the same packet all walk into 4G coverage at the same time and upload simultaneously?*

**Solution: Atomic Idempotency Gate on Ciphertext Hash**
- Before performing any decryption or database writes, the server computes `SHA-256(ciphertext)`.
- It calls `idempotencyService.claim(hash)`.
- The first request claims the hash and proceeds to settle. Concurrent or subsequent requests receive `false` and are immediately short-circuited as `DUPLICATE_DROPPED`.
- Hashing the ciphertext (rather than packetId) ensures that even if a rogue intermediary changes the packetId, the underlying payment hash remains identical and deduplicated.

### Problem 3: Replay Attacks
*What if someone captures an encrypted packet and re-uploads it 2 weeks later?*

**Solution: 24-Hour Freshness Window & Nonce Guarantee**
- Inside the encrypted payload, the sender includes an epoch timestamp `signedAt`. The server rejects packets older than 24 hours.
- Every payment contains a unique random UUID `nonce`. If Alice sends Bob ₹100 twice, the nonces differ, producing completely different ciphertexts and hashes, allowing both legitimate payments to settle.

---

## Codebase & File Structure

Every source file contains in-depth documentation explaining the design decisions:

```
src/
├── app.js                          # Express application setup, middleware, and server listener
├── config.js                       # System configuration (port, TTLs, max packet age)
├── crypto/
│   ├── serverKeyHolder.js          # Generates RSA-2048 keypair on startup and exports public key
│   └── hybridCryptoService.js      # Hybrid RSA-OAEP + AES-256-GCM encryption & SHA-256 hashing
├── db/
│   ├── inMemoryDb.js               # Transactional in-memory database with ACID rollback and optimistic locking
│   └── repositories.js             # Data access repositories for Accounts and Transactions
├── models/
│   ├── Account.js                  # Account model with optimistic locking version check
│   ├── Transaction.js              # Permanent transaction ledger record model
│   ├── MeshPacket.js               # Gossip wire packet model & input validator
│   └── PaymentInstruction.js       # Decrypted payment payload model (with nonce and signedAt)
├── services/
│   ├── idempotencyService.js       # In-memory atomic cache with automatic TTL cleanup
│   ├── settlementService.js        # Atomic debit/credit fund transfer engine
│   ├── virtualDevice.js            # Simulated phone holding packets
│   ├── meshSimulatorService.js     # Epidemic Bluetooth mesh gossip simulator
│   ├── bridgeIngestionService.js   # 5-step production ingestion pipeline
│   └── demoService.js              # Seeds starter bank accounts & simulates sender phone
├── routes/
│   └── apiRoutes.js                # REST API endpoints for keys, simulator, ledger, and ingestion
└── public/
    └── index.html                  # Simple, intuitive live demo dashboard
tests/
└── idempotencyConcurrency.test.js  # Automated tests for concurrency, tampering, and round-trips
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the demo dashboard HTML |
| `GET` | `/api/server-key` | Returns the server's RSA public key (Base64) |
| `POST` | `/api/demo/send` | Simulates sender phone: creates encrypted packet and injects into mesh |
| `GET` | `/api/mesh/state` | Returns the list of phones and the packets held by each |
| `POST` | `/api/mesh/gossip` | Runs one round of Bluetooth gossip between phones |
| `POST` | `/api/mesh/flush` | Simulates bridge phones uploading held packets to the server |
| `POST` | `/api/mesh/reset` | Resets all virtual phones and clears the server idempotency cache |
| `POST` | `/api/bridge/ingest` | **Production Ingestion Endpoint**: Real or simulated phones POST packets here |
| `GET` | `/api/accounts` | Returns all bank accounts and balances |
| `GET` | `/api/transactions` | Returns recent settled transactions |

### Ingestion Request (`POST /api/bridge/ingest`)

**Headers:**
```http
Content-Type: application/json
X-Bridge-Node-Id: phone-bridge
X-Hop-Count: 3
```

**Body:**
```json
{
  "packetId": "3b29c97b-8df5-4040-9777-628f9906669f",
  "ttl": 2,
  "createdAt": 1730000000000,
  "ciphertext": "..."
}
```

**Response (`SETTLED`):**
```json
{
  "outcome": "SETTLED",
  "packetHash": "8f481c7b89791490226...",
  "reason": null,
  "transactionId": 1
}
```

---

## Automated Concurrency Tests

Run the built-in test suite:

```bash
npm test
```

### The Three Tests:
1. **`encryptDecryptRoundTrip`**: Validates that hybrid RSA-OAEP + AES-GCM encryption is completely lossless and symmetric.
2. **`tamperedCiphertextIsRejected`**: Flips a single character in the ciphertext, verifying that AES-GCM authentication fails and returns `INVALID` (`decryption_failed`).
3. **`singlePacketDeliveredByThreeBridgesSettlesExactlyOnce`**: Fires 3 simultaneous bridge uploads for the same packet concurrently using `Promise.all`. Verifies that **exactly 1 settles**, **exactly 2 are dropped as duplicates**, and Alice's balance is debited **only once**.

---

## What's NOT Real (Production Considerations)

This project is an educational simulator designed to run self-contained on a laptop without external infrastructure:

| In This Demo | In Production |
|---|---|
| In-Memory Database | Distributed SQL Database (PostgreSQL / CockroachDB) with replication |
| In-Memory Idempotency Cache | Redis cluster with `SET key NX EX 86400` |
| In-Memory Key Generation | Hardware Security Module (HSM) or cloud KMS (AWS KMS, GCP KMS) |
| Simulated Bluetooth Mesh | Physical Android BLE GATT / Wi-Fi Direct protocols |
| In-Memory Ledger | Core Banking System (CBS) and NPCI / UPI Switch integration |
#   u p i _ w i t h o u t _ i n t e r n e t  
 