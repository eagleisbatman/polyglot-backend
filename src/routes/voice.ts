import express from 'express';
import { apiRateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validator';
import { z } from 'zod';
import { translateVoice, handleFollowUp } from '../services/geminiService';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

const voiceTranslateSchema = z.object({
  audio: z.string().min(1, 'Audio data is required'),
  sourceLanguage: z.string().min(2, 'Source language is required'),
  targetLanguage: z.string().min(2, 'Target language is required'),
  previousInteractionId: z.string().optional(),
  conversationId: z.string().uuid().optional(), // Link to existing conversation
});

const followUpSchema = z.object({
  questionId: z.string().min(1, 'Question ID is required'),
});

router.post(
  '/translate',
  apiRateLimiter,
  validateBody(voiceTranslateSchema),
  async (req, res, next) => {
    try {
      // Extract userId from header
      const userId = req.headers['x-user-id'] as string | undefined;
      
      const result = await translateVoice({
        audio: req.body.audio,
        sourceLanguage: req.body.sourceLanguage,
        targetLanguage: req.body.targetLanguage,
        previousInteractionId: req.body.previousInteractionId,
        conversationId: req.body.conversationId,
        userId,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/interactions/:interactionId/follow-up',
  apiRateLimiter,
  validateBody(followUpSchema),
  async (req, res, next) => {
    try {
      const { interactionId } = req.params;
      const { questionId } = req.body;

      if (!interactionId) {
        throw new AppError('Interaction ID is required', 400);
      }

      const result = await handleFollowUp(interactionId, questionId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

