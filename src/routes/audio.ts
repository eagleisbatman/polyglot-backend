import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';
import { voiceSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  uploadBuffer,
  uploadFile,
  uploadBase64,
  deleteAsset,
  isCloudinaryConfigured,
} from '../services/cloudinaryService';

const router = express.Router();

// Use temp directory for multer (files will be uploaded to Cloudinary then deleted)
const uploadsDir = path.join(os.tmpdir(), 'polyglot-uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for temporary file storage
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
 * Upload an audio file to Cloudinary
 */
router.post('/upload', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No audio file provided', 400);
    }

    const { interactionId, type } = req.body; // type: 'user' or 'translation'
    const source = type === 'translation' ? 'ai' : 'user';

    let audioUrl: string;

    // Check if Cloudinary is configured
    if (isCloudinaryConfigured()) {
      // Upload to Cloudinary
      const result = await uploadFile(req.file.path, {
        assetType: 'audio',
        interactionId,
        source: source as 'user' | 'ai',
        publicId: req.file.filename.replace(/\.[^/.]+$/, ''),
      });

      audioUrl = result.secureUrl;

      // Delete temporary file
      fs.unlinkSync(req.file.path);

      logger.info('Audio uploaded to Cloudinary', {
        publicId: result.publicId,
        url: audioUrl,
        interactionId,
      });
    } else {
      // Fallback to local storage (for development)
      const localUploadsDir = path.join(process.cwd(), 'uploads', 'audio');
      if (!fs.existsSync(localUploadsDir)) {
        fs.mkdirSync(localUploadsDir, { recursive: true });
      }
      
      const localPath = path.join(localUploadsDir, req.file.filename);
      fs.renameSync(req.file.path, localPath);
      audioUrl = `/api/v1/audio/local/${req.file.filename}`;
      
      logger.info('Audio stored locally (Cloudinary not configured)', { audioUrl });
    }

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
        url: audioUrl,
        interactionId,
        type,
      },
    });
  } catch (error) {
    // Clean up temp file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
});

/**
 * POST /api/v1/audio/upload-base64
 * Upload audio as base64 string to Cloudinary
 */
router.post('/upload-base64', async (req, res, next) => {
  try {
    const { audio, interactionId, type, mimeType } = req.body;

    if (!audio) {
      throw new AppError('No audio data provided', 400);
    }

    const source = type === 'translation' ? 'ai' : 'user';
    let audioUrl: string;

    logger.info('Audio upload request', { 
      audioLength: audio?.length,
      interactionId,
      type,
      mimeType,
      cloudinaryConfigured: isCloudinaryConfigured(),
    });

    if (isCloudinaryConfigured()) {
      // Upload to Cloudinary
      try {
        const result = await uploadBase64(audio, {
          assetType: 'audio',
          interactionId,
          source: source as 'user' | 'ai',
        });

        audioUrl = result.secureUrl;

        logger.info('Audio (base64) uploaded to Cloudinary', {
          publicId: result.publicId,
          url: audioUrl,
          interactionId,
        });
      } catch (cloudinaryError: any) {
        logger.error('Cloudinary upload error details', {
          message: cloudinaryError.message,
          http_code: cloudinaryError.http_code,
          name: cloudinaryError.name,
        });
        throw new AppError(`Cloudinary upload failed: ${cloudinaryError.message}`, 500);
      }
    } else {
      // Fallback to local storage
      const audioBuffer = Buffer.from(audio, 'base64');
      
      let ext = '.wav';
      if (mimeType) {
        if (mimeType.includes('mp3') || mimeType.includes('mpeg')) ext = '.mp3';
        else if (mimeType.includes('webm')) ext = '.webm';
        else if (mimeType.includes('ogg')) ext = '.ogg';
      }

      const localUploadsDir = path.join(process.cwd(), 'uploads', 'audio');
      if (!fs.existsSync(localUploadsDir)) {
        fs.mkdirSync(localUploadsDir, { recursive: true });
      }

      const uniqueId = uuidv4();
      const filename = `${uniqueId}${ext}`;
      const filepath = path.join(localUploadsDir, filename);

      fs.writeFileSync(filepath, audioBuffer);
      audioUrl = `/api/v1/audio/local/${filename}`;

      logger.info('Audio (base64) stored locally', { audioUrl });
    }

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
        url: audioUrl,
        interactionId,
        type,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/audio/local/:filename
 * Stream locally stored audio file (fallback when Cloudinary not configured)
 */
router.get('/local/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const localUploadsDir = path.join(process.cwd(), 'uploads', 'audio');
    const filepath = path.join(localUploadsDir, filename);

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
 * DELETE /api/v1/audio/:publicId
 * Delete an audio file from Cloudinary
 */
router.delete('/:publicId', async (req, res, next) => {
  try {
    const { publicId } = req.params;

    if (isCloudinaryConfigured()) {
      const deleted = await deleteAsset(publicId, 'audio');
      
      if (!deleted) {
        throw new AppError('Failed to delete audio file', 500);
      }

      logger.info('Audio file deleted from Cloudinary', { publicId });
    } else {
      // Delete from local storage
      const localUploadsDir = path.join(process.cwd(), 'uploads', 'audio');
      const filepath = path.join(localUploadsDir, publicId);
      
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info('Audio file deleted locally', { publicId });
      } else {
        throw new AppError('Audio file not found', 404);
      }
    }

    res.json({
      success: true,
      message: 'Audio file deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
