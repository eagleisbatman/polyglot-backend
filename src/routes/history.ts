import express from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { db } from '../db';
import { conversations, interactions, voiceSessions, visionTranslations, documentTranslations } from '../db/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Query params schema for pagination
const paginationSchema = z.object({
  page: z.string().optional().transform(val => parseInt(val || '1', 10)),
  limit: z.string().optional().transform(val => parseInt(val || '20', 10)),
  type: z.string().optional().transform(val => {
    if (!val || val === 'all') return undefined;
    if (['voice', 'vision', 'document'].includes(val)) return val;
    return undefined;
  }),
});

// Helper to ensure db is available
function ensureDb() {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }
  return db;
}

// Helper to get session data for an interaction
async function getSessionData(database: NonNullable<typeof db>, interaction: any) {
  if (interaction.type === 'voice') {
    const [session] = await database
      .select()
      .from(voiceSessions)
      .where(eq(voiceSessions.interactionId, interaction.id))
      .limit(1);
    return session;
  } else if (interaction.type === 'vision') {
    const [vision] = await database
      .select()
      .from(visionTranslations)
      .where(eq(visionTranslations.interactionId, interaction.id))
      .limit(1);
    return vision;
  } else if (interaction.type === 'document') {
    const [doc] = await database
      .select()
      .from(documentTranslations)
      .where(eq(documentTranslations.interactionId, interaction.id))
      .limit(1);
    return doc;
  }
  return null;
}

// Helper to format message from interaction + session
function formatMessage(interaction: any, sessionData: any) {
  const cleanSessionData: Record<string, any> = {};
  if (sessionData) {
    const { id: _sessionId, interactionId: _intId, createdAt: _createdAt, ...rest } = sessionData;
    Object.assign(cleanSessionData, rest);
  }

  return {
    id: interaction.id,
    type: interaction.type,
    sourceLanguage: interaction.sourceLanguage,
    targetLanguage: interaction.targetLanguage,
    createdAt: interaction.createdAt,
    ...cleanSessionData,
  };
}

/**
 * GET /api/v1/history
 * Get paginated conversation history (grouped by conversation)
 */
router.get('/', async (req, res, next) => {
  try {
    const database = ensureDb();

    // Get userId from header
    const userId = req.headers['x-user-id'] as string | undefined;
    if (!userId) {
      throw new AppError('User ID is required', 401);
    }

    const { page, limit, type } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    // Get conversations for user
    const conversationResults = await database
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.userId, userId),
        sql`${conversations.status} != 'deleted'`
      ))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);

    // Enrich each conversation with first message preview
    const enrichedConversations = await Promise.all(
      conversationResults.map(async (conv) => {
        // Get first interaction for preview
        let firstInteractionQuery = database
          .select()
          .from(interactions)
          .where(and(
            eq(interactions.conversationId, conv.id),
            sql`${interactions.status} != 'deleted'`
          ))
          .orderBy(interactions.createdAt)
          .limit(1);

        // Apply type filter if provided
        if (type) {
          firstInteractionQuery = database
            .select()
            .from(interactions)
            .where(and(
              eq(interactions.conversationId, conv.id),
              eq(interactions.type, type),
              sql`${interactions.status} != 'deleted'`
            ))
            .orderBy(interactions.createdAt)
            .limit(1);
        }

        const [firstInteraction] = await firstInteractionQuery;

        if (!firstInteraction) {
          // Conversation has no matching messages, skip
          return null;
        }

        const sessionData = await getSessionData(database, firstInteraction);
        const preview = formatMessage(firstInteraction, sessionData);

        return {
          id: conv.id,
          title: conv.title || (preview as any).transcription || (preview as any).extractedText || 'Untitled',
          sourceLanguage: conv.sourceLanguage,
          targetLanguage: conv.targetLanguage,
          messageCount: conv.messageCount,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          preview, // First message preview
        };
      })
    );

    // Filter out null results (conversations with no matching messages)
    const filteredConversations = enrichedConversations.filter(c => c !== null);

    // Get total count for pagination
    const countResult = await database
      .select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(and(
        eq(conversations.userId, userId),
        sql`${conversations.status} != 'deleted'`
      ));

    const total = countResult[0]?.count ?? 0;

    res.json({
      success: true,
      data: {
        items: filteredConversations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/history/conversations/:id
 * Get all messages in a conversation
 */
router.get('/conversations/:id', async (req, res, next) => {
  try {
    const database = ensureDb();
    const { id } = req.params;

    // Get the conversation
    const [conversation] = await database
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    // Get all interactions in this conversation
    const interactionResults = await database
      .select()
      .from(interactions)
      .where(and(
        eq(interactions.conversationId, id),
        sql`${interactions.status} != 'deleted'`
      ))
      .orderBy(interactions.createdAt);

    // Enrich with session data
    const messages = await Promise.all(
      interactionResults.map(async (interaction) => {
        const sessionData = await getSessionData(database, interaction);
        return formatMessage(interaction, sessionData);
      })
    );

    res.json({
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          sourceLanguage: conversation.sourceLanguage,
          targetLanguage: conversation.targetLanguage,
          messageCount: conversation.messageCount,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
        messages,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/history/:id
 * Get single interaction by ID (legacy support)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const database = ensureDb();
    const { id } = req.params;

    const [interaction] = await database
      .select()
      .from(interactions)
      .where(eq(interactions.id, id))
      .limit(1);

    if (!interaction) {
      throw new AppError('Interaction not found', 404);
    }

    const sessionData = await getSessionData(database, interaction);
    const message = formatMessage(interaction, sessionData);

    res.json({
      success: true,
      data: {
        ...message,
        conversationId: interaction.conversationId,
        status: interaction.status,
        metadata: interaction.metadata,
        updatedAt: interaction.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/history/:id
 * Delete a conversation (soft delete)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const database = ensureDb();
    const { id } = req.params;

    // Check if it's a conversation or interaction
    const [conversation] = await database
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (conversation) {
      // Delete conversation and all its interactions
      await database
        .update(conversations)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(conversations.id, id));

      await database
        .update(interactions)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(interactions.conversationId, id));

      logger.info('Conversation deleted', { id });
    } else {
      // Try to delete individual interaction
      const [interaction] = await database
        .select()
        .from(interactions)
        .where(eq(interactions.id, id))
        .limit(1);

      if (!interaction) {
        throw new AppError('Not found', 404);
      }

      await database
        .update(interactions)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(interactions.id, id));

      logger.info('Interaction deleted', { id });
    }

    res.json({
      success: true,
      message: 'Deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
