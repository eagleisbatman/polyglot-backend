import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: 'polyglot', // Root folder for all Polyglot assets
  },
};

// Validate required environment variables
if (!config.geminiApiKey) {
  throw new Error('GEMINI_API_KEY is required');
}

if (!config.database.url && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production');
}

