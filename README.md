# OpenClaw - Hệ thống Tôm Nướng Đa Tác Vụ (Multi-Agent System)

<div align="center">
  <img src="https://img.shields.io/badge/Node.js-18.x-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Puppeteer-Stealth-blue.svg" alt="Puppeteer">
  <img src="https://img.shields.io/badge/AI-Gemini%20%7C%20Ollama-orange.svg" alt="AI">
  <img src="https://img.shields.io/badge/Telegram-Bot-blue.svg" alt="Telegram">
</div>

## 📌 Khái quát dự án
**OpenClaw (Tôm Nướng)** là hệ thống AI Multi-Agent tự động hóa các linh vật (Agent) được lập trình chuyên sâu. Hệ thống kết nối đa nền tảng nhờ sự phối hợp gỡ rối qua Telegram Bot và Dashboard trực quan. Cốt lõi của OpenClaw nằm ở luồng (Pipeline) xử lý thông minh kết hợp sức mạnh API và Puppeteer tự động hóa Chrome.

## 🚀 Tính năng lõi
- **Trình duyệt Tự Động Hóa (Puppeteer Stealth):** Xuyên qua hàng rào phát hiện bot để tự động hóa tương tác với nền tảng Facebook (Duyệt bài) và Gemini web.
- **Telegram Bot Command Center:** Cổng nhận lệnh và kiểm soát quy trình của Chủ Nhân (Khầy).
- **Multi-Agent Pipeline Coder:** Hệ thống tự gạch đầu dòng, viết code (Coder), kiểm duyệt (Reviewer), thử nghiệm (Tester) và báo cáo lỗi tuần hoàn.
- **API Gateway Điều Phối:** Trung tâm tiếp nhận mọi tín hiệu API và phân luồng xử lý nhẹ nhàng.
- **Giám Sát Hệ Thống:** Bao gồm bảng điều khiển UI Frontend `dashboard/index.html` tích hợp biểu đồ thời gian thực.

## 🛠 Yêu cầu hệ thống
- **Node.js** >= 18.x
- **PM2** (Công cụ quản lý Task chạy nền)
- Khuyến nghị sử dụng VPS cấu hình đủ tải được Puppeteer (Bắt buộc tối thiểu 2-4GB RAM).
- Nếu tự phân phối Local LLM (Ollama) thì yêu cầu sức mạnh phần cứng cao hơn tùy Models.

## 📦 Hướng dẫn cài đặt

**1. Tải về kho lưu trữ bản quyền:**
```bash
git clone https://github.com/qualaduoc/tomnuongclaw-backup.git
cd tomnuongclaw-backup
```

**2. Cài đặt các siêu nạp cơ sở (Dependencies):**
```bash
npm install
```

**3. Khởi tạo Không gian Bí mật (Bắt buộc):**
Dự án này rất chú trọng bảo mật, toàn bộ tài liệu có chứa Token đều đã bị chặn vĩnh viễn không đẩy lên Github (như `fb_cookie.json`, `gemini_keys.json`, `.env`). Hãy tạo cấu hình ban đầu:
Tạo file `.env`:
```env
TELEGRAM_BOT_TOKEN=điền_token_telegram_của_bạn_vào_đây
PORT=3000
```
*(Nếu cần các chức năng Facebook tự động, vui lòng thiết lập tay các file `fb_cookie.json` dựa trên cookie của chính bạn).*

**4. Khởi động chiến cơ:**
Môi trường Debug:
```bash
node api_gateway.js
node bot.js
```

Môi trường Production (Nên Dùng):
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 logs
```

## 📜 Kiến trúc File quan trọng
- `bot.js`: Lắng nghe lệnh từ Telegram.
- `api_gateway.js`: Trung tâm phân phát API cho web/dashboard.
- `ecosystem.config.js`: File thiết lập của PM2.
- `agents/`: Phân xưởng chứa các file định nghĩa lõi tư duy của Multi-Agent.
- `dashboard/`: Thư mục mảng Front-end trực quan theo dõi.

---
✨ *Phát triển và bảo vệ bởi Tom Nuong Claw - Code for Magic.*
