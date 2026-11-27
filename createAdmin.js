process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const bcrypt = require('bcrypt');
const { createClient } = require('@libsql/client');

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function crearAdmin() {
  const nombre = 'Admin Principal';
  const email = 'admin@community360.com';
  const passwordPlano = 'admin123';
  const creadoEn = new Date().toISOString();

  try {
    const existente = await turso.execute({
      sql: 'SELECT id_admin, nombre, email FROM administradores WHERE LOWER(email) = LOWER(?) LIMIT 1',
      args: [email],
    });

    if (existente.rows.length > 0) {
      console.log('El administrador ya existe en Turso:', existente.rows[0]);
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(passwordPlano, 10);

    const resultado = await turso.execute({
      sql: `INSERT INTO administradores (nombre, email, password_hash, creado_en)
            VALUES (?, ?, ?, ?)`,
      args: [nombre, email, passwordHash, creadoEn],
    });

    console.log('Administrador creado correctamente en Turso:', {
      id_admin: Number(resultado.lastInsertRowid),
      nombre,
      email,
      creado_en: creadoEn,
    });
    process.exit(0);
  } catch (error) {
    console.error('Error al crear el administrador:', error);
    process.exit(1);
  }
}

crearAdmin();
