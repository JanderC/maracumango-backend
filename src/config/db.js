const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(() => console.log('✅ Conectado a PostgreSQL - maracumango'))
  .catch(err => console.error('❌ Error conectando a PostgreSQL:', err.message));

module.exports = pool;