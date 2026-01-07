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
import deviceRoutes from './routes/device';
import { createRealtimeWebSocketServer } from './routes/realtime';
import { runStartupMigrations } from './db/runMigrations';

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
app.use('/api/v1/device', deviceRoutes);
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
// Use noServer mode and manually handle upgrade for better Railway compatibility
const wss = new WebSocketServer({ noServer: true });

// Initialize WebSocket handlers
createRealtimeWebSocketServer(wss);

// Handle WebSocket upgrade manually (required for Railway proxy compatibility)
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  
  logger.info('WebSocket upgrade request', { 
    pathname,
    headers: { upgrade: request.headers.upgrade, connection: request.headers.connection }
  });
  
  if (pathname === '/api/v1/realtime') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    logger.warn('WebSocket upgrade rejected - invalid path', { pathname });
    socket.destroy();
  }
});

logger.info('WebSocket server initialized', { path: '/api/v1/realtime' });

// Start server with migrations
async function startServer() {
  // Run database migrations first
  await runStartupMigrations();
  
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`, {
      env: process.env.NODE_ENV,
      port: PORT,
      database: process.env.DATABASE_URL ? 'connected' : 'not configured',
      websocket: 'enabled',
    });
  });
}

startServer().catch((error) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});

export default app;

