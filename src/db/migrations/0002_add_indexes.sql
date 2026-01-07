-- Add performance indexes for common queries

-- Interactions table indexes
CREATE INDEX IF NOT EXISTS interactions_user_id_idx ON interactions(user_id);
CREATE INDEX IF NOT EXISTS interactions_status_idx ON interactions(status);
CREATE INDEX IF NOT EXISTS interactions_type_idx ON interactions(type);
CREATE INDEX IF NOT EXISTS interactions_created_at_idx ON interactions(created_at);
CREATE INDEX IF NOT EXISTS interactions_status_created_at_idx ON interactions(status, created_at);

-- Voice sessions index
CREATE INDEX IF NOT EXISTS voice_sessions_interaction_id_idx ON voice_sessions(interaction_id);

-- Vision translations index
CREATE INDEX IF NOT EXISTS vision_translations_interaction_id_idx ON vision_translations(interaction_id);

-- Document translations index
CREATE INDEX IF NOT EXISTS document_translations_interaction_id_idx ON document_translations(interaction_id);

-- Follow-up questions index
CREATE INDEX IF NOT EXISTS follow_up_questions_interaction_id_idx ON follow_up_questions(interaction_id);

