// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\routes\payment-history.js

const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

/**
 * Route to display the employer's payment history.
 * This route is protected, ensuring only authenticated employers can access it.
 */
router.get('/employer/payment-history', requireAuth, requireRole(['employer']), async (req, res) => {
    // Defensive check to ensure req.user exists
    if (!req.user) {
        return res.status(401).send('Unauthorized. User not found.');
    }

    try {
        console.log('Fetching payment history for user with ID:', req.user._id);

        const transactions = await Transaction.find({ userId: req.user._id })
            .populate({
                path: 'jobId',
                populate: {
                    path: 'craftsmanId',
                    model: 'User'
                }
            })
            .sort({ createdAt: -1 });

        console.log(`Successfully fetched ${transactions.length} transactions.`);

        try {
            res.render('employer/payment-history', {
                payments: transactions || [] // Always pass an array to avoid template errors
            });
        } catch (renderError) {
            console.error('Error rendering payment-history.pug:', renderError);
            res.status(500).send('An error occurred while rendering the page.');
        }

    } catch (dbError) {
        console.error('Error fetching payment history:', dbError);
        res.status(500).send('An error occurred while fetching payment history.');
    }
});

// Export the router so it can be used in your main app.js file
module.exports = router;
