const { Pool } = require('pg');
require('dotenv').config();

// Use the connectionString for a cleaner setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        // Required for Supabase external connections
        rejectUnauthorized: false 
    }
});

// TEST THE CONNECTION IMMEDIATELY ON STARTUP
pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ FATAL: Could not connect to Supabase!', err.stack);
    }
    console.log('🐘 Connection Verified: Successfully linked to Supabase PostgreSQL.');
    release();
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};
