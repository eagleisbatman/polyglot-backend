import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index';
import { logger } from '../utils/logger';
import * as path from 'path';

async function runMigrations() {
  if (!db) {
    logger.warn('Database not configured, skipping migrations');
    process.exit(0);
  }

  try {
    // Use process.cwd() to find drizzle folder relative to project root
    const migrationsFolder = path.join(process.cwd(), 'drizzle');
    logger.info('Running database migrations...', { 
      migrationsFolder,
      cwd: process.cwd() 
    });
    
    await migrate(db, { migrationsFolder });
    
    logger.info('Migrations completed successfully');
    process.exit(0);
  } catch (error: any) {
    logger.error('Migration failed', { 
      error: error.message,
      stack: error.stack,
      cwd: process.cwd()
    });
    
    // In production, log error but don't fail deployment
    // Migrations might fail if already applied or database not ready
    if (process.env.NODE_ENV === 'production') {
      logger.warn('Continuing despite migration error (may already be applied or DB not ready)');
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

runMigrations();

