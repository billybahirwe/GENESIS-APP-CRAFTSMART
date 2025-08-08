const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: String,
  description: String,
  location: String,
  budget: Number,
  employerId: mongoose.Schema.Types.ObjectId,
  craftsmanId: mongoose.Schema.Types.ObjectId,
  status: String,
  category: String,
  createdAt: Date,
  acceptedAt: Date,
  images: [String]
});

module.exports = mongoose.model('Job', jobSchema);
