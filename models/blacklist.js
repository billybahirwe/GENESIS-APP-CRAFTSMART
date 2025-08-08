const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  name: String,
  mobile: String,
  reason: String,
  addedBy: mongoose.Schema.Types.ObjectId,
  addedAt: Date
});

module.exports = mongoose.model('Blacklist', blacklistSchema);
