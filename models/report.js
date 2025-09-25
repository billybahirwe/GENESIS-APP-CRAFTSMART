// models/report.js
// const mongoose = require('mongoose');

// const reportSchema = new mongoose.Schema({
//   reportSubject: { type: String, required: true },
//   reportMessage: { type: String, required: true },
//   timestamp: { type: Date, default: Date.now },
//   employerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   craftsmanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // ✅ store ID
// });

// module.exports = mongoose.model('Report', reportSchema);



const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportSubject: { type: String, required: true },
  reportMessage: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false },

  // Who submitted this report: 'employer' or 'craftsman'
  fromRole: { 
    type: String, 
    enum: ['employer', 'craftsman'], 
    required: true 
  },

  // Relations
  employerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  craftsmanId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  jobId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Job', 
    required: true 
  }
});

// Index for faster lookups
reportSchema.index({ fromRole: 1, employerId: 1, craftsmanId: 1, jobId: 1 });

module.exports = mongoose.model('Report', reportSchema);




