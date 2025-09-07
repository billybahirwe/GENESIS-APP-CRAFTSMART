// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\models\job.js

const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  budget: {
    type: Number,
    required: true
  },
  employerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },
  // The craftsman assigned to the job
  craftsmanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Track both job progress and payment status
  status: {
    type: String,
    enum: [
      'open',
      'in-progress',
      'paid-in-escrow',
      'disbursed',
      'completed',
      'canceled'
    ],
    default: 'open'
  },
  // Keep the transaction IDs to link to external payment records
  employerTransactionId: {
    type: String
  },
  craftsmanTransactionId: {
    type: String
  },
  images: [
    {
      type: String
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;
