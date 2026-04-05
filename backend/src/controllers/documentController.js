// File: backend/src/controllers/documentController.js
'use strict';

const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { uploadToCloudinary } = require('../services/uploadService');
const logger = require('../utils/logger');

exports.uploadDocument = async (req, res, next) => {
  try {
    const { tagId } = req.body;
    if (!req.file) return error(res, 'No file uploaded', 400);

    // Verify tag belongs to user
    const { rows } = await query(
      'SELECT id FROM tags WHERE id = $1 AND user_id = $2',
      [tagId, req.user.id]
    );
    if (!rows.length) return error(res, 'Tag not found or not owned by you', 404);

    const publicId = `vahantag/documents/${req.user.id}/${uuidv4()}`;
    const { url } = await uploadToCloudinary(req.file.buffer, 'vahantag/documents', publicId);

    const docEntry = {
      id: uuidv4(),
      url,
      publicId,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
    };

    // Append to tag_assets documents array
    await query(
      `UPDATE tag_assets
       SET documents = documents || $1::jsonb
       WHERE tag_id = $2`,
      [JSON.stringify([docEntry]), tagId]
    );

    logger.info(`Document uploaded for tag ${tagId}`);
    return success(res, docEntry, 'Document uploaded', 201);
  } catch (err) {
    next(err);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const { tagId, docId } = req.params;

    const { rows } = await query(
      'SELECT ta.documents FROM tag_assets ta JOIN tags t ON t.id = ta.tag_id WHERE ta.tag_id = $1 AND t.user_id = $2',
      [tagId, req.user.id]
    );
    if (!rows.length) return error(res, 'Tag not found', 404);

    const docs = rows[0].documents || [];
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return error(res, 'Document not found', 404);

    // Remove from Cloudinary
    const { deleteFromCloudinary } = require('../services/uploadService');
    await deleteFromCloudinary(doc.publicId);

    // Remove from DB array
    const updatedDocs = docs.filter((d) => d.id !== docId);
    await query('UPDATE tag_assets SET documents = $1::jsonb WHERE tag_id = $2', [JSON.stringify(updatedDocs), tagId]);

    return success(res, null, 'Document deleted');
  } catch (err) {
    next(err);
  }
};
