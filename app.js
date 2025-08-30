const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios'); // Ensure axios is imported

// --- Middleware and Configuration Imports ---
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const morgan = require('morgan');
require('dotenv').config();
console.log('Redirect URL:', process.env.FLUTTERWAVE_REDIRECT_URL ? '✅ Loaded' : '❌ Missing');
console.log('Initiating payment with redirect URL:', process.env.FLUTTERWAVE_REDIRECT_URL);
console.log("🔑 FLW_PUBLIC_KEY from .env:", process.env.FLW_PUBLIC_KEY ? "✅ Loaded" : "❌ MISSING");
console.log("🔑 FLW_SECRET_KEY from .env:", process.env.FLW_SECRET_KEY ? "✅ Loaded" : "❌ MISSING");

// This now imports your single MongoDB connection function.
const connectDB = require('./db');
// The models are your database interface for MongoDB.
const User = require('./models/user');
const Job = require('./models/job');
const Review = require('./models/review');
const Transaction = require('./models/Transaction');
const PaymentLog = require('./models/PaymentLog');
const Blacklist = require('./models/blacklist');
const Message = require('./models/message');
const Application = require('./models/application');

// --- Route and Middleware Imports ---
const paymentRoutes = require('./routes/flutterwave-payment');
const employerRoutes = require('./routes/employer');
const employerController = require('./controllers/employerController');
const paymentHistoryRouter = require('./routes/payment-history'); // ADDED

// 💡 NEW: Import the application API routes
const applicationApiRoutes = require('./routes/api/application');

// --- Main App Setup ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Security and Payment Middleware (Integrated) ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws://localhost:3002'],
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://your-frontend-domain.com']
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

// --- Configure Multer for File Uploads (Existing) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, 'public/uploads');
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

// --- Existing Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: 'craftsmart-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Set Pug as template engine
app.set('view engine', 'pug');
app.set('views', './views');

// Authentication and Role-based middleware
const requireAuth = async (req, res, next) => {
  if (req.session.userId) {
    req.user = await User.findById(req.session.userId);
    if (req.user) {
      next();
    } else {
      req.session.destroy();
      res.redirect('/login');
    }
  } else {
    res.redirect('/login');
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).send('Access denied');
    }
  };
};

// New middleware for admin only routes
const requireAdmin = requireRole(['admin']);

