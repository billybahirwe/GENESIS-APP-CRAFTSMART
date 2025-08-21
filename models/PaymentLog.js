// ./models/PaymentLog.js
const db = require('../config/database');

class PaymentLog {
  /**
   * Creates a new log entry for a payment transaction.
   * @param {object} logData - The data for the log entry.
   * @param {string} logData.transactionId - The ID of the transaction.
   * @param {string} logData.action - The action being logged (e.g., 'INITIATE', 'WEBHOOK_UPDATE', 'ERROR').
   * @param {string} logData.status - The status of the transaction at the time of logging.
   * @param {object} logData.requestData - The raw request data from the API call.
   * @param {object} logData.responseData - The raw response data from the API call.
   * @param {string} [logData.errorMessage] - An optional error message.
   * @returns {Promise<object>} The newly created payment log record.
   */
  static async create(logData) {
    const {
      transactionId,
      action,
      status,
      requestData,
      responseData,
      errorMessage
    } = logData;

    const query = `
      INSERT INTO payment_logs (
        transaction_id, action, status, request_data, 
        response_data, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      transactionId,
      action,
      status,
      requestData ? JSON.stringify(requestData) : null,
      responseData ? JSON.stringify(responseData) : null,
      errorMessage
    ];

    try {
      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error creating payment log:', error);
      throw error;
    }
  }

  static async getLogsByTransaction(transactionId) {
    const query = `
      SELECT * FROM payment_logs 
      WHERE transaction_id = $1 
      ORDER BY created_at DESC
    `;
    try {
      const result = await db.query(query, [transactionId]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching payment logs:', error);
      throw error;
    }
  }

  static async getLogs(limit = 100, offset = 0) {
    const query = `
      SELECT * FROM payment_logs
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    try {
      const result = await db.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching all payment logs:', error);
      throw error;
    }
  }
}

module.exports = PaymentLog;
