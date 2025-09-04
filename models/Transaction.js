const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Type of transaction (deposit, disbursement, or system fee)
  type: {
    type: String,
    enum: ['deposit', 'disbursement', 'fee'],
    required: true
  },

  // The job this transaction is related to
  job: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Job', 
    required: true 
  },

  // The user involved in the transaction
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },

  // Unique reference from the payment gateway (e.g., Flutterwave's flwRef or tx_ref)
  transactionId: { 
    type: String, 
    unique: true,
    sparse: true // Allows multiple documents to have null values
  },

  gatewayRef: { 
    type: String, 
    unique: true,
    sparse: true // Allows multiple documents to have null values
  },

  // Status of the transaction
  status: {
    type: String,
    enum: [
      'PENDING',
      'COMPLETED',
      'FAILED',
      'DISBURSEMENT_INITIATED',
      'DISBURSEMENT_COMPLETED'
    ],
    default: 'PENDING'
  },

  // Amounts
  total_amount: { type: Number },
  commission_amount: { type: Number },
  disbursement_amount: { type: Number },

  // Phone numbers involved
  employer_phone: { type: String },
  craftsman_phone: { type: String },

  // Payment and disbursement references
  payment_method: { type: String },
  payment_reference: { type: String },
  disbursement_reference: { type: String },
  external_transaction_id: { type: String },
  webhook_received_at: { type: Date },

  // A link to a related transaction (e.g., disbursement references parent deposit)
  relatedTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }

}, { timestamps: true });

// Export the model
const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
