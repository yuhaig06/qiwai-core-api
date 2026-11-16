const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const ACTIVE_MODEL = 'gemini-3.5-flash-lite';

async function analyzeRiskWithAI(type, content) {
  const prompt = `Bạn là hệ thống phân tích rủi ro lừa đảo quốc tế. Tự động nhận diện ngôn ngữ của nội dung đầu vào (tiếng Việt, Anh, Nhật, Hàn, Trung, Pháp...) và BẮT BUỘC viết "reason" và "action_advice" bằng CHÍNH ngôn ngữ của content đầu vào (nếu content tiếng Anh thì trả lời tiếng Anh, tiếng Nhật thì tiếng Nhật...). Các key JSON giữ nguyên tiếng Anh. Phân tích dữ liệu [${type}]: "${content}".

QUY TẮC ĐÁNH GIÁ CHUẨN:
- PHONE: SĐT di động VN hợp lệ (10 số, bắt đầu 03/05/07/08/09, hoặc 11 số 10x/14x/16x/18x/19x) mà KHÔNG kèm dấu hiệu lừa đảo nào -> risk_level "SAFE", risk_score 10-25. Chỉ nâng SUSPICIOUS/DANGEROUS khi có pattern xấu: đầu số quốc tế lạ (+224/+252/+375/+371/+381/+881/+882...), số quá ngắn/dài bất thường, hoặc nội dung đi kèm đe dọa/giả mạo.
- URL: Domain chính thống (.gov.vn, .com.vn của ngân hàng/thương hiệu thật, facebook.com, google.com...) -> SAFE. Domain giả mạo thương hiệu, TLD rủi ro (.xyz/.top/.vip/.tk/.ml...) -> DANGEROUS/SUSPICIOUS.
- TEXT_PATTERN: Chỉ flag khi có dấu hiệu lừa đảo cụ thể (OTP, chuyển khoản gấp, giả công an/tòa án/ngân hàng, trúng thưởng ảo, tuyển CTV việc nhẹ lương cao...). Văn bản đời thường không dấu hiệu -> SAFE.

Trả về JSON duy nhất, không thêm chữ nào khác:
{"risk_level":"SAFE|SUSPICIOUS|DANGEROUS","risk_score":0-100,"reason":"lý do dưới 20 từ","action_advice":"khuyến nghị dưới 15 từ"}`;

  try {
    const response = await ai.models.generateContent({
      model: ACTIVE_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text);
    return { ...parsed, model_used: ACTIVE_MODEL };
  } catch (error) {
    console.warn(`[QIWAI AI] Lỗi hoặc chạm giới hạn Free Tier (${error.status || error.message})`);
    return null; // Trả về null để Shield Module tự động kích hoạt Fallback nội bộ
  }
}


// Chan 2: AI Vision doi chieu anh bang chung chup truc tiep tai hien truong
async function validatePulsePhoto(photoDataUrl, pulseType, description) {
  try {
    const comma = photoDataUrl.indexOf(',');
    if (comma < 0) return null;
    const mimeType = photoDataUrl.slice(5, photoDataUrl.indexOf(';'));
    const base64 = photoDataUrl.slice(comma + 1);
    const promptText = 'Day la anh bang chung duoc chup tai hien truong cho canh bao "' + pulseType + '" tai Viet Nam. Mo ta nguoi dung: "' + description + '". ' +
      'Hay danh gia JSON: {"relevant":true/false,"staged_or_screenshot":true/false,"confidence":0-100} ' +
      '- relevant=true neu anh thuc su the hien dung loai su co (FLOOD=nuoc ngap, TRAFFIC_JAM=ket xe, CONSTRUCTION=cong trinh, SECURITY=tinh huong bat thuong/an ninh). ' +
      '- staged_or_screenshot=true neu anh la anh cu, screenshot, anh gia, hoac khong khop mo ta.';
    const response = await ai.models.generateContent({
      model: ACTIVE_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType, data: base64 } },
          { text: promptText }
        ]
      }],
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    });
    const parsed = JSON.parse(response.text);
    return Object.assign({}, parsed, { trustworthy: parsed.relevant === true && parsed.staged_or_screenshot !== true });
  } catch (error) {
    console.warn('[QIWAI Vision] Loi kiem tra anh:', error.status || error.message);
    return null;
  }
}

module.exports = { analyzeRiskWithAI, validatePulsePhoto };
