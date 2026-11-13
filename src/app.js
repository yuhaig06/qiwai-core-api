require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Tắt CSP để phục vụ Leaflet CDN + inline script (MVP dev)
app.set('trust proxy', 1); // Render/Cloud chay sau proxy -> rate limit doc IP that
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Phục vụ giao diện tĩnh
const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting toàn cục
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100,                 // tối đa 100 request / IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'qiwai-core-api' });
});

// Nạp modules (pluggable)
// TODO: gắn router của từng module tại đây, ví dụ:
const shieldRouter = require('./modules/shield');
app.use('/api/v1/shield', shieldRouter);
const authRouter = require('./modules/auth');
app.use('/api/v1/auth', authRouter);
const urbanRouter = require('./modules/urban');
app.use('/api/v1/urban', urbanRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

module.exports = app;
