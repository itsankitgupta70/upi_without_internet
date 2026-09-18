import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { apiRouter } from './routes/apiRoutes.js';

/**
 * ==============================================================================
 * APPLICATION ENTRY POINT (EXPRESS HTTP SERVER)
 * ==============================================================================
 *
 * This file boots up the backend HTTP server.
 *
 * WHAT THIS FILE DOES (FOR BEGINNERS):
 * 1. Initializes an Express application.
 * 2. Attaches middleware (CORS to allow cross-origin requests, JSON body parser).
 * 3. Serves the frontend web dashboard from the `public/` directory.
 * 4. Mounts the REST API routes under `/api`.
 * 5. Starts listening for incoming network connections on port 8080.
 */

// Helper to determine current directory when using ES Modules ('type': 'module')
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// ------------------------------------------------------------------------------
// MIDDLEWARE
// ------------------------------------------------------------------------------
// Allow Cross-Origin Resource Sharing (CORS) so API can be called from other tools
app.use(cors());

// Automatically parse incoming HTTP request bodies with Content-Type: application/json
app.use(express.json());

// Serve static HTML/CSS/JS frontend files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------------------------
// Mount all REST endpoints under the /api prefix
app.use('/api', apiRouter);

// Serve index.html as fallback root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ------------------------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------------------------
// Only listen on port if executed directly (not when imported in unit tests)
if (process.argv[1] === __filename) {
  const server = app.listen(config.port, () => {
    console.log(`\n======================================================`);
    console.log(`📡 UPI Offline Mesh — Server Started Successfully!`);
    console.log(`🌐 Live Dashboard UI : http://localhost:${config.port}`);
    console.log(`🔑 RSA Public Key   : http://localhost:${config.port}/api/server-key`);
    console.log(`📱 Mesh Status      : http://localhost:${config.port}/api/mesh/state`);
    console.log(`======================================================\n`);
  });

  // Graceful shutdown on Ctrl+C (SIGINT)
  const shutdown = () => {
    console.log('\nGracefully shutting down server...');
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
