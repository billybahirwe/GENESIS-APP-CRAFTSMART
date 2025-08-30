// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\routes\employer.js

// Load environment variables at the top of the file
require('dotenv').config();

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Job = require('../models/job');
const User = require('../models/user');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const axios = require('axios'); // Required for making API requests

// Get API keys from environment variables
const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLUTTERWAVE_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY;

// --- Flutterwave Integration Functions ---
async function initiatePayment(phoneNumber, amount, destinationAccount) {
    try {
        const response = await axios.post('https://api.flutterwave.com/v3/charges?type=mobile_money_uganda', {
            tx_ref: `txn_${Date.now()}`, // Unique transaction reference
            amount: amount,
            currency: 'UGX',
            network: 'MTN', // Or 'Airtel' depending on user choice
            // The `destinationAccount` here is your Flutterwave account identifier
            // For mobile money, the `account_bank` is the mobile network
            // The actual recipient account is handled by Flutterwave's dashboard
            phone_number: phoneNumber,
            client_id: destinationAccount, // This is your account identifier
            redirect_url: 'http://your-domain.com/employer/payment-success'
        }, {
            headers: {
                Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`
            }
        });
        return { success: response.data.status === 'success', transactionId: response.data.data.id };
    } catch (error) {
        console.error('Flutterwave payment initiation error:', error.response ? error.response.data : error.message);
        return { success: false, message: 'Payment initiation failed.' };
    }
}

async function disburseFunds(phoneNumber, amount) {
    try {
        const response = await axios.post('https://api.flutterwave.com/v3/transfers', {
            account_bank: 'UGX', // For Uganda
            account_number: phoneNumber,
            amount: amount,
            narration: 'Payment for services on CraftsMart',
            currency: 'UGX',
            reference: `disb_${Date.now()}`
        }, {
            headers: {
                Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`
            }
        });
        return { success: response.data.status === 'success', transactionId: response.data.data.id };
    } catch (error) {
        console.error('Flutterwave disbursement error:', error.response ? error.response.data : error.message);
        return { success: false, message: 'Disbursement failed.' };
    }
}
// --- End Flutterwave Integration Functions ---

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadsDir = path.join(__dirname, '../public/uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Define routes for employer dashboard
router.get('/dashboard', requireAuth, requireRole(['employer']), async (req, res) => {
    const userJobs = await Job.find({ employerId: req.user._id });
    const craftsmen = await User.find({ role: 'craftsman', approved: true });
    res.render('employer/dashboard', { user: req.user, jobs: userJobs, craftsmen, path: req.path });
});

// Route for posting a new job
router.get('/post-job', requireAuth, requireRole(['employer']), (req, res) => {
    res.render('employer/post-job', { user: req.user, path: req.path });
});

router.post('/post-job', requireAuth, requireRole(['employer']), upload.array('images', 5), async (req, res) => {
    const { title, description, location, budget, category } = req.body;
    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    const newJob = new Job({ title, description, location, budget: parseFloat(budget), employerId: req.user._id, category, images });
    try {
        await newJob.save();
        res.redirect('/employer/dashboard');
    } catch (err) {
        console.error('Error posting job:', err);
        res.status(500).send('An error occurred while posting the job.');
    }
});

// Route for browsing craftsmen
router.get('/browse-craftsmen', requireAuth, requireRole(['employer']), async (req, res) => {
    const craftsmen = await User.find({ role: 'craftsman', approved: true });
    res.render('employer/browse-craftsmen', { user: req.user, craftsmen, path: req.path });
});

// Route to display the payment form
router.get('/payment-form/:jobId', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
        const jobId = req.params.jobId;
        const job = await Job.findById(jobId);

        if (!job) {
            return res.status(404).render('404', { message: 'Job not found.' });
        }
        
        // Pass the fetched job object to the Pug template
        res.render('employer/payment-form', { job, user: req.user, path: req.path });
    } catch (err) {
        console.error('Error rendering payment form:', err);
        res.status(500).render('error', { message: 'Internal Server Error' });
    }
});

// Route for initial payment from employer to your system's escrow
router.post('/api/payment/initiate/:caseId', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
        const { caseId } = req.params;
        const { totalAmount, employerPhone, craftsmanPhone } = req.body;
        
        const job = await Job.findById(caseId);
        
        const YOUR_SYSTEM_PAYMENT_ACCOUNT = 'your_system_phone_number_or_account_id';
        const paymentResult = await initiatePayment(employerPhone, totalAmount, YOUR_SYSTEM_PAYMENT_ACCOUNT);

        if (paymentResult.success) {
            job.paymentStatus = 'paid-in-escrow';
            job.employerTransactionId = paymentResult.transactionId;
            await job.save();

            res.status(200).json({ success: true, message: 'Payment secured in escrow. Funds will be released upon your confirmation.' });
        } else {
            res.status(400).json({ success: false, message: 'Payment failed.' });
        }
    } catch (error) {
        console.error('Initial payment error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// New route for the employer to disburse funds to the craftsman
router.post('/api/payment/disburse/:caseId', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
        const { caseId } = req.params;
        const job = await Job.findById(caseId);

        if (!job || job.paymentStatus !== 'paid-in-escrow') {
            return res.status(400).json({ success: false, message: 'Payment is not ready for disbursement.' });
        }

        const craftsman = await User.findById(job.craftsmanId);
        if (!craftsman) {
            return res.status(404).json({ success: false, message: 'Craftsman not found.' });
        }

        // Calculate the craftsman's payout (90% of the total budget)
        const payoutAmount = job.budget * 0.90;

        const disbursementResult = await disburseFunds(craftsman.phoneNumber, payoutAmount);

        if (disbursementResult.success) {
            job.paymentStatus = 'disbursed';
            job.craftsmanTransactionId = disbursementResult.transactionId;
            await job.save();

            res.status(200).json({ success: true, message: 'Funds successfully released to the craftsman.' });
        } else {
            res.status(400).json({ success: false, message: 'Disbursement failed. Please contact support.' });
        }
    } catch (error) {
        console.error('Disbursement error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// New route for payment success page
router.get('/payment-success', requireAuth, requireRole(['employer']), (req, res) => {
    res.render('employer/payment-success', { user: req.user, path: req.path });
});

module.exports = router;
