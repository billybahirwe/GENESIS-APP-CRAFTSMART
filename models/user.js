// models/User.js

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    mobile: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ['employer', 'craftsman', 'admin'] },
    approved: { type: Boolean, default: false },
    
    // This is the location field that was already present
    location: {
        region: { type: String, required: false },
        district: { type: String, required: false },
        city: { type: String, required: false },
    },

    // --- These are the missing fields for the craftsman profile ---
    experience: { type: Number, default: 0 },
    skills: [String],
    cvPath: String,
    coverLetterPath: String,
    profile: {
        communication: { type: Number, default: 0 },
        technicalSkill: { type: Number, default: 0 },
        punctuality: { type: Number, default: 0 },
        quality: { type: Number, default: 0 },
        safety: { type: Number, default: 0 }
    },
    // --- End of missing fields ---
});

const User = mongoose.model('User', userSchema);

module.exports = User;