// --- Socket.IO Logic (Existing) ---
io.on('connection', (socket) => {
  console.log('A user connected with socket ID:', socket.id);
  socket.on('join', (userId) => {
    if (userId) {
      socket.join(userId);
      console.log(`User ${userId} joined their private room.`);
    }
  });
  socket.on('sendMessage', async (message) => {
    const { senderId, receiverId, content } = message;
    if (!senderId || !receiverId || !content) {
      return;
    }
    try {
      const newMessage = new Message({ senderId, receiverId, content });
      const savedMessage = await newMessage.save();
      io.to(receiverId).emit('newMessage', {
        senderId: savedMessage.senderId,
        content: savedMessage.content,
        timestamp: savedMessage.timestamp
      });
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

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

// --- Combined App Routes ---
app.get('/', async (req, res) => {
  if (req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user) {
      res.redirect(`/${user.role}/dashboard`);
    } else {
      req.session.destroy();
      res.redirect('/login');
    }
  } else {
    res.render('index', { path: req.path });
  }
});

// Use payment routes
app.use('/api/payment', paymentRoutes);
// 💡 NEW: Use the application API routes
app.use('/api/applications', applicationApiRoutes);

// Main login/register routes
app.get('/login', (req, res) => { res.render('login', { path: req.path }); });
app.post('/login', async (req, res) => {
  const { mobile, password } = req.body;
  const user = await User.findOne({ mobile });
  if (user && await bcrypt.compare(password, user.password)) {
    req.session.userId = user._id;
    res.redirect(`/${user.role}/dashboard`);
  } else {
    res.render('login', { error: 'Invalid credentials', path: req.path });
  }
});

app.get('/register', (req, res) => {
  const formData = req.session.formData || {};
  delete req.session.formData;
  res.render('register', { path: req.path, formData });
});

app.post('/register', async (req, res) => {
  const { name, email, mobile, password, role, region, district, city, company, position, industry, skills, bio } = req.body;

  const existingUser = await User.findOne({ mobile });
  if (existingUser) {
    req.session.formData = req.body;
    return res.render('register', {
      error: 'Mobile number already registered',
      path: req.path,
      formData: req.body
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({
    name, email, mobile, password: hashedPassword, role, location: { region, district, city },
  });

  if (role === 'employer') {
    newUser.company = company; newUser.position = position; newUser.industry = industry;
  } else if (role === 'craftsman') {
    newUser.skills = skills ? skills.split(',').map(s => s.trim()) : [];
    newUser.bio = bio; newUser.approved = false;
  } else if (role === 'admin') {
    return res.status(403).send('Cannot register as admin.');
  }

  try {
    const savedUser = await newUser.save();
    req.session.userId = savedUser._id;
    if (req.session.formData) {
      delete req.session.formData;
    }
    res.redirect(`/${role}/dashboard`);
  } catch (err) {
    console.error('Error saving user:', err);
    res.render('register', {
      error: 'An error occurred during registration.',
      path: req.path,
      formData: req.body
    });
  }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// NEW: Route for the payment history page
app.use('/', paymentHistoryRouter);
// -------------------------------------------------------------

// Use other app routes
app.use('/', employerRoutes);

// ----------------------------------------------------
// Employer Routes
// ----------------------------------------------------
app.get('/employer/dashboard', requireAuth, requireRole(['employer']), async (req, res) => {
  const userJobs = await Job.find({ employerId: req.user._id });
  const craftsmen = await User.find({ role: 'craftsman', approved: true });
  res.render('employer/dashboard', { user: req.user, jobs: userJobs, craftsmen, path: req.path });
});
app.get('/employer/post-job', requireAuth, requireRole(['employer']), (req, res) => { res.render('employer/post-job', { user: req.user, path: req.path }); });
app.post('/employer/post-job', requireAuth, requireRole(['employer']), upload.array('images', 5), async (req, res) => {
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
app.get('/employer/browse-craftsmen', requireAuth, requireRole(['employer']), async (req, res) => {
  const craftsmen = await User.find({ role: 'craftsman', approved: true });
  res.render('employer/browse-craftsmen', { user: req.user, craftsmen, path: req.path });
});

app.get('/employer/payment-records', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const transferInRecords = await Transaction.find({
      userId: req.user._id,
      status: { $in: ['COMPLETED', 'PENDING', 'FAILED'] }
    }).sort({ createdAt: -1 });

    const transferOutRecords = await Transaction.find({
      userId: req.user._id,
      status: { $in: ['DISBURSEMENT_COMPLETED', 'DISBURSEMENT_INITIATED'] }
    }).sort({ createdAt: -1 });

    // Pass helpers to Pug
    res.render('employer/payment-records', {
      user: req.user,
      path: req.path,
      transferInRecords,
      transferOutRecords,
      formatCurrency: (amount) => {
        if (typeof amount !== 'number') return amount;
        return new Intl.NumberFormat('en-UG', {
          style: 'currency',
          currency: 'UGX',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }).format(amount);
      },
      formatDate: (dateString) => {
        return new Date(dateString).toLocaleString('en-UG', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    });
  } catch (error) {
    console.error('Error rendering payments page:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/employer/applications/:jobId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId).lean();
    if (!job) {
      return res.status(404).send('Job not found.');
    }
    // Find all applications for this job and populate the craftsman data
    const applications = await Application.find({ jobId }).populate('craftsmanId').lean();

    res.render('employer/applications', {
      user: req.user,
      job, // <--- Pass the full job object here
      applications,
      path: req.path
    });
  } catch (err) {
    console.error('Error fetching applications:', err);
    res.status(500).send('Internal Server Error');
  }
});

// --- UPDATED ROUTE ---
app.post('/api/applications/accept/:applicationId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { applicationId } = req.params;

    const acceptedApplication = await Application.findByIdAndUpdate(
      applicationId,
      { status: 'accepted' },
      { new: true }
    ).populate('jobId');

    if (!acceptedApplication) {
      return res.status(404).send('Application not found.');
    }
    // --- IMPORTANT: Update the job's status and craftsmanId here ---
    const job = await Job.findByIdAndUpdate(acceptedApplication.jobId._id, {
      status: 'in-progress',
      craftsmanId: acceptedApplication.craftsmanId
    }, { new: true });

    res.redirect(`/employer/applications/${job._id}`);
  } catch (error) {
    console.error('Error accepting application:', error);
    res.status(500).send('Server error');
  }
});
// --- Route for the payment form page ---
app.get('/payment/form', requireAuth, requireRole(['employer']), async (req, res) => {
    const { jobId, craftsmanId } = req.query; // Get both jobId and craftsmanId from the URL
    console.log('Received jobId:', jobId);
    console.log('Received craftsmanId:', craftsmanId);
    try {
      const job = await Job.findById(jobId).lean();
      const craftsman = await User.findById(craftsmanId).lean(); // Fetch the craftsman from the database
      
      // Check if both job and craftsman were found
      if (!job || !craftsman) {
        return res.status(404).send('Job or craftsman not found.');
      }
      
      // Pass both job and craftsman to the Pug template
      res.render('employer/deposit-form', { 
        user: req.user, 
        job, 
        craftsman, // Now passing the craftsman variable
        path: req.path, 
        formatCurrency 
      });
    } catch (error) {
      console.error('Error rendering payment form:', error);
      res.status(500).send('Internal Server Error');
    }
});

// --- Route to view the employer's payment history ---
app.get('/employer/payments', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
      // Fetch all transactions for this employer
      const payments = await Transaction.find({ employerId: req.user._id })
        .populate({
          path: 'jobId',
          select: 'title',
        })
        .populate({
          path: 'craftsmanId',
          select: 'name mobileNumber',
        })
        .sort({ createdAt: -1 })
        .lean(); // convert Mongoose documents to plain objects

      // Ensure the template always receives an array
      res.render('employer/payment-history', {
        user: req.user,
        payments: payments || [], 
        path: req.path,
        formatCurrency
      });
    } catch (error) {
      console.error('Error fetching payment history:', error);
      res.status(500).send('Internal Server Error');
    }
});
// This route simulates releasing funds from escrow.
app.post('/api/payment/release/:jobId', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await Job.findById(jobId);

      if (!job) {
        return res.status(404).send('Job not found.');
      }
      if (job.status !== 'paid-in-escrow') {
        return res.status(400).send('Payment is not in escrow for this job.');
      }

      // Update the job status to 'disbursed'
      job.status = 'disbursed';
      await job.save();

      res.redirect(`/employer/applications/${jobId}`);
    } catch (error) {
      console.error('Error releasing payment:', error);
      res.status(500).send('Server error');
    }
});

// --- Route to reject an application ---
app.post('/api/applications/reject/:applicationId', requireAuth, requireRole(['employer']), async (req, res) => {
    try {
      const { applicationId } = req.params;
      const rejectedApplication = await Application.findByIdAndUpdate(
        applicationId,
        { status: 'rejected' },
        { new: true }
      );
      if (!rejectedApplication) {
        return res.status(404).send('Application not found.');
      }
      res.redirect('back');
    } catch (error) {
      console.error('Error rejecting application:', error);
      res.status(500).send('Server error');
    }
});
// --- Route to initiate a payment via Flutterwave API ---
// app.post('/api/payment/initiate', requireAuth, requireRole(['employer']), async (req, res) => {
//   try {
//     const { jobId, amount, mobile_number, network } = req.body;

//     // Log the received data for debugging
//     console.log('Incoming payment data:', { jobId, amount, mobile_number, network });

//     const job = await Job.findById(jobId).populate('craftsmanId');
//     if (!job || job.status !== 'in-progress' || job.employerId.toString() !== req.user._id.toString()) {
//       console.error('Payment initiation failed: Invalid job or unauthorized.');
//       return res.render('employer/payment-failed', { message: 'Invalid job or unauthorized.' });
//     }

//     const txRef = `CS_${Date.now()}_${req.user._id}`;

//     const response = await axios.post(
//       'https://api.flutterwave.com/v3/payments',
//       {
//         tx_ref: txRef,
//         amount,
//         currency: 'UGX',
//         redirect_url: process.env.FLUTTERWAVE_REDIRECT_URL,
//         customer: {
//           email: req.user.email || 'no-reply@craftsmart.com',
//           phonenumber: mobile_number,
//           name: req.user.name || 'Craftsmart User'
//         },
//         meta: { job_id: jobId, craftsman_id: job.craftsmanId, network },
//         customizations: { title: job.title, description: `Payment for job: ${job.title}` }
//       },
//       { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`, "Content-Type": "application/json" } }
//     );

//     const fwData = response.data;
//     // Log the full Flutterwave response for inspection
//     console.log('Full Flutterwave response data:', JSON.stringify(fwData, null, 2));

//     if (fwData.status === 'success' && fwData.data?.link) {
//       // Save PENDING transaction locally
//       await Transaction.create({
//         userId: req.user._id,
//         jobId: job._id,
//         flwRef: txRef,
//         status: 'PENDING',
//         total_amount: amount,
//       });
//       console.log('Successfully received hosted link. Redirecting user...');
//       //  Direct redirect to Flutterwave
//       return res.redirect(fwData.data.link);
//     }

//     // fallback
//     console.error('Unexpected Flutterwave response:', fwData);
//     return res.render('employer/payment-failed', { message: 'Failed to initiate payment. Hosted link missing.' });

//   } catch (error) {
//     console.error('Payment initiation error:', error.response?.data || error.message);
//     return res.render('employer/payment-failed', { message: 'Failed to initiate payment. Please try again.' });
//   }
// });
// --- Socket.IO Logic (Updated with Flutterwave payment) ---
io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // Join private room for each user (optional)
  socket.on("join", (userId) => {
    if (userId) {
      socket.join(userId);
      console.log(`User ${userId} joined their private room.`);
    }
  });

  // Message handling
  socket.on("sendMessage", async (message) => {
    const { senderId, receiverId, content } = message;
    if (!senderId || !receiverId || !content) return;

    try {
      const newMessage = new Message({ senderId, receiverId, content });
      const savedMessage = await newMessage.save();
      io.to(receiverId).emit("newMessage", {
        senderId: savedMessage.senderId,
        content: savedMessage.content,
        timestamp: savedMessage.timestamp
      });
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  // Payment initiation
  socket.on("initiatePayment", async (data) => {
    try {
      const { jobId, amount, mobile_number, userId } = data;

      // Fetch job and users
      const job = await Job.findById(jobId);
      if (!job) throw new Error("Job not found");

      const employer = await User.findById(userId);
      const craftsman = await User.findById(job.craftsmanId);
      if (!employer || !craftsman) throw new Error("User not found");

      // Create tx reference
      const txRef = `CS_${Date.now()}_${userId}`;

      // Flutterwave payment payload
      const payload = {
        tx_ref: txRef,
        amount,
        currency: "UGX",
        redirect_url: process.env.FLUTTERWAVE_REDIRECT_URL,
        customer: { email: employer.email, phonenumber: mobile_number, name: employer.name },
        meta: { job_id: jobId, craftsman_id: job.craftsmanId },
        customizations: { title: job.title, description: `Payment for job: ${job.title}` }
      };

      const response = await axios.post(
        "https://api.flutterwave.com/v3/payments",
        payload,
        { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json" } }
      );

      const fwData = response.data;

      if (fwData.status === "success" && fwData.data.link) {
        // Save transaction in DB with all required fields
        const newTransaction = new Transaction({
          userId,                        // employer
          jobId,
          craftsmanId: job.craftsmanId,
          craftsman_phone: craftsman.mobile,
          employer_phone: employer.mobile,
          disbursement_amount: amount,
          commission_amount: 0,
          flwRef: txRef,
          status: "PENDING",
          total_amount: amount
        });
        await newTransaction.save();

        // Update job status to reflect payment started only if it's still open
        if (job.status === "open") {
          job.status = "in-progress"; // valid enum
          await job.save();
        }

        // Emit hosted payment link back to client
        socket.emit("paymentLink", { success: true, link: fwData.data.link });
      } else {
        socket.emit("paymentLink", { success: false, message: "Failed to initiate payment" });
      }

    } catch (err) {
      console.error("❌ Payment initiation error:", err.message);
      socket.emit("paymentLink", { success: false, message: "Server error" });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});


// --- Route to handle Flutterwave payment verification ---

app.get('/payment/verify', async (req, res) => {
  try {
    const { tx_ref } = req.query;
    if (!tx_ref) return res.status(400).send('Transaction reference missing.');

    // Find the transaction by local reference
    const transaction = await Transaction.findOne({ flwRef: tx_ref });
    if (!transaction) return res.status(404).send('Transaction not found.');

    // Verify payment with Flutterwave using the correct secret key
    const verifyResponse = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      {
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } // use the correct env variable
      }
    );

    const fwData = verifyResponse.data;

    if (fwData.status === 'success' && fwData.data.status === 'successful') {
      // Mark transaction as completed
      transaction.status = 'COMPLETED';
      transaction.transactionId = fwData.data.id; // Flutterwave transaction ID
      await transaction.save();

      // Update job status to 'paid-in-escrow' if needed
      const job = await Job.findById(transaction.jobId);
      if (job) {
        // Only set 'paid-in-escrow' if job is still in-progress
        if (['open', 'in-progress'].includes(job.status)) {
          job.status = 'paid-in-escrow';
          await job.save();
        }
      }

      return res.render('employer/payment-success', { message: 'Payment successful!' });

    } else if (fwData.data && fwData.data.status === 'pending') {
      transaction.status = 'PENDING';
      await transaction.save();
      return res.render('employer/payment-otp', { tx_ref });

    } else {
      transaction.status = 'FAILED';
      await transaction.save();
      return res.render('employer/payment-failed', { message: 'Payment failed. Please try again.' });
    }

  } catch (error) {
    console.error('Error verifying payment:', error.response?.data || error.message);
    return res.status(500).send('Server error during payment verification.');
  }
});



// 💡 NEW ROUTE: To view a craftsman's profile
app.get('/craftsman/dashboard', requireAuth, requireRole(['craftsman']), async (req, res) => {
  // Fix: This query now correctly fetches all jobs with a status of 'open'
  const availableJobs = await Job.find({ status: 'open' }).lean();
  const myJobs = await Job.find({ craftsmanId: req.user._id }).lean();
  res.render('craftsman/dashboard', { user: req.user, availableJobs, myJobs, path: req.path });
});

app.get('/craftsman/:craftsmanId', requireAuth, async (req, res) => {
  try {
    const { craftsmanId } = req.params;
    const craftsman = await User.findById(craftsmanId).lean();

    if (!craftsman || craftsman.role !== 'craftsman') {
      return res.status(404).render('error', { message: 'Craftsman not found.' });
    }

    // Render the craftsman profile page. Make sure you have this PUG file.
    res.render('craftsman/profile', { user: req.user, craftsman, path: req.path });
  } catch (error) {
    console.error('Error fetching craftsman profile:', error);
    res.status(500).send('Internal Server Error');
  }
});

// CORRECTED: Corrected route for payment form with live data
app.get('/employer/deposit-funds/:jobId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Fetch the job by its ID
    const job = await Job.findById(jobId);

    if (!job) {
      return res.status(404).send('Job not found.');
    }
    
    // 💡 NEW: Fetch the craftsman associated with this job
    // This assumes the 'job' document has a 'craftsmanId' field
    const craftsman = await User.findById(job.craftsmanId);

    // If the craftsman is not found, handle the error
    if (!craftsman) {
      return res.status(404).send('Assigned craftsman not found.');
    }

    const adminCommissionRate = 0.10; // 10%
    const craftsmanPaymentRate = 0.90; // 90%
    const commissionAmount = job.budget * adminCommissionRate;
    const craftsmanAmount = job.budget * craftsmanPaymentRate;

    // Render the deposit-form.pug template, passing both job and craftsman data
    res.render('employer/deposit-form', {
      title: 'Deposit Funds',
      job,
      craftsman, // 💡 NEW: Pass the craftsman object to the template
      commissionAmount,
      craftsmanAmount,
      formatCurrency,
      formatDate,
      path: req.path,
      user: req.user // Assuming you have user data in the request object
    });
  } catch (error) {
    console.error('Error rendering deposit form:', error);
    res.status(500).send('An unexpected error occurred. Please try again later.');
  }
});

// NEW ROUTE: Payment Status Page
app.get('/payment/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await Transaction.findByTransactionId(transactionId);

    if (!transaction) {
      return res.redirect('/employer/dashboard'); // Or a more suitable error page
    }

    const logs = await PaymentLog.getLogsByTransaction(transactionId);

    res.render('payment-status', {
      title: 'Payment Status',
      pageTitle: 'Payment Status',
      transaction,
      logs,
      formatCurrency,
      formatDate,
      user: req.user,
      path: req.path
    });

  } catch (error) {
    console.error('❌ Error fetching payment status:', error);
    res.redirect('/employer/dashboard');
  }
});
// ----------------------------------------------------
// Craftsman Routes
// ----------------------------------------------------
app.get('/craftsman/dashboard', requireAuth, requireRole(['craftsman']), async (req, res) => {
  // Fix: This query now correctly fetches all jobs with a status of 'open'
  const availableJobs = await Job.find({ status: 'open' }).lean();
  const myJobs = await Job.find({ craftsmanId: req.user._id }).lean();
  res.render('craftsman/dashboard', { user: req.user, availableJobs, myJobs, path: req.path });
});
app.get('/craftsman/profile', requireAuth, requireRole(['craftsman']), (req, res) => {
  const platformAverage = { communication: 75, technicalSkill: 70, punctuality: 80, quality: 75, safety: 85 };
  const userProfile = req.user.profile || { communication: 0, technicalSkill: 0, punctuality: 0, quality: 0, safety: 0 };
  const isPending = !req.user.approved;
  res.render('craftsman/profile', { user: { ...req.user.toObject(), profile: userProfile }, platformAverage, path: req.path, isPending: isPending });
});
// 💡 NEW ROUTE: POST route for a craftsman to apply for a job.
app.post('/craftsman/apply-for-job/:jobId', requireAuth, requireRole(['craftsman']), async (req, res) => {
  try {
    const { jobId } = req.params;
    const craftsmanId = req.user._id;

    // Check if the craftsman has already applied for this job
    const existingApplication = await Application.findOne({ jobId, craftsmanId });
    if (existingApplication) {
      return res.status(400).send('You have already applied for this job.');
    }

    // Create a new application
    const newApplication = new Application({
      jobId,
      craftsmanId,
      status: 'pending' // Initial status is pending
    });

    await newApplication.save();
    res.redirect('/craftsman/dashboard');
  } catch (err) {
    console.error('Error applying for job:', err);
    res.status(500).send('Internal Server Error');
  }
});

// 💡 NEW ROUTE: GET route for a craftsman to view a job's details
app.get('/craftsman/jobs/:jobId', requireAuth, requireRole(['craftsman']), async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId).lean();

    if (!job) {
      return res.status(404).send('Job not found.');
    }

    // Render the job details page, passing the job object
    res.render('craftsman/job-details', {
      user: req.user,
      job,
      path: req.path
    });
  } catch (err) {
    console.error('Error fetching job details:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.post('/craftsman/profile', requireAuth, requireRole(['craftsman']), upload.fields([{ name: 'profilePicture', maxCount: 1 }, { name: 'cv', maxCount: 1 }, { name: 'coverLetter', maxCount: 1 }]), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) { return res.status(404).send('User not found.'); }
    if (!user.approved) { return res.status(403).send('Your profile is pending admin approval and cannot be updated at this time.'); }
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.experience = parseInt(req.body.experience) || user.experience;
    if (req.body.skills) { user.skills = req.body.skills.split(',').map(s => s.trim()); }
    if (req.body.location) {
      user.location = {
        city: req.body.location.city || user.location.city,
        region: req.body.location.region || user.location.region,
        district: req.body.location.district || user.location.district
      };
    }
    if (req.body.profile) {
      user.profile = {
        communication: parseInt(req.body.profile.communication) || user.profile.communication,
        technicalSkill: parseInt(req.body.profile.technicalskill) || user.profile.technicalSkill,
        punctuality: parseInt(req.body.profile.punctuality) || user.profile.punctuality,
        quality: parseInt(req.body.profile.quality) || user.profile.quality,
        safety: parseInt(req.body.profile.safety) || user.profile.safety,
      };
    }
    if (req.files && req.files.profilePicture && req.files.profilePicture.length > 0) { user.profilePicture = `/uploads/${req.files.profilePicture[0].filename}`; }
    if (req.files && req.files.cv && req.files.cv.length > 0) { user.cvPath = `/uploads/${req.files.cv[0].filename}`; }
    if (req.files && req.files.coverLetter && req.files.coverLetter.length > 0) { user.coverLetterPath = `/uploads/${req.files.coverLetter[0].filename}`; }
    user.approved = false;
    await user.save();
    res.redirect('/craftsman/profile?updated=true');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).send('An error occurred while updating the profile.');
  }
});
// ----------------------------------------------------
// --- COMBINED Admin Dashboard Route ---
// This route is correct. It uses Mongoose queries to fetch data for the dashboard.
app.get('/admin/dashboard', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const pendingCraftsmen = await User.find({ role: 'craftsman', approved: false });
    const totalUsers = await User.countDocuments();
    const totalJobs = await Job.countDocuments();
    const totalReviews = await Review.countDocuments();

    const transactions = await Transaction.find().limit(100).skip(0);
    const stats = transactions.reduce((acc, tx) => {
      acc.totalTransactions += 1;
      acc.totalRevenue += tx.total_amount || 0;
      acc.totalCommission += tx.commission_amount || 0;
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
      user: req.user,
      pendingCraftsmen,
      totalUsers,
      totalJobs,
      totalReviews,
      transactions,
      stats,
      formatCurrency,
      formatDate,
      path: req.path
    });
  } catch (err) {
    console.error('Error fetching admin dashboard data:', err);
    res.status(500).send('Internal Server Error');
  }
});


