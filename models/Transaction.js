const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    // Type of transaction
    type: {
      type: String,
      enum: ["deposit", "disbursement", "fee", "admin_withdrawal"],
      required: true,
    },

    // Job related to this transaction
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },

    // User involved (employer for deposits, craftsman for disbursement, admin for withdrawal)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Payment gateway references
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
      default: undefined,
    },
    gatewayRef: {
      type: String,
      unique: true,
      sparse: true,
      required: true, // ✅ always required
    },

    // Status
    status: {
      type: String,
      enum: [
        "PENDING",
        "COMPLETED",
        "FAILED",
        "DISBURSEMENT_INITIATED",
        "DISBURSEMENT_COMPLETED",
        "PAID_TO_CRAFTSMAN",
      ],
      default: "PENDING",
    },

    // Amounts
    total_amount: { type: Number }, // total paid by employer / withdrawn by admin
    commission_amount: { type: Number }, // 10% platform fee
    disbursement_amount: { type: Number }, // 90% craftsman share

    // Phone numbers
    employer_phone: { type: String },
    craftsman_phone: { type: String },

    // Payment method & references
    payment_method: { type: String },
    payment_reference: { type: String }, // Flutterwave payment reference
    disbursement_reference: { type: String }, // Flutterwave transfer reference
    external_transaction_id: { type: String },
    webhook_received_at: { type: Date },

    // Who confirmed payout
    confirmed_by: { type: String, enum: ["employer", "admin"] },

    // Link to parent transaction (e.g., disbursement -> deposit)
    relatedTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
    },

    // Time when money was actually paid out
    paid_at: { type: Date },
  },
  { timestamps: true }
);

// Pre-save middleware: always ensure gatewayRef is set
transactionSchema.pre("validate", function (next) {
  if (!this.gatewayRef) {
    this.gatewayRef = `tx_${this.type}_${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}`;
  }
  next();
});

// Export the model
const Transaction = mongoose.model("Transaction", transactionSchema);
module.exports = Transaction;
