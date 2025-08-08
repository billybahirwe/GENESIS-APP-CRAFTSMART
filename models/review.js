const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  jobId: mongoose.Schema.Types.ObjectId,
  employerId: mongoose.Schema.Types.ObjectId,
  craftsmanId: mongoose.Schema.Types.ObjectId,
  rating: Number,
  comment: String,
  approved: Boolean,
  createdAt: Date
});

module.exports = mongoose.model('Review', reviewSchema);
