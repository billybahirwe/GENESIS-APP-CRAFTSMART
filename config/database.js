const { Pool } = require('pg');

// This conditional logic ensures dotenv is only used in a local environment
// when the DATABASE_URL environment variable is NOT present.
// This prevents it from overwriting the production environment variables on Render.
if (!process.env.DATABASE_URL) {
  require('dotenv').config();
}

// Create the connection configuration object
let dbConfig;
if (process.env.DATABASE_URL) {
  // Use a single connection string for production (Render)
  dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  };
} else {
  // Fallback to individual variables for local development
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
