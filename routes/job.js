// routes/job.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

// Import your Mongoose models
const Job = require("../models/job");
const User = require("../models/user");
const Transaction = require("../models/Transaction");

/**
 * Helper to build Flutterwave payout payload
 */
function buildPayoutPayload({ phone, amount, reference, narration, name }) {
  const cleanPhone = phone.replace(/^\+/, ""); // remove leading +
  return {
    account_bank: "MPS",
    account_number: cleanPhone,
    amount,
    currency: "UGX",
    narration,
    reference,
    beneficiary_name: name || "Beneficiary",
  };
}

/**
 * Employer confirms job completion → craftsman gets 90%, platform keeps 10%
 */
router.post("/:jobId/confirm", async (req, res) => {
  try {
    const { jobId } = req.params;
    const { employerId } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "paid-in-escrow") return res.status(400).json({ error: "Job not ready for payout" });
    if (String(job.employerId) !== employerId) return res.status(403).json({ error: "Not authorized to confirm this job" });

    const craftsman = await User.findById(job.craftsmanId);
    if (!craftsman) return res.status(404).json({ error: "Craftsman not found" });

    const transaction = await Transaction.findOne({ job: job._id, status: "COMPLETED" });
    if (!transaction) return res.status(400).json({ error: "Escrow transaction not found" });

    const totalAmount = transaction.total_amount;
    const platformFee = Math.round(totalAmount * 0.1);
    const craftsmanShare = totalAmount - platformFee;

    const payoutPayload = buildPayoutPayload({
      phone: craftsman.mobile,
      amount: craftsmanShare,
      reference: `payout_${Date.now()}_${jobId}`,
      narration: `Payment for job ${job.title}`,
      name: craftsman.name,
    });

    const fwResponse = await axios.post("https://api.flutterwave.com/v3/transfers", payoutPayload, {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (fwResponse.data.status === "success") {
      transaction.status = "PAID_TO_CRAFTSMAN";
      transaction.commission_amount = platformFee;
      transaction.disbursement_amount = craftsmanShare;
      transaction.disbursement_reference = fwResponse.data.data.id;
      transaction.confirmed_by = "employer";
      transaction.paid_at = new Date();
      await transaction.save();

      await Job.updateOne({ _id: job._id }, { status: "completed" });

      return res.render("transaction-success", { transaction });
    } else {
      return res.status(500).json({ error: "❌ Payout failed", details: fwResponse.data });
    }
  } catch (err) {
    console.error("❌ Employer confirm error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

/**
 * Admin emergency confirm → craftsman gets paid directly
 */
router.post("/:jobId/admin-confirm", async (req, res) => {
  try {
    const { jobId } = req.params;
    const { adminId } = req.body;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Not authorized" });

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "paid-in-escrow") return res.status(400).json({ error: "Job not ready for payout" });

    const craftsman = await User.findById(job.craftsmanId);
    if (!craftsman) return res.status(404).json({ error: "Craftsman not found" });

    const transaction = await Transaction.findOne({ job: job._id, status: "COMPLETED" });
    if (!transaction) return res.status(400).json({ error: "Escrow transaction not found" });

    const totalAmount = transaction.total_amount;
    const platformFee = Math.round(totalAmount * 0.1);
    const craftsmanShare = totalAmount - platformFee;

    const payoutPayload = buildPayoutPayload({
      phone: craftsman.mobile,
      amount: craftsmanShare,
      reference: `admin_emergency_${Date.now()}_${jobId}`,
      narration: `Emergency payout for job ${job.title}`,
      name: craftsman.name || "Craftsman",
    });

    const fwResponse = await axios.post("https://api.flutterwave.com/v3/transfers", payoutPayload, {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (fwResponse.data.status === "success") {
      transaction.status = "PAID_TO_CRAFTSMAN";
      transaction.commission_amount = platformFee;
      transaction.disbursement_amount = craftsmanShare;
      transaction.disbursement_reference = fwResponse.data.data.id;
      transaction.confirmed_by = "admin";
      transaction.paid_at = new Date();
      await transaction.save();

      await Job.updateOne({ _id: job._id }, { status: "completed" });

      return res.render("transaction-success", { transaction });
    } else {
      return res.status(500).json({ error: "❌ Emergency payout failed", details: fwResponse.data });
    }
  } catch (err) {
    console.error("❌ Admin emergency payout error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

/**
 * Admin withdraw platform fees
 */
router.post("/admin/withdraw", async (req, res) => {
  try {
    const { adminId, amount, phoneNumber } = req.body;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Not authorized" });
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const payoutPayload = buildPayoutPayload({
      phone: phoneNumber,
      amount,
      reference: `admin_withdraw_${Date.now()}_${adminId}`,
      narration: "Admin withdrawal of platform fees",
      name: admin.name || "Admin",
    });

    const fwResponse = await axios.post("https://api.flutterwave.com/v3/transfers", payoutPayload, {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (fwResponse.data.status === "success") {
      const transaction = new Transaction({
        type: "admin_withdrawal",
        user: admin._id,
        total_amount: amount,
        status: "COMPLETED",
        disbursement_reference: fwResponse.data.data.id,
        paid_at: new Date(),
        gatewayRef: `tx_admin_withdrawal_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      });
      await transaction.save();

      // ✅ Render success Pug view instead of JSON
      return res.render("admin/withdraw-success", { transaction });
    } else {
      return res.status(500).json({ error: "❌ Withdrawal failed", details: fwResponse.data });
    }
  } catch (err) {
    console.error("❌ Admin withdrawal error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

/**
 * Admin dashboard routes
 */
router.get("/admin/summary", async (req, res) => {
  try {
    const { adminId } = req.query;
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).send("Not authorized");

    const totalFees = await Transaction.aggregate([
      { $match: { status: "PAID_TO_CRAFTSMAN" } },
      { $group: { _id: null, total: { $sum: "$commission_amount" } } },
    ]);

    const withdrawn = await Transaction.aggregate([
      { $match: { type: "admin_withdrawal", status: "COMPLETED" } },
      { $group: { _id: null, total: { $sum: "$total_amount" } } },
    ]);

    const pendingFees = (totalFees[0]?.total || 0) - (withdrawn[0]?.total || 0);

    res.render("admin/platform-summary", {
      platformSummary: {
        totalPlatformFees: totalFees[0]?.total || 0,
        withdrawn: withdrawn[0]?.total || 0,
        availableForWithdraw: pendingFees,
      },
      adminId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.get("/admin/escrow", async (req, res) => {
  try {
    const { adminId } = req.query;
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).send("Not authorized");

    const jobs = await Job.find({ status: "paid-in-escrow" }).populate("employerId craftsmanId").lean();

    const pendingEscrowJobs = jobs.map(job => ({
      jobId: job._id,
      title: job.title,
      employer: job.employerId?.name,
      craftsman: job.craftsmanId?.name,
      status: job.status,
    }));

    res.render("admin/escrow-jobs", { pendingEscrowJobs, adminId });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.get("/admin/completed", async (req, res) => {
  try {
    const { adminId } = req.query;
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).send("Not authorized");

    const transactions = await Transaction.find({ status: "PAID_TO_CRAFTSMAN" }).populate("job user").lean();

    const completedPayouts = transactions.map(t => ({
      jobId: t.job?._id,
      jobTitle: t.job?.title,
      craftsman: t.user?.name,
      craftsmanPhone: t.craftsman_phone,
      amountPaid: t.disbursement_amount,
      platformFee: t.commission_amount,
      confirmedBy: t.confirmed_by || "employer",
      paidAt: t.paid_at,
    }));

    res.render("admin/completed-payouts", { completedPayouts, adminId });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.get("/admin/actions", async (req, res) => {
  try {
    const { adminId } = req.query;
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).send("Not authorized");

    const actions = await Transaction.find({
      $or: [{ type: "admin_withdrawal" }, { confirmed_by: "admin" }],
    }).lean();

    const adminActions = actions.map(a => ({
      type: a.type || "emergency_confirm",
      amount: a.total_amount || a.disbursement_amount,
      reference: a.disbursement_reference,
      date: a.paid_at,
    }));

    res.render("admin/admin-actions", { adminActions, adminId });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
