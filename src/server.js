const express = require('express');
const crypto = require('crypto');
const pino = require('pino');
const config = require('./config');
const db = require('./db');
const { queue } = require('./queue');
const { generateSecret } = require('./signing');
const { validateTargetUrl } = require('./urlGuard');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
app.use(express.json({ limit: '256kb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
  });
  next();
});

// Health check is unauthenticated (used by load balancers / Docker).
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    await queue.client.then((c) => c.ping());
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable' });
  }
});

// API key auth for everything else.
app.use((req, res, next) => {
  const provided = Buffer.from(req.get('x-api-key') || '');
  const expected = Buffer.from(config.apiKey);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
});

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Register a webhook endpoint. The secret is returned once, on creation.
app.post('/endpoints', asyncRoute(async (req, res) => {
  const { url } = req.body || {};
  const check = validateTargetUrl(url);
  if (!check.ok) return res.status(400).json({ error: check.reason });

  const secret = generateSecret();
  const { rows } = await db.query(
    'INSERT INTO endpoints (url, secret) VALUES ($1, $2) RETURNING id, url, active, created_at',
    [url, secret]
  );
  res.status(201).json({ ...rows[0], secret });
}));

// Publish an event: stored, then queued for delivery.
app.post('/events', asyncRoute(async (req, res) => {
  const { endpointId, type, payload } = req.body || {};
  if (!endpointId || !type || typeof payload !== 'object' || payload === null) {
    return res.status(400).json({ error: 'endpointId, type and payload (object) are required' });
  }

  const endpoint = await db.query('SELECT id, active FROM endpoints WHERE id = $1', [endpointId]);
  if (!endpoint.rows.length) return res.status(404).json({ error: 'Endpoint not found' });
  if (!endpoint.rows[0].active) return res.status(409).json({ error: 'Endpoint is disabled' });

  const event = await db.query(
    'INSERT INTO events (endpoint_id, type, payload) VALUES ($1, $2, $3) RETURNING id, created_at',
    [endpointId, type, payload]
  );
  const delivery = await db.query(
    'INSERT INTO deliveries (event_id) VALUES ($1) RETURNING id',
    [event.rows[0].id]
  );

  // jobId = delivery id makes enqueueing idempotent.
  await queue.add('deliver', { deliveryId: delivery.rows[0].id }, { jobId: delivery.rows[0].id });

  res.status(202).json({
    eventId: event.rows[0].id,
    deliveryId: delivery.rows[0].id,
    status: 'pending',
  });
}));

// Delivery status + full attempt log.
app.get('/deliveries/:id', asyncRoute(async (req, res) => {
  const delivery = await db.query(
    'SELECT id, event_id, status, attempts, updated_at FROM deliveries WHERE id = $1',
    [req.params.id]
  ).catch(() => ({ rows: [] })); // malformed UUID -> 404
  if (!delivery.rows.length) return res.status(404).json({ error: 'Delivery not found' });

  const attempts = await db.query(
    `SELECT attempt, status_code, error, duration_ms, created_at
       FROM delivery_attempts WHERE delivery_id = $1 ORDER BY attempt`,
    [req.params.id]
  );
  res.json({ ...delivery.rows[0], attemptLog: attempts.rows });
}));

// Manually retry a failed delivery.
app.post('/deliveries/:id/retry', asyncRoute(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE deliveries SET status = 'pending', updated_at = now()
      WHERE id = $1 AND status = 'failed' RETURNING id`,
    [req.params.id]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return res.status(409).json({ error: 'Only failed deliveries can be retried' });

  await queue.remove(rows[0].id); // clear the old failed job so the id can be reused
  await queue.add('deliver', { deliveryId: rows[0].id }, { jobId: rows[0].id });
  res.status(202).json({ deliveryId: rows[0].id, status: 'pending' });
}));

app.use((err, req, res, next) => {
  log.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const server = app.listen(config.port, () => log.info(`HookRelay API listening on :${config.port}`));
  const shutdown = async () => {
    log.info('shutting down');
    server.close(async () => {
      await queue.close();
      await db.pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
