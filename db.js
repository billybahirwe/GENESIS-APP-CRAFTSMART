// This file connects to MongoDB Atlas using the Mongoose library.
const mongoose = require('mongoose');

// The single, clean function to connect to the database.
const connectDB = async () => {
  try {
    // Corrected: The connection string is retrieved from the .env file.
    // Removed deprecated options as they are no longer necessary in modern Mongoose.
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected successfully to MongoDB Atlas!');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1); // Exit process with a failure code
  }
};

module.exports = connectDB;
