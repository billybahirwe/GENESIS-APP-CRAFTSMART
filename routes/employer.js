const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Job = require('../models/job');
const User = require('../models/user');
const { requireAuth, requireRole } = require('../middleware/auth');

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
// This route now correctly renders your existing payment-form.pug file
router.get('/payment-form', requireAuth, requireRole(['employer']), (req, res) => {
  res.render('employer/payment-form', { user: req.user, path: req.path });
});

// This route handles the payment form submission
// The JavaScript in your payment-form.pug file sends a POST request here
router.post('/api/payment/initiate', requireAuth, requireRole(['employer']), async (req, res) => {
  // Extract data from the request body
  const { employerPhone, totalAmount, paymentMethod } = req.body;
  
  console.log('Received payment initiation request:', { employerPhone, totalAmount, paymentMethod });
  
  // NOTE: This is a placeholder for a real payment gateway integration
  // In a real application, you would connect to an API like Paystack, Flutterwave, or local mobile money APIs here.
  
  // For demonstration, we'll simulate a successful payment initiation
  if (employerPhone && totalAmount && paymentMethod) {
    // Return a success response to the client-side JavaScript
    // The client-side JS will then handle the modal and redirect to the success page.
    res.status(200).json({ success: true, message: 'Payment initiation successful. Please check your phone for a payment prompt.' });
  } else {
    // Return a failure response if required data is missing
    res.status(400).json({ success: false, message: 'Missing required payment details.' });
  }
});

// New route for payment success page
router.get('/payment-success', requireAuth, requireRole(['employer']), (req, res) => {
  res.render('employer/payment-success', { user: req.user, path: req.path });
});

module.exports = router;
