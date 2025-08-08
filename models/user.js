// models/User.js

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    mobile: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ['employer', 'craftsman', 'admin'] },
    location: {
        region: { type: String, required: true },
        district: { type: String, required: true },
        city: { type: String, required: true },
    },
    approved: { type: Boolean, default: false },
});

const User = mongoose.model('User', userSchema);

module.exports = User;