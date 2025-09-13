// models/Job.js
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

  // 🌍 GeoJSON location for distance calculations
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },

  // 🏷️ Human-readable address for display
  locationName: {
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

// Add a geospatial index for queries like "find nearby jobs"
jobSchema.index({ location: "2dsphere" });

const Job = mongoose.model('Job', jobSchema);
module.exports = Job;
