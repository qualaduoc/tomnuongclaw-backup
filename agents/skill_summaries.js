// ===================================================================
// SKILL_SUMMARIES.JS — Bản Tóm Tắt Skill Nén (Thay vì dump nguyên file)
// Mỗi agent chỉ nhận bản tóm tắt ~500 từ thay vì 50,000+ tokens skill
// Giúp model nhớ được TOÀN BỘ instructions trong context window
// ===================================================================

const SKILL_SUMMARIES = {

    // ─── TÔM CODER ──────────────────────────────────────────────
    coder: `
🔒 QUY TẮC CODE BẮT BUỘC (TÓM TẮT TỪ 9 SKILL):

[CLEAN CODE]
- SRP: Mỗi function 1 việc. DRY: Không lặp code. KISS: Đơn giản nhất có thể.
- Guard Clauses: return sớm, tối đa 2 cấp if lồng nhau.
- Không nuốt catch trống. Không dùng magic numbers.
- Tên biến tự giải thích: handleSubmit, formatCurrency, MAX_RETRY.

[ARCHITECTURE]
- Feature-based: mỗi tính năng 1 file/folder riêng.
- Dependency 1 chiều: Pages → Features → Services → Utils.
- File tối đa 500 dòng. Vượt → tách file mới.

[FILE OUTPUT - CỰC KỲ QUAN TRỌNG]
- Khi được yêu cầu viết file .css → CHỈ viết CSS. KHÔNG nhồi HTML/JS.
- Khi được yêu cầu viết file .js → CHỈ viết JS. KHÔNG nhồi HTML/CSS.
- Khi được yêu cầu viết file .html → Viết HTML, link CSS/JS đúng path.
- KHÔNG BAO GIỜ viết text giải thích, gợi ý, "FILES CẦN UPDATE" trong code.
- KHÔNG bọc code trong markdown (\`\`\`). Xuất RAW code.

[WEB PERFORMANCE]
- Import Google Fonts bằng <link> trong HTML.
- CSS: dùng rem/em, mobile-first responsive, smooth transitions.
- JS: DOMContentLoaded, event delegation, no inline scripts.

[FRONTEND DESIGN]
- Palette: 3-5 HEX harmonious. Không dùng màu thô (red, blue, green).
- Typography: Google Fonts (Inter, Roboto, Outfit...), không Times New Roman.
- Micro-animations: hover scale, fade-in, smooth transitions.
- Glassmorphism: backdrop-filter, border-radius 16px, subtle shadows.
`,

    // ─── TÔM REVIEWER ───────────────────────────────────────────
    reviewer: `
🔒 QUY TẮC REVIEW BẮT BUỘC (TÓM TẮT TỪ 5 SKILL):

[CODE REVIEW CHECKLIST]
- Kiểm tra: SRP, DRY, naming conventions, error handling.
- Phát hiện: magic numbers, deep nesting (>2 levels), catch trống.
- Đánh giá: readable, maintainable, testable.

[SECURITY - VULNERABILITY SCANNER]
- SQL Injection: dùng parameterized queries chưa?
- XSS: escape HTML output chưa?
- API Key: có expose ở frontend không? Có hardcode secret không?
- Input validation: server-side validate hay chỉ client-side?

[ARCHITECTURE REVIEW]
- File structure: feature-based hay type-based?
- Dependency: có circular dependency không?
- File size: file nào > 500 dòng cần tách?

[CẤU TRÚC FILE - QUAN TRỌNG NHẤT]
- File .css CÓ THỰC SỰ chứa CSS không? Hay chứa HTML/JS?
- File .js CÓ THỰC SỰ chứa JS không? Hay chứa HTML/CSS?
- Có text rác AI trong code không? ("FILES CẦN UPDATE", "Gợi Ý"...)
- Path link CSS/JS có đúng relative path không?
- Nếu file sai cấu trúc → ĐIỂM = 0/10 và FAIL ngay lập tức.

[CHẤM ĐIỂM]
- 9-10: Xuất sắc, production-ready.
- 7-8: Tốt, có vấn đề nhỏ.
- 5-6: Trung bình, cần sửa.
- 1-4: Tệ, cần viết lại.
- 0: File sai cấu trúc hoàn toàn (CSS chứa HTML, JS chứa HTML...).
`,

    // ─── TÔM CHỈ HUY ────────────────────────────────────────────
    director: `
🔒 QUY TẮC CHỈ HUY (TÓM TẮT):

[LẬP KẾ HOẠCH]
- Tách file đúng: index.html, css/style.css, js/app.js (KHÔNG GOM CHUNG).
- Liệt kê đầy đủ: mọi file cần tạo, không thiếu.
- Ước lượng thời gian hợp lý.

[PHÂN TÍCH]
- Socratic Gate: hỏi Purpose, Users, Scope nếu yêu cầu mơ hồ.
- Phân loại: projectMode (dự án lớn) vs single agent (hỏi đáp/sửa nhỏ).

[OUTPUT FORMAT]
- LUÔN trả JSON thuần trong <DISPATCH> block.
- Kế hoạch dự án trả JSON: { projectType, projectName, files, estimatedMinutes, steps }.
`,

    // ─── TÔM DESIGNER ───────────────────────────────────────────
    designer: `
🔒 QUY TẮC THIẾT KẾ (TÓM TẮT):

[AESTHETIC]
- Palette: 3-5 HEX harmonious, HSL-based. CẤM màu thô (red, blue, purple gắt).
- Typography: Google Fonts (Inter + Playfair Display, Outfit + Lora...).
- Style: Glassmorphism, Neumorphism, hoặc Modern Minimal.
- Animations: hover scale(1.02-1.05), fade-in, smooth transitions 0.3s ease.

[LAYOUT]
- Mobile-first responsive.
- CSS Grid/Flexbox.
- Spacing: consistent 8px grid.
- Border-radius: 8-16px, rounded corners.

[OUTPUT]
- Chỉ đặc tả thiết kế, KHÔNG viết code hoàn chỉnh.
- Format: Bảng màu → Font → Layout → Effects → Style.
`,

    // ─── TÔM TESTER ──────────────────────────────────────────────
    tester: `
🔒 QUY TẮC TEST (TÓM TẮT):

[TEST CASE]
- AAA Pattern: Arrange (chuẩn bị) → Act (thực hiện) → Assert (kiểm tra).
- Test pyramid: Unit > Integration > E2E.
- Edge cases: empty input, null, overflow, special characters.

[CHẤM ĐIỂM]
- Functionality: code có chạy đúng không?
- UI/UX: giao diện có responsive không? Có animation không?
- Performance: load time, asset size.
- Security: XSS, injection, exposed secrets.
`,

    // ─── TÔM THƯ KÝ ─────────────────────────────────────────────
    secretary: `
🔒 QUY TẮC THƯ KÝ (TÓM TẮT):
- Trả lời rõ ràng, dễ hiểu.
- Không dùng format rườm rà (**, ##).
- Tóm tắt ngắn gọn, đi thẳng vào vấn đề.
`,

    // ─── TÔM DEVOPS ──────────────────────────────────────────────
    devops: `
🔒 QUY TẮC DEVOPS (TÓM TẮT):
- Server: PM2 process management, nginx reverse proxy.
- Deploy: Git pull → npm install → pm2 reload.
- Monitor: health checks, log rotation, resource alerts.
- Security: firewall (ufw), fail2ban, SSL (certbot).
`,

    // ─── TÔM FACEBOOK ────────────────────────────────────────────
    facebook: `
🔒 QUY TẮC FACEBOOK (TÓM TẮT):
- Content: engaging, viral-worthy, CTA rõ ràng.
- SEO: hashtags relevant, timing optimal.
- Format: không dùng **, ##. Viết tự nhiên như người thật.
`,

    // ─── TÔM ZALO ────────────────────────────────────────────────
    zalo: `
🔒 QUY TẮC ZALO (TÓM TẮT):
- Tin nhắn: ngắn gọn, thân thiện, có CTA.
- Automation: broadcast theo nhóm, tự động reply.
`,

    // ─── TÔM GEMINI PRO ──────────────────────────────────────────
    gemini: `
🔒 QUY TẮC GEMINI PRO (TÓM TẮT):
- Phân tích sâu, data-driven, có nguồn dẫn.
- So sánh multi-dimensional, pros/cons rõ ràng.
- Output: structured, dễ scan, actionable insights.
`
};

module.exports = { SKILL_SUMMARIES };
