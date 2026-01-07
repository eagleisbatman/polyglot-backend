import { db } from './index';
import { logger } from '../utils/logger';
import { sql } from 'drizzle-orm';

/**
 * Run migrations at server startup
 * Uses raw SQL for reliability - no external tools needed
 */
export async function runStartupMigrations(): Promise<void> {
  if (!db) {
    logger.warn('Database not configured, skipping migrations');
    return;
  }

  try {
    logger.info('Running startup migrations...');

    // Create tables if they don't exist (idempotent)
    // Users table with device-based auth
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id TEXT UNIQUE NOT NULL,
        device_model TEXT,
        device_brand TEXT,
        os_name TEXT,
        os_version TEXT,
        app_version TEXT,
        country TEXT,
        country_code TEXT,
        city TEXT,
        region TEXT,
        latitude TEXT,
        longitude TEXT,
        timezone TEXT,
        preferred_source_language TEXT DEFAULT 'en',
        preferred_target_language TEXT DEFAULT 'hi',
        last_active_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Add device columns to existing users table if upgrading
    await db.execute(sql`
      DO $$ 
      BEGIN
        -- Add device_id if not exists (for existing tables)
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'device_id'
        ) THEN
          ALTER TABLE users ADD COLUMN device_id TEXT;
          ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
          ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
          ALTER TABLE users ADD CONSTRAINT users_device_id_key UNIQUE (device_id);
        END IF;
        
        -- Add other device columns
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'device_model') THEN
          ALTER TABLE users ADD COLUMN device_model TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'device_brand') THEN
          ALTER TABLE users ADD COLUMN device_brand TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'os_name') THEN
          ALTER TABLE users ADD COLUMN os_name TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'os_version') THEN
          ALTER TABLE users ADD COLUMN os_version TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'app_version') THEN
          ALTER TABLE users ADD COLUMN app_version TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'country') THEN
          ALTER TABLE users ADD COLUMN country TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'country_code') THEN
          ALTER TABLE users ADD COLUMN country_code TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'city') THEN
          ALTER TABLE users ADD COLUMN city TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'region') THEN
          ALTER TABLE users ADD COLUMN region TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'latitude') THEN
          ALTER TABLE users ADD COLUMN latitude TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'longitude') THEN
          ALTER TABLE users ADD COLUMN longitude TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'timezone') THEN
          ALTER TABLE users ADD COLUMN timezone TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'preferred_source_language') THEN
          ALTER TABLE users ADD COLUMN preferred_source_language TEXT DEFAULT 'en';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'preferred_target_language') THEN
          ALTER TABLE users ADD COLUMN preferred_target_language TEXT DEFAULT 'hi';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_active_at') THEN
          ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP DEFAULT NOW();
        END IF;
      END $$;
    `);

    // Conversations table (groups messages into sessions)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        title TEXT,
        source_language TEXT,
        target_language TEXT NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        message_count INTEGER DEFAULT 0 NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS interactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id),
        user_id UUID REFERENCES users(id),
        gemini_interaction_id TEXT NOT NULL,
        type TEXT NOT NULL,
        source_language TEXT,
        target_language TEXT NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        interaction_id UUID REFERENCES interactions(id) NOT NULL,
        session_summary TEXT,
        transcription TEXT,
        translation TEXT,
        duration INTEGER,
        user_audio_url TEXT,
        translation_audio_url TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vision_translations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        interaction_id UUID REFERENCES interactions(id) NOT NULL,
        image_url TEXT,
        extracted_text TEXT,
        translated_text TEXT,
        confidence TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_translations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        interaction_id UUID REFERENCES interactions(id) NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_url TEXT,
        mode TEXT NOT NULL,
        original_text TEXT,
        result_text TEXT,
        word_count INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS follow_up_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        interaction_id UUID REFERENCES interactions(id) NOT NULL,
        question_id TEXT NOT NULL,
        question_text TEXT NOT NULL,
        category TEXT,
        priority INTEGER,
        answered BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Add audio URL columns if they don't exist (migration 0001)
    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'voice_sessions' AND column_name = 'user_audio_url'
        ) THEN
          ALTER TABLE voice_sessions ADD COLUMN user_audio_url TEXT;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'voice_sessions' AND column_name = 'translation_audio_url'
        ) THEN
          ALTER TABLE voice_sessions ADD COLUMN translation_audio_url TEXT;
        END IF;
      END $$;
    `);

    // Add conversation_id to interactions if not exists (migration 0003)
    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'interactions' AND column_name = 'conversation_id'
        ) THEN
          ALTER TABLE interactions ADD COLUMN conversation_id UUID REFERENCES conversations(id);
        END IF;
      END $$;
    `);

    // Create indexes if they don't exist (migration 0002)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations(status);
      CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON conversations(created_at);
      CREATE INDEX IF NOT EXISTS interactions_conversation_id_idx ON interactions(conversation_id);
      CREATE INDEX IF NOT EXISTS interactions_user_id_idx ON interactions(user_id);
      CREATE INDEX IF NOT EXISTS interactions_status_idx ON interactions(status);
      CREATE INDEX IF NOT EXISTS interactions_type_idx ON interactions(type);
      CREATE INDEX IF NOT EXISTS interactions_created_at_idx ON interactions(created_at);
      CREATE INDEX IF NOT EXISTS interactions_status_created_at_idx ON interactions(status, created_at);
      CREATE INDEX IF NOT EXISTS voice_sessions_interaction_id_idx ON voice_sessions(interaction_id);
      CREATE INDEX IF NOT EXISTS vision_translations_interaction_id_idx ON vision_translations(interaction_id);
      CREATE INDEX IF NOT EXISTS document_translations_interaction_id_idx ON document_translations(interaction_id);
      CREATE INDEX IF NOT EXISTS follow_up_questions_interaction_id_idx ON follow_up_questions(interaction_id);
    `);

    logger.info('Startup migrations completed successfully');
  } catch (error: any) {
    logger.error('Startup migration error', { 
      error: error.message,
      stack: error.stack 
    });
    // Don't throw - let the server start anyway
    // The database operations will fail gracefully if tables don't exist
  }
}

