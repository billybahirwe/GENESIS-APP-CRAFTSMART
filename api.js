// api.js

/**
 * Node.js script to initiate a mobile money payment using the Flutterwave-node-v3 SDK.
 * This script demonstrates how to load API keys from a .env file and make a
 * server-side API call with proper authentication headers handled by the SDK.
 */

// --- Imports and Configuration ---
// Load environment variables from a .env file
try {
  require('dotenv').config();
} catch (e) {
  console.error("❌ Error loading .env file. Please make sure it exists.");
  process.exit(1);
}

// Import UUID for generating a unique transaction reference
const { v4: uuidv4 } = require('uuid');

// Import the official Flutterwave Node.js SDK
const Flutterwave = require('flutterwave-node-v3');

// Initialize the Flutterwave SDK with your public and secret keys
// The third argument, "TEST", tells the SDK to use the sandbox environment.
const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY,
  "TEST" // <-- This is the crucial line to add
);

// --- Flutterwave Mobile Money Functions ---

/**
 * Initiates a mobile money payment in Uganda using Flutterwave's API.
 * @param {number} amount - The amount to charge (in UGX).
 * @param {string} phoneNumber - The customer's mobile money phone number.
 * @param {string} network - The mobile money network ("MTN" or "AIRTEL").
 * @returns {Promise<object>} The response data from the Flutterwave API.
 */
async function initiateFlutterwaveMobileMoneyPayment(amount, phoneNumber, network) {
  try {
    // Generate a unique transaction reference for this payment
    const tx_ref = uuidv4();

    // The payload for the Flutterwave API call
    const payload = {
      phone_number: phoneNumber,
      network: network, // "MTN" or "AIRTEL"
      amount: amount,
      currency: 'UGX',
      email: 'customer@email.com', // Replace with a dynamic customer email
      tx_ref: tx_ref,
      fullname: 'Customer Name', // Replace with a dynamic customer name
      redirect_url: 'https://your-app.com/payment/callback', // Replace with your webhook or redirect URL
    };

    // Call the Flutterwave Mobile Money API for Uganda
    const response = await flw.MobileMoney.uganda(payload);

    if (response.status === 'success') {
      console.log(`✅ Flutterwave: Payment request sent successfully. Transaction ID: ${response.data.tx_ref}`);
      return response.data;
    } else {
      console.error('❌ Flutterwave: Payment initiation failed:', response.message);
      throw new Error(`Flutterwave payment initiation failed: ${response.message}`);
    }
  } catch (error) {
    // Log the specific error from the API response if available
    console.error('An error occurred during payment initiation:', error.message);
    throw new Error('Flutterwave payment initiation failed');
  }
}

// --- Example Usage ---

/**
 * Main function to demonstrate the payment initiation process for both networks.
 */
async function main() {
  // Check if keys are loaded before proceeding
  if (!process.env.FLW_PUBLIC_KEY || !process.env.FLW_SECRET_KEY) {
    console.error("❌ API keys not found. Please check your .env file.");
    return;
  }

  try {
    // Example for MTN Uganda
    const mtnResponse = await initiateFlutterwaveMobileMoneyPayment(10000, '25677xxxxxxx', 'MTN');
    console.log('MTN Response:', mtnResponse);
    console.log('------------------------------------');

    // Example for Airtel Uganda
    const airtelResponse = await initiateFlutterwaveMobileMoneyPayment(5000, '2567xxxxxxx', 'AIRTEL');
    console.log('Airtel Response:', airtelResponse);
  } catch (error) {
    console.error('An error occurred in the main process:', error.message);
  }
}

// Execute the main function
main();
