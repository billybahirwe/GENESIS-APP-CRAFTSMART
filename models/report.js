// models/report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportSubject: { type: String, required: true },
  reportMessage: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  employerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  craftsmanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // ✅ store ID
});

module.exports = mongoose.model('Report', reportSchema);
