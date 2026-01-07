import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { config } from '../config/env';
import { logger } from '../utils/logger';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

if (config.database.url) {
  try {
    pool = new Pool({
      connectionString: config.database.url,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    db = drizzle(pool, { schema });
    logger.info('Database connection initialized');
  } catch (error) {
    logger.error('Failed to initialize database', { error });
  }
} else {
  logger.warn('DATABASE_URL not set, database features will be disabled');
}

export { db };
export type Database = typeof db;

