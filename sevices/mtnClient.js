const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const PaymentLog = require('../models/PaymentLog');

class MTNClient {
  constructor() {
    this.baseURL = process.env.MTN_BASE_URL;
    this.subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY;
    this.apiUser = process.env.MTN_API_USER;
    this.apiKey = process.env.MTN_API_KEY;
    this.targetEnvironment = process.env.MTN_TARGET_ENVIRONMENT;
    this.callbackUrl = process.env.MTN_CALLBACK_URL;
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
      
      const response = await axios.post(
        `${this.baseURL}/collection/token/`,
        {},
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Target-Environment': this.targetEnvironment
          }
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiration time (expires_in is in seconds, convert to milliseconds)
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 minute buffer

      return this.accessToken;
    } catch (error) {
      console.error('Error getting MTN access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with MTN API');
    }
  }

  async requestToPay(transactionId, amount, phoneNumber, message = 'Payment for SmartCraft service') {
    try {
      const token = await this.getAccessToken();
      const referenceId = uuidv4();

      // Format phone number (remove + and ensure it starts with country code)
      const formattedPhone = phoneNumber.replace(/^\+?/, '').replace(/^0/, '256');

      const requestData = {
        amount: amount.toString(),
        currency: 'UGX',
        externalId: transactionId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: formattedPhone
        },
        payerMessage: message,
        payeeNote: `SmartCraft payment for transaction ${transactionId}`
      };

      await PaymentLog.create({
        transactionId,
        action: 'MTN_REQUEST_TO_PAY',
        status: 'INITIATED',
        requestData
      });

      const response = await axios.post(
        `${this.baseURL}/collection/v1_0/requesttopay`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Reference-Id': referenceId,
            'X-Target-Environment': this.targetEnvironment,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/json',
            'X-Callback-Url': this.callbackUrl
          }
        }
      );

      await PaymentLog.create({
        transactionId,
        action: 'MTN_REQUEST_TO_PAY',
        status: 'SUCCESS',
        responseData: { referenceId, status: response.status }
      });

      return { success: true, referenceId, externalId: transactionId };
    } catch (error) {
      const errorMessage = error.response?.data || error.message;
      console.error('MTN Request to Pay error:', errorMessage);

      await PaymentLog.create({
        transactionId,
        action: 'MTN_REQUEST_TO_PAY',
        status: 'ERROR',
        errorMessage: JSON.stringify(errorMessage)
      });

      throw new Error(`MTN payment request failed: ${JSON.stringify(errorMessage)}`);
    }
  }

  async transfer(transactionId, amount, phoneNumber, message = 'SmartCraft craftsman payment') {
    try {
      const token = await this.getAccessToken();
      const referenceId = uuidv4();

      // Format phone number
      const formattedPhone = phoneNumber.replace(/^\+?/, '').replace(/^0/, '256');

      const requestData = {
        amount: amount.toString(),
        currency: 'UGX',
        externalId: `${transactionId}-disbursement`,
        payee: {
          partyIdType: 'MSISDN',
          partyId: formattedPhone
        },
        payerMessage: message,
        payeeNote: `SmartCraft craftsman payment for transaction ${transactionId}`
      };

      await PaymentLog.create({
        transactionId,
        action: 'MTN_TRANSFER',
        status: 'INITIATED',
        requestData
      });

      const response = await axios.post(
        `${this.baseURL}/disbursement/v1_0/transfer`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Reference-Id': referenceId,
            'X-Target-Environment': this.targetEnvironment,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/json'
          }
        }
      );

      await PaymentLog.create({
        transactionId,
        action: 'MTN_TRANSFER',
        status: 'SUCCESS',
        responseData: { referenceId, status: response.status }
      });

      return { success: true, referenceId, externalId: `${transactionId}-disbursement` };
    } catch (error) {
      const errorMessage = error.response?.data || error.message;
      console.error('MTN Transfer error:', errorMessage);

      await PaymentLog.create({
        transactionId,
        action: 'MTN_TRANSFER',
        status: 'ERROR',
        errorMessage: JSON.stringify(errorMessage)
      });

      throw new Error(`MTN transfer failed: ${JSON.stringify(errorMessage)}`);
    }
  }

  async getTransactionStatus(referenceId) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${this.baseURL}/collection/v1_0/requesttopay/${referenceId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Target-Environment': this.targetEnvironment,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error getting MTN transaction status:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new MTNClient();