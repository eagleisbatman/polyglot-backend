import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

// Create rate limiter with custom handler for 429 responses
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  // Custom handler to add X-RateLimit-* headers (for API contract compatibility)
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + config.rateLimit.windowMs);
    res.set({
      'X-RateLimit-Limit': config.rateLimit.maxRequests.toString(),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': Math.floor(resetTime.getTime() / 1000).toString(),
    });
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later.',
    });
  },
});

// Middleware wrapper to add X-RateLimit-* headers to all responses
export const apiRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Store original json function
  const originalJson = res.json.bind(res);
  
  // Override json to add headers before sending response
  res.json = function (body: any) {
    // Get rate limit info from response (set by express-rate-limit)
    const rateLimitInfo = (res as any).rateLimit;
    
    // Calculate reset time
    const resetTime = rateLimitInfo?.resetTime 
      ? new Date(rateLimitInfo.resetTime)
      : new Date(Date.now() + config.rateLimit.windowMs);
    
    // Add X-RateLimit-* headers (for API contract compatibility)
    res.set({
      'X-RateLimit-Limit': config.rateLimit.maxRequests.toString(),
      'X-RateLimit-Remaining': rateLimitInfo?.remaining?.toString() ?? config.rateLimit.maxRequests.toString(),
      'X-RateLimit-Reset': Math.floor(resetTime.getTime() / 1000).toString(),
    });
    
    return originalJson(body);
  };

  // Apply rate limiter
  limiter(req, res, next);
};

