const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: String, required: true, index: true }, 
    transactionId: { type: String }, // removed unique constraint
    flwRef: { type: String, required: true, unique: true }, 
    status: {
        type: String,
        enum: ['PENDING','COMPLETED','FAILED','DISBURSEMENT_INITIATED','DISBURSEMENT_COMPLETED'],
        default: 'PENDING'
    },
    total_amount: { type: Number, required: true },
    commission_amount: { type: Number, required: true },
    disbursement_amount: { type: Number, required: true },
    employer_phone: { type: String, required: true },
    craftsman_phone: { type: String, required: true },
    payment_method: { type: String },
    payment_reference: { type: String },
    disbursement_reference: { type: String },
    external_transaction_id: { type: String },
    webhook_received_at: { type: Date }
}, { timestamps: true });

transactionSchema.statics.findByTransactionId = function(transactionId) {
    return this.findOne({ transactionId });
};
transactionSchema.statics.findByJobId = function(jobId) {
    return this.find({ jobId });
};
transactionSchema.statics.findByFlwRef = function(flwRef) {
    return this.findOne({ flwRef });
};

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
