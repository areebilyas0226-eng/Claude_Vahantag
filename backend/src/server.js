'use strict';

require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const morgan      = require('morgan');
const compression = require('compression');
const os          = require('os');

const { testConnection } = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { startCronJobs } = require('./services/cronService');
const logger = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────
// ❌🔥 DISABLE CACHING (CRITICAL FIX)
// ─────────────────────────────────────────
app.set('etag', false); // ❌ disable 304 completely

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// ─────────────────────────────────────────
// 🔥 GET LOCAL IP
// ─────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// ─────────────────────────────────────────
// 🚨 SAFE ROUTE LOADER
// ─────────────────────────────────────────
function loadRoute(path, name) {
  try {
    const route = require(path);
    if (!route) throw new Error(`${name} is undefined`);

    console.log(`✅ Loaded: ${name}`);
    return route;

  } catch (err) {
    console.error(`❌ FAILED TO LOAD: ${name}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// ─────────────────────────────────────────
// 📦 LOAD ROUTES
// ─────────────────────────────────────────
const authRoutes  = loadRoute('./routes/auth', 'authRoutes');
const adminRoutes = loadRoute('./routes/admin', 'adminRoutes');
const agentRoutes = loadRoute('./routes/agent', 'agentRoutes');
const userRoutes  = loadRoute('./routes/user', 'userRoutes');
const scanRoutes  = loadRoute('./routes/scan', 'scanRoutes');
const cronRoutes  = loadRoute('./routes/cron', 'cronRoutes');

// ─────────────────────────────────────────
// 🔍 REQUEST LOGGER
// ─────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

// ─────────────────────────────────────────
// 🛡️ MIDDLEWARE
// ─────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());

app.use(cors({
  origin: true,
  credentials: true,
}));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────
// 🚦 RATE LIMIT
// ─────────────────────────────────────────
app.use('/api', apiLimiter);

// ─────────────────────────────────────────
// ❤️ HEALTH
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

app.get('/health/db', async (req, res) => {
  try {
    await testConnection();
    res.json({ db: 'connected' });
  } catch {
    res.status(503).json({ db: 'failed' });
  }
});

// ─────────────────────────────────────────
// 📌 ROUTES
// ─────────────────────────────────────────
console.log('📌 Mounting routes...');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/cron', cronRoutes);

// ─────────────────────────────────────────
// ❌ 404 HANDLER
// ─────────────────────────────────────────
app.use((req, res, next) => {
  console.error(`❌ 404 NOT FOUND: ${req.method} ${req.originalUrl}`);
  next();
});

app.use(notFound);

// ─────────────────────────────────────────
// 💥 GLOBAL ERROR HANDLER
// ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('💥 ERROR:', err.stack || err.message);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ─────────────────────────────────────────
// 🚀 START SERVER
// ─────────────────────────────────────────
async function start() {
  try {
    await testConnection();
    logger.info('✅ Database connected');
  } catch {
    logger.warn('⚠️ Database not connected');
  }

  const localIP = getLocalIP();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    logger.info(`📱 Mobile URL: http://${localIP}:${PORT}`);
  });

  if (process.env.NODE_ENV !== 'test') {
    startCronJobs();
  }
}

// ─────────────────────────────────────────
// 💣 PROCESS ERRORS
// ─────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Rejection:', err);
});

start();

module.exports = app;