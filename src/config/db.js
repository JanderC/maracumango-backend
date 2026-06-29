const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

// Manejo de errores en el pool para evitar crash
pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message);
  // No lanzar el error — evita que el servidor se caiga
});

pool.connect()
  .then(client => {
    console.log('✅ Conectado a PostgreSQL - maracumango');
    client.release();
  })
  .catch(err => console.error('❌ Error conectando a PostgreSQL:', err.message));

module.exports = pool;