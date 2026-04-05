// File: backend/src/services/uploadService.js
'use strict';

const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');
const { error } = require('../utils/response');
const logger = require('../utils/logger');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Multer memory storage (files go to Cloudinary, not disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPG, PNG, WEBP, GIF, PDF`));
    }
  },
});

/**
 * Upload a buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {string} folder  e.g. 'vahantag/documents'
 * @param {string} publicId
 * @returns {Promise<{url: string, publicId: string}>}
 */
async function uploadToCloudinary(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: 'auto' },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Delete a file from Cloudinary.
 */
async function deleteFromCloudinary(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info(`Deleted from Cloudinary: ${publicId}`);
  } catch (err) {
    logger.warn(`Failed to delete from Cloudinary: ${publicId} — ${err.message}`);
  }
}

module.exports = { upload, uploadToCloudinary, deleteFromCloudinary };
