// ===================================================================
// OUTPUT_VALIDATOR.JS — Bộ Kiểm Tra Cưỡng Chế
// Chặn Coder dump rác, lẫn tạp HTML/CSS/JS vào sai file
// Guard Rails: Validate + Strip garbage + Auto-reject
// ===================================================================

// ─── CƠ CHẾ 1: AI GARBAGE STRIPPER ────────────────────────────
// Loại bỏ text hội thoại AI bị dump vào code
function stripAIGarbage(content) {
    let clean = content;

    // Loại bỏ markdown fences
    clean = clean.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');

    // Loại bỏ block rác AI phổ biến (từ "FILES CẦN UPDATE" trở đi)
    const garbagePatterns = [
        /\*{0,2}FILES CẦN UPDATE[\s\S]*/i,
        /\*{0,2}SQL QUERY[\s\S]*/i,
        /\*{0,2}\d+\s*Gợi Ý[\s\S]*/i,
        /\*{0,2}5 Gợi Ý[\s\S]*/i,
        /\*{0,2}GỢI Ý HOÀN THIỆN[\s\S]*/i,
        /\*{0,2}DANH SÁCH FILE[\s\S]*/i,
        /\*{0,2}CHÚ THÍCH[\s\S]*/i,
        /\*{0,2}LƯU Ý[\s\S]*/i,
    ];

    for (const pattern of garbagePatterns) {
        clean = clean.replace(pattern, '');
    }

    // Loại bỏ dòng bắt đầu bằng ** hoặc // kèm tiếng Việt mô tả (rác comment AI)
    clean = clean.replace(/^\*\*[^*]+\*\*\s*$/gm, '');

    // Loại bỏ dòng trống liên tiếp (> 2 dòng trống → 1 dòng trống)
    clean = clean.replace(/\n{3,}/g, '\n\n');

    return clean.trim();
}

