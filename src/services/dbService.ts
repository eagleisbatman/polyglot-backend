import { db } from '../db/index';
import {
  interactions,
  voiceSessions,
  visionTranslations,
  documentTranslations,
  followUpQuestions,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

if (!db) {
  logger.warn('Database not configured - dbService operations will fail');
}

/**
 * Save an interaction record to the database
 */
export async function saveInteraction(data: {
  geminiInteractionId: string;
  type: 'voice' | 'vision' | 'document';
  sourceLanguage?: string;
  targetLanguage: string;
  metadata?: any;
  userId?: string;
}): Promise<string> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [interaction] = await db
      .insert(interactions)
      .values({
        geminiInteractionId: data.geminiInteractionId,
        type: data.type,
        sourceLanguage: data.sourceLanguage || null,
        targetLanguage: data.targetLanguage,
        metadata: data.metadata || null,
        status: 'active',
        userId: data.userId || null,
      })
      .returning({ id: interactions.id });

    if (!interaction) {
      throw new AppError('Failed to save interaction', 500);
    }

    logger.info('Interaction saved', { interactionId: interaction.id });
    return interaction.id;
  } catch (error: any) {
    logger.error('Error saving interaction', { error: error.message });
    throw new AppError('Failed to save interaction to database', 500);
  }
}

/**
 * Save a voice session to the database
 */
export async function saveVoiceSession(data: {
  interactionId: string;
  transcription: string;
  translation: string;
  summary: string;
  duration?: number;
}): Promise<string> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [session] = await db
      .insert(voiceSessions)
      .values({
        interactionId: data.interactionId,
        transcription: data.transcription,
        translation: data.translation,
        sessionSummary: data.summary,
        duration: data.duration || null,
      })
      .returning({ id: voiceSessions.id });

    if (!session) {
      throw new AppError('Failed to save voice session', 500);
    }

    logger.info('Voice session saved', { sessionId: session.id });
    return session.id;
  } catch (error: any) {
    logger.error('Error saving voice session', { error: error.message });
    throw new AppError('Failed to save voice session to database', 500);
  }
}

/**
 * Save a vision translation to the database
 */
export async function saveVisionTranslation(data: {
  interactionId: string;
  imageUrl?: string;
  extractedText?: string;
  translatedText: string;
  confidence: string;
}): Promise<string> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [translation] = await db
      .insert(visionTranslations)
      .values({
        interactionId: data.interactionId,
        imageUrl: data.imageUrl || null,
        extractedText: data.extractedText || null,
        translatedText: data.translatedText,
        confidence: data.confidence,
      })
      .returning({ id: visionTranslations.id });

    if (!translation) {
      throw new AppError('Failed to save vision translation', 500);
    }

    logger.info('Vision translation saved', { translationId: translation.id });
    return translation.id;
  } catch (error: any) {
    logger.error('Error saving vision translation', { error: error.message });
    throw new AppError('Failed to save vision translation to database', 500);
  }
}

/**
 * Save a document translation to the database
 */
export async function saveDocumentTranslation(data: {
  interactionId: string;
  fileName: string;
  fileType: string;
  fileUrl?: string;
  mode: 'translate' | 'summarize';
  originalText?: string;
  resultText: string;
  wordCount?: number;
}): Promise<string> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [translation] = await db
      .insert(documentTranslations)
      .values({
        interactionId: data.interactionId,
        fileName: data.fileName,
        fileType: data.fileType,
        fileUrl: data.fileUrl || null,
        mode: data.mode,
        originalText: data.originalText || null,
        resultText: data.resultText,
        wordCount: data.wordCount || null,
      })
      .returning({ id: documentTranslations.id });

    if (!translation) {
      throw new AppError('Failed to save document translation', 500);
    }

    logger.info('Document translation saved', { translationId: translation.id });
    return translation.id;
  } catch (error: any) {
    logger.error('Error saving document translation', { error: error.message });
    throw new AppError('Failed to save document translation to database', 500);
  }
}

/**
 * Save follow-up questions to the database
 */
export async function saveFollowUpQuestions(
  interactionId: string,
  questions: Array<{
    questionId: string;
    questionText: string;
    category: string;
    priority: number;
  }>
): Promise<void> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  if (questions.length === 0) {
    return;
  }

  try {
    await db.insert(followUpQuestions).values(
      questions.map((q) => ({
        interactionId,
        questionId: q.questionId,
        questionText: q.questionText,
        category: q.category || null,
        priority: q.priority || null,
        answered: false,
      }))
    );

    logger.info('Follow-up questions saved', {
      interactionId,
      count: questions.length,
    });
  } catch (error: any) {
    logger.error('Error saving follow-up questions', { error: error.message });
    throw new AppError('Failed to save follow-up questions to database', 500);
  }
}

