import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';
import { voiceSessions } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads', 'audio');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, _file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(_file.originalname) || '.wav';
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

/**
 * POST /api/v1/audio/upload
 * Upload an audio file
 */
router.post('/upload', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No audio file provided', 400);
    }

    const { interactionId, type } = req.body; // type: 'user' or 'translation'

    const audioUrl = `/api/v1/audio/${req.file.filename}`;

    // If interactionId provided, update the voice session
    if (interactionId && type && db) {
      const field = type === 'user' ? 'userAudioUrl' : 'translationAudioUrl';
      
      await db
        .update(voiceSessions)
        .set({ [field]: audioUrl })
        .where(eq(voiceSessions.interactionId, interactionId));
      
      logger.info('Audio URL saved to voice session', { interactionId, type, audioUrl });
    }

    res.json({
      success: true,
      data: {
        id: req.file.filename.replace(/\.[^/.]+$/, ''),
        url: audioUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/audio/upload-base64
 * Upload audio as base64 string
 */
router.post('/upload-base64', async (req, res, next) => {
  try {
    const { audio, interactionId, type, mimeType } = req.body;

    if (!audio) {
      throw new AppError('No audio data provided', 400);
    }

    // Decode base64
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Determine file extension
    let ext = '.wav';
    if (mimeType) {
      if (mimeType.includes('mp3') || mimeType.includes('mpeg')) ext = '.mp3';
      else if (mimeType.includes('webm')) ext = '.webm';
      else if (mimeType.includes('ogg')) ext = '.ogg';
    }

    // Generate filename and save
    const uniqueId = uuidv4();
    const filename = `${uniqueId}${ext}`;
    const filepath = path.join(uploadsDir, filename);

    fs.writeFileSync(filepath, audioBuffer);

    const audioUrl = `/api/v1/audio/${filename}`;

    // If interactionId provided, update the voice session
    if (interactionId && type && db) {
      const field = type === 'user' ? 'userAudioUrl' : 'translationAudioUrl';
      
      await db
        .update(voiceSessions)
        .set({ [field]: audioUrl })
        .where(eq(voiceSessions.interactionId, interactionId));
      
      logger.info('Audio URL saved to voice session', { interactionId, type, audioUrl });
    }

    res.json({
      success: true,
      data: {
        id: uniqueId,
        url: audioUrl,
        filename,
        size: audioBuffer.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/audio/:filename
 * Stream audio file
 */
router.get('/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filepath)) {
      throw new AppError('Audio file not found', 404);
    }

    const stat = fs.statSync(filepath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'audio/wav';
    if (ext === '.mp3') contentType = 'audio/mpeg';
    else if (ext === '.webm') contentType = 'audio/webm';
    else if (ext === '.ogg') contentType = 'audio/ogg';

    if (range) {
      // Handle range requests for streaming
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      const file = fs.createReadStream(filepath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });

      file.pipe(res);
    } else {
      // Send entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      });

      fs.createReadStream(filepath).pipe(res);
    }
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/audio/:filename
 * Delete an audio file
 */
router.delete('/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filepath)) {
      throw new AppError('Audio file not found', 404);
    }

    fs.unlinkSync(filepath);
    logger.info('Audio file deleted', { filename });

    res.json({
      success: true,
      message: 'Audio file deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
