require('dotenv').config();
console.log('DEBUG: MONGO_URI =', process.env.MONGO_URI);
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Corrected Import Section ---
// Import Mongoose Models (defined in their own files)
const User = require('./models/user');
const Job = require('./models/Job');
const Review = require('./models/Review');
const Blacklist = require('./models/Blacklist');
const Message = require('./models/Message');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log('✅ MongoDB connected successfully');
}).catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Middleware
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

// Authentication middleware
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

// Role-based middleware
const requireRole = (roles) => {
    return (req, res, next) => {
        if (req.user && roles.includes(req.user.role)) {
            next();
        } else {
            res.status(403).send('Access denied');
        }
    };
};

// --- Routes ---
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

app.get('/login', (req, res) => {
    res.render('login', { path: req.path });
});

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
    res.render('register', { path: req.path });
});

app.post('/register', async (req, res) => {
    const { name, email, mobile, password, role, region, district, city, company, position, industry, skills, bio } = req.body;
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
        return res.render('register', { error: 'Mobile number already registered', path: req.path });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
        name,
        email,
        mobile,
        password: hashedPassword,
        role,
        location: { region, district, city },
    });
    if (role === 'employer') {
        newUser.company = company;
        newUser.position = position;
        newUser.industry = industry;
    } else if (role === 'craftsman') {
        newUser.skills = skills ? skills.split(',').map(s => s.trim()) : [];
        newUser.bio = bio;
        newUser.approved = false;
    } else if (role === 'admin') {
        return res.status(403).send('Cannot register as admin.');
    }
    try {
        const savedUser = await newUser.save();
        req.session.userId = savedUser._id;
        res.redirect(`/${role}/dashboard`);
    } catch (err) {
        console.error('Error saving user:', err);
        res.render('register', { error: 'An error occurred during registration.', path: req.path });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- Employer routes ---
app.get('/employer/dashboard', requireAuth, requireRole(['employer']), async (req, res) => {
    const userJobs = await Job.find({ employerId: req.user._id });
    const craftsmen = await User.find({ role: 'craftsman', approved: true });
    res.render('employer/dashboard', { user: req.user, jobs: userJobs, craftsmen, path: req.path });
});

app.get('/employer/post-job', requireAuth, requireRole(['employer']), (req, res) => {
    res.render('employer/post-job', { user: req.user, path: req.path });
});

app.post('/employer/post-job', requireAuth, requireRole(['employer']), upload.array('images', 5), async (req, res) => {
    const { title, description, location, budget, category } = req.body;
    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    const newJob = new Job({
        title,
        description,
        location,
        budget: parseFloat(budget),
        employerId: req.user._id,
        category,
        images
    });
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

// --- Craftsman routes ---
app.get('/craftsman/dashboard', requireAuth, requireRole(['craftsman']), async (req, res) => {
    const availableJobs = await Job.find({ status: 'open' });
    const myJobs = await Job.find({ craftsmanId: req.user._id });
    res.render('craftsman/dashboard', { user: req.user, availableJobs, myJobs, path: req.path });
});

// CORRECTED ROUTE for GET /craftsman/profile
app.get('/craftsman/profile', requireAuth, requireRole(['craftsman']), (req, res) => {
    const platformAverage = {
        communication: 75,
        technicalSkill: 70,
        punctuality: 80,
        quality: 75,
        safety: 85
    };
    
    // Create a mock user profile object with default values if it doesn't exist
    const userProfile = req.user.profile || {
        communication: 0,
        technicalSkill: 0,
        punctuality: 0,
        quality: 0,
        safety: 0
    };
    
    // Pass the correct user data and the path variable
    res.render('craftsman/profile', { 
        user: { ...req.user.toObject(), profile: userProfile }, 
        platformAverage,
        path: req.path 
    });
});

// CORRECTED ROUTE for POST /craftsman/profile
app.post('/craftsman/profile', requireAuth, requireRole(['craftsman']), async (req, res) => {
    const { name, email, location, skills, experience } = req.body;

    // Check if skills exist and is a string before splitting
    const skillsArray = skills ? skills.split(',').map(s => s.trim()) : [];
    
    const updateData = {
        name,
        email,
        location,
        skills: skillsArray,
        experience: parseInt(experience),
        // Ensure new profile changes trigger admin re-approval
        approved: false 
    };
    try {
        // Update the user and get the new user object
        const updatedUser = await User.findByIdAndUpdate(req.user._id, updateData, { new: true });
        
        // Update the user in the session so the next GET request has the correct data
        req.user = updatedUser; 

        res.redirect('/craftsman/profile?updated=true');
    } catch (err) {
        console.error('Error updating profile:', err);
        res.status(500).send('An error occurred while updating the profile.');
    }
});

app.post('/craftsman/accept-job/:jobId', requireAuth, requireRole(['craftsman']), async (req, res) => {
    const jobId = req.params.jobId;
    try {
        await Job.findByIdAndUpdate(jobId, { status: 'in-progress', craftsmanId: req.user._id, acceptedAt: new Date() });
        res.redirect('/craftsman/dashboard');
    } catch (err) {
        console.error('Error accepting job:', err);
        res.status(500).send('An error occurred while accepting the job.');
    }
});

// --- Admin routes ---
app.get('/admin/dashboard', requireAuth, requireRole(['admin']), async (req, res) => {
    try {
        const pendingCraftsmen = await User.find({ role: 'craftsman', approved: false });
        const totalUsers = await User.countDocuments();
        const totalJobs = await Job.countDocuments();
        const totalReviews = await Review.countDocuments();
        res.render('admin/dashboard', {
            user: req.user,
            pendingCraftsmen,
            totalUsers,
            totalJobs,
            totalReviews,
            path: req.path
        });
    } catch (err) {
        console.error('Error fetching admin dashboard data:', err);
        res.status(500).send('Internal Server Error');
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
    const newBlacklistEntry = new Blacklist({
        name,
        mobile,
        reason,
        addedBy: req.user._id
    });
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
        const jobsByStatus = await Job.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        res.render('admin/reports', {
            user: req.user,
            employerCount,
            craftsmanCount,
            jobsByStatus,
            path: req.path
        });
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

// --- Messages routes ---
app.get('/messages', requireAuth, async (req, res) => {
    try {
        // Find all other users to display in the conversation sidebar
        const allUsers = await User.find({ _id: { $ne: req.user._id } }).select('_id name');

        // Your existing code to find the user's messages
        const userMessages = await Message.find({
            $or: [{ senderId: req.user._id }, { receiverId: req.user._id }]
        }).populate('senderId receiverId').sort({ timestamp: 1 });

        // Pass both the list of users and the messages to the template
        res.render('messages', {
            user: req.user,
            allUsers: allUsers,
            messages: userMessages,
            path: req.path
        });
    } catch (err) {
        console.error('Error fetching message data:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/messages', requireAuth, async (req, res) => {
    const { receiverId, content } = req.body;
    const senderId = req.user._id;

    if (!receiverId || !content) {
        return res.status(400).json({ error: 'Receiver ID and content are required.' });
    }

    try {
        const newMessage = new Message({
            senderId,
            receiverId,
            content
        });
        await newMessage.save();
        res.status(201).json({ success: true, message: 'Message sent successfully.' });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Create uploads directory
const uploadsDir = './public/uploads';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.listen(PORT, () => {
    console.log(`CraftSmart server running on http://localhost:${PORT}`);
});