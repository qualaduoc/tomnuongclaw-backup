const axios = require('axios');
const fs = require('fs');

class GeminiCookieClaw {
    constructor(cookieFilePath = './gemini_cookie.json') {
        // Đọc cấu hình từ file
        const cookies = JSON.parse(fs.readFileSync(cookieFilePath, 'utf8'));
        this.psid = cookies['__Secure-1PSID'];
        this.psidts = cookies['__Secure-1PSIDTS'];
        this.psidcc = cookies['__Secure-1PSIDCC'];
        
        // Hợp nhất thành Header chuẩn
        this.cookieHeader = `__Secure-1PSID=${this.psid}; __Secure-1PSIDTS=${this.psidts}; __Secure-1PSIDCC=${this.psidcc};`;
        this.SNlM0e = null; // Token phiên làm việc bảo mật
    }

    /**
     * BƯỚC 1: Đột nhập vào trang chủ để lấy "chìa khóa" SNlM0e
     */
    async fetchSessionToken() {
        console.log("⏳ Bắt đầu đi đêm vào Gemini để lấy SNlM0e...");
        try {
            const res = await axios.get('https://gemini.google.com/', {
                headers: {
                    'Cookie': this.cookieHeader,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                }
            });
            
            // Cào cấu trúc HTML để rút trích mã SNlM0e (Google trả về mã này để cấp phép gọi batchexecute)
            const match = res.data.match(/"SNlM0e":"(.*?)"/);
            if (match && match[1]) {
                this.SNlM0e = match[1];
                console.log("✅ Đã lấy được Chìa khóa SNlM0e thành công!");
            } else {
                throw new Error("Không tìm thấy SNlM0e trong HTML. Có thể Cookie đã hết hạn hoặc Google đã khóa tài khoản này lại (bắt CAPTCHA).");
            }
        } catch (error) {
            console.error("❌ Lỗi Fetch Token Phiên: ", error.message);
            throw error;
        }
    }

    /**
     * BƯỚC 2: Bơm trực tiếp câu hỏi qua cổng ngầm batchexecute (Không qua giao diện)
     */
    async askGemini(promptText) {
        if (!this.SNlM0e) {
            await this.fetchSessionToken();
        }

        console.log(`🧠 Tôm Nướng đang vắt não Gemini PRO với câu hỏi: "${promptText}"`);
        
        // Định dạng mảng "tà đạo" của Google (RPC - Remote Procedure Call)
        // LƯU Ý: Cấu trúc mảng này của Google thay đổi liên tục, nếu lỗi parse array, Khầy sẽ cần cập nhật cấu trúc tại đây.
        const reqArray = JSON.stringify([[promptText], null, []]);
        const fReq = JSON.stringify([[["Wz173D", reqArray, null, "generic"]]]);

        // Cổng hậu batchexecute
        const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=Wz173D&_reqid=${Math.floor(Math.random() * 10000)}&rt=c`;

        try {
            const res = await axios.post(url, new URLSearchParams({
                'f.req': fReq,
                'at': this.SNlM0e
            }), {
                headers: {
                    'Cookie': this.cookieHeader,
                    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                }
            });

            // Kết quả trả về là một cục chuỗi rác lồng ghép nhiều JSON
            // Đoạn này bóc tách JSON thô (parse Google's envelope response)
            console.log("✅ Đã nhận được cục dữ liệu thô từ Google!");
            
            // Trả về dữ liệu gốc để xử lý. Việc cào chữ ra khỏi mảng nhiều lớp cần bắt chính xác mảng nào chứa text.
            // Để hệ thống không crash vì Google đổi format, tạm thời log ra kết quả đoạn đầu.
            console.log("================= KẾT QUẢ RAW ==================");
            console.log(res.data.substring(0, 500) + "... [Đã cắt bớt cho gọn]");
            
            return res.data; 

        } catch (error) {
             console.error("❌ Lỗi Gửi Lệnh batchexecute: ", error.message);
             if (error.response) {
                 console.log(error.response.data);
             }
        }
    }
}

// === Chạy thử nghiệm ngay tại đây (Khầy gõ: node gemini_cookie_claw.js) ===
if (require.main === module) {
    const claw = new GeminiCookieClaw();
    claw.askGemini("Xin chào, bạn có phải là Gemini Advanced (Google AI PRO) không?").then(() => {
        console.log("Thử nghiệm hoàn tất.");
    }).catch(err => {
        console.log("Xin hãy điền Cookie vào file gemini_cookie.json trước!");
    });
}

module.exports = { GeminiCookieClaw };