// ─── CƠ CHẾ 2: OUTPUT VALIDATOR ───────────────────────────────
// Kiểm tra file có đúng loại không (CSS phải là CSS, JS phải là JS)
function validateFileContent(filePath, content) {
    const ext = getExtension(filePath);
    const errors = [];
    const trimmed = content.trim();

    // Rule 0: File quá ngắn
    if (trimmed.length < 30) {
        errors.push(`File quá ngắn (${trimmed.length} ký tự). Có thể Coder chưa viết gì.`);
    }

    // Rule 1: Cross-contamination (lẫn tạp ngôn ngữ)
    if (ext === '.css') {
        if (/^\s*<!DOCTYPE/im.test(trimmed)) {
            errors.push('🔴 CSS file BẮT ĐẦU bằng <!DOCTYPE html> — đây là HTML, không phải CSS!');
        }
        if (/<html|<head|<body|<div|<section|<footer|<header|<script/i.test(trimmed)) {
            errors.push('🔴 CSS file CHỨA HTML tags — Coder dump toàn bộ vào 1 file!');
        }
        if (/\bdocument\s*\.\s*(addEventListener|querySelector|getElementById)\b/.test(trimmed)) {
            errors.push('🔴 CSS file CHỨA JavaScript — JS bị lẫn vào CSS!');
        }
    }

    if (ext === '.js') {
        if (/^\s*<!DOCTYPE/im.test(trimmed)) {
            errors.push('🔴 JS file BẮT ĐẦU bằng <!DOCTYPE html> — đây là HTML, không phải JS!');
        }
        if (/<html|<head|<body/i.test(trimmed)) {
            errors.push('🔴 JS file CHỨA HTML structure — Coder dump toàn bộ vào 1 file!');
        }
        if (/^\s*\.\w+\s*\{[^}]*\}/m.test(trimmed) && !/['"`]/.test(trimmed.match(/^\s*\.\w+\s*\{[^}]*\}/m)?.[0] || '')) {
            errors.push('🟡 JS file có thể CHỨA CSS rules.');
        }
    }

    if (ext === '.html') {
        if (!/<!DOCTYPE|<html|<head|<body/i.test(trimmed)) {
            errors.push('🟡 HTML file không chứa DOCTYPE hoặc thẻ html cơ bản.');
        }
    }

    // Rule 2: Rác AI còn sót
    if (/FILES CẦN UPDATE|Gợi Ý HOÀN THIỆN|SQL QUERY.*Không cần|CHÚ THÍCH/i.test(trimmed)) {
        errors.push('🔴 File CHỨA RÁC AI: text hội thoại bị dump vào code.');
    }

    // Rule 3: File chứa nhiều ngôn ngữ (multi-lang dump)
    const hasHTML = /<!DOCTYPE|<html|<head/i.test(trimmed);
    const hasCSS = /\/\*\s*style|body\s*\{|\.[\w-]+\s*\{/i.test(trimmed);
    const hasJS = /document\.addEventListener|function\s+\w+\s*\(|const\s+\w+\s*=/i.test(trimmed);
    const langCount = [hasHTML, hasCSS, hasJS].filter(Boolean).length;

    if (langCount >= 3) {
        errors.push('🔴 File chứa CẢ 3 ngôn ngữ HTML+CSS+JS — Coder dump tất cả vào 1 file!');
    } else if (langCount === 2 && ext !== '.html') {
        errors.push('🟡 File chứa 2 ngôn ngữ khác nhau — có thể lẫn tạp.');
    }

    return {
        valid: errors.filter(e => e.startsWith('🔴')).length === 0,
        errors,
        severity: errors.some(e => e.startsWith('🔴')) ? 'critical' : 
                  errors.some(e => e.startsWith('🟡')) ? 'warning' : 'ok'
    };
}

// ─── CƠ CHẾ 3: AUTO-EXTRACT ───────────────────────────────────
// Khi Coder dump tất cả vào 1 file, tách ra đúng phần cần dùng
function extractRelevantCode(filePath, content) {
    const ext = getExtension(filePath);
    let extracted = content;

    if (ext === '.css') {
        // Tìm phần CSS: từ comment /* style hoặc CSS selector đầu tiên
        const cssStart = extracted.search(/\/\*|(\*|@import|@charset|@font-face|:root|body|html|\.[\w-]+|#[\w-]+)\s*\{/i);
        if (cssStart > 0) {
            extracted = extracted.substring(cssStart);
        }
        // Cắt JS ở cuối
        const jsStart = extracted.search(/\/\/\s*(scripts?|app|main)\.js\b/i);
        if (jsStart > 0) {
            extracted = extracted.substring(0, jsStart);
        }
        // Cắt rác AI ở cuối
        const garbageStart = extracted.search(/\*{0,2}FILES CẦN UPDATE/i);
        if (garbageStart > 0) {
            extracted = extracted.substring(0, garbageStart);
        }
        // Loại bỏ HTML tags nếu còn sót
        extracted = extracted.replace(/<\/?(!DOCTYPE|html|head|body|meta|title|link|script|div|section|header|footer|p|h[1-6]|img|a|ul|li|nav|span|button|input|form|label|textarea|table|tr|td|th)[^>]*>/gi, '');
    }

    if (ext === '.js') {
        // Tìm phần JS: từ comment // hoặc keyword JS đầu tiên
        const jsStart = extracted.search(/(\/\/\s*(scripts?|app|main)\.js\b|document\.|window\.|function\s|const\s|let\s|var\s|class\s|import\s|export\s|'use strict')/i);
        if (jsStart > 0) {
            extracted = extracted.substring(jsStart);
        }
        // Loại bỏ CSS nếu còn sót
        extracted = extracted.replace(/\/\*\s*style\.css\s*\*\/[\s\S]*?(?=\/\/|document\.|window\.|function\s|const\s|$)/i, '');
        // Cắt rác AI ở cuối
        const garbageStart = extracted.search(/\*{0,2}FILES CẦN UPDATE/i);
        if (garbageStart > 0) {
            extracted = extracted.substring(0, garbageStart);
        }
        // Loại bỏ HTML tags
        extracted = extracted.replace(/<\/?(!DOCTYPE|html|head|body|meta|title|link|script|section|header|footer)[^>]*>/gi, '');
    }

    return stripAIGarbage(extracted);
}

// ─── CƠ CHẾ 4: BUILD RETRY PROMPT ─────────────────────────────
// Tạo prompt sửa lỗi cụ thể khi validator phát hiện lỗi
function buildRetryPrompt(filePath, errors, originalPrompt) {
    const ext = getExtension(filePath);
    const langName = { '.html': 'HTML', '.css': 'CSS', '.js': 'JavaScript', '.json': 'JSON' }[ext] || ext;

    return `⚠️ CẢNH BÁO: Output trước đó BỊ TỪ CHỐI vì vi phạm quy tắc!

LỖI PHÁT HIỆN:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

QUY TẮC CỨNG — VI PHẠM = BỊ TỪ CHỐI:
1. File "${filePath}" là file ${langName}. CHỈ ĐƯỢC chứa code ${langName}.
2. KHÔNG ĐƯỢC chứa code của ngôn ngữ khác (${ext === '.css' ? 'KHÔNG HTML, KHÔNG JS' : ext === '.js' ? 'KHÔNG HTML, KHÔNG CSS' : 'OK có thể link CSS/JS'}).
3. KHÔNG ĐƯỢC viết text giải thích, gợi ý, "FILES CẦN UPDATE", "SQL QUERY".
4. BẮT ĐẦU file bằng code ${langName} ngay dòng đầu tiên.

${originalPrompt}

LẦN NÀY HÃY XUẤT ĐÚNG — CHỈ CODE ${langName} THUẦN TÚY, KHÔNG GÌ KHÁC.`;
}

// ─── HELPER ────────────────────────────────────────────────────
function getExtension(filePath) {
    const dot = filePath.lastIndexOf('.');
    return dot >= 0 ? filePath.substring(dot).toLowerCase() : '';
}

// ─── PROCESS PIPELINE: Validate + Strip + Extract + Retry ──────
// Hàm tổng hợp dùng trong pipeline
function processCoderOutput(filePath, rawOutput) {
    // Bước 1: Strip garbage (rác AI)
    let cleaned = stripAIGarbage(rawOutput);

    // Bước 2: Validate
    const validation = validateFileContent(filePath, cleaned);

    if (validation.severity === 'critical') {
        // Bước 3: Nếu critical → thử auto-extract
        cleaned = extractRelevantCode(filePath, rawOutput);
        
        // Validate lần 2 sau khi extract
        const revalidation = validateFileContent(filePath, cleaned);
        
        return {
            content: cleaned,
            validation: revalidation,
            wasExtracted: true,
            needsRetry: revalidation.severity === 'critical'
        };
    }

    return {
        content: cleaned,
        validation,
        wasExtracted: false,
        needsRetry: false
    };
}

module.exports = {
    stripAIGarbage,
    validateFileContent,
    extractRelevantCode,
    buildRetryPrompt,
    processCoderOutput
};
