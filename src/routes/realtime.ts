import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
  saveInteraction,
  saveVoiceSession,
} from '../services/dbService';

interface RealtimeSession {
  id: string;
  clientWs: WebSocket;
  geminiWs: WebSocket | null;
  sourceLanguage: string;
  targetLanguage: string;
  userTranscription: string;
  modelTranscription: string;
  audioChunks: Buffer[];
  startTime: Date;
}

const sessions = new Map<string, RealtimeSession>();

/**
 * Create WebSocket server for real-time translation
 */
export function createRealtimeWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (clientWs: WebSocket, request: IncomingMessage) => {
    const sessionId = uuidv4();
    logger.info('New realtime connection', { sessionId });

    const session: RealtimeSession = {
      id: sessionId,
      clientWs,
      geminiWs: null,
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      userTranscription: '',
      modelTranscription: '',
      audioChunks: [],
      startTime: new Date(),
    };

    sessions.set(sessionId, session);

    // Send session ID to client
    clientWs.send(JSON.stringify({ type: 'session_id', sessionId }));

    clientWs.on('message', async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleClientMessage(session, message);
      } catch (error) {
        logger.error('Error handling client message', { sessionId, error });
        clientWs.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    clientWs.on('close', async () => {
      logger.info('Client disconnected', { sessionId });
      await endSession(session);
      sessions.delete(sessionId);
    });

    clientWs.on('error', (error) => {
      logger.error('WebSocket error', { sessionId, error });
    });
  });
}

async function handleClientMessage(session: RealtimeSession, message: any): Promise<void> {
  switch (message.type) {
    case 'setup':
      await setupGeminiConnection(session, message);
      break;
    case 'audio':
      forwardAudioToGemini(session, message.data);
      break;
    case 'end':
      await endSession(session);
      break;
    default:
      logger.warn('Unknown message type', { type: message.type });
  }
}

async function setupGeminiConnection(
  session: RealtimeSession,
  config: { sourceLanguage: string; targetLanguage: string }
): Promise<void> {
  session.sourceLanguage = config.sourceLanguage || 'en';
  session.targetLanguage = config.targetLanguage || 'hi';

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    session.clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: 'Gemini API key not configured' 
    }));
    return;
  }

  try {
    // Connect to Gemini Live API
    const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    
    session.geminiWs = new WebSocket(geminiWsUrl);

    session.geminiWs.on('open', () => {
      logger.info('Connected to Gemini', { sessionId: session.id });
      
      // Send setup message to Gemini
      const setupMessage = {
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generation_config: {
            response_modalities: ['AUDIO', 'TEXT'],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: 'Kore'
                }
              }
            }
          },
          system_instruction: {
            parts: [{
              text: `You are an expert real-time interpreter.
LANGUAGE PAIR: ${session.sourceLanguage} → ${session.targetLanguage}

RULES:
1. Listen to audio input in ${session.sourceLanguage}
2. Translate EVERYTHING to ${session.targetLanguage} immediately
3. Speak the translation out loud in ${session.targetLanguage}
4. Transcribe both the original speech and your translation
5. Be natural and conversational in your translations

DO NOT add commentary. JUST translate.`
            }]
          }
        }
      };

      session.geminiWs!.send(JSON.stringify(setupMessage));
    });

    session.geminiWs.on('message', (data: WebSocket.Data) => {
      handleGeminiMessage(session, data);
    });

    session.geminiWs.on('close', () => {
      logger.info('Gemini connection closed', { sessionId: session.id });
      session.clientWs.send(JSON.stringify({ type: 'gemini_disconnected' }));
    });

    session.geminiWs.on('error', (error) => {
      logger.error('Gemini WebSocket error', { sessionId: session.id, error });
      session.clientWs.send(JSON.stringify({ 
        type: 'error', 
        message: 'Gemini connection error' 
      }));
    });

  } catch (error) {
    logger.error('Failed to connect to Gemini', { sessionId: session.id, error });
    session.clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: 'Failed to connect to translation service' 
    }));
  }
}

function handleGeminiMessage(session: RealtimeSession, data: WebSocket.Data): void {
  try {
    const message = JSON.parse(data.toString());

    // Handle setup complete
    if (message.setupComplete) {
      session.clientWs.send(JSON.stringify({ type: 'ready' }));
      return;
    }

    const serverContent = message.serverContent;
    if (!serverContent) return;

    // Handle input transcription (user's speech)
    if (serverContent.inputTranscription?.text) {
      session.userTranscription += serverContent.inputTranscription.text;
      session.clientWs.send(JSON.stringify({
        type: 'user_transcription',
        text: serverContent.inputTranscription.text,
        accumulated: session.userTranscription,
      }));
    }

    // Handle output transcription (model's translation)
    if (serverContent.outputTranscription?.text) {
      session.modelTranscription += serverContent.outputTranscription.text;
      session.clientWs.send(JSON.stringify({
        type: 'model_transcription',
        text: serverContent.outputTranscription.text,
        accumulated: session.modelTranscription,
      }));
    }

    // Handle audio output
    if (serverContent.modelTurn?.parts?.[0]?.inlineData?.data) {
      const audioData = serverContent.modelTurn.parts[0].inlineData.data;
      session.clientWs.send(JSON.stringify({
        type: 'audio',
        data: audioData,
      }));
    }

    // Handle turn complete
    if (serverContent.turnComplete) {
      session.clientWs.send(JSON.stringify({
        type: 'turn_complete',
        userTranscription: session.userTranscription,
        modelTranscription: session.modelTranscription,
      }));
    }

  } catch (error) {
    logger.error('Error parsing Gemini message', { sessionId: session.id, error });
  }
}

function forwardAudioToGemini(session: RealtimeSession, audioData: string): void {
  if (!session.geminiWs || session.geminiWs.readyState !== WebSocket.OPEN) {
    session.clientWs.send(JSON.stringify({ 
      type: 'error', 
      message: 'Gemini connection not ready' 
    }));
    return;
  }

  // Store audio chunk for later saving
  session.audioChunks.push(Buffer.from(audioData, 'base64'));

  // Forward to Gemini
  const message = {
    realtimeInput: {
      mediaChunks: [{
        mimeType: 'audio/pcm;rate=16000',
        data: audioData,
      }]
    }
  };

  session.geminiWs.send(JSON.stringify(message));
}

async function endSession(session: RealtimeSession): Promise<void> {
  // Close Gemini connection
  if (session.geminiWs && session.geminiWs.readyState === WebSocket.OPEN) {
    session.geminiWs.close();
  }

  // Save to database if there's content
  if (session.userTranscription || session.modelTranscription) {
    try {
      const duration = Math.floor(
        (new Date().getTime() - session.startTime.getTime()) / 1000
      );

      // Save interaction - returns the interaction ID
      const interactionId = await saveInteraction({
        type: 'voice',
        sourceLanguage: session.sourceLanguage,
        targetLanguage: session.targetLanguage,
        geminiInteractionId: session.id,
      });

      // Save voice session
      await saveVoiceSession({
        interactionId: interactionId,
        transcription: session.userTranscription,
        translation: session.modelTranscription,
        summary: '', // Real-time sessions don't have summary
        duration,
      });

      // Send interaction ID to client
      session.clientWs.send(JSON.stringify({
        type: 'session_saved',
        interactionId: interactionId,
      }));

      logger.info('Session saved to database', { 
        sessionId: session.id, 
        interactionId: interactionId 
      });

    } catch (error) {
      logger.error('Failed to save session', { sessionId: session.id, error });
    }
  }
}

export default { createRealtimeWebSocketServer };

