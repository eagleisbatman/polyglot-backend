import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table - device-based authentication
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceId: text('device_id').unique().notNull(), // Unique device identifier
  
  // Device info
  deviceModel: text('device_model'),        // e.g., "iPhone 15 Pro", "Pixel 8"
  deviceBrand: text('device_brand'),        // e.g., "Apple", "Google"
  osName: text('os_name'),                  // e.g., "iOS", "Android"
  osVersion: text('os_version'),            // e.g., "17.2", "14"
  appVersion: text('app_version'),          // e.g., "1.0.0"
  
  // Location info (optional, user can grant permission)
  country: text('country'),
  countryCode: text('country_code'),        // e.g., "IN", "US"
  city: text('city'),
  region: text('region'),                   // State/Province
  latitude: text('latitude'),
  longitude: text('longitude'),
  timezone: text('timezone'),               // e.g., "Asia/Kolkata"
  
  // User preferences
  preferredSourceLanguage: text('preferred_source_language').default('en'),
  preferredTargetLanguage: text('preferred_target_language').default('hi'),
  
  // Timestamps
  lastActiveAt: timestamp('last_active_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  deviceIdIdx: index('users_device_id_idx').on(table.deviceId),
}));

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
}, (table) => ({
  // Performance indexes for common queries
  userIdIdx: index('interactions_user_id_idx').on(table.userId),
  statusIdx: index('interactions_status_idx').on(table.status),
  typeIdx: index('interactions_type_idx').on(table.type),
  createdAtIdx: index('interactions_created_at_idx').on(table.createdAt),
  // Composite index for filtered queries
  statusCreatedAtIdx: index('interactions_status_created_at_idx').on(table.status, table.createdAt),
}));

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
}, (table) => ({
  interactionIdIdx: index('voice_sessions_interaction_id_idx').on(table.interactionId),
}));

// Vision translations table
export const visionTranslations = pgTable('vision_translations', {
  id: uuid('id').defaultRandom().primaryKey(),
  interactionId: uuid('interaction_id').references(() => interactions.id).notNull(),
  imageUrl: text('image_url'), // Store image URL or path
  extractedText: text('extracted_text'),
  translatedText: text('translated_text'),
  confidence: text('confidence'), // 'high', 'medium', 'low'
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  interactionIdIdx: index('vision_translations_interaction_id_idx').on(table.interactionId),
}));

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
}, (table) => ({
  interactionIdIdx: index('document_translations_interaction_id_idx').on(table.interactionId),
}));

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

