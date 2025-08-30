// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\routes\api\application.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// --- Import Mongoose Models ---
const Application = require('../../models/application');
const Job = require('../../models/job');

// --- Import Middleware ---
// Note: It's good practice to import middleware directly here for clarity
const { requireAuth, requireRole } = require('../../middleware/requireAuth'); 

/**
 * @description POST route for a craftsman to apply for a specific job.
 * @route POST /api/applications/
 * @middleware requireAuth, requireRole(['craftsman'])
 */
router.post('/', requireAuth, requireRole(['craftsman']), async (req, res) => {
  try {
    const { jobId } = req.body;
    const craftsmanId = req.user._id;

    // Validate that jobId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
        return res.status(400).json({ success: false, message: 'Invalid job ID.' });
    }

    // Check if the job exists and is open
    const job = await Job.findById(jobId);
    if (!job || job.status !== 'open') {
      return res.status(404).json({ success: false, message: 'Job not found or not open for applications.' });
    }

    // Check if the craftsman has already applied for this job
    const existingApplication = await Application.findOne({ jobId, craftsmanId });
    if (existingApplication) {
      return res.status(400).json({ success: false, message: 'You have already applied for this job.' });
    }

    // Create a new application
    const newApplication = new Application({
      jobId,
      craftsmanId,
      status: 'pending' // Initial status is pending
    });

    await newApplication.save();
    res.status(201).json({ success: true, message: 'Application submitted successfully!', application: newApplication });

  } catch (err) {
    console.error('Error submitting application:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

/**
 * @description PUT route for an employer to accept a specific application.
 * @route PUT /api/applications/:applicationId/accept
 * @middleware requireAuth, requireRole(['employer'])
 */
router.put('/:applicationId/accept', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { applicationId } = req.params;

    // Validate that applicationId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        return res.status(400).json({ success: false, message: 'Invalid application ID.' });
    }

    // Find the application and populate the job and craftsman details
    const application = await Application.findById(applicationId).populate('jobId');

    if (!application) {
        return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    // Ensure the employer owns the job they are accepting an application for
    if (application.jobId.employerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden: You do not own this job.' });
    }
    
    // Find the application by its ID and update its status field to 'accepted'.
    const acceptedApplication = await Application.findByIdAndUpdate(
      applicationId,
      { status: 'accepted' },
      { new: true } // { new: true } returns the updated document
    );
    
    // Find and update the job to 'in-progress' and assign the craftsman
    const updatedJob = await Job.findByIdAndUpdate(
      application.jobId._id,
      { status: 'in-progress', craftsmanId: application.craftsmanId },
      { new: true }
    );
    
    // Reject all other applications for this job
    await Application.updateMany(
      { jobId: application.jobId._id, _id: { $ne: applicationId } },
      { status: 'rejected' }
    );

    res.status(200).json({
      success: true,
      message: 'Application accepted successfully!',
      application: acceptedApplication,
      updatedJob: updatedJob
    });
  } catch (error) {
    console.error('Error accepting application:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @description PUT route for an employer to reject a specific application.
 * @route PUT /api/applications/:applicationId/reject
 * @middleware requireAuth, requireRole(['employer'])
 */
router.put('/:applicationId/reject', requireAuth, requireRole(['employer']), async (req, res) => {
  try {
    const { applicationId } = req.params;
    
    // Validate that applicationId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        return res.status(400).json({ success: false, message: 'Invalid application ID.' });
    }

    const application = await Application.findById(applicationId).populate('jobId');
    
    if (!application) {
        return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    // Ensure the employer owns the job they are rejecting an application for
    if (application.jobId.employerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden: You do not own this job.' });
    }

    // Find the application by its ID and update its status field to 'rejected'.
    const rejectedApplication = await Application.findByIdAndUpdate(
      applicationId,
      { status: 'rejected' },
      { new: true } // { new: true } returns the updated document
    );

    res.status(200).json({
      success: true,
      message: 'Application rejected successfully!',
      application: rejectedApplication
    });
  } catch (error) {
    console.error('Error rejecting application:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
