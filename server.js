process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@libsql/client');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

io.on('connection', (socket) => {
  console.log(`Cliente WebSocket conectado: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Cliente WebSocket desconectado: ${socket.id}`);
  });
});

if (!JWT_SECRET) {
  console.error('Error: falta definir JWT_SECRET en el archivo .env');
  process.exit(1);
}

// ---------------------------------------------------------
// CONEXIONES A LA NUBE (TURSO SQL + FIREBASE FIRESTORE)
// ---------------------------------------------------------
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// --- BLOQUE TEMPORAL: INSERTAR ADMIN PARA ENTREGA FINAL ---
(async () => {
  const nombre = 'lizandro.reyes';
  const email = 'lizandro.reyes@utmetropolitana.edu.mx';
  const passwordPlano = 'lizandr0_reye$';

  try {
    const existe = await turso.execute({
      sql: 'SELECT id_admin FROM administradores WHERE LOWER(email) = LOWER(?) LIMIT 1',
      args: [email],
    });

    if (existe.rows.length > 0) {
      console.log(`El administrador '${nombre}' ya existe en Turso (id_admin: ${existe.rows[0].id_admin}).`);
      return;
    }

    const passwordHash = await bcrypt.hash(passwordPlano, 10);
    const creadoEn = new Date().toISOString();

    await turso.execute({
      sql: 'INSERT INTO administradores (nombre, email, password_hash, creado_en) VALUES (?, ?, ?, ?)',
      args: [nombre, email, passwordHash, creadoEn],
    });

    console.log(`Administrador '${nombre}' creado con éxito en Turso.`);
  } catch (error) {
    console.error(`Error al crear el administrador '${nombre}':`, error);
  }
})();
// --- FIN BLOQUE TEMPORAL ---

const serviceAccount = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT));
initializeApp({
  credential: cert(serviceAccount),
});
const dbFirestore = getFirestore();
dbFirestore.settings({ preferRest: true });

// ---------------------------------------------------------
// MIDDLEWARES GLOBALES
// ---------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// MIDDLEWARE DE PROTECCIÓN DE RUTAS (JWT)
// ---------------------------------------------------------
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Acceso denegado. Debes enviar el header Authorization: Bearer <token>.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: 'Token inválido o expirado.',
    });
  }
}

