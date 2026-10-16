const { Worker } = require('bullmq');
const pino = require('pino');
const config = require('./config');
const db = require('./db');
const { createConnection, QUEUE_NAME } = require('./queue');
const { sign } = require('./signing');
const { validateTargetUrl } = require('./urlGuard');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

async function processDelivery(job) {
  const { deliveryId } = job.data;
  const attempt = job.attemptsMade + 1;

  const { rows } = await db.query(
    `SELECT d.id, e.id AS event_id, e.type, e.payload, e.created_at, ep.url, ep.secret
       FROM deliveries d
       JOIN events e ON e.id = d.event_id
       JOIN endpoints ep ON ep.id = e.endpoint_id
      WHERE d.id = $1`,
    [deliveryId]
  );
  if (!rows.length) {
    log.warn({ deliveryId }, 'delivery not found, dropping job');
    return;
  }
  const d = rows[0];

  // Re-validate at delivery time, not only at registration.
  const check = validateTargetUrl(d.url);
  if (!check.ok) {
    await recordAttempt(deliveryId, attempt, null, `Blocked: ${check.reason}`, 0);
    await markStatus(deliveryId, 'failed', attempt);
    return; // do not retry blocked targets
  }

  const body = JSON.stringify({
    id: d.event_id,
    type: d.type,
    created_at: d.created_at,
    data: d.payload,
  });

  const started = Date.now();
  let statusCode = null;
  let error = null;

  try {
    const res = await fetch(d.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'HookRelay/1.0',
        'x-hookrelay-event-id': d.event_id,
        'x-hookrelay-signature': sign(d.secret, body),
      },
      body,
      redirect: 'manual', // never follow redirects (SSRF safety)
      signal: AbortSignal.timeout(config.deliveryTimeoutMs),
    });
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) {
      error = `Non-2xx response: ${res.status}`;
    }
  } catch (err) {
    error = err.name === 'TimeoutError' ? 'Request timed out' : err.message;
  }

  const duration = Date.now() - started;
  await recordAttempt(deliveryId, attempt, statusCode, error, duration);

  if (!error) {
    await markStatus(deliveryId, 'delivered', attempt);
    log.info({ deliveryId, attempt, statusCode, duration }, 'delivered');
    return;
  }

  const isLastAttempt = attempt >= config.maxAttempts;
  await markStatus(deliveryId, isLastAttempt ? 'failed' : 'pending', attempt);
  log.warn({ deliveryId, attempt, error }, isLastAttempt ? 'delivery failed permanently' : 'delivery failed, will retry');

  // Throwing tells BullMQ to schedule a retry with exponential backoff.
  throw new Error(error);
}

function recordAttempt(deliveryId, attempt, statusCode, error, durationMs) {
  return db.query(
    `INSERT INTO delivery_attempts (delivery_id, attempt, status_code, error, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [deliveryId, attempt, statusCode, error, durationMs]
  );
}

function markStatus(deliveryId, status, attempts) {
  return db.query(
    'UPDATE deliveries SET status = $2, attempts = $3, updated_at = now() WHERE id = $1',
    [deliveryId, status, attempts]
  );
}

const worker = new Worker(QUEUE_NAME, processDelivery, {
  connection: createConnection(),
  concurrency: config.workerConcurrency,
});

worker.on('error', (err) => log.error({ err }, 'worker error'));
log.info('HookRelay worker started');

async function shutdown() {
  log.info('worker shutting down');
  await worker.close(); // waits for in-flight jobs
  await db.pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
