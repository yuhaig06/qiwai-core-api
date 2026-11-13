const db = require('../database/db');

function startPulseCleanerJob() {
  // Chạy định kỳ mỗi 15 phút (15 * 60 * 1000 ms)
  const INTERVAL_MS = 15 * 60 * 1000;

  const cleanExpiredPulses = async () => {
    try {
      const [result] = await db.execute(
        `UPDATE urban_pulses
         SET status = 'EXPIRED'
         WHERE status != 'EXPIRED' AND expires_at <= NOW()`
      );
      if (result.affectedRows > 0) {
        console.log(`[QIWAI Cleaner] Đã tự động đóng ${result.affectedRows} điểm sự cố đô thị hết hạn.`);
      }
    } catch (error) {
      console.error('[QIWAI Cleaner Error]:', error.message);
    }
  };

  // Chạy ngay 1 lần khi server vừa khởi động, sau đó lặp lại mỗi 15 phút
  cleanExpiredPulses();
  setInterval(cleanExpiredPulses, INTERVAL_MS);
}

module.exports = { startPulseCleanerJob };