// ---------------------------------------------------------
// RUTAS (FASE 3 - AUTENTICACIÓN)
// ---------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: 'Debes enviar email y password en el cuerpo de la petición.',
      });
    }

    const emailLimpio = String(email).trim().toLowerCase();

    const resultado = await turso.execute({
      sql: 'SELECT id_admin, nombre, email, password_hash FROM administradores WHERE LOWER(email) = ? LIMIT 1',
      args: [emailLimpio],
    });

    if (resultado.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const admin = resultado.rows[0];
    const esValida = await bcrypt.compare(String(password), admin.password_hash);

    if (!esValida) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const payload = {
      id_admin: admin.id_admin,
      nombre: admin.nombre,
      email: admin.email,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

    return res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      admin: payload,
    });
  } catch (error) {
    console.error('Error en POST /api/login:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Ruta de prueba protegida para validar verificarToken desde Postman
app.get('/api/perfil', verificarToken, (req, res) => {
  res.json({
    mensaje: 'Acceso autorizado',
    admin: req.admin,
  });
});

// ---------------------------------------------------------
// RUTAS DE LA API REST (FASE 4 - PROTEGIDAS CON JWT)
// ---------------------------------------------------------

// 1. Estadísticas de usuarios (Turso SQL) y canales (Firestore)
app.get('/api/stats', verificarToken, async (req, res) => {
  try {
    const [resTotal, resPorPais, interaccionesSnap] = await Promise.all([
      turso.execute('SELECT COUNT(*) AS total FROM usuarios'),
      turso.execute(`
        SELECT
          p.nombre AS pais,
          COUNT(u.id_usuario) AS cantidad,
          AVG(u.latitud) AS lat,
          AVG(u.longitud) AS lng
        FROM usuarios u
        INNER JOIN ciudades c ON u.id_ciudad = c.id_ciudad
        INNER JOIN estados e ON c.id_estado = e.id_estado
        INNER JOIN paises p ON e.id_pais = p.id_pais
        GROUP BY p.id_pais, p.nombre
        ORDER BY cantidad DESC
      `),
      dbFirestore.collection('interacciones').get(),
    ]);

    const totalUsuarios = Number(resTotal.rows[0]?.total ?? 0);

    const usuariosPorPais = resPorPais.rows.map((row) => ({
      pais: row.pais,
      cantidad: Number(row.cantidad),
      lat: row.lat !== null && row.lat !== undefined ? Number(row.lat) : null,
      lng: row.lng !== null && row.lng !== undefined ? Number(row.lng) : null,
    }));

    const conteoCanales = {};
    interaccionesSnap.forEach((doc) => {
      const canal = doc.data()?.canal || 'Sin canal';
      conteoCanales[canal] = (conteoCanales[canal] || 0) + 1;
    });

    const porCanal = Object.entries(conteoCanales)
      .map(([canal, cantidad]) => ({ canal, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    return res.json({
      total_usuarios: totalUsuarios,
      usuarios_por_pais: usuariosPorPais,
      por_canal: porCanal,
    });
  } catch (error) {
    console.error('Error en GET /api/stats:', error);
    return res.status(500).json({
      error: 'Error al consultar las estadísticas en Turso y Firestore.',
    });
  }
});

// Helper para agrupar interacciones por hora (0 a 23)
function calcularHorariosPico(snapshot) {
  const conteoHoras = Array.from({ length: 24 }, (_, hora) => ({
    hora,
    etiqueta: `${String(hora).padStart(2, '0')}:00`,
    cantidad: 0,
  }));

  snapshot.forEach((doc) => {
    const ts = doc.data()?.timestamp;
    if (!ts) return;
    const fecha = new Date(ts);
    if (!Number.isNaN(fecha.getTime())) {
      const hora = fecha.getHours();
      conteoHoras[hora].cantidad++;
    }
  });

  return conteoHoras;
}

// 1B. Análisis de Comunidad, Leaderboard y Horarios Pico
app.get('/api/analisis', verificarToken, async (req, res) => {
  try {
    const [resEstatus, resTotales, resArtistas, resTopContribuidores, interaccionesSnap] =
      await Promise.all([
        turso.execute(`
          SELECT estatus, COUNT(*) AS cantidad
          FROM usuarios
          GROUP BY estatus
          ORDER BY cantidad DESC
        `),
        turso.execute(`
          SELECT
            COALESCE(SUM(eventos_asistidos), 0) AS eventos_asistidos,
            COALESCE(SUM(comisiones_compradas), 0) AS comisiones_compradas
          FROM usuarios
        `),
        turso.execute('SELECT COUNT(*) AS total_artistas FROM usuarios WHERE es_artista = 1'),
        turso.execute(`
          SELECT alias, (mensajes_30d + reacciones_30d) AS total_actividad
          FROM usuarios
          ORDER BY total_actividad DESC
          LIMIT 5
        `),
        dbFirestore.collection('interacciones').get(),
      ]);

    const porEstatus = resEstatus.rows.map((row) => ({
      estatus: row.estatus,
      cantidad: Number(row.cantidad),
    }));

    const totalesRow = resTotales.rows[0] || {};
    const totalEventos = Number(totalesRow.eventos_asistidos ?? 0);
    const totalComisiones = Number(totalesRow.comisiones_compradas ?? 0);
    const totalArtistas = Number(resArtistas.rows[0]?.total_artistas ?? 0);

    const topContribuidores = resTopContribuidores.rows.map((row) => ({
      alias: row.alias,
      total_actividad: Number(row.total_actividad ?? 0),
    }));

    const horariosPico = calcularHorariosPico(interaccionesSnap);

    return res.json({
      por_estatus: porEstatus,
      totales: {
        eventos_asistidos: totalEventos,
        comisiones_compradas: totalComisiones,
      },
      total_artistas: totalArtistas,
      top_contribuidores: topContribuidores,
      horarios_pico: horariosPico,
    });
  } catch (error) {
    console.error('Error en GET /api/analisis:', error);
    return res.status(500).json({
      error: 'Error al consultar el análisis de comunidad en Turso.',
    });
  }
});

// 1C. Moderación, Tendencias, Toxicidad por Canal y Horarios Pico (Firestore)
app.get('/api/moderacion', verificarToken, async (req, res) => {
  try {
    const snapshot = await dbFirestore.collection('interacciones').get();

    const conteoEtiquetas = {};
    const conteoToxicidadCanal = {};
    const alertas = [];

    snapshot.forEach((doc) => {
      const data = doc.data() || {};

      // Contar palabras del arreglo etiquetas
      if (Array.isArray(data.etiquetas)) {
        for (const rawTag of data.etiquetas) {
          const tag = String(rawTag || '').trim().toLowerCase();
          if (tag) {
            conteoEtiquetas[tag] = (conteoEtiquetas[tag] || 0) + 1;
          }
        }
      }

      // Filtrar interacciones con sentimiento negativo (< 0) y agrupar por canal
      const sentimiento = Number(data.sentimiento);
      if (!Number.isNaN(sentimiento) && sentimiento < 0) {
        const canal = data.canal || 'Sin canal';
        conteoToxicidadCanal[canal] = (conteoToxicidadCanal[canal] || 0) + 1;

        alertas.push({
          id: doc.id,
          ...data,
        });
      }
    });

    const tendencias = Object.entries(conteoEtiquetas)
      .map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    const toxicidadPorCanal = Object.entries(conteoToxicidadCanal)
      .map(([canal, cantidad]) => ({ canal, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const horariosPico = calcularHorariosPico(snapshot);

    alertas.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    return res.json({
      tendencias,
      alertas,
      toxicidad_por_canal: toxicidadPorCanal,
      horarios_pico: horariosPico,
    });
  } catch (error) {
    console.error('Error en GET /api/moderacion:', error);
    return res.status(500).json({
      error: 'Error al consultar moderación y tendencias en Firestore.',
    });
  }
});

// 2. Listar últimas 50 interacciones desde Firestore
app.get('/api/interacciones', verificarToken, async (req, res) => {
  try {
    const snapshot = await dbFirestore
      .collection('interacciones')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const interacciones = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      total: interacciones.length,
      interacciones,
    });
  } catch (error) {
    console.error('Error en GET /api/interacciones:', error);
    return res.status(500).json({
      error: 'Error al consultar las interacciones en Firestore.',
    });
  }
});

// 3. Crear nueva interacción en Firestore
app.post('/api/interacciones', verificarToken, async (req, res) => {
  try {
    const {
      id_usuario,
      texto,
      canal,
      tipo,
      tema,
      sentimiento,
      idioma,
      ubicacion,
      dispositivo,
      reacciones_recibidas,
      etiquetas,
      timestamp,
      latitud,
      longitud,
    } = req.body || {};

    if (
      !id_usuario ||
      !String(id_usuario).trim() ||
      !texto ||
      !String(texto).trim() ||
      !canal ||
      !String(canal).trim()
    ) {
      return res.status(400).json({
        error: 'Los campos id_usuario, texto y canal son obligatorios.',
      });
    }

    const textoLimpio = String(texto).trim();
    const idInteraccion = `I${Date.now()}`;

    const nuevaInteraccion = {
      id_interaccion: idInteraccion,
      id_usuario: String(id_usuario).trim(),
      timestamp: timestamp ? String(timestamp).trim() : new Date().toISOString(),
      canal: String(canal).trim(),
      tipo: tipo ? String(tipo).trim().toLowerCase() : 'mensaje',
      texto: textoLimpio,
      tema: tema ? String(tema).trim().toLowerCase() : 'general',
      sentimiento: typeof sentimiento === 'number' ? sentimiento : 0,
      idioma: idioma ? String(idioma).trim().toLowerCase() : 'es',
      ubicacion: ubicacion ?? null,
      dispositivo: dispositivo ? String(dispositivo).trim() : 'Web',
      longitud_texto: textoLimpio.length,
      reacciones_recibidas: typeof reacciones_recibidas === 'number' ? reacciones_recibidas : 0,
      etiquetas: Array.isArray(etiquetas) ? etiquetas : [],
    };

    await dbFirestore.collection('interacciones').doc(idInteraccion).set(nuevaInteraccion);

    // Buscar coordenadas del usuario en Turso para el destello 3D en tiempo real
    const eventoInteraccion = { ...nuevaInteraccion };
    try {
      const resCoords = await turso.execute({
        sql: 'SELECT latitud, longitud FROM usuarios WHERE UPPER(id_usuario) = UPPER(?) LIMIT 1',
        args: [nuevaInteraccion.id_usuario],
      });
      const coords = resCoords.rows[0];
      if (
        coords &&
        coords.latitud !== null &&
        coords.latitud !== undefined &&
        coords.longitud !== null &&
        coords.longitud !== undefined
      ) {
        eventoInteraccion.latitud = Number(coords.latitud);
        eventoInteraccion.longitud = Number(coords.longitud);
      } else if (latitud !== undefined && longitud !== undefined && latitud !== null && longitud !== null) {
        const latNum = Number(latitud);
        const lngNum = Number(longitud);
        if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
          eventoInteraccion.latitud = latNum;
          eventoInteraccion.longitud = lngNum;
        }
      }
      console.log(
        `[Socket.IO] Emitiendo nueva_interaccion (${idInteraccion}) usuario=${nuevaInteraccion.id_usuario} coords=${eventoInteraccion.latitud ?? 'N/A'},${eventoInteraccion.longitud ?? 'N/A'}`
      );
    } catch (errCoords) {
      console.error('Error al consultar coordenadas del usuario en Turso:', errCoords);
    }

    io.emit('nueva_interaccion', eventoInteraccion);

    return res.status(201).json({
      mensaje: 'Interacción creada correctamente.',
      id: idInteraccion,
      interaccion: eventoInteraccion,
    });
  } catch (error) {
    console.error('Error en POST /api/interacciones:', error);
    return res.status(500).json({
      error: 'Error al guardar la interacción en Firestore.',
    });
  }
});

// 4. Eliminar una interacción por su ID en Firestore
app.delete('/api/interacciones/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    await dbFirestore.collection('interacciones').doc(id).delete();

    io.emit('interaccion_eliminada', { id_interaccion: req.params.id });

    return res.json({
      mensaje: 'Interacción eliminada correctamente.',
      id,
    });
  } catch (error) {
    console.error('Error en DELETE /api/interacciones/:id:', error);
    return res.status(500).json({
      error: 'Error al eliminar la interacción en Firestore.',
    });
  }
});

// ---------------------------------------------------------
// INICIO DEL SERVIDOR (EXPRESS + SOCKET.IO)
// ---------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Servidor Community 360 (HTTP + WebSockets) corriendo en http://localhost:${PORT}`);
});

module.exports = { app, server, io, verificarToken };
