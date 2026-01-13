const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// TEST THE CONNECTION IMMEDIATELY ON STARTUP
pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ FATAL: Could not connect to PostgreSQL!', err.stack);
    }
    console.log('🐘 Connection Verified: Successfully linked to database:', process.env.DB_NAME);
    release();
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};