const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ===== HỆ THỐNG CACHE VÀ LOAD BALANCING (ROUND-ROBIN) DÀNH CHO LOCAL TELEGRAM =====
let CACHED_KEYS = [];
let currentKeyIndex = 0;

function refreshApiKeys() {
    try {
        const filePath = path.join(__dirname, 'gemini_keys.json');
        const rawData = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(rawData);
        
        CACHED_KEYS = data.filter(item => item.active).map(item => item.key);
    } catch (err) {
        console.log(`[SYS Local] Lỗi Refresh Cache: ${err.message}`);
    }
}

// Khởi chạy nạp đạn lần đầu
refreshApiKeys();
setInterval(refreshApiKeys, 180000); // 3 phút update 1 lần

async function askGeminiProHelper(promptText) {
    if (CACHED_KEYS.length === 0 || CACHED_KEYS[0].startsWith("ĐIỀN_")) {
        return "❌ Khầy chưa cấu hình API Key đang Active vào file gemini_keys.json!";
    }

    // Đọc quy tắc Tôn giáo cốt lõi
    let systemInstruction = "Bạn là Tôm Nướng.";
    try {
        systemInstruction = fs.readFileSync(path.join(__dirname, 'tom_system_prompt.txt'), 'utf8');
    } catch(e) { /* ignore */ }

    // Cơ chế Xoay Tua (Round Robin) + Tự động chuyển Key khi bị 429
    for (let i = 0; i < CACHED_KEYS.length; i++) {
        const apiKey = CACHED_KEYS[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % CACHED_KEYS.length;

        try {
            // Chọc vào model xịn nhất Flash 2.5 theo yêu cầu của Khầy
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const payload = {
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ parts: [{ text: promptText }] }]
            };
            
            const res = await axios.post(url, payload);
            return res.data.candidates[0].content.parts[0].text;

        } catch (error) {
            const status = error.response?.status;
            if (status === 429) {
                console.log(`[API KEY Local] Key bị Rate Limit (429). Tự động chuyển sang key dự phòng...`);
                continue;
            }
            console.error("❌ Gemini API Error: ", error.response?.data || error.message);
            throw new Error(`Google API ngắt kết nối.`);
        }
    }
    
    return "❌ Cạn kiệt đạn dược! Quá tải Rate Limit toàn bộ hệ thống API Keys.";
}

module.exports = { askGeminiProHelper };
