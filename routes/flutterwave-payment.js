// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\routes\flutterwave-payment.js

const express = require('express');
const router = express.Router();

// Import the payment controller that holds the business logic.
const paymentController = require('../controllers/FlutterwavePaymentController');

// Define the API routes and link them to the controller functions.
// We use a POST route for the form submission to initiate the payment.
router.post('/initiate-mobile-money', paymentController.initiateMobileMoneyPayment);

// This is the webhook endpoint that Flutterwave will send a callback to.
router.post('/flutterwave-webhook', paymentController.handleWebhook);

// This route is for manually verifying a transaction status.
router.get('/verify-transaction/:transactionId', paymentController.verifyTransaction);

// Export the router for use in app.js.
module.exports = router;
