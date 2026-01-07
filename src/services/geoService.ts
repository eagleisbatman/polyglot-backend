import { logger } from '../utils/logger';

interface GeoLocation {
  country?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
}

interface IPAPIResponse {
  status: 'success' | 'fail';
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
}

/**
 * Get geolocation from IP address using free ip-api.com service
 * Falls back gracefully if the service is unavailable
 */
export async function getLocationFromIP(ip: string): Promise<GeoLocation | null> {
  try {
    // Clean up IP address
    let cleanIP = ip;
    
    // Handle localhost/private IPs - use empty string to get requester's public IP
    if (
      cleanIP === '127.0.0.1' ||
      cleanIP === '::1' ||
      cleanIP === 'localhost' ||
      cleanIP.startsWith('192.168.') ||
      cleanIP.startsWith('10.') ||
      cleanIP.startsWith('172.')
    ) {
      // For local development, use empty endpoint to get our public IP
      cleanIP = '';
    }

    // Remove IPv6 prefix if present
    if (cleanIP.startsWith('::ffff:')) {
      cleanIP = cleanIP.substring(7);
    }

    // Use ip-api.com (free, no API key required, 45 requests/minute)
    const url = cleanIP
      ? `http://ip-api.com/json/${cleanIP}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone`
      : `http://ip-api.com/json/?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone`;

    const response = await fetch(url);
    const data = (await response.json()) as IPAPIResponse;

    if (data.status === 'fail') {
      logger.warn('IP geolocation failed', { ip: cleanIP, message: data.message });
      return null;
    }

    logger.info('IP geolocation successful', {
      ip: cleanIP || 'auto-detected',
      country: data.country,
      city: data.city,
    });

    return {
      country: data.country,
      countryCode: data.countryCode,
      city: data.city,
      region: data.regionName,
      latitude: data.lat?.toString(),
      longitude: data.lon?.toString(),
      timezone: data.timezone,
    };
  } catch (error) {
    logger.error('IP geolocation error', { ip, error });
    return null;
  }
}

/**
 * Extract client IP from request
 * Handles proxies and load balancers
 */
export function getClientIP(req: { 
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  connection?: { remoteAddress?: string };
}): string {
  // Check X-Forwarded-For (common for proxies/load balancers)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const forwardedIP = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    // X-Forwarded-For can contain multiple IPs, take the first (original client)
    return forwardedIP.split(',')[0].trim();
  }

  // Check other common headers
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  // Fall back to Express req.ip or connection.remoteAddress
  return req.ip || req.connection?.remoteAddress || '127.0.0.1';
}