/**
 * Get a follow-up question by questionId and interactionId
 */
export async function getFollowUpQuestion(
  interactionId: string,
  questionId: string
): Promise<{
  questionId: string;
  questionText: string;
  category: string | null;
  priority: number | null;
}> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [question] = await db
      .select()
      .from(followUpQuestions)
      .where(
        and(
          eq(followUpQuestions.interactionId, interactionId),
          eq(followUpQuestions.questionId, questionId)
        )
      )
      .limit(1);

    if (!question) {
      throw new AppError('Follow-up question not found', 404);
    }

    return {
      questionId: question.questionId,
      questionText: question.questionText,
      category: question.category,
      priority: question.priority,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error('Error retrieving follow-up question', { error: error.message });
    throw new AppError('Failed to retrieve follow-up question from database', 500);
  }
}

/**
 * Update voice session audio URLs (for Cloudinary uploads)
 */
export async function updateVoiceSessionAudioUrls(
  interactionId: string,
  data: {
    userAudioUrl?: string;
    translationAudioUrl?: string;
  }
): Promise<void> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    // Build update object with proper column types
    const updateData: Partial<typeof voiceSessions.$inferInsert> = {};
    
    if (data.userAudioUrl !== undefined) {
      updateData.userAudioUrl = data.userAudioUrl;
    }
    if (data.translationAudioUrl !== undefined) {
      updateData.translationAudioUrl = data.translationAudioUrl;
    }

    if (Object.keys(updateData).length === 0) {
      logger.warn('No audio URLs to update', { interactionId });
      return;
    }

    // First check if a voice session exists for this interaction
    const [existingSession] = await db
      .select({ id: voiceSessions.id })
      .from(voiceSessions)
      .where(eq(voiceSessions.interactionId, interactionId))
      .limit(1);

    if (!existingSession) {
      logger.warn('No voice session found for interaction', { interactionId });
      return;
    }

    // Update the voice session
    await db
      .update(voiceSessions)
      .set(updateData)
      .where(eq(voiceSessions.interactionId, interactionId));

    logger.info('Voice session audio URLs updated', { 
      interactionId, 
      sessionId: existingSession.id,
      userAudioUrl: data.userAudioUrl,
      translationAudioUrl: data.translationAudioUrl,
    });
  } catch (error: any) {
    logger.error('Error updating voice session audio URLs', { 
      interactionId,
      error: error.message,
      stack: error.stack,
    });
    throw new AppError('Failed to update voice session audio URLs', 500);
  }
}

/**
 * Get an interaction by database ID
 */
export async function getInteraction(interactionId: string): Promise<{
  id: string;
  geminiInteractionId: string;
  type: string;
  sourceLanguage: string | null;
  targetLanguage: string;
}> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [interaction] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.id, interactionId))
      .limit(1);

    if (!interaction) {
      throw new AppError('Interaction not found', 404);
    }

    return {
      id: interaction.id,
      geminiInteractionId: interaction.geminiInteractionId,
      type: interaction.type,
      sourceLanguage: interaction.sourceLanguage,
      targetLanguage: interaction.targetLanguage,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error('Error retrieving interaction', { error: error.message });
    throw new AppError('Failed to retrieve interaction from database', 500);
  }
}

/**
 * Get an interaction by Gemini interaction ID
 */
export async function getInteractionByGeminiId(
  geminiInteractionId: string
): Promise<{
  id: string;
  geminiInteractionId: string;
  type: string;
  sourceLanguage: string | null;
  targetLanguage: string;
}> {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }

  try {
    const [interaction] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.geminiInteractionId, geminiInteractionId))
      .limit(1);

    if (!interaction) {
      throw new AppError('Interaction not found', 404);
    }

    return {
      id: interaction.id,
      geminiInteractionId: interaction.geminiInteractionId,
      type: interaction.type,
      sourceLanguage: interaction.sourceLanguage,
      targetLanguage: interaction.targetLanguage,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error('Error retrieving interaction by Gemini ID', {
      error: error.message,
    });
    throw new AppError('Failed to retrieve interaction from database', 500);
  }
}

