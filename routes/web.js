const express = require('express');
const Transaction = require('../models/Transaction');
const PaymentLog = require('../models/PaymentLog');
const router = express.Router();

// Helper function to format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

// Helper function to format date
const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString('en-UG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Home page
router.get('/', (req, res) => {
  res.render('index', {
    title: 'SmartCraft Payment System',
    pageTitle: 'Welcome to SmartCraft Payment System'
  });
});

// Payment form for specific case
router.get('/payment/case/:caseId', (req, res) => {
  const { caseId } = req.params;
  
  // Demo data - in real app, fetch from database
  const caseData = {
    id: caseId,
    amount: 150000, // 150,000 UGX
    craftsmanPhone: '0700123456',
    description: 'Plumbing repair work'
  };

  const commissionAmount = caseData.amount * 0.10;
  const craftsmanAmount = caseData.amount * 0.90;

  res.render('payment-form', {
    title: `Payment for Case #${caseId}`,
    pageTitle: `Payment for Case #${caseId}`,
    caseData,
    commissionAmount,
    craftsmanAmount,
    formatCurrency
  });
});

// Payment status page
router.get('/payment/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      // req.flash('error_msg', 'Transaction not found');
      return res.redirect('/');
    }

    const logs = await PaymentLog.getLogsByTransaction(transactionId);

    res.render('payment-status', {
      title: 'Payment Status',
      pageTitle: 'Payment Status',
      transaction,
      logs,
      formatCurrency,
      formatDate
    });
  } catch (error) {
    console.error('❌ Error fetching payment status:', error);
    // req.flash('error_msg', 'Error fetching payment status');
    res.redirect('/');
  }
});

// Admin dashboard
router.get('/admin/dashboard', async (req, res) => {
  try {
    const transactions = await Transaction.getAllTransactions(100, 0);
    
    // Calculate statistics
    const stats = transactions.reduce((acc, tx) => {
      acc.totalTransactions += 1;
      acc.totalRevenue += parseFloat(tx.total_amount || 0);
      acc.totalCommission += parseFloat(tx.commission_amount || 0);
      
      if (tx.status === 'COMPLETED' || tx.status === 'DISBURSEMENT_INITIATED') {
        acc.completedTransactions += 1;
      }
      
      return acc;
    }, {
      totalTransactions: 0,
      totalRevenue: 0,
      totalCommission: 0,
      completedTransactions: 0
    });

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      pageTitle: 'Payment Dashboard',
      transactions,
      stats,
      formatCurrency,
      formatDate
    });
  } catch (error) {
    console.error('❌ Error fetching dashboard data:', error);
    // req.flash('error_msg', 'Error loading dashboard');
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      pageTitle: 'Payment Dashboard',
      transactions: [],
      stats: { totalTransactions: 0, totalRevenue: 0, totalCommission: 0, completedTransactions: 0 },
      formatCurrency,
      formatDate
    });
  }
});

// Transaction details page
router.get('/admin/transaction/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await Transaction.findByTransactionId(transactionId);
    if (!transaction) {
      // req.flash('error_msg', 'Transaction not found');
      return res.redirect('/admin/dashboard');
    }

    const logs = await PaymentLog.getLogsByTransaction(transactionId);

    res.render('admin/transaction-details', {
      title: 'Transaction Details',
      pageTitle: `Transaction ${transactionId.substring(0, 8)}...`,
      transaction,
      logs,
      formatCurrency,
      formatDate
    });
  } catch (error) {
    console.error('❌ Error fetching transaction details:', error);
    // req.flash('error_msg', 'Error fetching transaction details');
    res.redirect('/admin/dashboard');
  }
});

module.exports = router;
