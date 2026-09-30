// Ejecuta los scripts .sql de esta carpeta en orden contra DATABASE_URL.
// Uso: node database/migrar.js            (todos)
//      node database/migrar.js 001_caja   (solo los que contengan ese texto)
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const pool = require('../src/config/db');

(async () => {
  const filtro = process.argv[2] || '';
  const archivos = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql') && f.includes(filtro))
    .sort();

  if (archivos.length === 0) {
    console.log('No hay scripts para ejecutar');
    return;
  }

  for (const archivo of archivos) {
    const sql = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
    process.stdout.write(`▶ ${archivo} ... `);
    await pool.query(sql);
    console.log('✅');
  }
})()
  .catch(err => { console.error('\n❌ Error en la migración:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
