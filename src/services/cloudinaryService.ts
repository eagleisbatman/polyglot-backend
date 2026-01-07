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
  /** User ID for organizing by user (optional, uses 'anonymous' if not provided) */
  userId?: string;
  /** Interaction/conversation ID for organizing files */
  interactionId?: string;
  /** Whether this is user-generated or AI-generated content */
  source: 'user' | 'ai';
  /** Optional custom public ID (filename without extension) */
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
 * Get the Cloudinary folder path
 * Structure: polyglot/users/{userId}/interactions/{interactionId}/
 * 
 * Examples:
 *   polyglot/users/user_123/interactions/abc-def-ghi/
 *   polyglot/users/anonymous/interactions/abc-def-ghi/
 */
function getFolderPath(options: UploadOptions): string {
  const parts = [config.cloudinary.folder]; // 'polyglot'
  
  // Add users folder
  parts.push('users');
  
  // Add user ID (or 'anonymous' if not authenticated)
  parts.push(options.userId || 'anonymous');
  
  // Add interactions folder
  parts.push('interactions');
  
  // Add interaction ID (or 'temp' for uploads without interaction)
  parts.push(options.interactionId || 'temp');
  
  return parts.join('/');
}

/**
 * Generate a descriptive public ID (filename) for the asset
 * Examples:
 *   user_recording (for user's audio)
 *   ai_translation (for AI-generated audio)
 *   original_image (for vision uploads)
 *   processed_document (for document uploads)
 */
function getPublicId(options: UploadOptions): string {
  if (options.publicId) {
    return options.publicId;
  }
  
  const prefix = options.source === 'user' ? 'user' : 'ai';
  
  switch (options.assetType) {
    case 'audio':
      return options.source === 'user' ? 'user_recording' : 'ai_translation';
    case 'image':
      return options.source === 'user' ? 'original_image' : 'processed_image';
    case 'video':
      return options.source === 'user' ? 'user_video' : 'processed_video';
    case 'document':
      return options.source === 'user' ? 'original_document' : 'translated_document';
    default:
      return `${prefix}_file_${Date.now()}`;
  }
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
  const publicId = getPublicId(options);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: publicId,
        overwrite: true, // Allow updating same file
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
  const publicId = getPublicId(options);

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
      public_id: publicId,
      overwrite: true,
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
  const publicId = getPublicId(options);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: resourceType,
      public_id: publicId,
      overwrite: true,
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

