const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true, unique: true }, // include country code e.g., 2567XXXXXXX
  password: { type: String, required: true },
  role: {
    type: String,
    required: true,
    enum: ["employer", "craftsman", "admin"],
  },
  approved: { type: Boolean, default: false },

  // 💰 Mobile Money Numbers (Craftsman-specific, optional)
  mtnMoney: { type: String, default: null },
  airtelMoney: { type: String, default: null },

  // 🗺️ Structured location
  location: {
    region: { type: String },
    district: { type: String },
    city: { type: String },
    formattedAddress: { type: String },
  },
  locationName: { type: String }, // human-readable location
  geoLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0],
    },
  },

  profilePicture: { type: String },

  // Craftsman-specific fields
  experience: { type: Number, default: 0 },
  skills: [String],
  cvPath: String,
  coverLetterPath: String,
  profile: {
    communication: { type: Number, default: 0 },
    technicalSkill: { type: Number, default: 0 },
    punctuality: { type: Number, default: 0 },
    quality: { type: Number, default: 0 },
    safety: { type: Number, default: 0 },
  },

  // ⭐ Feedbacks from employers
  feedbacks: [
    {
      employerName: { type: String, required: true },
      rating: { type: Number, required: true, min: 1, max: 5 },
      comment: { type: String },
      date: { type: Date, default: Date.now },
    },
  ],

  // 💰 Optional: platform balance for admin (derived from transactions)
  balance: { type: Number, default: 0 },
});

// Geospatial index for distance queries
userSchema.index({ geoLocation: "2dsphere" });

const User = mongoose.model("User", userSchema);
module.exports = User;
