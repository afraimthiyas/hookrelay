function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  apiKey: required('API_KEY'),
  maxAttempts: parseInt(process.env.MAX_ATTEMPTS || '6', 10),
  baseBackoffMs: parseInt(process.env.BASE_BACKOFF_MS || '5000', 10),
  deliveryTimeoutMs: parseInt(process.env.DELIVERY_TIMEOUT_MS || '10000', 10),
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '10', 10),
};
