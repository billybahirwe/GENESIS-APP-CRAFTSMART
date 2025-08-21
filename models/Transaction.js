// D:\GENESIS\GENESIS-APP-CRAFTSMART\project\models\Transaction.js

const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Transaction {
  static async create(transactionData) {
    const {
      caseId,
      employerId,
      craftsmanId,
      totalAmount,
      employerPhone,
      craftsmanPhone,
      paymentMethod
    } = transactionData;

    const transactionId = uuidv4();
    const commissionRate = parseFloat(process.env.ADMIN_COMMISSION_RATE || '0.10');
    const commissionAmount = totalAmount * commissionRate;
    const disbursementAmount = totalAmount - commissionAmount;

    const query = `
      INSERT INTO transactions (
        transaction_id, case_id, employer_id, craftsman_id, 
        total_amount, commission_amount, disbursement_amount,
        employer_phone, craftsman_phone, payment_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      transactionId, caseId, employerId, craftsmanId,
      totalAmount, commissionAmount, disbursementAmount,
      employerPhone, craftsmanPhone, paymentMethod, 'PENDING'
    ];

    try {
      const result = await db.query(query, values);
      console.log('✅ Transaction created:', transactionId);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error creating transaction:', error);
      throw error;
    }
  }

  // New static method to find a transaction by case_id
  static async findByCaseId(caseId) {
    const query = 'SELECT * FROM transactions WHERE case_id = $1';
    try {
      const result = await db.query(query, [caseId]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error finding transaction by case ID:', error);
      throw error;
    }
  }

  static async findByTransactionId(transactionId) {
    const query = 'SELECT * FROM transactions WHERE transaction_id = $1';
    try {
      const result = await db.query(query, [transactionId]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error finding transaction:', error);
      throw error;
    }
  }

  static async updateStatus(transactionId, updateData) {
    const {
      status,
      paymentReference,
      disbursementReference,
      externalTransactionId,
      webhookReceivedAt
    } = updateData;

    let query = 'UPDATE transactions SET updated_at = CURRENT_TIMESTAMP';
    const values = [];
    let paramCount = 0;

    if (status) {
      query += `, status = $${++paramCount}`;
      values.push(status);
    }

    if (paymentReference) {
      query += `, payment_reference = $${++paramCount}`;
      values.push(paymentReference);
    }

    if (disbursementReference) {
      query += `, disbursement_reference = $${++paramCount}`;
      values.push(disbursementReference);
    }

    if (externalTransactionId) {
      query += `, external_transaction_id = $${++paramCount}`;
      values.push(externalTransactionId);
    }

    if (webhookReceivedAt) {
      query += `, webhook_received_at = $${++paramCount}`;
      values.push(webhookReceivedAt);
    }

    query += ` WHERE transaction_id = $${++paramCount} RETURNING *`;
    values.push(transactionId);

    try {
      const result = await db.query(query, values);
      console.log('✅ Transaction updated:', transactionId, 'Status:', status);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error updating transaction:', error);
      throw error;
    }
  }

  static async getAllTransactions(limit = 50, offset = 0) {
    const query = `
      SELECT * FROM transactions 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `;
    try {
      const result = await db.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching transactions:', error);
      throw error;
    }
  }

  static async getTransactionsByStatus(status) {
    const query = 'SELECT * FROM transactions WHERE status = $1 ORDER BY created_at DESC';
    try {
      const result = await db.query(query, [status]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching transactions by status:', error);
      throw error;
    }
  }
}

module.exports = Transaction;
