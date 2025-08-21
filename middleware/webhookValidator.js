const crypto = require('crypto');

const validateWebhook = (req, res, next) => {
  try {
    // Skip validation in development mode
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    const signature = req.headers['x-signature'] || req.headers['signature'];
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      console.warn('Webhook validation skipped: missing signature or secret');
      return next();
    }

    // Create expected signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const providedSignature = signature.replace('sha256=', '');

    if (expectedSignature !== providedSignature) {
      console.error('Webhook signature validation failed');
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    next();
  } catch (error) {
    console.error('Webhook validation error:', error);
    res.status(500).json({ message: 'Webhook validation error' });
  }
};

module.exports = {
  validateWebhook
};