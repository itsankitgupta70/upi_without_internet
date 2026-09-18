/**
 * ==============================================================================
 * CONFIGURATION SETTINGS
 * ==============================================================================
 *
 * This file holds the global configuration parameters for the application.
 * In a production system, these values are typically loaded from environment
 * variables (process.env) or a configuration file (.env).
 *
 * KEY CONCEPTS FOR BEGINNERS:
 * 1. Port: The network port (default 8080) that our HTTP server listens to.
 * 2. TTL (Time To Live): How long (in seconds) the server remembers a processed
 *    payment hash to prevent duplicates.
 * 3. Max Packet Age: How old a signed payment packet can be before it is rejected
 *    as a potential replay attack (prevents someone replaying old captured transactions).
 * 4. Clock Skew: Small tolerance window (5 minutes) for phones whose system
 *    clocks might be slightly ahead of the server clock.
 */

export const config = {
  // HTTP server port (can be overridden via PORT environment variable)
  port: parseInt(process.env.PORT || '8080', 10),

  // Idempotency cache retention window: 86400 seconds = 24 hours
  // Any duplicate packet received within 24 hours of the first delivery is dropped
  idempotencyTtlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '86400', 10),

  // Freshness check: Reject any packet older than 24 hours
  packetMaxAgeSeconds: parseInt(process.env.PACKET_MAX_AGE_SECONDS || '86400', 10),

  // Clock skew tolerance: Allow packets with timestamps up to 300s (5 mins) in the future
  // in case the sender's phone clock is slightly inaccurate
  clockSkewToleranceSeconds: 300,
};
