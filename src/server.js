const express = require('express');
const { MongoClient } = require('mongodb');
const os = require('os');

// ==========================================
// 1. LECTURA Y VALIDACIÓN DE CONFIGURACIÓN
// ==========================================
const APP_PORT = parseInt(process.env.APP_PORT || '3000', 10);
const DB_HOST = process.env.DB_HOST || 'mongo-service';
const DB_PORT = process.env.DB_PORT || '27017';
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER || '';
const DB_PASS = process.env.DB_PASS || '';

console.log('---------------------------------------------------------');
console.log(' [AVSA] Iniciando aplicación Node.js en K3s / AWS EC2');
console.log('---------------------------------------------------------');
console.log(` Configuración cargada:`);
console.log(` - APP_PORT : ${APP_PORT}`);
console.log(` - DB_HOST  : ${DB_HOST}`);
console.log(` - DB_PORT  : ${DB_PORT}`);
console.log(` - DB_NAME  : ${DB_NAME || '<NO DEFINIDO>'}`);
console.log(` - DB_USER  : ${DB_USER ? '*** (configurado)' : '<sin usuario>'}`);

// Validación estricta requerida: falla explícita si falta DB_NAME
if (!DB_NAME || DB_NAME.trim() === '') {
  console.error('\n=========================================================');
  console.error(' [ERROR FATAL] Variable de entorno requerida "DB_NAME" no está definida.');
  console.error(' La aplicación no puede iniciar sin especificar la base de datos.');
  console.error(' Verifique el ConfigMap o las variables de entorno asociadas.');
  console.error('=========================================================\n');
  process.exit(1);
}

// Construcción de la URI de conexión a MongoDB
let mongoUri = '';
if (DB_USER && DB_PASS) {
  mongoUri = `mongodb://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${DB_NAME}?authSource=admin`;
} else {
  mongoUri = `mongodb://${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

const client = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 2000,
  connectTimeoutMS: 2000
});

let db = null;
let isMongoConnected = false;

// Función de reconexión continua a MongoDB
async function connectToMongo() {
  try {
    if (!isMongoConnected) {
      await client.connect();
      db = client.db(DB_NAME);
      isMongoConnected = true;
      console.log(`[AVSA - MongoDB] Conexión establecida exitosamente a: ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
    }
  } catch (err) {
    isMongoConnected = false;
    db = null;
    console.warn(`[AVSA - MongoDB] No se pudo conectar a MongoDB (${DB_HOST}:${DB_PORT}): ${err.message}`);
  }
}

// Intentar conexión inicial y programar reintentos periódicos
connectToMongo();
setInterval(async () => {
  if (!isMongoConnected) {
    await connectToMongo();
  } else {
    try {
      if (db) {
        await db.command({ ping: 1 });
      }
    } catch (e) {
      isMongoConnected = false;
      db = null;
      console.warn(`[AVSA - MongoDB] Se perdió la conexión con MongoDB: ${e.message}`);
    }
  }
}, 5000);

// ==========================================
// 2. CONFIGURACIÓN DEL SERVIDOR EXPRESS
// ==========================================
const app = express();
app.use(express.json());

// Endpoint Principal (GET /)
app.get('/', async (req, res) => {
  let visitas = 0;

  if (isMongoConnected && db) {
    try {
      const col = db.collection('visitas');
      const resultado = await col.findOneAndUpdate(
        { _id: 'contador_global' },
        { $inc: { total: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      visitas = resultado ? resultado.total : 1;
    } catch (error) {
      console.error('[AVSA] Error actualizando contador de visitas:', error.message);
      visitas = 'Error registrando visita en BD';
    }
  } else {
    visitas = 'No disponible (MongoDB desconectado)';
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const gid = typeof process.getgid === 'function' ? process.getgid() : null;
  let username = 'appuser';
  try {
    username = os.userInfo().username;
  } catch (e) {
    username = `uid-${uid}`;
  }

  const respuesta = {
    aplicacion: "AVSA - Practica S12 (Kubernetes en AWS)",
    pod: process.env.HOSTNAME || "desconocido",
    usuario: {
      uid: uid,
      gid: gid,
      nombre: username,
      root: uid === 0
    },
    mongodb: isMongoConnected ? "CONECTADO" : "DESCONECTADO",
    baseDeDatos: DB_NAME,
    visitas: visitas
  };

  res.status(200).json(respuesta);
});

// Sonda de Vitalidad (Liveness Probe): GET /health/live
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'ALIVE',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Sonda de Preparación (Readiness Probe): GET /health/ready
app.get('/health/ready', async (req, res) => {
  if (isMongoConnected && db) {
    try {
      await db.command({ ping: 1 });
      return res.status(200).json({
        status: 'READY',
        mongodb: 'CONECTADO',
        database: DB_NAME
      });
    } catch (err) {
      isMongoConnected = false;
      return res.status(503).json({
        status: 'NOT_READY',
        mongodb: 'DESCONECTADO',
        error: err.message
      });
    }
  }

  return res.status(503).json({
    status: 'NOT_READY',
    mongodb: 'DESCONECTADO',
    error: 'Sin conexión activa a la instancia de MongoDB'
  });
});

// ==========================================
// 3. API REST DE PRODUCTOS
// ==========================================

// GET /api/productos - Obtener todos los productos
app.get('/api/productos', async (req, res) => {
  if (!isMongoConnected || !db) {
    return res.status(503).json({
      error: 'Servicio no disponible: MongoDB no está conectado'
    });
  }

  try {
    const productos = await db.collection('productos').find({}).toArray();
    res.status(200).json({
      total: productos.length,
      productos: productos
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error al consultar productos',
      detalle: error.message
    });
  }
});

// POST /api/productos - Crear un nuevo producto
app.post('/api/productos', async (req, res) => {
  if (!isMongoConnected || !db) {
    return res.status(503).json({
      error: 'Servicio no disponible: MongoDB no está conectado'
    });
  }

  const { nombre, precio, stock, categoria, descripcion } = req.body;

  if (!nombre || precio === undefined) {
    return res.status(400).json({
      error: 'Campos requeridos: "nombre" y "precio"'
    });
  }

  try {
    const nuevoProducto = {
      nombre,
      precio: Number(precio),
      stock: stock !== undefined ? Number(stock) : 0,
      categoria: categoria || 'General',
      descripcion: descripcion || '',
      fechaCreacion: new Date()
    };

    const resultado = await db.collection('productos').insertOne(nuevoProducto);
    res.status(201).json({
      mensaje: 'Producto creado exitosamente',
      id: resultado.insertedId,
      producto: nuevoProducto
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error al registrar producto',
      detalle: error.message
    });
  }
});

// ==========================================
// 4. INICIO DEL SERVIDOR HTTP
// ==========================================
const server = app.listen(APP_PORT, '0.0.0.0', () => {
  console.log(`[AVSA] Servidor escuchando en http://0.0.0.0:${APP_PORT}`);
  console.log(`[AVSA] Proceso ejecutándose con UID: ${typeof process.getuid === 'function' ? process.getuid() : 'N/A'}`);
});

// Cierre elegante (Graceful Shutdown)
const gracefulShutdown = async (signal) => {
  console.log(`\n[AVSA] Señal ${signal} recibida. Cerrando conexiones...`);
  server.close(async () => {
    try {
      if (client) {
        await client.close();
      }
      console.log('[AVSA] Servidor y conexiones cerradas correctamente.');
      process.exit(0);
    } catch (err) {
      console.error('[AVSA] Error cerrando conexión MongoDB:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
