// File: backend/src/services/smsService.js
'use strict';

const logger = require('../utils/logger');

// ─── Provider implementations ─────────────────────────────────────────────────

async function sendViaTwilio(phone, message) {
  const twilio = require('twilio');
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE,
    to: phone.startsWith('+') ? phone : `+91${phone}`,
  });
  logger.debug(`Twilio SMS sent: ${result.sid}`);
  return result;
}

async function sendViaMsg91(phone, message) {
  const https = require('https');
  const cleanPhone = phone.replace(/\D/g, '');

  const payload = JSON.stringify({
    sender: process.env.MSG91_SENDER_ID || 'VAHNTG',
    route: '4',
    country: '91',
    sms: [{ message, to: [cleanPhone] }],
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.msg91.com',
      path: '/api/sendhttp.php',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: process.env.MSG91_AUTH_KEY,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        logger.debug(`MSG91 response: ${data}`);
        resolve(data);
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendViaFast2sms(phone, message) {
  const https = require('https');
  const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.fast2sms.com',
      path: `/dev/bulkV2?authorization=${process.env.FAST2SMS_API_KEY}&message=${encodeURIComponent(message)}&language=english&route=v3&numbers=${cleanPhone}`,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        logger.debug(`Fast2SMS response: ${data}`);
        resolve(data);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─── Mock provider (development / test) ──────────────────────────────────────

async function sendViaMock(phone, message) {
  logger.info(`[MOCK SMS] To: ${phone} | Message: ${message}`);
  return { mock: true, phone, message };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function sendSms(phone, message) {
  const provider = process.env.SMS_PROVIDER || 'mock';
  try {
    switch (provider) {
      case 'twilio':   return await sendViaTwilio(phone, message);
      case 'msg91':    return await sendViaMsg91(phone, message);
      case 'fast2sms': return await sendViaFast2sms(phone, message);
      case 'mock':
      default:         return await sendViaMock(phone, message);
    }
  } catch (err) {
    logger.error(`SMS send failed via ${provider} to ${phone.slice(0, 5)}*****: ${err.message}`);
    // Don't throw — SMS failure should not break the primary flow
    return null;
  }
}

async function sendOtp(phone, otp) {
  const message = `Your VahanTag OTP is ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share.`;
  return sendSms(phone, message);
}

async function sendActivationConfirmation(phone, categoryName, expiryDate) {
  const message = `Your ${categoryName} VahanTag is now active until ${expiryDate}. Thank you!`;
  return sendSms(phone, message);
}

async function sendExpiryReminder(phone, categoryName, expiryDate) {
  const message = `Your VahanTag (${categoryName}) expires on ${expiryDate}. Renew now to keep your asset protected!`;
  return sendSms(phone, message);
}

async function makeProxyCall(callerPhone, ownerPhone) {
  const provider = process.env.SMS_PROVIDER || 'mock';

  if (provider === 'twilio' && process.env.TWILIO_PROXY_SERVICE_SID) {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // Create a Twilio proxy session
    const session = await client.proxy.v1
      .services(process.env.TWILIO_PROXY_SERVICE_SID)
      .sessions.create({ ttl: 600 }); // 10 min proxy session

    await session.participants().create({ identifier: callerPhone.startsWith('+') ? callerPhone : `+91${callerPhone}` });
    await session.participants().create({ identifier: ownerPhone.startsWith('+') ? ownerPhone : `+91${ownerPhone}` });

    return { proxyNumber: process.env.TWILIO_PHONE, sessionSid: session.sid };
  }

  // Mock proxy for dev
  logger.info(`[MOCK CALL] Proxy call: ${callerPhone} ↔ ${ownerPhone}`);
  return { proxyNumber: '+911234567890', mock: true };
}

module.exports = { sendSms, sendOtp, sendActivationConfirmation, sendExpiryReminder, makeProxyCall };
