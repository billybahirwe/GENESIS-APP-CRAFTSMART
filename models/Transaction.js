// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\models\Transaction.js

const mongoose = require('mongoose');

// Define the schema for the Transaction model
const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Reference to the User model
        required: true
    },
    jobId: {
        type: String, // Changed from ObjectId to String
        required: true,
        unique: true,
        index: true
    },
    transactionId: {
        type: String,
        unique: true, // Ensures each transaction has a unique ID
        required: true
    },
    status: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'FAILED', 'DISBURSEMENT_INITIATED', 'DISBURSEMENT_COMPLETED'],
        default: 'PENDING'
    },
    total_amount: {
        type: Number,
        required: true
    },
    commission_amount: {
        type: Number,
        required: true
    },
    disbursement_amount: {
        type: Number,
        required: true
    },
    employer_phone: {
        type: String,
        required: true
    },
    craftsman_phone: {
        type: String,
        required: true
    },
    payment_method: {
        type: String
    },
    payment_reference: {
        type: String
    },
    disbursement_reference: {
        type: String
    },
    external_transaction_id: {
        type: String
    },
    webhook_received_at: {
        type: Date
    }
}, {
    timestamps: true // Adds createdAt and updatedAt timestamps automatically
});

// Create a static method to find a transaction by its transactionId
transactionSchema.statics.findByTransactionId = async function(transactionId) {
    return this.findOne({ transactionId });
};

// Create a static method to find a transaction by its jobId
transactionSchema.statics.findByJobId = async function(jobId) {
    return this.findOne({ jobId });
};

// Create the Mongoose model and export it
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
