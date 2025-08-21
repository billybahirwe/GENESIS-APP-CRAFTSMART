const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const PaymentLog = require('../models/PaymentLog');

class AirtelClient {
  constructor() {
    this.baseURL = process.env.AIRTEL_BASE_URL;
    this.clientId = process.env.AIRTEL_CLIENT_ID;
    this.clientSecret = process.env.AIRTEL_CLIENT_SECRET;
    this.callbackUrl = process.env.AIRTEL_CALLBACK_URL;
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        `${this.baseURL}/auth/oauth2/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 minute buffer

      return this.accessToken;
    } catch (error) {
      console.error('Error getting Airtel access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Airtel API');
    }
  }

  async requestToPay(transactionId, amount, phoneNumber, message = 'Payment for SmartCraft service') {
    try {
      const token = await this.getAccessToken();
      const referenceId = uuidv4();

      // Format phone number for Airtel Uganda
      const formattedPhone = phoneNumber.replace(/^\+?/, '').replace(/^0/, '256');

      const requestData = {
        reference: referenceId,
        subscriber: {
          country: 'UG',
          currency: 'UGX',
          msisdn: formattedPhone
        },
        transaction: {
          amount: amount.toString(),
          country: 'UG',
          currency: 'UGX',
          id: transactionId
        }
      };

      await PaymentLog.create({
        transactionId,
        action: 'AIRTEL_REQUEST_TO_PAY',
        status: 'INITIATED',
        requestData
      });

      const response = await axios.post(
        `${this.baseURL}/merchant/v1/payments/`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Country': 'UG',
            'X-Currency': 'UGX'
          }
        }
      );

      await PaymentLog.create({
        transactionId,
        action: 'AIRTEL_REQUEST_TO_PAY',
        status: 'SUCCESS',
        responseData: response.data
      });

      return { success: true, referenceId, data: response.data };
    } catch (error) {
      const errorMessage = error.response?.data || error.message;
      console.error('Airtel Request to Pay error:', errorMessage);

      await PaymentLog.create({
        transactionId,
        action: 'AIRTEL_REQUEST_TO_PAY',
        status: 'ERROR',
        errorMessage: JSON.stringify(errorMessage)
      });

      throw new Error(`Airtel payment request failed: ${JSON.stringify(errorMessage)}`);
    }
  }

  async transfer(transactionId, amount, phoneNumber, message = 'SmartCraft craftsman payment') {
    try {
      const token = await this.getAccessToken();
      const referenceId = uuidv4();

      // Format phone number
      const formattedPhone = phoneNumber.replace(/^\+?/, '').replace(/^0/, '256');

      const requestData = {
        payee: {
          msisdn: formattedPhone
        },
        reference: referenceId,
        pin: process.env.AIRTEL_PIN, // You'll need to set this in env
        transaction: {
          amount: amount.toString(),
          id: `${transactionId}-disbursement`
        }
      };

      await PaymentLog.create({
        transactionId,
        action: 'AIRTEL_TRANSFER',
        status: 'INITIATED',
        requestData
      });

      const response = await axios.post(
        `${this.baseURL}/standard/v1/disbursements/`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Country': 'UG',
            'X-Currency': 'UGX'
          }
        }
      );

      await PaymentLog.create({
        transactionId,
        action: 'AIRTEL_TRANSFER',
        status: 'SUCCESS',
        responseData: response.data
      });

      return { success: true, referenceId, data: response.data };
    } catch (error) {
      const errorMessage = error.response?.data || error.message;
      console.error('Airtel Transfer error:', errorMessage);

      await PaymentLog.create({
        transactionId,
        action: 'AIRTEL_TRANSFER',
        status: 'ERROR',
        errorMessage: JSON.stringify(errorMessage)
      });

      throw new Error(`Airtel transfer failed: ${JSON.stringify(errorMessage)}`);
    }
  }
}

module.exports = new AirtelClient();