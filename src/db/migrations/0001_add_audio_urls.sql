-- Add audio URL columns to voice_sessions table
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS user_audio_url TEXT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS translation_audio_url TEXT;

