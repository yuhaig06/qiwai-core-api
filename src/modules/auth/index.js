const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../core/database/db');
const { verifyToken } = require('../../core/middlewares/auth');

// 1. Đăng ký tài khoản QIWAI: POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  try {
    const { phone_or_email, password } = req.body;
    if (!phone_or_email || !password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Cần nhập SĐT/Email và mật khẩu tối thiểu 6 ký tự.',
      });
    }

    const cleanId = phone_or_email.trim();
    const [existing] = await db.execute('SELECT id FROM users WHERE phone_or_email = ?', [cleanId]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Tài khoản đã tồn tại trong hệ thống.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const [result] = await db.execute(
      'INSERT INTO users (phone_or_email, password_hash, trust_score) VALUES (?, ?, 100)',
      [cleanId, passwordHash]
    );

    return res.status(201).json({
      success: true,
      message: 'Khởi tạo danh tính QIWAI thành công.',
      data: { user_id: result.insertId, phone_or_email: cleanId, trust_score: 100 },
    });
  } catch (error) {
    console.error('[Auth Register Error]:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi đăng ký.' });
  }
});

// 2. Đăng nhập lấy JWT Token: POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { phone_or_email, password } = req.body;
    const [rows] = await db.execute('SELECT * FROM users WHERE phone_or_email = ? LIMIT 1', [phone_or_email?.trim()]);

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Sai thông tin đăng nhập.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Sai thông tin đăng nhập.' });
    }

    const token = jwt.sign(
      { id: user.id, phone_or_email: user.phone_or_email, trust_score: user.trust_score },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      token,
      user: { id: user.id, phone_or_email: user.phone_or_email, trust_score: user.trust_score },
    });
  } catch (error) {
    console.error('[Auth Login Error]:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi đăng nhập.' });
  }
});

// 3. Kiểm tra thông tin cá nhân & Điểm uy tín: GET /api/v1/auth/me
router.get('/me', verifyToken, async (req, res) => {
  const [rows] = await db.execute('SELECT id, phone_or_email, trust_score, created_at FROM users WHERE id = ?', [req.user.id]);
  return res.json({ success: true, data: rows[0] || null });
});

module.exports = router;
