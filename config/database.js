const { Pool } = require('pg');

// Create the connection configuration object
let dbConfig;

// Use the NODE_ENV variable to determine the environment.
// This is a more robust check than relying on the presence of a variable.
if (process.env.NODE_ENV === 'production') {
  // Use a single connection string for production (Render)
  dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  };
} else {
  // This block runs ONLY in local development
  // It requires dotenv and individual variables
  require('dotenv').config();
  dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: false
  };
}

const pool = new Pool(dbConfig);

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
  // Log the environment variables being used to aid in debugging
  console.error('Debug Info - NODE_ENV:', process.env.NODE_ENV);
  console.error('Debug Info - DATABASE_URL:', process.env.DATABASE_URL);
  console.error('Debug Info - DB_HOST:', process.env.DB_HOST);
  process.exit(-1);
});

// Initialize database tables
const initDatabase = async () => {
  try {
    // Create transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(255) UNIQUE NOT NULL,
        case_id INTEGER NOT NULL,
        employer_id INTEGER NOT NULL,
        craftsman_id INTEGER NOT NULL,
        total_amount DECIMAL(15, 2) NOT NULL,
        commission_amount DECIMAL(15, 2),
        disbursement_amount DECIMAL(15, 2),
        employer_phone VARCHAR(20) NOT NULL,
        craftsman_phone VARCHAR(20) NOT NULL,
        payment_method VARCHAR(20) NOT NULL,
        payment_reference VARCHAR(255),
        disbursement_reference VARCHAR(255),
        status VARCHAR(50) DEFAULT 'PENDING',
        external_transaction_id VARCHAR(255),
        webhook_received_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create payment_logs table for audit trail
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_logs (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        request_data JSONB,
        response_data JSONB,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_case_id ON transactions(case_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_payment_logs_transaction_id ON payment_logs(transaction_id);
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

module.exports = {
  pool,
  initDatabase,
  query: (text, params) => pool.query(text, params)
};
