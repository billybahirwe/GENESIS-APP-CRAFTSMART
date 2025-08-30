// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\routes\flutterwave-payment.js

const express = require('express');
const router = express.Router();
const Job = require('../models/job');
const Transaction = require('../models/Transaction');
const User = require('../models/user');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// Defensive log to confirm keys are loaded
console.log("🔑 FLW_PUBLIC_KEY:", process.env.FLW_PUBLIC_KEY ? "✅ Loaded" : "❌ Missing");
console.log("🔑 FLW_SECRET_KEY:", process.env.FLW_SECRET_KEY ? "✅ Loaded" : "❌ Missing");
console.log("🔑 Redirect URL:", process.env.FLUTTERWAVE_REDIRECT_URL || "❌ Missing");

// @route   POST /flutterwave/initiate
// @desc    Initiate a payment with Flutterwave
// @access  Private (employer only)
router.post('/initiate', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
        const { jobId, amount, mobile_number } = req.body;

        // Find job and users
        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

        const craftsman = await User.findById(job.craftsmanId);
        const employer = await User.findById(req.user._id);
        if (!craftsman || !employer) return res.status(404).json({ success: false, message: 'User not found.' });

        // Calculate commission and disbursement
        const commissionRate = 0.05;
        const commission_amount = parseFloat(amount) * commissionRate;
        const disbursement_amount = parseFloat(amount) - commission_amount;

        // Build payment payload for Flutterwave
        const txRef = `CS_${Date.now()}_${req.user._id}`;
        const payload = {
            tx_ref: txRef,
            amount: parseFloat(amount),
            currency: 'UGX',
            redirect_url: process.env.FLUTTERWAVE_REDIRECT_URL,
            customer: {
                email: employer.email,
                phonenumber: mobile_number,
                name: employer.name,
            },
            meta: { job_id: jobId, craftsman_id: job.craftsmanId },
            customizations: { 
                title: job.title, 
                description: `Payment for job: ${job.title}` 
            }
        };

        console.log("📤 Sending payload to Flutterwave:", payload);

        // Send request to Flutterwave
        const response = await axios.post(
            'https://api.flutterwave.com/v3/payments',
            payload,
            { 
                headers: { 
                    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 
                    "Content-Type": "application/json" 
                } 
            }
        );

        const fwData = response.data;
        console.log('Full Flutterwave Response:', JSON.stringify(fwData, null, 2));

        // ✅ Check only for a hosted link (transaction id will come later)
        if (!fwData.data || !fwData.data.link) {
            console.error('❌ No payment link returned from Flutterwave', fwData);
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate payment. Flutterwave response is invalid.',
                data: fwData
            });
        }

        // Save transaction in PENDING state (without transactionId yet)
        const newTransaction = new Transaction({
            userId: employer._id,
            jobId: job._id,
            tx_ref: txRef, // store your own reference
            status: 'PENDING',
            total_amount: parseFloat(amount),
            commission_amount,
            disbursement_amount,
            employer_phone: employer.mobile || employer.mobileNumber,
            craftsman_phone: craftsman.mobile || craftsman.mobileNumber
        });

        await newTransaction.save();

        // Update job status
        job.status = 'awaiting-payment';
        await job.save();

        return res.status(200).json({
            success: true,
            message: 'Payment initiated successfully.',
            paymentLink: fwData.data.link,   // 👈 frontend should redirect here
            transactionId: newTransaction._id
        });

    } catch (error) {
        console.error('❌ Payment initiation error:', error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to initiate payment',
            error: error.response?.data || error.message
        });
    }
});

module.exports = router;
