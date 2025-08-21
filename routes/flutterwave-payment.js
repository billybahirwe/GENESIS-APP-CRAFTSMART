// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\routes\flutterwave-payment.js

const express = require('express');
const router = express.Router();

// Import the payment controller that holds the business logic.
const paymentController = require('../controllers/FlutterwavePaymentController');

// Define the API routes and link them to the controller functions
router.post('/initiate', paymentController.initiateMobileMoneyPayment);
router.post('/webhook', paymentController.handleWebhook);
router.get('/verify-transaction/:transactionId', paymentController.verifyTransaction);

// Export the router for use in app.js.
module.exports = router;
