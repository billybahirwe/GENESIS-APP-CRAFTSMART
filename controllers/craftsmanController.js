// controllers/craftsmanController.js
const Job = require('../models/job');

exports.renderDashboard = async (req, res) => {
  try {
    // Jobs assigned to this craftsman
    const myJobs = await Job.find({ assignedCraftsman: req.user._id })
      .populate('employerId', 'name mobile') // so craftsman can see employer details
      .lean();

    // Jobs available (open jobs)
    const availableJobs = await Job.find({ status: 'open' })
      .populate('employerId', 'name')
      .lean();

    res.render('craftsman/dashboard', {
      user: req.user,
      myJobs,
      availableJobs
    });
  } catch (error) {
    console.error('Error rendering craftsman dashboard:', error);
    res.status(500).send('Internal Server Error');
  }
};
