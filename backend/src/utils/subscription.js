'use strict';

exports.isTagExpired = (expiresAt) => {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
};

exports.isTagActive = (tag) => {
  return tag.status === 'active' && !exports.isTagExpired(tag.expires_at);
};