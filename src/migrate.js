const fs = require('fs');
const path = require('path');
const db = require('./db');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Postgres can report "ready" a moment before it accepts TCP connections
// (for example during first start in Docker), so retry the connection.
async function waitForDatabase(attempts = 30, delayMs = 1000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`waiting for database (${i}/${attempts}): ${err.code || err.message}`);
      await sleep(delayMs);
    }
  }
}

async function migrate() {
  await waitForDatabase();
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.query(sql);
    console.log(`applied ${file}`);
  }
  await db.pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
