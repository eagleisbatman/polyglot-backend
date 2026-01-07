import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

export type AssetType = 'audio' | 'image' | 'video' | 'document';

interface UploadOptions {
  /** Type of asset being uploaded */
  assetType: AssetType;
  /** Interaction/job ID for organizing files */
  interactionId?: string;
  /** Whether this is user-generated or AI-generated content */
  source: 'user' | 'ai';
  /** Optional custom public ID */
  publicId?: string;
}

interface UploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string;
  bytes: number;
  duration?: number; // For audio/video
  width?: number;    // For images/videos
  height?: number;   // For images/videos
}

/**
 * Get the Cloudinary folder path based on asset type and source
 */
function getFolderPath(options: UploadOptions): string {
  const parts = [config.cloudinary.folder];
  
  // Add asset type subfolder
  parts.push(options.assetType);
  
  // Add source subfolder (user vs ai)
  parts.push(options.source);
  
  // Optionally organize by interaction ID
  if (options.interactionId) {
    parts.push(options.interactionId);
  }
  
  return parts.join('/');
}

/**
 * Get Cloudinary resource type based on asset type
 */
function getResourceType(assetType: AssetType): 'image' | 'video' | 'raw' | 'auto' {
  switch (assetType) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      // Use 'raw' for audio to avoid Cloudinary validation issues
      // Cloudinary's 'video' type can be strict about audio formats
      return 'raw';
    case 'document':
      return 'raw';
    default:
      return 'auto';
  }
}

/**
 * Upload a file buffer to Cloudinary
 */
export async function uploadBuffer(
  buffer: Buffer,
  options: UploadOptions
): Promise<UploadResult> {
  const folder = getFolderPath(options);
  const resourceType = getResourceType(options.assetType);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: options.publicId,
      },
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload failed', { error, folder });
          reject(error);
        } else if (result) {
          logger.info('Cloudinary upload successful', {
            publicId: result.public_id,
            url: result.secure_url,
            bytes: result.bytes,
          });
          resolve(mapResult(result));
        } else {
          reject(new Error('No result from Cloudinary'));
        }
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Upload a base64-encoded file to Cloudinary
 */
export async function uploadBase64(
  base64Data: string,
  options: UploadOptions
): Promise<UploadResult> {
  const folder = getFolderPath(options);
  const resourceType = getResourceType(options.assetType);

  // Ensure proper data URI format
  let dataUri = base64Data;
  if (!base64Data.startsWith('data:')) {
    // Add appropriate MIME type prefix
    const mimeType = getMimeType(options.assetType);
    dataUri = `data:${mimeType};base64,${base64Data}`;
  }

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: resourceType,
      public_id: options.publicId,
    });

    logger.info('Cloudinary base64 upload successful', {
      publicId: result.public_id,
      url: result.secure_url,
      bytes: result.bytes,
    });

    return mapResult(result);
  } catch (error) {
    logger.error('Cloudinary base64 upload failed', { error, folder });
    throw error;
  }
}

/**
 * Upload a file from a local path to Cloudinary
 */
export async function uploadFile(
  filePath: string,
  options: UploadOptions
): Promise<UploadResult> {
  const folder = getFolderPath(options);
  const resourceType = getResourceType(options.assetType);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: resourceType,
      public_id: options.publicId,
    });

    logger.info('Cloudinary file upload successful', {
      publicId: result.public_id,
      url: result.secure_url,
      bytes: result.bytes,
    });

    return mapResult(result);
  } catch (error) {
    logger.error('Cloudinary file upload failed', { error, folder, filePath });
    throw error;
  }
}

/**
 * Delete a file from Cloudinary
 */
export async function deleteAsset(
  publicId: string,
  assetType: AssetType
): Promise<boolean> {
  const resourceType = getResourceType(assetType);

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });

    const success = result.result === 'ok';
    logger.info('Cloudinary delete', { publicId, success });
    return success;
  } catch (error) {
    logger.error('Cloudinary delete failed', { error, publicId });
    throw error;
  }
}

/**
 * Get a signed URL for private assets (if needed in future)
 */
export function getSignedUrl(
  publicId: string,
  assetType: AssetType,
  expiresInSeconds: number = 3600
): string {
  const resourceType = getResourceType(assetType);
  
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    sign_url: true,
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

/**
 * Map Cloudinary result to our standard format
 */
function mapResult(result: UploadApiResponse): UploadResult {
  return {
    url: result.url,
    secureUrl: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
    duration: result.duration,
    width: result.width,
    height: result.height,
  };
}

/**
 * Get MIME type for asset type
 */
function getMimeType(assetType: AssetType): string {
  switch (assetType) {
    case 'audio':
      return 'audio/wav';
    case 'image':
      return 'image/png';
    case 'video':
      return 'video/mp4';
    case 'document':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Check if Cloudinary is configured
 */
export function isCloudinaryConfigured(): boolean {
  return !!(
    config.cloudinary.cloudName &&
    config.cloudinary.apiKey &&
    config.cloudinary.apiSecret
  );
}

export default {
  uploadBuffer,
  uploadBase64,
  uploadFile,
  deleteAsset,
  getSignedUrl,
  isCloudinaryConfigured,
};

