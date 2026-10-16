const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('./config');

const QUEUE_NAME = 'deliveries';

function createConnection() {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

const queue = new Queue(QUEUE_NAME, {
  connection: createConnection(),
  defaultJobOptions: {
    attempts: config.maxAttempts,
    backoff: { type: 'exponential', delay: config.baseBackoffMs },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

module.exports = { queue, createConnection, QUEUE_NAME };
