// controllers/reportController.js
const Report = require('../models/report');
const Job = require('../models/job');

exports.createEmployerReport = async (req, res) => {
  try {
    const { jobId, craftsmanId, reportSubject, reportMessage } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).send("Job not found");

    await Report.create({
      fromRole: 'employer',
      employerId: req.user._id,
      craftsmanId,
      jobId,
      reportSubject,
      reportMessage
    });

    res.redirect('/employer/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error submitting report");
  }
};

exports.createCraftsmanReport = async (req, res) => {
  try {
    const { jobId, employerId, reportSubject, reportMessage } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).send("Job not found");

    await Report.create({
      fromRole: 'craftsman',
      craftsmanId: req.user._id,
      employerId,
      jobId,
      reportSubject,
      reportMessage
    });

    res.redirect('/craftsman/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error submitting report");
  }
};
