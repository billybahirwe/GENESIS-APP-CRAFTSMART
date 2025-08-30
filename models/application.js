// models/application.js

const mongoose = require('mongoose');

// This file defines the Mongoose schema for the 'Application' object.
// It represents a craftsman's application for a specific job.

const applicationSchema = new mongoose.Schema({
  // The ObjectId of the Job this application is for.
  // It references the 'Job' collection.
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
  },
  // The ObjectId of the Craftsman who submitted the application.
  // It references the 'User' collection.
  craftsmanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The current status of the application.
  // It defaults to 'pending' and can be updated later.
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
  },
  // A timestamp for when the application was created.
  timestamp: {
    type: Date,
    default: Date.now,
  }
});

// Create the 'Application' model from the schema.
const Application = mongoose.model('Application', applicationSchema);

// Export the model so it can be used in other files (like app.js).
module.exports = Application;

