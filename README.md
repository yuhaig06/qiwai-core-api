# 🛡️ QIWAI — Nền tảng AI An Ninh & Bản Đồ Đô Thị Thông Minh

> **Live:** https://qiwai-core-api.onrender.com
> **Database:** TiDB Cloud (Singapore) · **AI:** Google Gemini · **Deploy:** Render

QIWAI là hệ sinh thái backend + PWA kết hợp **trí tuệ nhân tạo phát hiện lừa đảo** (QIWAI Shield) và **bản đồ cảnh báo đô thị thời gian thực** (QIWAI Urban) trên nền bản đồ 3D toàn cầu.

---

## ✨ Tính năng nổi bật

### 🛡️ QIWAI Shield — Phân tích rủi ro AI 3 lớp
- **Lớp 1 — Hard-rule filter (0 token, ~1ms):** chặn ngay domain giả mạo ngân hàng/chính phủ VN, TLD rủi ro (`.xyz/.top/.vip`), đầu số quốc tế lừa đảo, tin nhắn đe dọa kèm link.
- **Lớp 2 — Cache DB 72h:** kết quả AI được cache trong `risk_entities` — hàng nghìn user quét cùng 1 link độc chỉ tốn **1 lần gọi Gemini**.
- **Lớp 3 — Gemini AI đa ngôn ngữ:** tự nhận diện ngôn ngữ input (Việt/Anh/Nhật/Hàn/Trung/Pháp...), trả `reason` + `action_advice` cùng ngôn ngữ đó, strict JSON.
- **Fallback heuristic:** Gemini chết/quá quota vẫn trả kết quả nội bộ — không bao giờ sập.
- Hỗ trợ 3 loại: `PHONE`, `URL`, `TEXT_PATTERN`.

### 🏙️ QIWAI Urban — Bản đồ cảnh báo đô thị
- **MapLibre GL 3D toàn cầu** (OpenFreeMap Liberty style): pan tự do, 3D buildings, pitch camera.
- **Zero-trust reporting:** báo cáo phải kèm telemetry GPS thật (`speed`, `accuracy`) hoặc ảnh bằng chứng chụp trực tiếp + timestamp — chống spam.
- **Weighted trust score:** user uy tín cao có trọng số xác nhận lớn hơn.
- **Trạng thái `PENDING_VERIFY`:** "Ghi nhận tín hiệu ban đầu — chờ thêm xác nhận thực địa".
- **Self-healing:** xe chạy qua điểm báo ngập/kẹt với tốc độ >25km/h + GPS chính xác → tự động `EXPIRED` cảnh báo.
- **`ALL_CLEAR`:** người dùng xác nhận khu vực an toàn → đóng các alert lân cận.
- Pulse types: `FLOOD`, `TRAFFIC_JAM`, `CONSTRUCTION`, `SECURITY`, `ALL_CLEAR` — có TTL + geohash + auto cleanup.

### 📍 Định vị & Tìm kiếm thông minh
- **Chip GPS ảo 3 tầng:** cache anchor → IP geolocation (`ipwho.is`) → `watchPosition` ngầm — hiện vị trí instant trên cả laptop không chip GPS.
- **Manual pin chống ghi đè 7 ngày:** search/click bản đồ khóa tọa độ (`MANUAL_SEARCH`/`MANUAL_PIN`/`SMART_AUTOCOMPLETE`) — IP/GPS không được đè.
- **Smart autocomplete:** Photon Geocoder (OSM) + debounce 250ms + `AbortController` + location bias theo tâm bản đồ + hiển thị khoảng cách haversine.
- **Search toàn cầu:** đường/phố/quận/trường học/địa danh VN & quốc tế (Nominatim fallback).
- **Micro-telemetry:** payload <120 bytes, chỉ gửi khi di chuyển >5m hoặc mỗi 3s, ngủ đông khi ẩn tab (`keepalive`).

### 👤 Auth & Freemium
- JWT (7 ngày) + bcrypt, trust score cộng đồng.
- **Free:** 5 lượt AI/ngày · **Pro:** không giới hạn · **Guest:** 3 lượt AI/ngày/IP.
- Chỉ lớp AI tốn token bị giới hạn — hard-rule + cache miễn phí vô hạn.
- Admin endpoint đổi gói: `POST /api/v1/auth/plan` (header `x-admin-key`).

### 📱 PWA
- `manifest.json` + `service-worker.js` (cache shell, API luôn network, HTML network-first).
- "Add to Home Screen" → chạy như app native; bọc Capacitor → APK/IPA sau này.

---

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────┐
│  public/index.html  — PWA: MapLibre 3D + Shield │
│  + Urban UI + GPS ảo + Search (Photon)          │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────────────┐
│  src/app.js — Express 5 + Helmet + CORS         │
│  rate-limit (global 100/15p, AI 10/p)           │
└──┬───────────┬────────────┬─────────────────────┘
   │           │            │
