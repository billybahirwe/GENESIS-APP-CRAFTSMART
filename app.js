const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios'); 
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { Server } = require("socket.io");
const turf = require("@turf/turf");
const NodeGeocoder = require("node-geocoder"); 

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
const paymentHistoryRouter = require('./routes/payment-history'); 
const jobRoutes = require("./routes/job");
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
// --- Configure Multer for File Uploads ---
// This storage configuration will be used for the craftsman profile files.
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
const upload = multer({ storage }); // Define the 'upload' variable here.
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

// const upload = multer({ storage });
const uploadTemp = multer({ dest: 'uploads/' });
// --- Existing Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: 'craftsmart-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use("/job", jobRoutes); // all job-related routes

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

app.locals.reports = [];
// New middleware for admin only routes
const requireAdmin = requireRole(['admin']);

function requireAdminPassword(req, res, next) {
  if (req.session.adminAuthenticated) {
    return next();
  }
  res.redirect("/admin/login");
}

// Helper function to format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};


// 👇 New route to handle funds release to the craftsman
app.post('/api/payment/release/:jobId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { jobId } = req.params;

    // Populate the job with the craftsman's details using craftsmanId
    const job = await Job.findById(jobId).populate('craftsmanId');

    if (!job || job.employerId.toString() !== req.user._id.toString()) {
      return res.status(404).send('Job not found or you are not the employer.');
    }

    if (job.status !== 'paid-in-escrow') {
      return res.status(400).send('Payment is not in escrow for this job.');
    }

    if (!job.craftsmanId) {
      return res.status(400).send('No craftsman assigned to this job.');
    }

    // Perform the transfer of funds to the craftsman's account
    // Make sure bank_name and bank_account exist in User schema for the craftsman
    const transferResponse = await axios.post(
      'https://api.flutterwave.com/v3/transfers',
      {
        account_bank: job.craftsmanId.bank_name,       // Ensure this exists in User model
        account_number: job.craftsmanId.bank_account,  // Ensure this exists in User model
        amount: job.budget,                            // Or job.craftsmanAmount if calculated
        currency: 'UGX',
        narration: `Payment for job: ${job.title}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, // Your Flutterwave secret
        },
      }
    );

    if (transferResponse.data.status === 'success') {
      // Update job status to 'disbursed'
      job.status = 'disbursed';
      await job.save();

      res.status(200).send('Funds have been successfully released to the craftsman.');
    } else {
      console.error('Flutterwave transfer failed:', transferResponse.data);
      res.status(500).send('Transfer failed.');
    }
  } catch (error) {
    console.error('Error releasing payment:', error.response?.data || error.message);
    res.status(500).send('Server error');
  }
});

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
  const { 
    name, email, mobile, password, confirmPassword, role,
    region, district, city,
    company, position, industry,
    skills, bio
  } = req.body;

  try {
    // ✅ Password confirmation check
    if (password !== confirmPassword) {
      return res.render('register', {
        error: 'Passwords do not match',
        path: req.path,
        formData: req.body
      });
    }

    // ✅ Prevent duplicate mobile
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      req.session.formData = req.body;
      return res.render('register', {
        error: 'Mobile number already registered',
        path: req.path,
        formData: req.body
      });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Build full location string
    const fullLocation = `${city}, ${district}, ${region}, Uganda`;

    // ✅ Geocode location
    let geoLocation = null;
    let locationName = null;
    try {
      const geoRes = await geocoder.geocode(fullLocation);
      if (geoRes.length > 0) {
        geoLocation = {
          type: "Point",
          coordinates: [geoRes[0].longitude, geoRes[0].latitude]
        };
        locationName = geoRes[0].formattedAddress || fullLocation;
      } else {
        locationName = fullLocation; // fallback if geocoding fails
      }
    } catch (geoErr) {
      console.error("Geocoding error:", geoErr);
      locationName = fullLocation; // fallback
    }

    // ✅ Create user
    const newUser = new User({
      name,
      email,
      mobile,
      password: hashedPassword,
      role,
      location: { region, district, city }, // keep structured fields
      geoLocation,   // ✅ for distance calculations
      locationName,  // ✅ human-readable display
    });

    // Role-specific fields
    if (role === 'employer') {
      newUser.company = company;
      newUser.position = position;
      newUser.industry = industry;
    } else if (role === 'craftsman') {
      newUser.skills = skills ? skills.split(',').map(s => s.trim()) : [];
      newUser.bio = bio;
      newUser.approved = false; // craftsmen require approval
    } else if (role === 'admin') {
      return res.status(403).send('Cannot register as admin.');
    }

    // ✅ Save user
    const savedUser = await newUser.save();
    req.session.userId = savedUser._id;

    if (req.session.formData) {
      delete req.session.formData;
    }

    res.redirect(`/${role}/dashboard`);

  } catch (err) {
    console.error('Error registering user:', err);
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

// Define a placeholder route for the employer dashboard to handle redirects
app.get('/employer/dashboard', (req, res) => {
    res.send('Employer Dashboard. Your report has been submitted successfully.');
});

// The route to handle the report submission
app.post('/employer/report-problem', async (req, res) => {
    try {
        // Retrieve data from the form body.
        const { craftsmanName, reportSubject, reportMessage } = req.body;
        
        // Basic validation to ensure the fields are not empty.
        if (!craftsmanName || !reportSubject || !reportMessage) {
            console.error('Validation Error: All fields are required for the report.');
            return res.status(400).send('All fields are required.');
        }

        // Create the report data object.
        const reportData = {
            // Placeholder ID for now. In a real app, this would be `req.user.id`.
            employerId: 'sample-employer-id-123', 
            craftsmanName,
            reportSubject,
            reportMessage,
            timestamp: new Date()
        };

        // Add the new report to our in-memory array.
        app.locals.reports.push(reportData);

        console.log('New report submitted:', reportData);

        // Redirect the user back to their dashboard with a success message.
        res.redirect('/employer/dashboard?success=report-submitted');

    } catch (error) {
        console.error('Error submitting report:', error);
        res.status(500).send('Internal Server Error. Please try again later.');
    }
});

// New route for the Admin Reports page
app.get('/admin/reports-message', (req, res) => {
    // The path 'admin/reports-message' tells Express to look for the file
    // at `./views/admin/reports-message.pug`
    res.render('admin/reports-message', { reports: app.locals.reports });
});

// New route for the Admin Reports page
app.get('/admin/reports-message', (req, res) => {
    // Pass the reports data from our in-memory array to the Pug template.
    res.render('admin/reports-message', { reports: app.locals.reports });
});

// --- BEGIN CHANGES ---

// Configure multer to save files temporarily

app.get('/employer/post-job', requireAuth, requireRole(['employer']), (req, res) => {
  res.render('employer/post-job', { user: req.user, path: req.path });
});

// This route processes the form submission, including image resizing.

// --- Helper: safe async delete with retry if file is busy
function safeDelete(filePath, retries = 3) {
  fs.unlink(filePath, (err) => {
    if (err) {
      if (err.code === 'EBUSY' && retries > 0) {
        console.warn(`⚠️ File busy, retrying in 100ms: ${filePath}`);
        setTimeout(() => safeDelete(filePath, retries - 1), 100);
      } else {
        console.error(`❌ Error deleting file: ${filePath}`, err.message);
      }
    } else {
      console.log(`✅ File deleted: ${filePath}`);
    }
  });
}

// --- POST route for employer to post a job

// --- Geocoder Setup ---
const geocoderOptions = {
  provider: 'openstreetmap', // free provider, no API key needed
  httpAdapter: 'https',
  formatter: null
};
const geocoder = NodeGeocoder(geocoderOptions);

// --- POST: Employer posts a new job ---
app.post(
  '/employer/post-job',
  requireAuth,
  requireRole(['employer']),
  uploadTemp.array('images', 10),
  async (req, res) => {
    const { title, description, location, budget, category, latitude, longitude } = req.body;
    const uploadedFiles = req.files;
    const processedImages = [];
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    try {
      // Use coordinates if provided, otherwise fallback to geocoding
      let coords = [
        parseFloat(longitude),
        parseFloat(latitude)
      ];

      if (!coords[0] || !coords[1]) {
        const geoRes = await geocoder.geocode(location);
        if (!geoRes.length) {
          return res.status(400).send("Could not determine job location. Please enter a valid address.");
        }
        coords = [geoRes[0].longitude, geoRes[0].latitude];
      }

      // Always have a readable location name
      const locationName =
        location ||
        geoRes?.[0]?.formattedAddress ||
        geoRes?.[0]?.city ||
        geoRes?.[0]?.district ||
        geoRes?.[0]?.state ||
        geoRes?.[0]?.country ||
        "Unknown location";

      // Process uploaded images
      if (uploadedFiles && uploadedFiles.length > 0) {
        for (const file of uploadedFiles) {
          const uniqueFileName = `${Date.now()}-${path.basename(file.originalname)}`;
          const newFilePath = path.join(uploadDir, uniqueFileName);

          await sharp(file.path)
            .resize({ width: 800, height: 600, fit: sharp.fit.inside, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(newFilePath);

          processedImages.push(`/uploads/${uniqueFileName}`);
          safeDelete(file.path); // Make sure this function exists
        }
      }

      const newJob = new Job({
        title,
        description,
        location: { type: "Point", coordinates: coords },
        locationName,
        budget: parseFloat(budget),
        employerId: req.user._id,
        category,
        images: processedImages
      });

      await newJob.save();
      res.redirect('/employer/dashboard');

    } catch (err) {
      console.error('Error posting job:', err);
      res.status(500).send('An error occurred while posting the job.');
    }
  }
);



app.get('/employer/browse-craftsmen', requireAuth, requireRole(['employer']), async (req, res) => {
  const craftsmen = await User.find({ role: 'craftsman', approved: true });
  res.render('employer/browse-craftsmen', { user: req.user, craftsmen, path: req.path });
});

app.get('/employer/payment-records', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    // ✅ Fetch deposits (Transfer In)
    const transferInRecords = await Transaction.find({
      user: req.user._id,
      type: 'deposit'
    }).sort({ createdAt: -1 });

    // ✅ Fetch disbursements (Transfer Out)
    const transferOutRecords = await Transaction.find({
      user: req.user._id,
      type: 'disbursement'
    }).sort({ createdAt: -1 });

    // Render the page
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

// Route to view a single job post (accessible to all authenticated users)
app.get('/job/:id', requireAuth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('employerId', 'name');
    if (!job) {
      return res.status(404).render('error', { message: 'Job not found.' });
    }
    // Render the job-details.pug template with the job data
    res.render('craftsman/job-details', { job, user: req.user, path: req.path });
  } catch (err) {
    console.error('Error fetching job details:', err);
    res.status(500).send('An error occurred while fetching job details.');
  }
});

// Route to view a single job post (accessible to all authenticated users)
app.get('/job/:id', requireAuth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('employerId', 'name');
    if (!job) {
      return res.status(404).render('error', { message: 'Job not found.' });
    }
    res.render('craftsman/job-details', { job, user: req.user, path: req.path });
  } catch (err) {
    console.error('Error fetching job details:', err);
    res.status(500).send('An error occurred while fetching job details.');
  }
});

// Route to render the edit job page for an employer
app.get('/employer/edit-job/:id', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).render('error', { message: 'Job not found.' });
    }
    if (job.employerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('You do not have permission to edit this job.');
    }
    res.render('employer/edit-job', { job, user: req.user, path: req.path });
  } catch (err) {
    console.error('Error fetching job for edit:', err);
    res.status(500).send('An error occurred while fetching the job.');
  }
});


// Route to handle the form submission for editing a job
// Route for employers to view all job listings (read-only)
app.get('/employer/all-jobs', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    // Fetch all jobs from the database, sorted by the most recent
    const jobs = await Job.find({}).sort({ createdAt: -1 }).lean();

    // Render the new template with the job data
    res.render('employer/all-jobs', {
      user: req.user,
      jobs: jobs,
      path: req.path
    });
  } catch (err) {
    console.error('Error fetching all jobs for employer:', err);
    res.status(500).send('An error occurred while fetching job listings.');
  }
});
// Route to handle the form submission for editing a job
app.post('/employer/edit-job/:id', requireAuth, requireRole(['employer']), uploadTemp.array('images', 10), async (req, res) => {
  const { title, description, location, budget, category, imagesToDelete } = req.body;
  const uploadedFiles = req.files;
  const uploadDir = path.join(__dirname, 'public', 'uploads');

  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).send('Job not found.');
    }
    if (job.employerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('You do not have permission to edit this job.');
    }
    
    let updatedImages = job.images || [];

    // Handle deletion of existing images
    if (imagesToDelete && imagesToDelete.length > 0) {
      updatedImages = job.images.filter(img => {
        const shouldDelete = imagesToDelete.includes(img);
        if (shouldDelete) {
          const imagePath = path.join(__dirname, 'public', img);
          if (fs.existsSync(imagePath)) {
            // Add a small delay to ensure the file is not busy
            setTimeout(() => {
              try {
                fs.unlinkSync(imagePath);
                console.log(`Successfully deleted old image: ${imagePath}`);
              } catch (err) {
                console.error(`Failed to delete old image ${imagePath}:`, err);
              }
            }, 100);
          }
        }
        return !shouldDelete;
      });
    }

    // Process newly uploaded images
    if (uploadedFiles && uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        const uniqueFileName = `${Date.now()}-${path.basename(file.originalname)}`;
        const newFilePath = path.join(uploadDir, uniqueFileName);

        await sharp(file.path)
          .resize({ width: 800, height: 600, fit: sharp.fit.inside, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(newFilePath);

        updatedImages.push(`/uploads/${uniqueFileName}`);
        
        // Add a small delay before deleting the temporary file
        setTimeout(() => {
          try {
            fs.unlinkSync(file.path);
            console.log(`Successfully deleted temporary file: ${file.path}`);
          } catch (err) {
            console.error(`Failed to delete temporary file ${file.path}:`, err);
          }
        }, 100);
      }
    }

    // Update job with new image list and other fields
    job.title = title;
    job.description = description;
    job.location = location;
    job.budget = parseFloat(budget);
    job.category = category;
    job.images = updatedImages;
    
    await job.save();
    res.redirect('/employer/dashboard');

  } catch (err) {
    console.error('Error updating job:', err);
    res.status(500).send('An error occurred while updating the job.');
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
// --- Socket.IO Logic (Updated with Flutterwave payment) ---
io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // Join private room
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
        timestamp: savedMessage.timestamp,
      });
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  // ✅ Payment initiation
  socket.on("initiatePayment", async (data) => {
    try {
      const { jobId, amount, mobile_number, userId } = data;

      // Fetch job and users
      const job = await Job.findById(jobId);
      if (!job) throw new Error("Job not found");

      const employer = await User.findById(userId);
      const craftsman = await User.findById(job.craftsmanId);
      if (!employer || !craftsman) throw new Error("User not found");

      const txRef = `CS_${Date.now()}_${userId}`;

      const payload = {
        tx_ref: txRef,
        amount,
        currency: "UGX",
        redirect_url: process.env.FLUTTERWAVE_REDIRECT_URL,
        customer: {
          email: employer.email,
          phonenumber: mobile_number,
          name: employer.name,
        },
        meta: {
          job_id: jobId,
          craftsman_id: job.craftsmanId,
          customer_id: userId, // included but not strictly required later
          employer_phone: employer.mobile,
          craftsman_phone: craftsman.mobile,
        },
        customizations: {
          title: job.title,
          description: `Payment for job: ${job.title}`,
        },
      };

      console.log("ℹ️ Sending this meta data to Flutterwave:", payload.meta);

      const response = await axios.post(
        "https://api.flutterwave.com/v3/payments",
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const fwData = response.data;

      if (fwData.status === "success" && fwData.data.link) {
        socket.emit("paymentLink", { success: true, link: fwData.data.link });
      } else {
        socket.emit("paymentLink", {
          success: false,
          message: "Failed to initiate payment",
        });
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
app.get("/payment/verify", async (req, res) => {
  try {
    const { tx_ref } = req.query;
    if (!tx_ref) return res.status(400).send("Transaction reference missing.");

    // 1️⃣ Verify payment with Flutterwave
    const verifyResponse = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      {
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
      }
    );

    const fwData = verifyResponse.data;
    console.log("ℹ️ Received this meta data from Flutterwave:", fwData.data.meta);

    // 2️⃣ Fetch job and users
    const jobId = fwData.data.meta?.job_id;
    if (!jobId) {
      console.error("❌ Missing job_id in Flutterwave meta.");
      return res.status(400).send("Verification failed: job ID missing.");
    }

    const job = await Job.findById(jobId);
    if (!job) return res.status(400).send("Verification failed: job not found.");

    const employer = await User.findById(job.employerId);
    const craftsman = await User.findById(job.craftsmanId);
    if (!employer || !craftsman) {
      return res.status(400).send("Verification failed: associated data not found.");
    }

    // 3️⃣ Handle transaction after Flutterwave verification
    try {
      let transaction = await Transaction.findOne({
        gatewayRef: fwData.data.flw_ref || fwData.data.id,
      });

      if (transaction) {
        // ✅ Update existing transaction
        transaction.status = "COMPLETED";
        transaction.employer_phone = employer.mobile;
        transaction.craftsman_phone = craftsman.mobile;
        transaction.payment_method = fwData.data.payment_type;
        transaction.payment_reference = fwData.data.flw_ref;
        transaction.external_transaction_id = fwData.data.id;
        transaction.webhook_received_at = new Date();
        await transaction.save();
        console.log(`✅ Existing transaction ${transaction.gatewayRef} updated successfully.`);
      } else {
        // ✅ Create new transaction
        transaction = new Transaction({
          type: "deposit",
          job: job._id,
          user: employer._id,
          gatewayRef: fwData.data.flw_ref || fwData.data.id,
          transactionId: fwData.data.tx_ref || undefined, // only if available
          status: "COMPLETED",
          total_amount: fwData.data.amount,
          commission_amount: 0,
          disbursement_amount: fwData.data.amount,
          employer_phone: employer.mobile,
          craftsman_phone: craftsman.mobile,
          payment_method: fwData.data.payment_type,
          payment_reference: fwData.data.flw_ref,
          external_transaction_id: fwData.data.id,
          webhook_received_at: new Date(),
        });
        await transaction.save();
        console.log(`✅ New transaction ${transaction.gatewayRef} saved successfully.`);
      }
    } catch (error) {
      console.error("❌ Error saving transaction:", error.message);
    }

    // 4️⃣ Update job status if necessary
    if (["open", "in-progress"].includes(job.status)) {
      job.status = "paid-in-escrow";
      await job.save();
    }

    // 5️⃣ Render success page
    if (fwData.status === "success" && fwData.data.status === "successful") {
      return res.render("employer/payment-success", { message: "Payment successful!" });
    } else if (fwData.data && fwData.data.status === "pending") {
      return res.render("employer/payment-otp", { tx_ref });
    } else {
      return res.render("employer/payment-failed", { message: "Payment failed. Please try again." });
    }

  } catch (error) {
    console.error("Error verifying payment:", error.response?.data || error.message);
    return res.status(500).send("Server error during payment verification.");
  }
});



// 💡 NEW ROUTE: To view a craftsman's profile


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


app.get("/employer/payment-receipt/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await Transaction.findById(transactionId).lean();

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    return res.render("transaction-success", { transaction });
  } catch (err) {
    console.error("❌ View receipt error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// ----------------------------------------------------
// Craftsman Routes (directly in app.js)
// ----------------------------------------------------

// Dashboard
app.get('/craftsman/dashboard', requireAuth, requireRole(['craftsman']), async (req, res) => {
  try {
    const craftsman = await User.findById(req.user._id).lean();
    if (!craftsman) {
      return res.status(404).send("Craftsman not found");
    }

    const availableJobs = await Job.find({ status: 'open' }).lean();
    const myJobs = await Job.find({ craftsmanId: craftsman._id }).lean();

    // Compute distance for each available job
    const enrichedJobs = availableJobs.map(job => {
      if (
        craftsman.geoLocation &&
        Array.isArray(craftsman.geoLocation.coordinates) &&
        craftsman.geoLocation.coordinates.length === 2 &&
        job.location &&
        Array.isArray(job.location.coordinates) &&
        job.location.coordinates.length === 2
      ) {
        const from = turf.point(craftsman.geoLocation.coordinates);
        const to = turf.point(job.location.coordinates);
        const distanceKm = turf.distance(from, to, { units: "kilometers" });

        return {
          ...job,
          distanceKm,
          isFar: distanceKm > 50 // threshold in km
        };
      }

      return { ...job, distanceKm: null, isFar: false };
    });

    res.render('craftsman/dashboard', {
      user: craftsman,
      availableJobs: enrichedJobs,
      myJobs,
      path: req.path
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    res.status(500).send("Internal Server Error");
  }
});


// Route for submitting feedback/rating for a craftsman
// GET craftsman profile for employer
app.get(
  '/craftsman/profile/:id',
  requireAuth,                 // ensure user is logged in
  requireRole(['employer']),   // ensure user is an employer
  async (req, res) => {
    try {
      const craftsmanId = req.params.id;

      // Fetch craftsman from DB
      const user = await User.findById(craftsmanId).lean();
      if (!user) {
        return res.status(404).send('Craftsman not found');
      }

      // Default profile stats if missing
      const userProfile = user.profile || {
        communication: 0,
        technicalSkill: 0,
        punctuality: 0,
        quality: 0,
        safety: 0
      };

      // Platform-wide average for radar chart
      const platformAverage = {
        communication: 75,
        technicalSkill: 70,
        punctuality: 80,
        quality: 75,
        safety: 85
      };

      // Render profile pug
      res.render('craftsman/profile', {
        user: { ...user, profile: userProfile },
        platformAverage,
        path: req.path
      });
    } catch (err) {
      console.error('Error fetching craftsman profile:', err);
      res.status(500).send('Server error');
    }
  }
);


// POST /rate-craftsman/:id
app.post('/rate-craftsman/:id', async (req, res) => {
  try {
    const craftsmanId = req.params.id;
    const { rating, comment } = req.body;

    // Validate rating
    const numericRating = parseInt(rating, 10);
    if (!numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: 'Invalid rating. Must be 1–5 stars.' });
    }

    // Get employer name from session
    const employerName = req.session.userName || 'Anonymous';

    // Find craftsman
    const craftsman = await User.findById(craftsmanId);
    if (!craftsman) {
      return res.status(404).json({ success: false, message: 'Craftsman not found.' });
    }

    // Add feedback
    craftsman.feedbacks.push({
      employerName,
      rating: numericRating,
      comment: comment || ''
    });

    await craftsman.save();

    // Respond with JSON (AJAX will handle page update)
    res.json({
      success: true,
      message: 'Feedback submitted successfully.',
      feedback: {
        employerName,
        rating: numericRating,
        comment: comment || '',
        date: new Date()
      }
    });
  } catch (err) {
    console.error('Error submitting feedback:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Define multerFields for multi-file uploads
const multerFields = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'cv', maxCount: 1 },
  { name: 'coverLetter', maxCount: 1 }
]);

// Profile update route
app.post('/craftsman/profile', requireAuth, multerFields, async (req, res) => {
  try {
    const user = req.user;

    // Update basic info
    user.name = req.body.name;
    user.email = req.body.email;
    user.mobile = req.body.mobile;
    user.experience = parseInt(req.body.experience || 0, 10);

    // Update location
    user.location = req.body.location;

    // Update skills
    user.skills = req.body.skills ? req.body.skills.split(',').map(s => s.trim()) : [];

    // Update profile ratings
    user.profile = {
      communication: parseInt(req.body.profile.communication || 0, 10),
      technicalSkill: parseInt(req.body.profile.technicalSkill || req.body.profile.technicalskill || 0, 10),
      punctuality: parseInt(req.body.profile.punctuality || 0, 10),
      quality: parseInt(req.body.profile.quality || 0, 10),
      safety: parseInt(req.body.profile.safety || 0, 10)
    };

    // Handle uploaded files
    if (req.files?.cv?.length) user.cvPath = `/uploads/${req.files.cv[0].filename}`;
    if (req.files?.coverLetter?.length) user.coverLetterPath = `/uploads/${req.files.coverLetter[0].filename}`;
    if (req.files?.profilePicture?.length) user.profilePicture = `/uploads/${req.files.profilePicture[0].filename}`;

    await user.save();
    res.redirect('/craftsman/profile');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});


// Apply for a job

app.post(
  '/craftsman/apply-for-job/:jobId',
  requireAuth,
  requireRole(['craftsman']),
  async (req, res) => {
    try {
      const { jobId } = req.params;
      const craftsmanId = req.user._id;

      // 1️⃣ Find job and craftsman
      const job = await Job.findById(jobId);
      if (!job) return res.status(404).send("Job not found.");

      const craftsman = await User.findById(craftsmanId);
      if (!craftsman) return res.status(404).send("Craftsman not found.");

      // 2️⃣ Prevent duplicate applications
      const existingApplication = await Application.findOne({ jobId, craftsmanId });
      if (existingApplication) {
        return res.status(400).send("You have already applied for this job.");
      }

      // 3️⃣ Calculate distance between craftsman and job
      // Turf expects [lng, lat]
      if (
        !craftsman.geoLocation ||
        !Array.isArray(craftsman.geoLocation.coordinates) ||
        craftsman.geoLocation.coordinates.length !== 2
      ) {
        console.warn("Craftsman geoLocation is invalid.");
      }
      if (
        !job.location ||
        !Array.isArray(job.location.coordinates) ||
        job.location.coordinates.length !== 2
      ) {
        console.warn("Job location is invalid.");
      }

      const from = turf.point(craftsman.geoLocation.coordinates);
      const to = turf.point(job.location.coordinates);
      const distanceKm = turf.distance(from, to, { units: "kilometers" });

      // 4️⃣ Notify if too far (threshold = 50 km)
      if (distanceKm > 50) {
        // Flash message for traditional page reload
        if (req.flash) {
          req.flash(
            "warning",
            `⚠️ This job is about ${distanceKm.toFixed(1)} km away from your location.`
          );
        }

        // Real-time notification using Socket.IO
        if (req.io) {
          req.io.to(craftsmanId.toString()).emit("job-distance-warning", {
            jobId: job._id,
            distance: distanceKm.toFixed(1),
            jobTitle: job.title,
            locationName: job.locationName || "Unknown"
          });
        }
      }

      // 5️⃣ Save application
      const newApplication = new Application({
        jobId,
        craftsmanId,
        status: "pending"
      });
      await newApplication.save();

      res.redirect('/craftsman/dashboard');
    } catch (err) {
      console.error("Error applying for job:", err);
      res.status(500).send("Internal Server Error");
    }
  }
);

// Job details
app.get('/craftsman/jobs/:jobId', requireAuth, requireRole(['craftsman']), async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId).lean();
    if (!job) return res.status(404).send('Job not found.');

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

// View another craftsman's profile (dynamic route last!)
app.get('/craftsman/:craftsmanId', requireAuth, async (req, res) => {
  try {
    const { craftsmanId } = req.params;
    const craftsman = await User.findById(craftsmanId).lean();

    if (!craftsman || craftsman.role !== 'craftsman') {
      return res.status(404).render('error', { message: 'Craftsman not found.' });
    }

    res.render('craftsman/profile', { user: req.user, craftsman, path: req.path });
  } catch (err) {
    console.error('Error fetching craftsman profile:', err);
    res.status(500).send('Internal Server Error');
  }
});
// Employer: view a craftsman's profile
app.get('/employer/craftsman/:craftsmanId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { craftsmanId } = req.params;
    const craftsman = await User.findById(craftsmanId).lean();

    if (!craftsman || craftsman.role !== 'craftsman') {
      return res.status(404).render('error', { message: 'Craftsman not found.' });
    }

    // Provide platform average values for the chart
    const platformAverage = {
      communication: 75,
      technicalSkill: 70,
      punctuality: 80,
      quality: 75,
      safety: 85
    };

    res.render('admin/craftsman-profile', {
      pageTitle: "Craftsman Profile",
      user: craftsman,
      platformAverage
    });
  } catch (err) {
    console.error('Error fetching craftsman profile for employer:', err);
    res.status(500).send('Internal Server Error');
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
      adminId: req.user._id,   // ✅ Make adminId available to Pug
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

// Routes for approving and rejecting a craftsman
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

app.post('/admin/approve/:id', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send('User not found');
    user.approved = true;
    await user.save();
    res.redirect(`/admin/user/${user._id}`); // or back to list
  } catch (err) {
    console.error('Error approving user:', err);
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

// Routes for managing the blacklist

app.get('/public-blacklist', async (req, res) => {
  try {
    const blacklistEntries = await Blacklist.find();
    res.render('public-blacklist', {
      blacklist: blacklistEntries,
      formatDate: (date) => date ? new Date(date).toLocaleString() : 'N/A'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// GET: Blacklist page
app.get("/admin/login", (req, res) => {
  const error = req.query.error;
  res.render("admin/login", { error });
});

app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === "1234") {
    req.session.adminAuthenticated = true;
    res.redirect("/admin/blacklist");
  } else {
    res.redirect("/admin/login?error=Invalid password");
  }
});

// Admin logout
app.get("/admin/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
});

// Blacklist management routes
app.get("/admin/blacklist", requireAdminPassword, async (req, res) => {
  try {
    const blacklist = await Blacklist.find().sort({ addedAt: -1 });
    res.render("admin/blacklist", { 
      blacklist, 
      formatDate: d => new Date(d).toLocaleString() 
    });
  } catch (error) {
    console.error("Error fetching blacklist:", error);
    res.status(500).send("Server error");
  }
});

app.post("/admin/blacklist", requireAdminPassword, async (req, res) => {
  try {
    const { name, mobile, reason } = req.body;
    await Blacklist.create({ name, mobile, reason });
    res.redirect("/admin/blacklist");
  } catch (error) {
    console.error("Error adding to blacklist:", error);
    res.status(500).send("Server error");
  }
});

app.delete("/admin/blacklist/:id", requireAdminPassword, async (req, res) => {
  try {
    await Blacklist.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "User removed from blacklist" });
  } catch (error) {
    console.error("Error removing from blacklist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Reports management routes
app.get("/admin/reports", requireAdminPassword, async (req, res) => {
  try {
    const reports = await Report.find()
      .populate("craftsmanId", "name")
      .populate("employerId", "name mobile")
      .sort({ timestamp: -1 });
    res.render("admin/reports-message", { reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).send("Server error");
  }
});

// Mark report as seen
app.post("/admin/reports/:id/seen", requireAdminPassword, async (req, res) => {
  try {
    await Report.findByIdAndUpdate(req.params.id, { seen: true });
    res.json({ success: true });
  } catch (error) {
    console.error("Error marking report as seen:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Craftsman profile view
app.get("/admin/craftsman/:id", requireAdminPassword, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).send("User not found");
    }
    
    const platformAverage = {
      communication: 3.5,
      technicalSkill: 3.8,
      punctuality: 3.2,
      quality: 3.6,
      safety: 3.4
    };
    
    res.render("admin/craftsman-profile", { user, platformAverage });
  } catch (error) {
    console.error("Error fetching craftsman profile:", error);
    res.status(500).send("Server error");
  }
});

// Socket.IO real-time notifications
io.on("connection", (socket) => {
  console.log("Admin connected to socket:", socket.id);

  socket.on("newReport", (data) => {
    console.log("New report received:", data);
    io.emit("reportNotification", data);
  });

  socket.on("disconnect", () => {
    console.log("Admin disconnected:", socket.id);
  });
});

// app.get('/admin/blacklist', requireAuth, requireAdmin, async (req, res) => {
//   try {
//     const blacklistEntries = await Blacklist.find();
//     res.render('admin/blacklist', {
//       blacklist: blacklistEntries,  // pass actual MongoDB data
//       formatDate: (date) => date ? new Date(date).toLocaleString() : 'N/A'
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send('Internal Server Error');
//   }
// });


// DELETE: Remove a user from blacklist
// app.delete('/admin/blacklist/:id', async (req, res) => {
//   const { id } = req.params;
//   console.log(`Server received a DELETE request for ID: ${id}`); // Add this line
//   try {
//     const deleted = await Blacklist.findByIdAndDelete(id);
//     if (!deleted) {
//       console.log(`No entry found for ID: ${id}`);
//       return res.status(404).send('User not found');
//     }
//     console.log(`Successfully deleted entry with ID: ${id}`);
//     res.status(200).json({ message: 'User removed' });
//   } catch (err) {
//     console.error("Error during deletion:", err);
//     res.status(500).send('Internal Server Error');
//   }
// });

// POST /employer/report-craftsman/:craftsmanId
app.post('/employer/report-craftsman/:craftsmanId', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { craftsmanId } = req.params;
    const { reportSubject, reportMessage } = req.body;

    // Make sure the craftsman exists
    const craftsman = await User.findById(craftsmanId);
    if (!craftsman || craftsman.role !== 'craftsman') {
      return res.status(404).send('Craftsman not found');
    }

    // Create the report using proper ObjectId references
    const newReport = new Report({
      employerId: req.user._id,   // must be ObjectId
      craftsmanId: craftsman._id, // must be ObjectId
      reportSubject,
      reportMessage
    });

    await newReport.save();
    console.log('New report submitted:', newReport);

    res.redirect('/employer/reports');
  } catch (err) {
    console.error('Error submitting report:', err);
    res.status(500).send('Server error while submitting report');
  }
});



// Admin view a specific craftsman's profile
app.get('/admin/craftsman/:craftsmanId', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const { craftsmanId } = req.params;

    // Fetch the craftsman user from DB
    const craftsman = await User.findById(craftsmanId).lean();

    if (!craftsman || craftsman.role !== 'craftsman') {
      return res.status(404).render('error', { message: 'Craftsman not found.' });
    }

    // Optional: fetch platform average if you display skills chart
    const platformAverage = {
      communication: 75,
      technicalSkill: 70,
      punctuality: 80,
      quality: 75,
      safety: 85
    };

    res.render('admin/craftsman-profile', {
      user: craftsman,
      platformAverage,
      pageTitle: `Craftsman Profile - ${craftsman.name}`
    });
  } catch (err) {
    console.error('Error fetching craftsman profile:', err);
    res.status(500).render('error', { message: 'Internal Server Error' });
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