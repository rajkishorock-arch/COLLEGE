const path = require('path');
const LocalStorageDriver = require('./localStorage');
const S3StorageDriver = require('./s3Storage');

const PROVIDER = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();

// Safe extension whitelist mapped to valid MIME prefixes
const ALLOWED_MIME_TYPES = {
  // Documents
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
  // Images
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif']
};

const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10) || (10 * 1024 * 1024); // 10MB default

class StorageProvider {
  constructor() {
    this.driver = PROVIDER === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
    this.providerName = PROVIDER;
  }

  /**
   * Validate uploaded file integrity, MIME, extension, and size
   */
  validateFile(file, allowedExtensions = ['.pdf', '.docx', '.png', '.jpg', '.jpeg']) {
    if (!file) {
      throw new Error('No file provided for upload.');
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size exceeds maximum permitted limit (${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB).`);
    }

    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Invalid file extension "${ext}". Allowed: ${allowedExtensions.join(', ')}`);
    }

    const validMimes = ALLOWED_MIME_TYPES[ext];
    if (validMimes && file.mimetype && !validMimes.includes(file.mimetype.toLowerCase())) {
      // Basic MIME type spoofing detection
      console.warn(`[Storage:MimeMismatch] Upload claimed extension ${ext} but has MIME ${file.mimetype}`);
    }

    return true;
  }

  /**
   * Securely store a file partition under tenants/{tenantId}/{category}/
   */
  async saveFile(tenantId, category, fileBuffer, originalName, mimeType = null) {
    if (!tenantId) {
      throw new Error('Tenant ID is required for storage partitioning.');
    }
    // Clean category string (letters and dashes only)
    const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
    return this.driver.saveFile(tenantId, safeCategory, fileBuffer, originalName, mimeType);
  }

  /**
   * Retrieve authorized or signed download URL
   */
  async getDownloadUrl(tenantId, storageKey, isPrivate = true) {
    return this.driver.getDownloadUrl(tenantId, storageKey, isPrivate);
  }

  /**
   * Check if a storage key belongs to the specified tenant
   */
  verifyTenantOwnership(tenantId, storageKey) {
    if (!storageKey || !tenantId) return false;
    const normalizedKey = storageKey.replace(/\\/g, '/');
    return normalizedKey.startsWith(`tenants/${tenantId}/`);
  }

  /**
   * Delete file
   */
  async deleteFile(tenantId, storageKey) {
    return this.driver.deleteFile(tenantId, storageKey);
  }
}

module.exports = new StorageProvider();
