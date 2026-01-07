import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import {
  saveInteraction,
  saveVoiceSession,
  saveVisionTranslation,
  saveDocumentTranslation,
  saveFollowUpQuestions,
  getFollowUpQuestion,
  getInteraction,
  getInteractionByGeminiId,
} from './dbService';

const client = new GoogleGenAI({
  apiKey: config.geminiApiKey,
});

/**
 * Handle Gemini API errors with proper error messages
 */
function handleGeminiError(error: any): never {
  logger.error('Gemini API error', {
    status: error.status,
    message: error.message,
    details: error.details,
  });

  if (error.status === 429) {
    throw new AppError(
      'Rate limit exceeded. Please try again later.',
      429
    );
  }

  if (error.status === 401 || error.status === 403) {
    throw new AppError('Invalid API key or authentication failed', 401);
  }

  if (error.status === 400) {
    throw new AppError(
      `Invalid request: ${error.message || 'Bad request'}`,
      400
    );
  }

  if (error.status === 503 || error.status === 500) {
    throw new AppError('Translation service temporarily unavailable', 503);
  }

  // Generic error
  throw new AppError(
    `Translation service error: ${error.message || 'Unknown error'}`,
    500
  );
}

// Schema for voice translation response
const VoiceResponseSchema = z.object({
  main_answer: z.string().describe('Comprehensive answer/translation'),
  summary: z.string().describe('Brief 1-2 sentence summary for TTS'),
  transcription: z.string().optional().describe('Transcription of the audio input'),
  follow_up_questions: z
    .array(
      z.object({
        question_text: z.string(),
        question_id: z.string(),
        category: z.string(),
        priority: z.number().min(1).max(3),
      })
    )
    .describe('3-5 relevant follow-up questions'),
  detected_language: z.string().optional(),
  urgency: z.enum(['immediate', 'soon', 'routine']).optional(),
});

export interface VoiceTranslationRequest {
  audio: string; // base64 encoded
  sourceLanguage: string;
  targetLanguage: string;
  previousInteractionId?: string;
}

export interface VoiceTranslationResponse {
  interactionId: string; // Database UUID
  transcription: string;
  translation: string;
  summary: string;
  followUpQuestions: Array<{
    questionText: string;
    questionId: string;
    category: string;
    priority: number;
  }>;
  detectedLanguage?: string;
  urgency?: string;
}

