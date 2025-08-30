// A new controller function for the admin dashboard
exports.getAdminDashboard = async (req, res) => {
  try {
    const transferInRecords = await Transaction.find({ status: 'COMPLETED' });
    const transferOutRecords = await Transaction.find({ status: 'DISBURSEMENT_COMPLETED' });
    const allLogs = await PaymentLog.find().sort({ createdAt: -1 }).limit(50);
    
    res.render('payment-views', {
      transferInRecords,
      transferOutRecords,
      allLogs
    });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    res.status(500).render('error-page', { message: 'Failed to load admin dashboard.' });
  }
};