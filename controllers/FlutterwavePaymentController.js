// This file has been updated to use the new Mongoose models for database interactions.

import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import Flutterwave from 'flutterwave-node-v3';
import mongoose from 'mongoose';
import crypto from 'crypto';

// Import our new Mongoose models.
import Transaction from '../models/Transaction.js';
import PaymentLog from '../models/PaymentLog.js';
// The User model is not used in this file, so it can be omitted from imports.

dotenv.config();

// Initialize Flutterwave client with your API keys from .env
const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY,
);

/**
 * Controller function to initiate a Mobile Money payment.
 * It handles creating a transaction, calling the Flutterwave API,
 * and responding to the client with a redirect URL if available.
 */
export const initiateMobileMoneyPayment = async (req, res) => {
  try {
    const { caseId, employerId, craftsmanId, totalAmount, paymentMethod, employerPhone, craftsmanPhone } = req.body;

    // 1. Basic input validation - CORRECTED TO CHECK ALL REQUIRED FIELDS
    if (!totalAmount || !employerPhone || !paymentMethod || !craftsmanPhone || !caseId || !employerId || !craftsmanId) {
      return res.status(400).json({ success: false, message: 'Missing required payment details.' });
    }

    // 2. Define payment constants and transaction reference
    const tx_ref = uuidv4();
    const network = paymentMethod.toUpperCase();
    const employer = { name: "SmartCraft Employer", email: "employer@smartcraft.com" };
    const safeAmount = Math.min(parseFloat(totalAmount), 40000);

    // 3. Find or create a new transaction in your database using Mongoose methods
    // We use findOne to find the transaction by a unique field like jobId.
    let transaction = await Transaction.findOne({ jobId: caseId });
    if (!transaction) {
      // Use Mongoose's create method, ensuring the field names match the schema.
      transaction = await Transaction.create({
        jobId: caseId,
        // In a real app, this should come from a user authentication system.
        userId: mongoose.Types.ObjectId.isValid(employerId) ? employerId : new mongoose.Types.ObjectId('60c72b2f9b1e8b0015b6b1a9'),
        craftsmanId: craftsmanId,
        total_amount: safeAmount,
        commission_amount: safeAmount * 0.1,
        disbursement_amount: safeAmount * 0.9,
        transaction_id: tx_ref,
        flw_ref: '', // This will be updated later
        status: 'PENDING',
        payment_method: paymentMethod,
        employer_phone: employerPhone,
        craftsman_phone: craftsmanPhone
      });
    } else {
      // Update an existing transaction
      transaction.status = 'PENDING';
      transaction.transaction_id = tx_ref; // Use the new tx_ref for the re-attempt
      await transaction.save();
    }

    // 4. Call the Flutterwave Mobile Money API
    const response = await flw.MobileMoney.uganda({
      phone_number: employerPhone,
      network,
      amount: safeAmount,
      currency: 'UGX',
      email: employer.email,
      tx_ref,
      fullname: employer.name,
      redirect_url: 'https://your-app.com/payment/callback',
    });

    // CRITICAL DEBUGGING STEP:
    // This console.log will show you the exact response from the Flutterwave API.
    // Check your server's console for this output. If it contains an error message,
    // that is the root cause of the problem.
    console.log("Flutterwave response:", response);

    // 5. Handle the Flutterwave response
    if (response.status === 'success') {
      // Correctly extract the transaction reference and the redirect URL
      const flwRef = response.data?.flw_ref || response.data?.id || response.data?.tx_ref;
      const redirect_url = response.meta?.authorization?.redirect;

      // Update the transaction status and reference in your database using Mongoose
      transaction.status = 'PROCESSING';
      transaction.flw_ref = flwRef; // Make sure to use the correct field name
      await transaction.save();

      // Log the successful initiation and make sure to use the correct schema field name
      await PaymentLog.create({
        transaction_id: transaction.transaction_id,
        action: 'FLUTTERWAVE_INITIATE',
        status: 'PROCESSING',
        request_data: req.body,
        response_data: response
      });

      // Respond to the client, including the redirect URL if it exists
      return res.status(200).json({
        success: true,
        message: 'Payment initiated. Please follow the prompts on your phone.',
        data: {
          tx_ref: flwRef || null,
          status: response.data?.status || 'PROCESSING',
          redirect_url: redirect_url || null
        }
      });
    } else {
      // Handle Flutterwave API error responses
      return res.status(400).json({
        success: false,
        message: response.message || 'Failed to initiate payment.',
        data: response.data || null
      });
    }

  } catch (error) {
    // 6. Handle network or other unexpected errors
    console.error('Flutterwave payment error:', error);
    if (req?.body?.caseId) {
      await PaymentLog.create({
        transaction_id: req.body.caseId,
        action: 'FLUTTERWAVE_ERROR',
        status: 'FAILED',
        request_data: req.body,
        response_data: null,
        error_message: error.message
      });
    }
    return res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/**
 * Controller function to handle webhook callbacks from Flutterwave.
 */
export const handleWebhook = async (req, res) => {
  // 1. Verify the webhook signature
  const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  const signature = req.headers['verif-hash'];

  if (!signature || signature !== secretHash) {
    return res.status(401).end();
  }

  // 2. Get the event payload from the request body
  const payload = req.body;
  
  if (payload.status === 'successful') {
    const txRef = payload.tx_ref;

    // 3. Find the transaction and update its status using Mongoose
    try {
      // CORRECTION: Use `flw_ref` to find the transaction as Flutterwave provides this.
      const transaction = await Transaction.findOne({ flw_ref: txRef });
      
      if (transaction) {
        transaction.status = 'COMPLETED';
        // Add additional tracking fields for debugging
        transaction.external_transaction_id = payload.id;
        transaction.webhook_received_at = new Date();
        await transaction.save();
      }
      console.log('Successfully updated transaction status via webhook.');
    } catch (error) {
      console.error('Error processing webhook:', error);
    }
  }

  // Always send a 200 OK response to Flutterwave to confirm receipt of the webhook.
  res.status(200).end();
};

/**
 * Controller function to manually verify a transaction status.
 */
export const verifyTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    // Find the transaction using the Mongoose-compatible method.
    // NOTE: This assumes you have a static method named 'findByTransactionId'
    // defined on your Transaction model.
    const transaction = await Transaction.findByTransactionId(transactionId);

    if (!transaction || !transaction.flw_ref) {
      return res.status(404).json({ success: false, message: 'Transaction not found or not initiated.' });
    }

    const response = await flw.Transaction.verify({ id: transaction.flw_ref });

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error('Error verifying transaction:', error);
    res.status(500).json({ success: false, message: 'Verification failed.' });
  }
};
