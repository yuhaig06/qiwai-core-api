const express = require('express');
const router = express.Router();
const geohash = require('ngeohash');
const db = require('../../core/database/db');
const { verifyToken } = require('../../core/middlewares/auth');

// Cấu hình vòng đời mặc định (tính bằng giờ) cho từng loại biến động đô thị
const PULSE_TTL_HOURS = {
  TRAFFIC_JAM: 2,    // Kẹt xe tự hết hạn sau 2 giờ
  FLOOD: 3,          // Ngập nước tự hết hạn sau 3 giờ
  SECURITY: 6,       // Cảnh báo an ninh tự hết hạn sau 6 giờ
  CONSTRUCTION: 168, // Công trình rào đường tự hết hạn sau 7 ngày (168 giờ)
};

// In-memory cache 15s cho truy vấn bản đồ: 500 user cung vung chi ton 1 query MySQL
const pulseCache = new Map();
const CACHE_TTL_MS = 15 * 1000;

// 1. Gửi cảnh báo biến động đô thị mới: POST /api/v1/urban/pulses (Yêu cầu JWT)
router.post('/pulses', verifyToken, async (req, res) => {
  try {
    const { pulse_type, latitude, longitude, description } = req.body;
    const validTypes = Object.keys(PULSE_TTL_HOURS);

    // Validate tọa độ thực tế & loại sự cố
    if (!pulse_type || !validTypes.includes(pulse_type)) {
      return res.status(400).json({ success: false, message: 'Loại sự cố không hợp lệ (FLOOD|TRAFFIC_JAM|CONSTRUCTION|SECURITY).' });
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, message: 'Tọa độ GPS không hợp lệ.' });
    }

    // Chặn tài khoản uy tín thấp spam bản đồ
    if (req.user.trust_score < 30) {
      return res.status(403).json({ success: false, message: 'Điểm uy tín không đủ để gửi cảnh báo bản đồ.' });
    }

    // Mã hóa tọa độ thành Geohash cấp độ 7 (ô lưới ~153m x 153m)
    const hash7 = geohash.encode(lat, lng, 7);
    const cleanDesc = description ? description.trim().slice(0, 255) : '';
    const ttlHours = PULSE_TTL_HOURS[pulse_type];

    // Kiểm tra xem trong ô lưới ~150m này đã có cảnh báo cùng loại còn sống chưa (tránh spam trùng điểm)
    const [existing] = await db.execute(
      `SELECT id FROM urban_pulses
       WHERE pulse_type = ? AND geohash LIKE ? AND status != 'EXPIRED' AND expires_at > NOW()
       LIMIT 1`,
      [pulse_type, `${hash7}%`]
    );

    if (existing.length > 0) {
      // Gia hạn thêm thời gian tồn tại cho điểm đã có
      await db.execute(
        `UPDATE urban_pulses
         SET status = 'VERIFIED', expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
         WHERE id = ?`,
        [ttlHours, existing[0].id]
      );

      pulseCache.clear(); // Diem moi/gia han -> xoa cache de hien thi ngay
      return res.json({
        success: true,
        message: 'Đã xác nhận và gia hạn điểm cảnh báo hiện có tại khu vực này.',
        data: { pulse_id: existing[0].id, geohash: hash7, status: 'VERIFIED' },
      });
    }

    // Nếu là điểm mới -> Lưu với Geohash đầy đủ (độ chính xác 9 ký tự ~5m)
    const fullHash = geohash.encode(lat, lng, 9);
    const initialStatus = req.user.trust_score >= 80 ? 'VERIFIED' : 'PENDING_AI';

    const [result] = await db.execute(
      `INSERT INTO urban_pulses (user_id, pulse_type, latitude, longitude, geohash, description, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [req.user.id, pulse_type, lat, lng, fullHash, cleanDesc, initialStatus, ttlHours]
    );

    pulseCache.clear(); // Diem moi -> xoa cache de hien thi ngay
    return res.status(201).json({
      success: true,
      message: 'Đã ghim cảnh báo đô thị lên bản đồ QIWAI.',
      data: {
        pulse_id: result.insertId,
        pulse_type,
        latitude: lat,
        longitude: lng,
        geohash: fullHash,
        status: initialStatus,
        ttl_hours: ttlHours,
      },
    });
  } catch (error) {
    console.error('[Urban Post Pulse Error]:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi ghim điểm cảnh báo.' });
  }
});

// 2. Truy vấn các điểm biến động quanh vị trí người dùng: GET /api/v1/urban/pulses?lat=...&lng=...
router.get('/pulses', async (req, res) => {
  try {
    // Che do bbox: quet toan bo vung chu nhat (dung cho "Quet toan TP.HCM")
    const bbox = req.query.bbox;
    if (bbox) {
      const parts = String(bbox).split(',').map(Number);
      if (parts.length !== 4 || parts.some(isNaN)) {
        return res.status(400).json({ success: false, message: 'bbox khong hop le. Dung dinh dang: minLat,minLng,maxLat,maxLng' });
      }
      const [minLat, minLng, maxLat, maxLng] = parts;
      const [pulses] = await db.execute(
        `SELECT id, pulse_type, latitude, longitude, geohash, description, status, expires_at, created_at
         FROM urban_pulses
         WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
           AND status != 'EXPIRED' AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 500`,
        [minLat, maxLat, minLng, maxLng]
      );
      const payload = { success: true, area_center_geohash: 'BBOX', count: pulses.length, data: pulses };
      return res.json(payload);
    }

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Cần truyền tham số lat và lng trên URL.' });
    }

    // Tính ô Geohash cấp 5 + 8 ô lân cận để quét vùng xung quanh người dùng
    const centerHash = geohash.encode(lat, lng, 5);

    // Tra cache RAM truoc (TTL 15s)
    const cached = pulseCache.get(centerHash);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ ...cached.payload, from_cache: true });
    }

    const neighborHashes = geohash.neighbors(centerHash);
    const searchPrefixes = [centerHash, ...neighborHashes].map((h) => `${h}%`);

    // Tạo điều kiện LIKE động cho 9 ô vùng
    const likeClauses = searchPrefixes.map(() => 'geohash LIKE ?').join(' OR ');

    const [pulses] = await db.execute(
      `SELECT id, pulse_type, latitude, longitude, geohash, description, status, expires_at, created_at
       FROM urban_pulses
       WHERE (${likeClauses})
         AND status != 'EXPIRED'
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 100`,
      searchPrefixes
    );

    const payload = {
      success: true,
      area_center_geohash: centerHash,
      count: pulses.length,
      data: pulses,
    };
    pulseCache.set(centerHash, { payload, expiresAt: Date.now() + CACHE_TTL_MS });

    return res.json(payload);
  } catch (error) {
    console.error('[Urban Get Pulses Error]:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tải dữ liệu bản đồ.' });
  }
});

module.exports = router;
