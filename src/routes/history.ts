import express from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { db } from '../db';
import { interactions, voiceSessions, visionTranslations, documentTranslations } from '../db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Query params schema for pagination
const paginationSchema = z.object({
  page: z.string().optional().transform(val => parseInt(val || '1', 10)),
  limit: z.string().optional().transform(val => parseInt(val || '20', 10)),
  type: z.enum(['voice', 'vision', 'document']).optional(),
});

// Helper to ensure db is available
function ensureDb() {
  if (!db) {
    throw new AppError('Database not configured', 500);
  }
  return db;
}

/**
 * GET /api/v1/history
 * Get paginated translation history
 */
router.get('/', async (req, res, next) => {
  try {
    const database = ensureDb();

    const { page, limit, type } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    // Build query conditions - always exclude deleted items
    const statusCondition = sql`${interactions.status} != 'deleted'`;
    const typeCondition = type ? eq(interactions.type, type) : undefined;
    
    // Combine conditions
    const conditions = typeCondition 
      ? sql`${statusCondition} AND ${typeCondition}`
      : statusCondition;

    // Get interactions with related data
    const results = await database
      .select()
      .from(interactions)
      .where(conditions)
      .orderBy(desc(interactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Enrich with session/translation data
    const enrichedResults = await Promise.all(
      results.map(async (interaction) => {
        let sessionData = null;

        if (interaction.type === 'voice') {
          const [session] = await database
            .select()
            .from(voiceSessions)
            .where(eq(voiceSessions.interactionId, interaction.id))
            .limit(1);
          sessionData = session;
        } else if (interaction.type === 'vision') {
          const [vision] = await database
            .select()
            .from(visionTranslations)
            .where(eq(visionTranslations.interactionId, interaction.id))
            .limit(1);
          sessionData = vision;
        } else if (interaction.type === 'document') {
          const [doc] = await database
            .select()
            .from(documentTranslations)
            .where(eq(documentTranslations.interactionId, interaction.id))
            .limit(1);
          sessionData = doc;
        }

        // Remove redundant/confusing fields from session data
        let cleanSessionData: Record<string, any> | null = null;
        if (sessionData) {
          const { id: _sessionId, interactionId: _intId, createdAt: _createdAt, ...rest } = sessionData;
          cleanSessionData = rest;
        }

        return {
          id: interaction.id,
          type: interaction.type,
          sourceLanguage: interaction.sourceLanguage,
          targetLanguage: interaction.targetLanguage,
          status: interaction.status,
          createdAt: interaction.createdAt,
          ...(cleanSessionData || {}),
        };
      })
    );

    // Get total count for pagination
    const countResult = await database
      .select({ count: sql<number>`count(*)` })
      .from(interactions)
      .where(conditions);

    const total = countResult[0]?.count ?? 0;

    res.json({
      success: true,
      data: {
        items: enrichedResults,
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
 * GET /api/v1/history/:id
 * Get single interaction by ID
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

    let sessionData = null;

    if (interaction.type === 'voice') {
      const [session] = await database
        .select()
        .from(voiceSessions)
        .where(eq(voiceSessions.interactionId, interaction.id))
        .limit(1);
      sessionData = session;
    } else if (interaction.type === 'vision') {
      const [vision] = await database
        .select()
        .from(visionTranslations)
        .where(eq(visionTranslations.interactionId, interaction.id))
        .limit(1);
      sessionData = vision;
    } else if (interaction.type === 'document') {
      const [doc] = await database
        .select()
        .from(documentTranslations)
        .where(eq(documentTranslations.interactionId, interaction.id))
        .limit(1);
      sessionData = doc;
    }

    // Remove redundant/confusing fields from session data
    let cleanSessionData: Record<string, any> | null = null;
    if (sessionData) {
      const { id: _sessionId, interactionId: _intId, createdAt: _createdAt, ...rest } = sessionData;
      cleanSessionData = rest;
    }

    res.json({
      success: true,
      data: {
        id: interaction.id,
        type: interaction.type,
        sourceLanguage: interaction.sourceLanguage,
        targetLanguage: interaction.targetLanguage,
        status: interaction.status,
        metadata: interaction.metadata,
        createdAt: interaction.createdAt,
        updatedAt: interaction.updatedAt,
        ...(cleanSessionData || {}),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/history/:id
 * Delete an interaction (soft delete by changing status)
 */
router.delete('/:id', async (req, res, next) => {
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

    // Soft delete by updating status
    await database
      .update(interactions)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(interactions.id, id));

    logger.info('Interaction deleted', { id });

    res.json({
      success: true,
      message: 'Interaction deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
