import express from 'express';
import multer from 'multer';
import { apiRateLimiter } from '../middleware/rateLimiter';
import { translateVision } from '../services/geminiService';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Only image files are allowed', 400));
    }
  },
});

router.post(
  '/translate',
  apiRateLimiter,
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Image file is required', 400);
      }

      const targetLanguage = req.body.targetLanguage || 'en';

      if (!targetLanguage || typeof targetLanguage !== 'string') {
        throw new AppError('Target language is required', 400);
      }

      // Convert buffer to base64
      const imageBase64 = req.file.buffer.toString('base64');

      const result = await translateVision({
        image: imageBase64,
        targetLanguage,
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

