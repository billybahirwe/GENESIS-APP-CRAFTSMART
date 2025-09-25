// controllers/employerController.js
const Job = require('../models/job');
const User = require('../models/user');

exports.renderDashboard = async (req, res) => {
  try {
    // Employer’s jobs
    const jobs = await Job.find({ employerId: req.user._id })
      .populate('craftsmanId', 'name')  // show assigned craftsman
      .lean();

    // All craftsmen (for dropdown in report form)
    const craftsmen = await User.find({ role: 'craftsman', approved: true })
      .select('name _id')
      .lean();

    res.render('employer/dashboard', {
      user: req.user,
      jobs,
      craftsmen
    });
  } catch (error) {
    console.error('Error rendering employer dashboard:', error);
    res.status(500).send('Internal Server Error');
  }
};
