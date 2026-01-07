import express from 'express';
import { z } from 'zod';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { getLocationFromIP, getClientIP } from '../services/geoService';

const router = express.Router();

// Schema for device registration
const registerDeviceSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
  deviceModel: z.string().optional(),
  deviceBrand: z.string().optional(),
  osName: z.string().optional(),
  osVersion: z.string().optional(),
  appVersion: z.string().optional(),
  timezone: z.string().optional(),
});

// Schema for location update
const updateLocationSchema = z.object({
  country: z.string().optional(),
  countryCode: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  timezone: z.string().optional(),
});

// Schema for preferences update
const updatePreferencesSchema = z.object({
  preferredSourceLanguage: z.string().optional(),
  preferredTargetLanguage: z.string().optional(),
});

/**
 * POST /api/v1/device/register
 * Register a device and get/create user
 */
router.post('/register', async (req, res, next) => {
  try {
    if (!db) {
      throw new AppError('Database not configured', 500);
    }

    const data = registerDeviceSchema.parse(req.body);

    // Check if device already registered
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.deviceId, data.deviceId))
      .limit(1);

    if (existingUser) {
      // Update last active and device info
      const [updatedUser] = await db
        .update(users)
        .set({
          deviceModel: data.deviceModel || existingUser.deviceModel,
          deviceBrand: data.deviceBrand || existingUser.deviceBrand,
          osName: data.osName || existingUser.osName,
          osVersion: data.osVersion || existingUser.osVersion,
          appVersion: data.appVersion || existingUser.appVersion,
          timezone: data.timezone || existingUser.timezone,
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id))
        .returning();

      logger.info('Existing device logged in', { 
        userId: updatedUser.id, 
        deviceId: data.deviceId 
      });

      return res.json({
        success: true,
        data: {
          userId: updatedUser.id,
          isNewUser: false,
          user: sanitizeUser(updatedUser),
        },
      });
    }

    // Get IP-based location for new users
    const clientIP = getClientIP(req);
    const ipLocation = await getLocationFromIP(clientIP);

    // Create new user with IP-based location
    const [newUser] = await db
      .insert(users)
      .values({
        deviceId: data.deviceId,
        deviceModel: data.deviceModel,
        deviceBrand: data.deviceBrand,
        osName: data.osName,
        osVersion: data.osVersion,
        appVersion: data.appVersion,
        timezone: data.timezone || ipLocation?.timezone,
        // Set location from IP (can be updated later with precise GPS)
        country: ipLocation?.country,
        countryCode: ipLocation?.countryCode,
        city: ipLocation?.city,
        region: ipLocation?.region,
        latitude: ipLocation?.latitude,
        longitude: ipLocation?.longitude,
      })
      .returning();

    logger.info('New device registered', { 
      userId: newUser.id, 
      deviceId: data.deviceId,
      deviceModel: data.deviceModel,
    });

    res.status(201).json({
      success: true,
      data: {
        userId: newUser.id,
        isNewUser: true,
        user: sanitizeUser(newUser),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/device/user/:userId
 * Get user details
 */
router.get('/user/:userId', async (req, res, next) => {
  try {
    if (!db) {
      throw new AppError('Database not configured', 500);
    }

    const { userId } = req.params;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Update last active
    await db
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));

    res.json({
      success: true,
      data: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/device/user/:userId/location
 * Update user's location
 * If no location data provided, falls back to IP-based detection
 */
router.put('/user/:userId/location', async (req, res, next) => {
  try {
    if (!db) {
      throw new AppError('Database not configured', 500);
    }

    const { userId } = req.params;
    let data = updateLocationSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // If no location data provided, use IP-based detection
    const hasLocationData = data.country || data.city || data.latitude;
    if (!hasLocationData) {
      const clientIP = getClientIP(req);
      const ipLocation = await getLocationFromIP(clientIP);
      
      if (ipLocation) {
        data = {
          ...data,
          ...ipLocation,
        };
        logger.info('Using IP-based location', { userId, ip: clientIP });
      }
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        country: data.country,
        countryCode: data.countryCode,
        city: data.city,
        region: data.region,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    logger.info('User location updated', { 
      userId, 
      country: data.country,
      city: data.city,
    });

    res.json({
      success: true,
      data: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/device/user/:userId/preferences
 * Update user's language preferences
 */
router.put('/user/:userId/preferences', async (req, res, next) => {
  try {
    if (!db) {
      throw new AppError('Database not configured', 500);
    }

    const { userId } = req.params;
    const data = updatePreferencesSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        preferredSourceLanguage: data.preferredSourceLanguage || user.preferredSourceLanguage,
        preferredTargetLanguage: data.preferredTargetLanguage || user.preferredTargetLanguage,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    logger.info('User preferences updated', { 
      userId, 
      sourceLanguage: data.preferredSourceLanguage,
      targetLanguage: data.preferredTargetLanguage,
    });

    res.json({
      success: true,
      data: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Remove sensitive fields from user object
 */
function sanitizeUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    deviceModel: user.deviceModel,
    deviceBrand: user.deviceBrand,
    osName: user.osName,
    osVersion: user.osVersion,
    appVersion: user.appVersion,
    country: user.country,
    countryCode: user.countryCode,
    city: user.city,
    region: user.region,
    timezone: user.timezone,
    preferredSourceLanguage: user.preferredSourceLanguage,
    preferredTargetLanguage: user.preferredTargetLanguage,
    lastActiveAt: user.lastActiveAt,
    createdAt: user.createdAt,
  };
}

export default router;

