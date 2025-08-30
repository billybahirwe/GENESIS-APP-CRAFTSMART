const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const Flutterwave = require('flutterwave-node-v3');
const mongoose = require('mongoose');
const crypto = require('crypto');

const Transaction = require('../models/Transaction.js');
const PaymentLog = require('../models/PaymentLog.js');
const User = require('../models/user.js'); 
const Job = require('../models/job.js'); 

dotenv.config();

// 🔎 Debug log to check if env variables are loaded

console.log("🔑 FLW_PUBLIC_KEY from .env:", process.env.FLW_PUBLIC_KEY ? "✅ Loaded" : "❌ MISSING");
console.log("🔑 FLW_SECRET_KEY from .env:", process.env.FLW_SECRET_KEY ? "✅ Loaded" : "❌ MISSING");
console.log("🔑 APP_BASE_URL from .env:", process.env.APP_BASE_URL || "❌ MISSING");
// Initialize Flutterwave client
const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY,
);

exports.initiateMobileMoneyPayment = async (req, res) => {
  try {
    const { caseId, totalAmount, paymentMethod, employerPhone } = req.body;

    // Debug incoming request
    console.log("📩 initiateMobileMoneyPayment request body:", req.body);

    if (!totalAmount || !employerPhone || !paymentMethod || !caseId) {
      return res.status(400).json({ success: false, message: 'Missing required payment details.' });
    }
    
    if (!req.user) {
      console.error('❌ User not authenticated in payment initiation route.');
      return res.status(401).json({ success: false, message: 'User not authenticated.' });
    }

    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      console.error(`❌ Invalid caseId provided: ${caseId}`);
      return res.status(400).json({ success: false, message: 'Invalid job ID provided.' });
    }
    
    const tx_ref = uuidv4();
    const network = paymentMethod.toUpperCase();
    const safeAmount = parseFloat(totalAmount);
    
    const job = await Job.findById(caseId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    let transaction = await Transaction.findOne({ jobId: caseId });
    if (!transaction) {
      transaction = await Transaction.create({
        userId: req.user._id, 
        jobId: caseId,
        transactionId: tx_ref,
        total_amount: safeAmount,
        commission_amount: safeAmount * 0.1,
        disbursement_amount: safeAmount * 0.9,
        status: 'PENDING',
        payment_method: paymentMethod,
        employer_phone: employerPhone,
        craftsman_phone: job.craftsmanPhoneNumber || ''
      });
    } else {
      transaction.status = 'PENDING';
      transaction.transactionId = tx_ref;
      await transaction.save();
    }

    // 🔎 Debug: Log before API call
    console.log("🚀 Sending request to Flutterwave with tx_ref:", tx_ref);

    const response = await flw.MobileMoney.uganda({
      phone_number: employerPhone,
      network,
      amount: safeAmount,
      currency: 'UGX',
      email: req.user.email,
      tx_ref,
      fullname: req.user.name,
      redirect_url: `${process.env.APP_BASE_URL}/payment/status/${tx_ref}`,
    });

    console.log("📡 Flutterwave raw response:", response);

    if (response.status === 'success' && response.data.status === 'pending') {
      const flwRef = response.data?.flw_ref || response.data?.id || response.data?.tx_ref;
      const redirect_url = response.meta?.authorization?.redirect;

      transaction.status = 'INITIATED'; 
      transaction.payment_reference = flwRef;
      await transaction.save();

      await PaymentLog.create({
        transactionId: transaction.transactionId,
        action: 'FLUTTERWAVE_INITIATE',
        status: 'PROCESSING',
        requestData: req.body,
        responseData: response
      });

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
      await transaction.save();
      return res.status(400).json({
        success: false,
        message: response.message || 'Failed to initiate payment.',
        data: response.data || null
      });
    }

  } catch (error) {
    console.error('❌ Flutterwave payment error:', error);
    if (req?.body?.caseId) {
      await PaymentLog.create({
        transactionId: req.body.caseId,
        action: 'FLUTTERWAVE_ERROR',
        status: 'FAILED',
        requestData: req.body,
        responseData: null,
        errorMessage: error.message
      });
    }
    return res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};
