import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import Flutterwave from 'flutterwave-node-v3';
import Transaction from '../models/Transaction.js';
import PaymentLog from '../models/PaymentLog.js';
import User from '../models/user.js';

dotenv.config();

// Initialize Flutterwave client
const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY,
);

// ----------------- Controller Functions -----------------

export const initiateMobileMoneyPayment = async (req, res) => {
  try {
    const { caseId, employerId, craftsmanId, totalAmount, craftsmanPhone, employerPhone, paymentMethod } = req.body;

    if (!totalAmount || !employerPhone || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Missing required payment details.' });
    }

    // --- Enforce Flutterwave maximum amount ---
    const MAX_AMOUNT = 50000;
    // Use a test amount less than 50k if the request exceeds it
    const safeAmount = Math.min(parseFloat(totalAmount), 40000); // 40k UGX for testing
    if (safeAmount > MAX_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Amount should be between 0 and ${MAX_AMOUNT} UGX`
      });
    }

    const tx_ref = uuidv4();
    const network = paymentMethod.toUpperCase();
    const employer = { name: "SmartCraft Employer", email: "employer@smartcraft.com" };

    let transaction = await Transaction.findByCaseId(caseId);
    if (!transaction) {
      transaction = await Transaction.create({
        case_id: caseId,
        employer_id: employerId,
        craftsman_id: craftsmanId,
        total_amount: safeAmount,
        commission_amount: safeAmount * 0.1,
        craftsman_amount: safeAmount * 0.9,
        tx_ref,
        flw_ref: '',
        status: 'PENDING',
        payment_method: paymentMethod,
        phone_number: employerPhone
      });
    } else {
      await Transaction.updateStatus(transaction.transaction_id, { status: 'PENDING', paymentReference: tx_ref });
    }

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

    console.log("Flutterwave response:", response);

    if (response.status === 'success') {
      const flwRef = response.data?.flw_ref 
                     || response.data?.id 
                     || response.data?.tx_ref 
                     || response.meta?.authorization?.redirect;

      await Transaction.updateStatus(transaction.transaction_id, {
        status: 'PROCESSING',
        paymentReference: flwRef
      });

      await PaymentLog.create({
        transactionId: transaction.transaction_id,
        action: 'FLUTTERWAVE_INITIATE',
        status: 'PROCESSING',
        requestData: req.body,
        responseData: response
      });

      return res.status(200).json({
        success: true,
        message: 'Payment initiated.',
        data: {
          tx_ref: flwRef || null,
          status: response.data?.status || 'PROCESSING',
          redirect_url: response.meta?.authorization?.redirect || null
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.message || 'Failed to initiate payment.',
        data: response.data || null
      });
    }

  } catch (error) {
    console.error('Flutterwave payment error:', error);

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

export const handleWebhook = async (req, res) => {
  res.status(200).send('Webhook received');
};

export const verifyTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
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