┌──▼───┐  ┌────▼─────┐  ┌───▼──────┐
│Shield│  │  Auth    │  │  Urban   │   ← src/modules/ (pluggable)
└──┬───┘  └────┬─────┘  └───┬──────┘
   │           │            │
┌──▼───────────▼────────────▼──┐
│  src/core/                    │
│  ├─ ai-engine (Gemini)        │
│  ├─ database (mysql2 pool)    │
│  ├─ middlewares (JWT auth)    │
│  └─ jobs (pulse cleanup)      │
└──────────────┬───────────────┘
               │ SSL :4000
        ┌──────▼──────┐
        │  TiDB Cloud │
        └─────────────┘
```

**Nguyên tắc modular:** thêm module mới (VD: Bản đồ Đô thị, SOS) chỉ cần tạo thư mục trong `src/modules/` + 1 dòng `app.use()` — không chạm code cũ.

---

## 🚀 Quick Start (local)

```bash
npm install
cp .env.example .env   # điền DB_*, GEMINI_API_KEY, JWT_SECRET, ADMIN_KEY
npm start              # http://localhost:3000
```

Yêu cầu: Node.js 18+ và MySQL/MariaDB/TiDB tương thích.

```bash
# Khởi tạo DB (MySQL client)
mysql -u root -p < src/core/database/schema.sql
```

### Browser test nhanh
1. Mở `http://localhost:3000` → đăng ký/đăng nhập
2. Shield: dán link/tin nhắn/SĐT → "Quét Rủi Ro Ngay"
3. Urban: "Vị trí của tôi" hoặc gõ địa điểm vào ô search → bản đồ bay tới + quét pulse

---

## 📡 API Endpoints

### Auth — `/api/v1/auth`
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/register` | — | Đăng ký (SĐT/email + password ≥6) |
| POST | `/login` | — | Đăng nhập → JWT + user info |
| GET | `/me` | Bearer | Thông tin user + trust + plan |
| POST | `/plan` | `x-admin-key` | Đổi gói free/pro (admin) |

### Shield — `/api/v1/shield`
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/analyze` | optional | Phân tích rủi ro 3 lớp (rate-limit 10/phút) |
| POST | `/report` | Bearer | Báo cáo entity mới (trust ≥30) |

### Urban — `/api/v1/urban`
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/pulses` | Bearer | Tạo cảnh báo (kèm telemetry/ảnh) |
| POST | `/telemetry` | Bearer | Micro-payload GPS → auto-clear |
| GET | `/pulses?bbox=` | — | Query pulse theo bounding box |

### Health
- `GET /health` → `{ status: "ok" }` — dùng cho UptimeRobot/Render healthCheck

---

## ⚙️ Environment Variables

| Key | Bắt buộc | Mô tả |
|---|---|---|
| `PORT` | | Mặc định 3000 |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | ✅ | TiDB/MySQL connection |
| `DB_SSL` | | `true` cho TiDB Cloud |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key |
| `JWT_SECRET` | ✅ | Chuỗi random dài (production!) |
| `ADMIN_KEY` | | Key admin cho `/auth/plan` |
| `CORS_ORIGINS` | | Domain whitelist, cách nhau dấu phẩy |

Xem `.env.example` để biết format đầy đủ.

---

## 🗄️ Database Schema

- **`users`** — `phone_or_email`, `password_hash`, `trust_score`, `plan` (free/pro), `scan_date`, `scan_count`
- **`risk_entities`** — cache kết quả Shield: `entity_type`, `entity_value`, `risk_level`, `risk_score`, `ai_analysis`, `report_count`
- **`urban_pulses`** — cảnh báo đô thị: `pulse_type`, `latitude/longitude`, `geohash`, `evidence`, `status`, `expires_at`

---

## 🚀 Deploy

### Render (hiện tại)
- Blueprint: `render.yaml` — auto-deploy từ `main`
- Health check: `/health`
- Env vars cấu hình trong Render Dashboard → Environment

### TiDB Cloud
- Serverless cluster Singapore, port `4000`, `DB_SSL=true`
- Chạy `src/core/database/schema.sql` trong SQL Editor

### Keep-alive (Render free)
- `.github/workflows/keepalive.yml` — GitHub Actions ping `/health` mỗi 5 phút
- Khuyến nghị thêm UptimeRobot monitor `/health`

---

## 🗺️ Roadmap

- [ ] `/geo/resolve` — resolve ranh giới hành chính VN cập nhật
- [ ] Capacitor wrapper → APK/IPA cho CH Play/App Store
- [ ] Payment integration (Pro tier 49-99k/tháng)
- [ ] Module mới: SOS alert, bản đồ đô thị chuyên sâu
- [ ] Custom domain + Cloudflare CDN

---

## 📄 License

Private project — © 2026 QIWAI Team.
