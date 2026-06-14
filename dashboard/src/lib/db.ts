import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://upwork:upwork_dev@localhost:5432/upwork';

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export default pool;