export async function translateVoice(
  request: VoiceTranslationRequest
): Promise<VoiceTranslationResponse> {
  try {
    const systemPrompt = `You are a translation assistant. Translate from ${request.sourceLanguage} to ${request.targetLanguage}. 
    Provide a comprehensive translation and generate relevant follow-up questions. 
    Keep the summary brief (1-2 sentences) for text-to-speech.
    Include the transcription of the audio input in your response.`;

    const input = [
      {
        type: 'text',
        text: systemPrompt,
      },
      {
        type: 'audio',
        data: request.audio,
        mime_type: 'audio/wav',
      },
    ];

    const interactionParams: any = {
      model: 'gemini-2.5-flash',
      input,
      response_format: zodToJsonSchema(VoiceResponseSchema as any) as any,
    };

    // If previousInteractionId is provided, get the Gemini interaction ID
    if (request.previousInteractionId) {
      try {
        const previousInteraction = await getInteractionByGeminiId(
          request.previousInteractionId
        );
        interactionParams.previous_interaction_id =
          previousInteraction.geminiInteractionId;
      } catch (error: any) {
        // If interaction not found in DB, try using it directly as Gemini ID
        logger.warn('Previous interaction not found in DB, using as Gemini ID', {
          interactionId: request.previousInteractionId,
        });
        interactionParams.previous_interaction_id = request.previousInteractionId;
      }
    }

    const interaction = await client.interactions.create(interactionParams);

    const outputs = interaction.outputs || [];
    const lastOutput = outputs[outputs.length - 1] as any;
    const responseText = lastOutput?.text || '{}';
    const response = VoiceResponseSchema.parse(JSON.parse(responseText));

    // Save interaction to database
    const dbInteractionId = await saveInteraction({
      geminiInteractionId: interaction.id,
      type: 'voice',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      metadata: {
        detectedLanguage: response.detected_language,
        urgency: response.urgency,
      },
    });

    // Save voice session
    await saveVoiceSession({
      interactionId: dbInteractionId,
      transcription: response.transcription || '',
      translation: response.main_answer,
      summary: response.summary,
    });

    // Save follow-up questions
    if (response.follow_up_questions.length > 0) {
      await saveFollowUpQuestions(
        dbInteractionId,
        response.follow_up_questions.map((q) => ({
          questionId: q.question_id,
          questionText: q.question_text,
          category: q.category,
          priority: q.priority,
        }))
      );
    }

    return {
      interactionId: dbInteractionId,
      transcription: response.transcription || '',
      translation: response.main_answer,
      summary: response.summary,
      followUpQuestions: response.follow_up_questions.map((q) => ({
        questionText: q.question_text,
        questionId: q.question_id,
        category: q.category,
        priority: q.priority,
      })),
      detectedLanguage: response.detected_language,
      urgency: response.urgency,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    // Check if it's a Gemini API error
    if (error.status || error.response) {
      handleGeminiError(error);
    }

    logger.error('Voice translation error', { error: error.message });
    throw new AppError('Failed to translate voice input', 500);
  }
}

// Schema for vision translation response
const VisionResponseSchema = z.object({
  translated_text: z.string().describe('Extracted and translated text'),
  confidence: z.enum(['high', 'medium', 'low']),
  detected_language: z.string().optional(),
  extracted_text: z.string().optional().describe('Original text extracted from image'),
});

export interface VisionTranslationRequest {
  image: string; // base64 encoded
  targetLanguage: string;
}

export interface VisionTranslationResponse {
  interactionId: string; // Database UUID
  translatedText: string;
  confidence: string;
  detectedLanguage?: string;
}

export async function translateVision(
  request: VisionTranslationRequest
): Promise<VisionTranslationResponse> {
  try {
    const prompt = `Extract text from this image and translate it to ${request.targetLanguage}. 
    Provide the translated text and confidence level.`;

    const interaction = await client.interactions.create({
      model: 'gemini-2.5-flash',
      input: [
        {
          type: 'text',
          text: prompt,
        },
        {
          type: 'image',
          data: request.image,
          mime_type: 'image/jpeg',
        },
      ],
      response_format: zodToJsonSchema(VisionResponseSchema as any) as any,
    });

    const outputs = interaction.outputs || [];
    const lastOutput = outputs[outputs.length - 1] as any;
    const responseText = lastOutput?.text || '{}';
    const response = VisionResponseSchema.parse(JSON.parse(responseText));

    // Save interaction to database
    const dbInteractionId = await saveInteraction({
      geminiInteractionId: interaction.id,
      type: 'vision',
      targetLanguage: request.targetLanguage,
      metadata: {
        detectedLanguage: response.detected_language,
        confidence: response.confidence,
      },
    });

    // Save vision translation
    await saveVisionTranslation({
      interactionId: dbInteractionId,
      translatedText: response.translated_text,
      extractedText: response.extracted_text ?? undefined,
      confidence: response.confidence,
    });

    return {
      interactionId: dbInteractionId,
      translatedText: response.translated_text,
      confidence: response.confidence,
      detectedLanguage: response.detected_language,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    // Check if it's a Gemini API error
    if (error.status || error.response) {
      handleGeminiError(error);
    }

    logger.error('Vision translation error', { error: error.message });
    throw new AppError('Failed to translate image', 500);
  }
}

// Schema for document translation response
const DocumentResponseSchema = z.object({
  result: z.string().describe('Translated or summarized text'),
  mode: z.enum(['translate', 'summarize']),
  word_count: z.number().optional(),
  original_text: z.string().optional().describe('Original text from document'),
});

export interface DocumentTranslationRequest {
  document: string; // base64 encoded
  targetLanguage: string;
  mode: 'translate' | 'summarize';
  mimeType: string;
  fileName: string;
}

export interface DocumentTranslationResponse {
  interactionId: string; // Database UUID
  result: string;
  mode: string;
  wordCount?: number;
}

export async function translateDocument(
  request: DocumentTranslationRequest
): Promise<DocumentTranslationResponse> {
  try {
    const prompt =
      request.mode === 'translate'
        ? `Translate this document to ${request.targetLanguage}. Preserve formatting where possible.`
        : `Summarize this document in ${request.targetLanguage}. Provide key points.`;

    const interaction = await client.interactions.create({
      model: 'gemini-2.5-flash',
      input: [
        {
          type: 'text',
          text: prompt,
        },
        {
          type: 'document',
          data: request.document,
          mime_type: request.mimeType,
        },
      ],
      response_format: zodToJsonSchema(DocumentResponseSchema as any) as any,
    });

    const outputs = interaction.outputs || [];
    const lastOutput = outputs[outputs.length - 1] as any;
    const responseText = lastOutput?.text || '{}';
    const response = DocumentResponseSchema.parse(JSON.parse(responseText));

    // Determine file type from mimeType
    const fileTypeMap: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'docx',
      'text/plain': 'txt',
    };
    const fileType = fileTypeMap[request.mimeType] || 'txt';

    // Save interaction to database
    const dbInteractionId = await saveInteraction({
      geminiInteractionId: interaction.id,
      type: 'document',
      targetLanguage: request.targetLanguage,
      metadata: {
        mode: request.mode,
      },
    });

    // Save document translation
    await saveDocumentTranslation({
      interactionId: dbInteractionId,
      fileName: request.fileName,
      fileType,
      mode: request.mode,
      originalText: response.original_text ?? undefined,
      resultText: response.result,
      wordCount: response.word_count ?? undefined,
    });

    return {
      interactionId: dbInteractionId,
      result: response.result,
      mode: response.mode,
      wordCount: response.word_count,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    // Check if it's a Gemini API error
    if (error.status || error.response) {
      handleGeminiError(error);
    }

    logger.error('Document translation error', { error: error.message });
    throw new AppError('Failed to translate document', 500);
  }
}

// Handle follow-up questions
export async function handleFollowUp(
  interactionId: string, // Database UUID
  questionId: string
): Promise<VoiceTranslationResponse> {
  try {
    // Get the interaction from database (try as database UUID first)
    let interaction;
    let geminiInteractionId: string;
    let dbInteractionId: string;
    
    try {
      interaction = await getInteraction(interactionId);
      geminiInteractionId = interaction.geminiInteractionId;
      dbInteractionId = interaction.id;
    } catch {
      // If not found as DB UUID, try as Gemini ID
      try {
        interaction = await getInteractionByGeminiId(interactionId);
        geminiInteractionId = interaction.geminiInteractionId;
        dbInteractionId = interaction.id;
      } catch {
        // If still not found, use interactionId directly as Gemini ID
        logger.warn('Interaction not found in DB, using as Gemini ID', {
          interactionId,
        });
        geminiInteractionId = interactionId;
        dbInteractionId = interactionId; // Will use this for question lookup
        // Create a minimal interaction object for the rest of the function
        interaction = {
          id: interactionId,
          geminiInteractionId: interactionId,
          type: 'voice',
          sourceLanguage: null,
          targetLanguage: 'en', // Default fallback
        };
      }
    }

    // Get the follow-up question from database
    let question;
    try {
      question = await getFollowUpQuestion(dbInteractionId, questionId);
    } catch (error: any) {
      // If question not found in DB, create a fallback question text
      logger.warn('Follow-up question not found in DB', {
        interactionId: dbInteractionId,
        questionId,
      });
      question = {
        questionId,
        questionText: `Answer this follow-up question: ${questionId}`,
        category: null,
        priority: null,
      };
    }

    // Create new interaction with the question
    const newInteraction = await client.interactions.create({
      model: 'gemini-2.5-flash',
      input: question.questionText,
      previous_interaction_id: geminiInteractionId,
      response_format: zodToJsonSchema(VoiceResponseSchema as any) as any,
    });

    const newOutputs = newInteraction.outputs || [];
    const newLastOutput = newOutputs[newOutputs.length - 1] as any;
    const responseText = newLastOutput?.text || '{}';
    const response = VoiceResponseSchema.parse(JSON.parse(responseText));

    // Save new interaction to database
    const newDbInteractionId = await saveInteraction({
      geminiInteractionId: newInteraction.id,
      type: 'voice',
      sourceLanguage: interaction.sourceLanguage || undefined,
      targetLanguage: interaction.targetLanguage,
      metadata: {
        isFollowUp: true,
        originalInteractionId: dbInteractionId,
        questionId,
      },
    });

    // Save voice session
    await saveVoiceSession({
      interactionId: newDbInteractionId,
      transcription: response.transcription || '',
      translation: response.main_answer,
      summary: response.summary,
    });

    // Save follow-up questions
    if (response.follow_up_questions.length > 0) {
      await saveFollowUpQuestions(
        newDbInteractionId,
        response.follow_up_questions.map((q) => ({
          questionId: q.question_id,
          questionText: q.question_text,
          category: q.category,
          priority: q.priority,
        }))
      );
    }

    return {
      interactionId: newDbInteractionId,
      transcription: response.transcription || '',
      translation: response.main_answer,
      summary: response.summary,
      followUpQuestions: response.follow_up_questions.map((q) => ({
        questionText: q.question_text,
        questionId: q.question_id,
        category: q.category,
        priority: q.priority,
      })),
      detectedLanguage: response.detected_language,
      urgency: response.urgency,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    // Check if it's a Gemini API error
    if (error.status || error.response) {
      handleGeminiError(error);
    }

    logger.error('Follow-up handling error', { error: error.message });
    throw new AppError('Failed to handle follow-up question', 500);
  }
}
