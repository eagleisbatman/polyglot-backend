import express from 'express';
import { isCloudinaryConfigured } from '../services/cloudinaryService';
import { db } from '../db';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    services: {
      database: !!db,
      cloudinary: isCloudinaryConfigured(),
      gemini: !!process.env.GEMINI_API_KEY,
    },
  });
});

export default router;

