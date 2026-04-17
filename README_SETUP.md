# 🦀 Cẩm nang cài đặt hệ sinh thái OpenClaw + Ollama + Gemma4

Trang tài liệu này hướng dẫn chi tiết quy trình xây dựng Căn Cứ AI Nội Bộ tuyệt đối bảo mật. Thay vì sử dụng API của các hãng lớn (OpenAI, Google) yêu cầu gửi dữ liệu ra ngoài, chúng ta sẽ **tự host (chạy) một máy chủ AI siêu mạnh (Gemma4) bằng Ollama**, sau đó kết nối trực tiếp vào não bộ của OpenClaw Multi-Agent!

---

## 💻 1. Cài đặt Ollama (Máy chủ AI)
*Ollama là phần mềm lõi giúp vận hành các mô hình ngôn ngữ khổng lồ (LLMs) bằng chính sức mạnh phần cứng máy tính/máy chủ của bạn (Local LLM).*

### 🟦 Dành cho máy chủ Linux / VPS (Ubuntu, Debian...)
Chỉ cần 1 dòng lệnh duy nhất để tải và cài đặt tự động:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```
*Lưu ý: Nếu VPS của bạn không có Card đồ họa (GPU), Ollama sẽ tự động chuyển sang chạy bằng sức mạnh CPU (sẽ chậm hơn bình thường).*

### 🪟 Dành cho máy tính Windows
1. Truy cập trực tiếp: [https://ollama.com/download/windows](https://ollama.com/download/windows)
2. Tải file `.exe` về và Click đúp để cài đặt như một phần mềm bình thường (Next -> Next).
3. Sau khi cài, Ollama sẽ chạy ngầm dưới góc khay hệ thống (System Tray).

---

## 🧠 2. Tải và Khởi động não bộ Gemma4
Sau khi có công cụ Ollama, ta cần cấp cho nó một bộ não. Gemma là siêu AI mã nguồn mở cực kỳ mạnh mẽ do chính Google phát triển.  

Mở Terminal (trên Linux/VPS) hoặc Command Prompt/PowerShell (trên Windows) và gõ lệnh:
```bash
ollama run gemma
```
*(Bạn có thể thay thế bằng `gemma:7b` hoặc `gemma:2b` tùy theo mức độ RAM và sức mạnh CPU của máy tính. Model càng lớn thì AI càng thông minh nhưng tính toán càng lâu. Hãy kiên nhẫn đợi nó tải về hàng GB dữ liệu).*

Thử gõ dòng: `Xin chào, bạn là ai?` ngay trong cửa sổ terminal để test độ mượt của AI trên máy tính của chính mình. Sau khi test xong, nhấn `Ctrl + D` để thoát nhưng AI vẫn sẽ chạy ngầm.

---

## 🔧 3. Triển khai Hệ thống OpenClaw kết nối Ollama
Bây giờ bộ não AI đã sẵn sàng ở port `11434`. Tiếp theo chúng ta sẽ dựng Hệ thống điều khiển **OpenClaw** để tương tác tự động hóa công việc.

**Bước 1: Tải mã nguồn OpenClaw:**
```bash
git clone https://github.com/qualaduoc/tomnuongclaw-backup.git
cd tomnuongclaw-backup
npm install
```

**Bước 2: Cài đặt cấu hình liên kết:**
Tạo 1 file `.env` (nếu chưa có) và trỏ API của OpenClaw về địa phương thay vì lên internet.
```env
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=gemma
TELEGRAM_BOT_TOKEN=token_telegram_cua_khay
PORT=3000
```
*(Nếu Khầy cài Ollama trên 1 VPS khác, nhớ sửa lại IP `127.0.0.1` thành IP của VPS và phải mở khóa port `11434` trên Ollama).*

**Bước 3: Vận hành OpenClaw Coder Agent:**
Mở hệ thống lên bằng PM2 để nó chạy ngầm vĩnh viễn:
```bash
pm2 start api_gateway.js --name "claw-gateway"
pm2 start bot.js --name "claw-telegram"
pm2 save
```

---

## 🛡️ Tối ưu hóa & Mở mạng ra Internet (Nâng cao)
Cơ bản Ollama mang tính bảo mật cực cao, nó chỉ cho phép chính máy tính cài nó được hỏi nó (tức là chỉ mở localhost `127.0.0.1`). 

**Nếu bạn cài Ollama trên máy tính Windows ở nhà, nhưng lại chạy OpenClaw trên VPS trên mạng thì phải làm sao?**
Bạn cần ép Ollama mở cửa kết nối cho máy ngoài bằng cách thiết lập biến môi trường `OLLAMA_HOST=0.0.0.0`
- **Trên Linux:** Chỉnh sửa service file của systemd: `sudo systemctl edit ollama.service` và thêm dòng `Environment="OLLAMA_HOST=0.0.0.0"`, sau đó chạy `systemctl restart ollama`.
- **Trên Windows:** Thêm Variables `OLLAMA_HOST=0.0.0.0` vào trong bảng System Environment của Windows, tắt ứng dụng Ollama và mở lại.

Chúc hệ thống của Khầy hoạt động bền bỉ, mượt mà và bất khả xâm phạm!

---
✨ *Tài liệu soạn thảo bởi Tom Nuong Claw System.*
