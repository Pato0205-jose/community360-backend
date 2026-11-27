process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { createClient } = require('@libsql/client');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ---------------------------------------------------------
// CONEXIONES A LA NUBE (TURSO + FIREBASE FIRESTORE)
// ---------------------------------------------------------
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const serviceAccount = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT));
initializeApp({
  credential: cert(serviceAccount),
});
const dbFirestore = getFirestore();
dbFirestore.settings({ preferRest: true });

// ---------------------------------------------------------
// FUNCIONES AUXILIARES (ETAPAS 2, 3 Y 4)
// ---------------------------------------------------------
function leerArchivo(ruta) {
  const wb = XLSX.readFile(ruta);
  const hoja = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { raw: false, defval: '' });
}

function limpiarTexto(valor) {
  if (valor === undefined || valor === null) return null;
  const limpio = String(valor).trim();
  if (limpio === '' || limpio.toLowerCase() === 'nan' || limpio.toLowerCase() === 'null') {
    return null;
  }
  return limpio;
}

function normalizarFecha(valor) {
  const texto = limpiarTexto(valor);
  if (!texto) return null;
  // Formato DD/MM/YYYY -> YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
    const [dia, mes, anio] = texto.split('/');
    return `${anio}-${mes}-${dia}`;
  }
  return texto.substring(0, 10);
}