// NEW ROUTE: Admin transaction details page
app.get('/admin/dashboard-payment', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const transactions = await Transaction.find().limit(100).skip(0);
    const logs = await PaymentLog.find().limit(100).skip(0);
    const stats = transactions.reduce((acc, tx) => {
      acc.totalTransactions += 1;
      acc.totalRevenue += tx.total_amount || 0;
      acc.totalCommission += tx.commission_amount || 0;
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

    res.render('admin/dashboard-payment', {
      user: req.user,
      title: 'Payment Management',
      pageTitle: 'Payment Management',
      transactions,
      logs,
      stats,
      formatCurrency,
      formatDate,
      path: req.path
    });
  } catch (err) {
    console.error('Error fetching payment management data:', err);
    res.status(500).send('Internal Server Error');
  }
});

// NEW ROUTE: Admin view for a single transaction
app.get('/admin/payments/:transaction_id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const transactionId = req.params.transaction_id;
    const transaction = await Transaction.findByTransactionId(transactionId);

    if (!transaction) {
      return res.status(404).render('error-page', { message: 'Transaction not found.' });
    }

    const logs = await PaymentLog.getLogsByTransaction(transactionId);
    res.render('admin/transaction', {
      user: req.user,
      title: 'Transaction Details',
      pageTitle: 'Transaction Details',
      transaction,
      logs,
      formatCurrency,
      formatDate,
      path: req.path
    });

  } catch (err) {
    console.error('Error fetching transaction details:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.get('/admin/craftsman/:userId', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const userId = req.params.userId;
    const userProfile = await User.findById(userId);
    if (!userProfile || userProfile.role !== 'craftsman') { return res.status(404).send('Craftsman not found.'); }
    const platformAverage = { communication: 75, technicalSkill: 70, punctuality: 80, quality: 75, safety: 85 };
    res.render('admin/craftsman-profile', { user: userProfile, platformAverage, path: req.path });
  } catch (error) {
    console.error('Error fetching craftsman profile:', error);
    res.status(500).send('Server Error');
  }
});
app.get('/admin/craftsmen', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const craftsmen = await User.find({ role: 'craftsman' });
    res.render('admin/users', { pageTitle: 'All Craftsmen', users: craftsmen, userType: 'craftsman', path: req.path });
  } catch (error) {
    console.error('Error fetching craftsmen:', error);
    res.status(500).send('Server Error');
  }
});
app.get('/admin/employers', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const employers = await User.find({ role: 'employer' });
    res.render('admin/users', { pageTitle: 'All Employers', users: employers, userType: 'employer', path: req.path });
  } catch (error) {
    console.error('Error fetching employers:', error);
    res.status(500).send('Server Error');
  }
});
app.get('/admin/employer/:userId', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const userId = req.params.userId;
    const userProfile = await User.findById(userId);
    if (!userProfile || userProfile.role !== 'employer') { return res.status(404).send('Employer not found.'); }
    res.render('admin/profile-details', { user: userProfile, pageTitle: `${userProfile.name}'s Profile`, path: req.path });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).send('Server Error');
  }
});
app.post('/admin/approve-craftsman/:userId', requireAuth, requireRole(['admin']), async (req, res) => {
  const userId = req.params.userId;
  try {
    await User.findByIdAndUpdate(userId, { approved: true });
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error approving craftsman:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.post('/admin/reject-craftsman/:userId', requireAuth, requireRole(['admin']), async (req, res) => {
  const userId = req.params.userId;
  try {
    await User.findByIdAndDelete(userId);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error rejecting craftsman:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/admin/blacklist', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const blacklistEntries = await Blacklist.find();
    res.render('admin/blacklist', {
      user: req.user,
      blacklist: blacklistEntries,
      path: req.path,
      formatDate: formatDate
    });
  } catch (err) {
    console.error('Error fetching admin blacklist:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/admin/blacklist', requireAuth, requireRole(['admin']), async (req, res) => {
  const { name, mobile, reason } = req.body;
  const newBlacklistEntry = new Blacklist({ name, mobile, reason, addedBy: req.user._id });
  try {
    await newBlacklistEntry.save();
    res.redirect('/admin/blacklist');
  } catch (err) {
    console.error('Error adding to blacklist:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.delete('/admin/blacklist/:id', requireAuth, requireRole(['admin']), async (req, res) => {
  const id = req.params.id;

  const { password } = req.body;
  const adminPassword = "12345678";

  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Incorrect password' });
  }

  try {
    await Blacklist.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting from blacklist:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/public-blacklist', async (req, res) => {
  try {
    const blacklistEntries = await Blacklist.find();
    res.render('public-blacklist', {
      blacklist: blacklistEntries,
      path: req.path,
      formatDate: formatDate
    });
  } catch (err) {
    console.error('Error fetching public blacklist:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/admin/reports', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const employerCount = await User.countDocuments({ role: 'employer' });
    const craftsmanCount = await User.countDocuments({ role: 'craftsman' });
    const jobsByStatus = await Job.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    res.render('admin/reports', { user: req.user, employerCount, craftsmanCount, jobsByStatus, path: req.path });
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.get('/admin/export-data', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const allUsers = await User.find().lean();
    res.setHeader('Content-disposition', 'attachment; filename=users_export.json');
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(allUsers, null, 2));
  } catch (err) {
    console.error('Error exporting data:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.get('/messages', requireAuth, async (req, res) => {
  try {
    const allUsers = await User.find({ _id: { $ne: req.user._id } }).select('_id name');
    const unreadCounts = await Message.aggregate([{ $match: { receiverId: req.user._id, isRead: false } }, { $group: { _id: '$senderId', count: { $sum: 1 } } }]);
    const usersWithCounts = allUsers.map(user => {
      const unread = unreadCounts.find(uc => uc._id.equals(user._id));
      return { ...user.toObject(), unreadCount: unread ? unread.count : 0 };
    });
    const initialRecipientId = usersWithCounts.length > 0 ? usersWithCounts[0]._id : null;
    let initialMessages = [];
    if (initialRecipientId) {
      initialMessages = await Message.find({ $or: [{ senderId: req.user._id, receiverId: initialRecipientId }, { senderId: initialRecipientId, receiverId: req.user._id }] }).sort({ timestamp: 1 }).populate('senderId receiverId');
      await Message.updateMany({ senderId: initialRecipientId, receiverId: req.user._id, isRead: false }, { $set: { isRead: true } });
    }
    res.render('messages', { user: req.user, allUsers: usersWithCounts, messages: initialMessages, path: req.path, initialRecipientId });
  } catch (err) {
    console.error('Error fetching message data:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.get('/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({ receiverId: req.user._id, isRead: false });
    res.json({ count: unreadCount });
  } catch (error) {
    console.error('Error fetching unread message count:', error);
    res.status(500).json({ count: 0 });
  }
});
app.get('/messages/:receiverId', requireAuth, async (req, res) => {
  try {
    const { receiverId } = req.params;
    const messages = await Message.find({ $or: [{ senderId: req.user._id, receiverId: receiverId }, { senderId: receiverId, receiverId: req.user._id }] }).sort({ timestamp: 1 }).populate('senderId receiverId');
    await Message.updateMany({ senderId: receiverId, receiverId: req.user._id, isRead: false }, { $set: { isRead: true } });
    res.status(200).json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
app.post('/messages', requireAuth, async (req, res) => {
  const { receiverId, content } = req.body;
  const senderId = req.user._id;
  if (!receiverId || !content) { return res.status(400).json({ error: 'Receiver ID and content are required.' }); }
  try {
    const newMessage = new Message({ senderId, receiverId, content });
    const savedMessage = await newMessage.save();
    io.to(receiverId).emit('newMessage', { senderId, content: savedMessage.content });
    res.status(201).json({ success: true, message: 'Message sent successfully.' });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// A health check endpoint for the combined server
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('/*Splat', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Create uploads directory
const uploadsDir = './public/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- Start Server Function ---
const startServer = async () => {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB Atlas');

    const transactionCollection = mongoose.connection.db.collection('transactions');
    const changeStream = transactionCollection.watch();

    changeStream.on('change', (change) => {
      console.log('Change detected in transactions collection:', change);
      io.emit('paymentUpdate', change);
    });

    server.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
};

startServer();