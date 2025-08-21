const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');

// --- New: Payment System Imports (PostgreSQL & Middleware) ---
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const morgan = require('morgan');
require('dotenv').config();
const { initDatabase } = require('./config/database');
const paymentRoutes = require('./routes/flutterwave-payment'); // Make sure this path is correct

// ADDED: Import the employer routes
const employerRoutes = require('./routes/employer');

// Payment System Models
const Transaction = require('./models/Transaction');
const PaymentLog = require('./models/PaymentLog');

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

// --- Import Mongoose Models ---
const User = require('./models/user');
const Job = require('./models/job');
const Review = require('./models/review');
const Blacklist = require('./models/blacklist');
const Message = require('./models/message');

// --- Connect to MongoDB ---
mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('✅ MongoDB connected successfully');
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// --- Security and Payment Middleware (Integrated) ---
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://your-frontend-domain.com']
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

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

// ADDED: Use the employer routes to handle all requests starting with /employer
app.use('/employer', employerRoutes);

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
app.get('/register', (req, res) => { res.render('register', { path: req.path }); });
app.post('/register', async (req, res) => {
  const { name, email, mobile, password, role, region, district, city, company, position, industry, skills, bio } = req.body;
  const existingUser = await User.findOne({ mobile });
  if (existingUser) { return res.render('register', { error: 'Mobile number already registered', path: req.path }); }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({
    name, email, mobile, password: hashedPassword, role, location: { region, district, city },
  });
  if (role === 'employer') {
    newUser.company = company; newUser.position = position; newUser.industry = industry;
  } else if (role === 'craftsman') {
    newUser.skills = skills ? skills.split(',').map(s => s.trim()) : [];
    newUser.bio = bio; newUser.approved = false;
  } else if (role === 'admin') { return res.status(403).send('Cannot register as admin.'); }
  try {
    const savedUser = await newUser.save();
    req.session.userId = savedUser._id;
    res.redirect(`/${role}/dashboard`);
  } catch (err) {
    console.error('Error saving user:', err);
    res.render('register', { error: 'An error occurred during registration.', path: req.path });
  }
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

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
// ----------------------------------------------------
// CORRECTION: Corrected route for payment form with live data
app.get('/employer/deposit-funds/:jobId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId);

    if (!job) {
      return res.status(404).send('Job not found.');
    }

    const adminCommissionRate = 0.10; // 10%
    const craftsmanPaymentRate = 0.90; // 90%
    const commissionAmount = job.budget * adminCommissionRate;
    const craftsmanAmount = job.budget * craftsmanPaymentRate;
    
    res.render('employer/deposit-form', {
      title: 'Deposit Funds',
      job,
      commissionAmount,
      craftsmanAmount,
      formatCurrency,
      formatDate,
      path: req.path
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
    
    // Pass the user and path variables for the layout
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
  const availableJobs = await Job.find({ status: 'open' });
  const myJobs = await Job.find({ craftsmanId: req.user._id });
  res.render('craftsman/dashboard', { user: req.user, availableJobs, myJobs, path: req.path });
});
app.get('/craftsman/profile', requireAuth, requireRole(['craftsman']), (req, res) => {
  const platformAverage = { communication: 75, technicalSkill: 70, punctuality: 80, quality: 75, safety: 85 };
  const userProfile = req.user.profile || { communication: 0, technicalSkill: 0, punctuality: 0, quality: 0, safety: 0 };
  const isPending = !req.user.approved;
  res.render('craftsman/profile', { user: { ...req.user.toObject(), profile: userProfile }, platformAverage, path: req.path, isPending: isPending });
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
// Admin Routes
// ----------------------------------------------------
// --- COMBINED Admin Dashboard Route ---
app.get('/admin/dashboard', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    // MongoDB Data
    const pendingCraftsmen = await User.find({ role: 'craftsman', approved: false });
    const totalUsers = await User.countDocuments();
    const totalJobs = await Job.countDocuments();
    const totalReviews = await Review.countDocuments();

    // PostgreSQL Data
    const transactions = await Transaction.getAllTransactions(100, 0);
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

// NEW ROUTE: Admin view for all payments
app.get('/admin/payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const transactions = await Transaction.getAllTransactions(100, 0);
    const logs = await PaymentLog.getLogs(100, 0);
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

// NEW ROUTE: Admin transaction details page
app.get('/admin/transaction/:transactionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await Transaction.findByTransactionId(transactionId);

    if (!transaction) {
      return res.redirect('/admin/dashboard');
    }

    const logs = await PaymentLog.getLogsByTransaction(transactionId);
    
    res.render('admin/transaction-details', {
      title: 'Transaction Details',
      pageTitle: `Transaction ${transactionId.substring(0, 8)}...`,
      transaction,
      logs,
      formatCurrency,
      formatDate,
      user: req.user,
      path: req.path
    });
  } catch (error) {
    console.error('❌ Error fetching transaction details:', error);
    res.redirect('/admin/dashboard');
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
  const blacklistEntries = await Blacklist.find();
  res.render('admin/blacklist', { user: req.user, blacklist: blacklistEntries, path: req.path });
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
    res.render('public-blacklist', { blacklist: blacklistEntries, path: req.path });
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
    await initDatabase();
    console.log('✅ PostgreSQL database initialized and ready.');
    server.listen(PORT, () => {
      console.log(`🚀 SmartCraft Payment Server running on http://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`📋 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Call the function to start the server
startServer();
module.exports = app;
