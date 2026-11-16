const express = require('express');
const router = express.Router();
const db = require('../../core/database/db');
const { analyzeRiskWithAI } = require('../../core/ai-engine');
const { verifyToken } = require('../../core/middlewares/auth');
const rateLimit = require('express-rate-limit');

// Rate limit chuyen biet cho endpoint goi AI: 10 req/phut/IP
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

/**
 * LỚP 1: Bộ lọc quy tắc cứng (0 Token - Chạy trong 1ms)
 */
function runHardRuleFilter(type, content) {
  const lower = content.toLowerCase();

  const suspiciousDomains = /\.(xyz|top|vip|club|cc|tk|ml|ga|cf|icu|work|click)(\/|$|\?)/i;
  const brandSpoofing = /(vcb|vietcombank|bidv|techcombank|mb|agribank|evn|dienluc|cong-an|vneid|dichvucong).*\.(com|net|org|vn|xyz|top|vip)/i;
  const urgentScamKeywords = /(khoa tai khoan|xac thuc otp|cap nhat sinh trac|viec nhe luong cao|nhan qua mien phi|trung thuong|hoan tien|lenh bat|truy na)/i;

  if (type === 'URL') {
    if (brandSpoofing.test(lower) && !lower.includes('vietcombank.com.vn') && !lower.includes('dichvucong.gov.vn')) {
      return {
        risk_level: 'DANGEROUS',
        risk_score: 98,
        analysis: 'Tên miền có dấu hiệu giả mạo tổ chức/ngân hàng tại Việt Nam. Khuyến nghị: Tuyệt đối không truy cập và không nhập mật khẩu/OTP.',
      };
    }
    if (suspiciousDomains.test(lower)) {
      return {
        risk_level: 'SUSPICIOUS',
        risk_score: 75,
        analysis: 'Đường link sử dụng tên miền mở rộng rủi ro cao thường dùng để phát tán mã độc. Khuyến nghị: Kiểm tra kỹ nguồn gửi trước khi bấm vào.',
      };
    }
  }

  if (type === 'TEXT_PATTERN') {
    const hasLink = /(http:\/\/|https:\/\/|www\.)/i.test(lower);
    if (hasLink && urgentScamKeywords.test(lower)) {
      return {
        risk_level: 'DANGEROUS',
        risk_score: 95,
        analysis: 'Tin nhắn chứa đường link lạ kết hợp nội dung đe dọa/dụ dỗ đặc trưng của kịch bản lừa đảo. Khuyến nghị: Xóa tin nhắn và chặn người gửi ngay.',
      };
    }
  }

  if (type === 'PHONE') {
    if (/^\+(224|252|375|371|381|881|882|231|247)/.test(content)) {
      return {
        risk_level: 'DANGEROUS',
        risk_score: 92,
        analysis: 'Đầu số quốc tế thuộc danh sách cảnh báo lừa đảo cước viễn thông/mạo danh. Khuyến nghị: Không nghe máy và không gọi lại.',
      };
    }
  }

  return null;
}

/**
 * DỰ PHÒNG (FALLBACK): Chấm điểm nội bộ khi AI chạm trần Free Tier
 */
function runFallbackHeuristic(type, content) {
  const lower = content.toLowerCase();
  const dangerWords = ['otp', 'mat khau', 'chuyen khoan', 'cong an', 'toa an', 'khoa the', 'hoa hong', 'nap tien'];
  let hitCount = 0;

  dangerWords.forEach((word) => {
    if (lower.includes(word)) hitCount++;
  });

  if (hitCount >= 2) {
    return {
      risk_level: 'SUSPICIOUS',
      risk_score: 70,
      analysis: 'Nội dung chứa nhiều từ khóa nhạy cảm thường gặp trong các vụ lừa đảo trực tuyến. Khuyến nghị: Xác minh qua kênh chính thức trước khi thao tác.',
    };
  }

  return {
    risk_level: 'SAFE',
    risk_score: 15,
    analysis: 'Chưa phát hiện dấu hiệu bất thường rõ rệt qua bộ lọc nhanh. Khuyến nghị: Vẫn luôn cảnh giác với các yêu cầu cung cấp thông tin cá nhân.',
  };
}

