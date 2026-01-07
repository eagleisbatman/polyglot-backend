import express from 'express';
import multer from 'multer';
import { apiRateLimiter } from '../middleware/rateLimiter';
import { translateDocument } from '../services/geminiService';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Configure multer for document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          'Only PDF, DOC, DOCX, and TXT files are allowed',
          400
        )
      );
    }
  },
});

router.post(
  '/translate',
  apiRateLimiter,
  upload.single('document'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Document file is required', 400);
      }

      const targetLanguage = req.body.targetLanguage || 'en';
      const mode = req.body.mode || 'translate';

      if (!targetLanguage || typeof targetLanguage !== 'string') {
        throw new AppError('Target language is required', 400);
      }

      if (mode !== 'translate' && mode !== 'summarize') {
        throw new AppError('Mode must be either "translate" or "summarize"', 400);
      }

      // Convert buffer to base64
      const documentBase64 = req.file.buffer.toString('base64');

      const result = await translateDocument({
        document: documentBase64,
        targetLanguage,
        mode: mode as 'translate' | 'summarize',
        mimeType: req.file.mimetype,
        fileName: req.file.originalname || 'document',
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

export default router;