function separarEtiquetas(valor) {
  const texto = limpiarTexto(valor);
  if (!texto) return [];
  return texto
    .split('|')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function aEntero(valor, defecto = 0) {
  const n = parseInt(valor, 10);
  return Number.isNaN(n) ? defecto : n;
}

function aDecimal(valor, permitirNulo = false) {
  const limpio = limpiarTexto(valor);
  if (limpio === null) return permitirNulo ? null : 0;
  const n = parseFloat(limpio);
  return Number.isNaN(n) ? (permitirNulo ? null : 0) : n;
}

// ---------------------------------------------------------
// PROCESO PRINCIPAL ETL (8 ETAPAS)
// ---------------------------------------------------------
async function ejecutarETL() {
  console.log('=== INICIANDO PROCESO ETL COMMUNITY 360 ===\n');

  const bitacora = {
    fecha_ejecucion: new Date().toISOString(),
    usuarios_recibidos: 0,
    usuarios_duplicados: 0,
    usuarios_validos: 0,
    usuarios_anonimizados_sin_consentimiento: 0,
    interacciones_recibidas: 0,
    interacciones_duplicadas: 0,
    interacciones_validas: 0,
    interacciones_cuarentena: 0,
    interacciones_sin_ubicacion_por_privacidad: 0,
  };

  // Leer archivos CSV originales
  const usuariosRaw = leerArchivo('./datos/comunidad_virtual_usuarios.csv.xlsx');
  const interaccionesRaw = leerArchivo('./datos/comunidad_virtual_1000_interacciones.csv.xlsx');

  bitacora.usuarios_recibidos = usuariosRaw.length;
  bitacora.interacciones_recibidas = interaccionesRaw.length;

  // --- ETAPA 1: ELIMINACIÓN DE DUPLICADOS ---
  const idsUsuariosVistos = new Set();
  const aliasVistos = new Set();
  const usuariosSinDuplicados = usuariosRaw.filter((u) => {
    const id = limpiarTexto(u.id_usuario);
    const alias = (limpiarTexto(u.alias) || '').toLowerCase();
    if (!id || idsUsuariosVistos.has(id) || aliasVistos.has(alias)) {
      bitacora.usuarios_duplicados++;
      return false;
    }
    idsUsuariosVistos.add(id);
    aliasVistos.add(alias);
    return true;
  });

  const idsInteraccionesVistos = new Set();
  const interaccionesSinDuplicados = interaccionesRaw.filter((i) => {
    const id = limpiarTexto(i.id_interaccion);
    if (!id || idsInteraccionesVistos.has(id)) {
      bitacora.interacciones_duplicadas++;
      return false;
    }
    idsInteraccionesVistos.add(id);
    return true;
  });

  // --- ETAPAS 2, 3, 4 Y 6: LIMPIEZA Y PRIVACIDAD DE USUARIOS ---
  const mapaUsuarios = new Map(); // id_usuario -> consentimiento ('si'/'no')
  const usuariosLimpios = [];

  for (const u of usuariosSinDuplicados) {
    const idUsuario = limpiarTexto(u.id_usuario);
    const consentimiento = (limpiarTexto(u.consentimiento_datos) || 'no').toLowerCase();
    const tienePermiso = consentimiento === 'si';

    if (!tienePermiso) {
      bitacora.usuarios_anonimizados_sin_consentimiento++;
    }

    const usuarioObj = {
      id_usuario: idUsuario,
      alias: limpiarTexto(u.alias),
      fecha_ingreso: normalizarFecha(u.fecha_ingreso),
      pais: tienePermiso ? limpiarTexto(u.pais) : null,
      estado: tienePermiso ? limpiarTexto(u.estado) : null,
      ciudad: tienePermiso ? limpiarTexto(u.ciudad) : null,
      latitud: tienePermiso ? aDecimal(u.latitud, true) : null,
      longitud: tienePermiso ? aDecimal(u.longitud, true) : null,
      zona_horaria: tienePermiso ? limpiarTexto(u.zona_horaria) : null,
      rango_edad: limpiarTexto(u.rango_edad),
      especie_fursona: limpiarTexto(u.especie_fursona),
      interes_principal: limpiarTexto(u.interes_principal),
      plataforma_principal: limpiarTexto(u.plataforma_principal),
      es_artista: aEntero(u.es_artista, 0) === 1 ? 1 : 0,
      mensajes_30d: aEntero(u.mensajes_30d, 0),
      reacciones_30d: aEntero(u.reacciones_30d, 0),
      eventos_asistidos: aEntero(u.eventos_asistidos, 0),
      comisiones_compradas: aEntero(u.comisiones_compradas, 0),
      sentimiento_promedio: aDecimal(u.sentimiento_promedio, false),
      ultima_actividad: normalizarFecha(u.ultima_actividad),
      estatus: (limpiarTexto(u.estatus) || 'inactivo').toLowerCase(),
      consentimiento_datos: tienePermiso ? 'si' : 'no',
    };

    mapaUsuarios.set(idUsuario, usuarioObj.consentimiento_datos);
    usuariosLimpios.push(usuarioObj);
  }
  bitacora.usuarios_validos = usuariosLimpios.length;

  // --- ETAPA 5 Y 6: VERIFICACIÓN DE REFERENCIAS Y PRIVACIDAD EN INTERACCIONES ---
  const interaccionesValidas = [];
  const interaccionesCuarentena = [];

  for (const row of interaccionesSinDuplicados) {
    const idInteraccion = limpiarTexto(row.id_interaccion);
    const idUsuario = limpiarTexto(row.id_usuario);

    if (!mapaUsuarios.has(idUsuario)) {
      interaccionesCuarentena.push({
        id_interaccion: idInteraccion,
        id_usuario: idUsuario,
        motivo_rechazo: 'El id_usuario no existe en la tabla usuarios',
        fecha_cuarentena: new Date().toISOString(),
        datos_originales: row,
      });
      continue;
    }

    const tienePermiso = mapaUsuarios.get(idUsuario) === 'si';
    const pais = limpiarTexto(row.pais);
    const estado = limpiarTexto(row.estado);
    const ciudad = limpiarTexto(row.ciudad);

    let ubicacion = null;
    if (tienePermiso && (pais || estado || ciudad)) {
      ubicacion = { pais, estado, ciudad };
    } else if (!tienePermiso) {
      bitacora.interacciones_sin_ubicacion_por_privacidad++;
    }

    interaccionesValidas.push({
      id_interaccion: idInteraccion,
      id_usuario: idUsuario,
      timestamp: limpiarTexto(row.timestamp),
      canal: limpiarTexto(row.canal),
      tipo: (limpiarTexto(row.tipo) || '').toLowerCase(),
      texto: limpiarTexto(row.texto),
      tema: (limpiarTexto(row.tema) || '').toLowerCase(),
      sentimiento: aDecimal(row.sentimiento, false),
      idioma: (limpiarTexto(row.idioma) || 'es').toLowerCase(),
      ubicacion: ubicacion,
      dispositivo: limpiarTexto(row.dispositivo),
      longitud_texto: aEntero(row.longitud_texto, 0),
      reacciones_recibidas: aEntero(row.reacciones_recibidas, 0),
      etiquetas: separarEtiquetas(row.etiquetas),
    });
  }

  bitacora.interacciones_validas = interaccionesValidas.length;
  bitacora.interacciones_cuarentena = interaccionesCuarentena.length;

  // --- ETAPA 7: EXPORTACIÓN LOCAL DE ARCHIVOS DEPURADOS ---
  fs.mkdirSync('./salida', { recursive: true });
  fs.writeFileSync('./salida/usuarios_depurados.json', JSON.stringify(usuariosLimpios, null, 2));
  fs.writeFileSync('./salida/interacciones_depuradas.json', JSON.stringify(interaccionesValidas, null, 2));
  fs.writeFileSync('./salida/interacciones_cuarentena.json', JSON.stringify(interaccionesCuarentena, null, 2));
  fs.writeFileSync('./salida/bitacora_etl.json', JSON.stringify(bitacora, null, 2));
  console.log('✔ Archivos depurados y bitácora generados en ./salida/');

  // --- ETAPA 8A: CARGA EN TURSO (SQL NORMALIZADO) ---
  console.log('\nConectando a Turso y creando tablas normalizadas...');

  await turso.batch([
    `CREATE TABLE IF NOT EXISTS paises (
      id_pais INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS estados (
      id_estado INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      id_pais INTEGER NOT NULL,
      UNIQUE(nombre, id_pais),
      FOREIGN KEY (id_pais) REFERENCES paises(id_pais)
    )`,
    `CREATE TABLE IF NOT EXISTS ciudades (
      id_ciudad INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      id_estado INTEGER NOT NULL,
      UNIQUE(nombre, id_estado),
      FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
    )`,
    `CREATE TABLE IF NOT EXISTS usuarios (
      id_usuario TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      fecha_ingreso TEXT NOT NULL,
      id_ciudad INTEGER NULL,
      latitud REAL NULL,
      longitud REAL NULL,
      zona_horaria TEXT NULL,
      rango_edad TEXT NOT NULL,
      especie_fursona TEXT NOT NULL,
      interes_principal TEXT NOT NULL,
      plataforma_principal TEXT NOT NULL,
      es_artista INTEGER NOT NULL,
      mensajes_30d INTEGER NOT NULL,
      reacciones_30d INTEGER NOT NULL,
      eventos_asistidos INTEGER NOT NULL,
      comisiones_compradas INTEGER NOT NULL,
      sentimiento_promedio REAL NOT NULL,
      ultima_actividad TEXT NOT NULL,
      estatus TEXT NOT NULL,
      consentimiento_datos TEXT NOT NULL,
      FOREIGN KEY (id_ciudad) REFERENCES ciudades(id_ciudad)
    )`,
    `CREATE TABLE IF NOT EXISTS administradores (
      id_admin INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      creado_en TEXT NOT NULL
    )`
  ], 'write');

  // Poblar catálogos geográficos (paises -> estados -> ciudades)
  const paisesSet = new Set();
  const estadosMap = new Map(); // "pais|estado" -> { pais, estado }
  const ciudadesMap = new Map(); // "pais|estado|ciudad" -> { pais, estado, ciudad }

  for (const u of usuariosLimpios) {
    if (u.pais && u.estado && u.ciudad) {
      paisesSet.add(u.pais);
      estadosMap.set(`${u.pais}|${u.estado}`, { pais: u.pais, estado: u.estado });
      ciudadesMap.set(`${u.pais}|${u.estado}|${u.ciudad}`, {
        pais: u.pais,
        estado: u.estado,
        ciudad: u.ciudad,
      });
    }
  }

  for (const pais of paisesSet) {
    await turso.execute({ sql: 'INSERT OR IGNORE INTO paises (nombre) VALUES (?)', args: [pais] });
  }
  const resPaises = await turso.execute('SELECT id_pais, nombre FROM paises');
  const idPaisPorNombre = new Map(resPaises.rows.map((r) => [r.nombre, r.id_pais]));

  for (const { pais, estado } of estadosMap.values()) {
    await turso.execute({
      sql: 'INSERT OR IGNORE INTO estados (nombre, id_pais) VALUES (?, ?)',
      args: [estado, idPaisPorNombre.get(pais)],
    });
  }
  const resEstados = await turso.execute('SELECT id_estado, nombre, id_pais FROM estados');
  const idEstadoPorClave = new Map(resEstados.rows.map((r) => [`${r.id_pais}|${r.nombre}`, r.id_estado]));

  for (const { pais, estado, ciudad } of ciudadesMap.values()) {
    const idEstado = idEstadoPorClave.get(`${idPaisPorNombre.get(pais)}|${estado}`);
    await turso.execute({
      sql: 'INSERT OR IGNORE INTO ciudades (nombre, id_estado) VALUES (?, ?)',
      args: [ciudad, idEstado],
    });
  }
  const resCiudades = await turso.execute('SELECT id_ciudad, nombre, id_estado FROM ciudades');
  const idCiudadPorClave = new Map(resCiudades.rows.map((r) => [`${r.id_estado}|${r.nombre}`, r.id_ciudad]));

  console.log(`✔ Catálogos cargados en Turso: ${paisesSet.size} países, ${estadosMap.size} estados, ${ciudadesMap.size} ciudades.`);

  // Insertar usuarios en lotes de 100
  const queriesUsuarios = usuariosLimpios.map((u) => {
    let idCiudad = null;
    if (u.pais && u.estado && u.ciudad) {
      const idPais = idPaisPorNombre.get(u.pais);
      const idEstado = idEstadoPorClave.get(`${idPais}|${u.estado}`);
      idCiudad = idCiudadPorClave.get(`${idEstado}|${u.ciudad}`) ?? null;
    }

    return {
      sql: `INSERT OR REPLACE INTO usuarios (
        id_usuario, alias, fecha_ingreso, id_ciudad, latitud, longitud, zona_horaria,
        rango_edad, especie_fursona, interes_principal, plataforma_principal, es_artista,
        mensajes_30d, reacciones_30d, eventos_asistidos, comisiones_compradas,
        sentimiento_promedio, ultima_actividad, estatus, consentimiento_datos
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        u.id_usuario, u.alias, u.fecha_ingreso, idCiudad, u.latitud, u.longitud, u.zona_horaria,
        u.rango_edad, u.especie_fursona, u.interes_principal, u.plataforma_principal, u.es_artista,
        u.mensajes_30d, u.reacciones_30d, u.eventos_asistidos, u.comisiones_compradas,
        u.sentimiento_promedio, u.ultima_actividad, u.estatus, u.consentimiento_datos,
      ],
    };
  });

  for (let i = 0; i < queriesUsuarios.length; i += 100) {
    await turso.batch(queriesUsuarios.slice(i, i + 100), 'write');
  }
  console.log(`✔ ${usuariosLimpios.length} usuarios cargados en Turso.`);

  // --- ETAPA 8B: CARGA EN FIREBASE CLOUD FIRESTORE (NoSQL) ---
  console.log('\nSubiendo documentos a Firebase Cloud Firestore...');

  async function subirEnLotes(coleccion, lista) {
    for (let i = 0; i < lista.length; i += 50) {
      const batch = dbFirestore.batch();
      for (const item of lista.slice(i, i + 50)) {
        const ref = dbFirestore.collection(coleccion).doc(item.id_interaccion);
        batch.set(ref, item);
      }
      await batch.commit();
    }
  }

  await subirEnLotes('interacciones', interaccionesValidas);
  console.log(`✔ ${interaccionesValidas.length} interacciones válidas cargadas en 'interacciones'.`);

  await subirEnLotes('interacciones_cuarentena', interaccionesCuarentena);
  console.log(`✔ ${interaccionesCuarentena.length} interacciones huérfanas cargadas en 'interacciones_cuarentena'.`);

  console.log('\n=== RESUMEN FINAL (BITÁCORA ETL) ===');
  console.table(bitacora);
  process.exit(0);
}

ejecutarETL().catch((err) => {
  console.error('Error en el proceso ETL:', err);
  process.exit(1);
});