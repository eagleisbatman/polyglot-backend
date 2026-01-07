import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer } from 'ws';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import voiceRoutes from './routes/voice';
import visionRoutes from './routes/vision';
import documentRoutes from './routes/documents';
import healthRoutes from './routes/health';
import historyRoutes from './routes/history';
import audioRoutes from './routes/audio';
import { createRealtimeWebSocketServer } from './routes/realtime';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Routes
app.use('/api/v1/voice', voiceRoutes);
app.use('/api/v1/vision', visionRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/history', historyRoutes);
app.use('/api/v1/audio', audioRoutes);
app.use('/health', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Polyglot Backend API',
    version: '1.0.0',
    status: 'running',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Create WebSocket server for real-time translation
const wss = new WebSocketServer({ 
  server,
  path: '/api/v1/realtime',
});

// Initialize WebSocket handlers
createRealtimeWebSocketServer(wss);

logger.info('WebSocket server initialized', { path: '/api/v1/realtime' });

// Start server
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    env: process.env.NODE_ENV,
    port: PORT,
    database: process.env.DATABASE_URL ? 'connected' : 'not configured',
    websocket: 'enabled',
  });
});

export default app;

