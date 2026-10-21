const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');

/**
 * Load credentials from environment or rzp-key.csv if provided
 */
function getCredentials() {
  let keyId = process.env.RAZORPAY_KEY_ID;
  let keySecret = process.env.RAZORPAY_KEY_SECRET;

  const isPlaceholder = !keyId || keyId === 'rzp_test_placeholder' || keyId === 'rzp_test_your_key_id_here';

  if (isPlaceholder || !keySecret || keySecret === 'your_razorpay_secret_here') {
    try {
      const csvPath = path.join(__dirname, '../rzp-key.csv');
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf8').trim();
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
          for (let i = 0; i < parts.length; i++) {
            if (parts[i].startsWith('rzp_test_') || parts[i].startsWith('rzp_live_')) {
              keyId = parts[i];
              if (parts[i + 1]) {
                keySecret = parts[i + 1];
              }
            }
          }
          if (!keyId && parts.length >= 2 && !parts[0].toLowerCase().includes('key')) {
            keyId = parts[0];
            keySecret = parts[1];
          }
        }
        if (keyId) process.env.RAZORPAY_KEY_ID = keyId;
        if (keySecret) process.env.RAZORPAY_KEY_SECRET = keySecret;
      }
    } catch (e) {
      // Ignore file read error if absent
    }
  }

  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET
  };
}

function getRazorpayInstance() {
  const { keyId, keySecret } = getCredentials();
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials not found. Please provide RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
}

/**
 * Create a real Razorpay Order
 * @param {object} params
 * @param {number} params.amountInRupees
 * @param {string} params.receipt
 * @param {object} params.notes
 */
async function createRazorpayOrder({ amountInRupees, receipt, notes = {} }) {
  const { keyId, keySecret } = getCredentials();

  if (!keyId || !keySecret || keyId === 'rzp_test_placeholder' || keyId === 'rzp_test_your_key_id_here') {
    throw new Error('Razorpay API keys not configured. Please check your credentials file or environment variables.');
  }

  const razorpay = getRazorpayInstance();
  const options = {
    amount: Math.round(amountInRupees * 100), // convert to paise
    currency: 'INR',
    receipt: String(receipt).slice(0, 40),
    notes: notes
  };

  return await razorpay.orders.create(options);
}

/**
 * Verify Razorpay payment signature
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} signature
 */
function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const { keySecret } = getCredentials();
  if (!keySecret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return false;
  }
}

/**
 * Verify Webhook Signature
 * @param {string|Buffer} rawBody
 * @param {string} signature
 * @param {string} secret
 */
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;

  try {
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(bodyStr)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch (err) {
    console.error('Webhook signature verification error:', err.message);
    return false;
  }
}

/**
 * Generate a clean, unique human-readable receipt number
 * e.g., RCP-2026-A1B2C
 */
function generateReceiptNumber() {
  const year = new Date().getFullYear();
  const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
  const timePart = Date.now().toString().slice(-4);
  return `RCP-${year}-${randomPart}${timePart}`;
}

module.exports = {
  getCredentials,
  getRazorpayInstance,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  generateReceiptNumber
};
