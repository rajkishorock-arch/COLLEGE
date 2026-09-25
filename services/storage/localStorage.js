const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Local File Storage Driver with Tenant Directory Partitioning
 */
class LocalStorageDriver {
  constructor(baseDir = null) {
    this.baseDir = baseDir || path.join(__dirname, '..', '..', 'public', 'uploads');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Save file with strict tenant-scoped folder partitioning and randomized UUID filename
   */
  async saveFile(tenantId, category, fileBuffer, originalName) {
    if (!tenantId) throw new Error('Tenant ID is required for file storage.');

    // Sanitize extension
    const ext = path.extname(originalName || '').toLowerCase() || '.bin';
    const randomName = `${crypto.randomUUID()}${ext}`;

    // Path: public/uploads/tenants/{tenantId}/{category}/{randomName}
    const tenantDir = path.join(this.baseDir, 'tenants', tenantId, category);
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const fullPath = path.join(tenantDir, randomName);
    await fs.promises.writeFile(fullPath, fileBuffer);

    // Relative web/storage path
    const relativeStoragePath = `tenants/${tenantId}/${category}/${randomName}`;
    return {
      storageKey: relativeStoragePath,
      url: `/uploads/${relativeStoragePath}`,
      filename: randomName
    };
  }

  /**
   * Resolve physical path on disk
   */
  getPhysicalPath(storageKey) {
    // Prevent path traversal
    const safeKey = path.normalize(storageKey).replace(/^(\.\.[\/\\])+/, '');
    return path.join(this.baseDir, safeKey);
  }

  /**
   * Generate authorized download URL
   */
  async getDownloadUrl(tenantId, storageKey, isPrivate = false) {
    if (isPrivate) {
      // Route through authorization controller
      return `/storage/download?key=${encodeURIComponent(storageKey)}`;
    }
    return `/uploads/${storageKey}`;
  }

  /**
   * Delete file from disk
   */
  async deleteFile(tenantId, storageKey) {
    const fullPath = this.getPhysicalPath(storageKey);
    // Double check tenant ownership
    if (!storageKey.startsWith(`tenants/${tenantId}/`)) {
      throw new Error('Access Denied: Attempted to delete cross-tenant file.');
    }
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      return true;
    }
    return false;
  }
}

module.exports = LocalStorageDriver;
