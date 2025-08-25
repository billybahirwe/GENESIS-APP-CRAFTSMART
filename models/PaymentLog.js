// ./models/PaymentLog.js

const mongoose = require('mongoose');

// Define the schema for the PaymentLog model
const paymentLogSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        index: true // Indexing this field for faster queries
    },
    action: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true
    },
    requestData: {
        type: mongoose.Schema.Types.Mixed, // Use Mixed type for flexible JSON data
        required: false
    },
    responseData: {
        type: mongoose.Schema.Types.Mixed, // Use Mixed type for flexible JSON data
        required: false
    },
    errorMessage: {
        type: String,
        required: false
    }
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Create the Mongoose model from the schema
const PaymentLog = mongoose.model('PaymentLog', paymentLogSchema);

// Define static methods on the model for common queries
PaymentLog.createLog = async function(logData) {
    try {
        const newLog = await this.create(logData);
        console.log('✅ Payment log created for transaction:', newLog.transactionId);
        return newLog;
    } catch (error) {
        console.error('❌ Error creating payment log:', error);
        throw error;
    }
};

PaymentLog.getLogsByTransaction = async function(transactionId) {
    try {
        const logs = await this.find({ transactionId }).sort({ createdAt: -1 });
        return logs;
    } catch (error) {
        console.error('❌ Error fetching payment logs:', error);
        throw error;
    }
};

PaymentLog.getLogs = async function(limit = 100, offset = 0) {
    try {
        const logs = await this.find()
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit);
        return logs;
    } catch (error) {
        console.error('❌ Error fetching all payment logs:', error);
        throw error;
    }
};

module.exports = PaymentLog;
