import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table (for future authentication)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Interactions table (stores Gemini interaction IDs and metadata)
export const interactions = pgTable('interactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id), // Optional for now (no auth yet)
  geminiInteractionId: text('gemini_interaction_id').notNull(),
  type: text('type').notNull(), // 'voice', 'vision', 'document'
  sourceLanguage: text('source_language'),
  targetLanguage: text('target_language').notNull(),
  status: text('status').default('active').notNull(), // 'active', 'archived', 'deleted'
  metadata: jsonb('metadata'), // Store additional data like follow-up questions, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Voice sessions table
export const voiceSessions = pgTable('voice_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  interactionId: uuid('interaction_id').references(() => interactions.id).notNull(),
  sessionSummary: text('session_summary'),
  transcription: text('transcription'),
  translation: text('translation'),
  duration: integer('duration'), // in seconds
  userAudioUrl: text('user_audio_url'), // URL to user's recorded audio
  translationAudioUrl: text('translation_audio_url'), // URL to TTS audio
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Vision translations table
export const visionTranslations = pgTable('vision_translations', {
  id: uuid('id').defaultRandom().primaryKey(),
  interactionId: uuid('interaction_id').references(() => interactions.id).notNull(),
  imageUrl: text('image_url'), // Store image URL or path
  extractedText: text('extracted_text'),
  translatedText: text('translated_text'),
  confidence: text('confidence'), // 'high', 'medium', 'low'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Document translations table
export const documentTranslations = pgTable('document_translations', {
  id: uuid('id').defaultRandom().primaryKey(),
  interactionId: uuid('interaction_id').references(() => interactions.id).notNull(),
  fileName: text('file_name').notNull(),
  fileType: text('file_type').notNull(), // 'pdf', 'docx', 'txt'
  fileUrl: text('file_url'), // Store file URL or path
  mode: text('mode').notNull(), // 'translate', 'summarize'
  originalText: text('original_text'),
  resultText: text('result_text'),
  wordCount: integer('word_count'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Follow-up questions table
export const followUpQuestions = pgTable('follow_up_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  interactionId: uuid('interaction_id').references(() => interactions.id).notNull(),
  questionId: text('question_id').notNull(), // From Gemini response
  questionText: text('question_text').notNull(),
  category: text('category'), // 'pest', 'disease', 'fertilizer', etc.
  priority: integer('priority'), // 1-3
  answered: boolean('answered').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const interactionsRelations = relations(interactions, ({ one, many }) => ({
  user: one(users, {
    fields: [interactions.userId],
    references: [users.id],
  }),
  voiceSession: one(voiceSessions),
  visionTranslation: one(visionTranslations),
  documentTranslation: one(documentTranslations),
  followUpQuestions: many(followUpQuestions),
}));

export const usersRelations = relations(users, ({ many }) => ({
  interactions: many(interactions),
}));

