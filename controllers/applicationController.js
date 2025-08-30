// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\controllers\ApplicationController.js

const Application = require('../models/application');
const Job = require('../models/job');

// This function handles accepting a craftsman's application.
exports.acceptApplication = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the application by its ID and update its status to 'accepted'.
    const application = await Application.findByIdAndUpdate(id, { status: 'accepted' }, { new: true });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    // After accepting, we need to update the related job to mark it as 'in-progress'
    // and assign the craftsman.
    await Job.findByIdAndUpdate(application.jobId, {
      status: 'in-progress',
      assignedCraftsman: application.craftsmanId
    });

    res.status(200).json({ success: true, message: 'Application accepted successfully.', data: application });

  } catch (error) {
    console.error('Error accepting application:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// This function handles rejecting a craftsman's application.
exports.rejectApplication = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the application by its ID and update its status to 'rejected'.
    const application = await Application.findByIdAndUpdate(id, { status: 'rejected' }, { new: true });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    res.status(200).json({ success: true, message: 'Application rejected successfully.', data: application });

  } catch (error) {
    console.error('Error rejecting application:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
