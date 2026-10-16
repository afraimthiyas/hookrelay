const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
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