// API CHÍNH: POST /api/v1/shield/analyze
router.post('/analyze', aiLimiter, async (req, res) => {
  try {
    const { type, content } = req.body;
    const validTypes = ['PHONE', 'URL', 'TEXT_PATTERN'];

    if (!type || !validTypes.includes(type) || !content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Dữ liệu không hợp lệ. Cần { type: PHONE|URL|TEXT_PATTERN, content: <chuỗi không rỗng> }',
      });
    }

    const cleanContent = content.trim();
    const noStore = req.body.no_store === true || req.query.no_store === '1'; // Che do rieng tu: khong luu vao DB

    // LỚP 1: Lọc cứng 0 token
    const hardResult = runHardRuleFilter(type, cleanContent);
    if (hardResult) {
      return res.json({
        success: true,
        source: 'QIWAI_HARD_RULE_FILTER (0 TOKENS)',
        tokens_used: 0,
        data: { type, content: cleanContent, ...hardResult },
      });
    }

    // LỚP 2: Tra cache Database 0 token
    const [existingRows] = await db.execute(
      'SELECT * FROM risk_entities WHERE entity_type = ? AND entity_value = ? LIMIT 1',
      [type, cleanContent.slice(0, 500)]
    );

    const CACHE_TTL_MS = 72 * 60 * 60 * 1000; // Cache AI 72h — het han thi phan tich lai
    let staleRecord = null;

    if (existingRows.length > 0) {
      const record = existingRows[0];
      const ageMs = Date.now() - new Date(record.updated_at).getTime();
      if (ageMs >= CACHE_TTL_MS) {
        staleRecord = record; // Cache cu -> cho phep Gemini cap nhat lai
      } else {
      await db.execute('UPDATE risk_entities SET report_count = report_count + 1 WHERE id = ?', [record.id]);

      return res.json({
        success: true,
        source: 'QIWAI_CORE_DB_CACHE',
        tokens_used: 0,
        data: {
          type: record.entity_type,
          content: record.entity_value,
          risk_level: record.risk_level,
          risk_score: record.risk_score,
          analysis: record.ai_analysis,
          report_count: record.report_count + 1,
        },
      });
      }
    }

    // LỚP 3: Gọi Gemini 3.5 Flash-Lite Free Tier
    const aiResult = await analyzeRiskWithAI(type, cleanContent);

    if (aiResult) {
      const fullAnalysis = `${aiResult.reason} ${aiResult.action_advice}`;

      if (!noStore) {
        if (staleRecord) {
          await db.execute(
            'UPDATE risk_entities SET risk_level = ?, risk_score = ?, ai_analysis = ?, report_count = report_count + 1 WHERE id = ?',
            [aiResult.risk_level, aiResult.risk_score, fullAnalysis, staleRecord.id]
          );
        } else {
          await db.execute(
            `INSERT INTO risk_entities (entity_type, entity_value, risk_level, risk_score, ai_analysis, report_count)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [type, cleanContent.slice(0, 500), aiResult.risk_level, aiResult.risk_score, fullAnalysis]
          );
        }
      }

      return res.json({
        success: true,
        source: `QIWAI_AI_ENGINE (${aiResult.model_used})`,
        data: {
          type,
          content: cleanContent,
          risk_level: aiResult.risk_level,
          risk_score: aiResult.risk_score,
          analysis: fullAnalysis,
          report_count: 1,
        },
      });
    }

    // 4. LỚP DỰ PHÒNG (FALLBACK)
    const fallbackResult = runFallbackHeuristic(type, cleanContent);
    return res.json({
      success: true,
      source: 'QIWAI_FALLBACK_HEURISTIC',
      tokens_used: 0,
      data: { type, content: cleanContent, ...fallbackResult },
    });
  } catch (error) {
    console.error('[Shield Module Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi phân tích rủi ro.',
    });
  }
});


// API Báo cáo mối nguy mới từ cộng đồng (Yêu cầu đăng nhập): POST /api/v1/shield/report
router.post('/report', verifyToken, async (req, res) => {
  try {
    // Chặn user uy tín quá thấp để tránh đầu độc dữ liệu
    if (req.user.trust_score < 30) {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản có điểm uy tín quá thấp, không được phép báo cáo.',
      });
    }

    const { type, content, description } = req.body;
    const validTypes = ['PHONE', 'URL', 'TEXT_PATTERN'];

    if (!type || !validTypes.includes(type) || !content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Dữ liệu không hợp lệ. Cần { type: PHONE|URL|TEXT_PATTERN, content: <chuỗi không rỗng> }',
      });
    }

    const cleanContent = content.trim().slice(0, 500);

    // Nếu entity đã tồn tại trong kho chung -> chỉ cộng dồn lượt báo cáo
    const [existing] = await db.execute(
      'SELECT id, report_count FROM risk_entities WHERE entity_type = ? AND entity_value = ? LIMIT 1',
      [type, cleanContent]
    );

    if (existing.length > 0) {
      await db.execute(
        'UPDATE risk_entities SET report_count = report_count + 1, risk_score = LEAST(100, risk_score + 5) WHERE id = ?',
        [existing[0].id]
      );
      return res.json({ success: true, message: 'Đã ghi nhận thêm lượt báo cáo cộng đồng.' });
    }

    // Nếu là báo cáo mới tinh -> Đưa qua AI thẩm định trước khi lưu vào kho chung
    const aiResult = await analyzeRiskWithAI(type, cleanContent + ' (Ghi chú người báo cáo: ' + (description || 'Không có') + ')');
    const riskLevel = aiResult ? aiResult.risk_level : 'SUSPICIOUS';
    const riskScore = aiResult ? aiResult.risk_score : 65;
    const analysis = aiResult
      ? aiResult.reason + ' Khuyến nghị: ' + aiResult.action_advice
      : 'Được cộng đồng báo cáo nghi vấn: ' + (description || 'Chưa có mô tả');

    await db.execute(
      'INSERT INTO risk_entities (entity_type, entity_value, risk_level, risk_score, ai_analysis, report_count) VALUES (?, ?, ?, ?, ?, 1)',
      [type, cleanContent, riskLevel, riskScore, analysis]
    );

    return res.status(201).json({
      success: true,
      message: 'Báo cáo đã được AI thẩm định và cập nhật vào lá chắn QIWAI.',
      data: { type, content: cleanContent, risk_level: riskLevel, risk_score: riskScore },
    });
  } catch (error) {
    console.error('[Shield Report Error]:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi xử lý báo cáo.' });
  }
});

module.exports = router;

