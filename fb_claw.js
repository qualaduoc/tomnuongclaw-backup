const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ====================================================================
// ENGINE 1: HTTP THUẦN (Primary — Nhanh, nhẹ, không cần Chrome)
// ====================================================================
function cookiesToHeader(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function postViaHTTP(content) {
    console.log("⚡ [HTTP Engine] Đang đăng bài qua mbasic.facebook.com...");
    
    const cookiesRaw = fs.readFileSync(path.join(__dirname, 'fb_cookie.json'), 'utf8');
    const cookies = JSON.parse(cookiesRaw);
    const cookieHeader = cookiesToHeader(cookies);
    
    const baseHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
        'Cookie': cookieHeader,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.5',
        'Cache-Control': 'no-cache',
    };

    // Bước 1: GET trang composer trực tiếp (tránh trang chủ bị ép tải app)
    console.log("🌐 GET mbasic.facebook.com/composer/ ...");
    const composerUrl = 'https://mbasic.facebook.com/composer/?text=&returnURI=%2F&refid=8';
    const homeRes = await axios.get(composerUrl, {
        headers: baseHeaders,
        maxRedirects: 5,
        validateStatus: () => true,
    });
    
    let html = homeRes.data;
    const finalUrl = homeRes.request?.res?.responseUrl || homeRes.config?.url || '';
    console.log(`📍 Response URL: ${finalUrl} | Status: ${homeRes.status}`);
    
    // Merge cookie mới từ response
    let mergedCookieHeader = cookieHeader;
    const setCookies = homeRes.headers['set-cookie'];
    if (setCookies && setCookies.length > 0) {
        const newParts = setCookies.map(c => c.split(';')[0]);
        mergedCookieHeader = cookieHeader + '; ' + newParts.join('; ');
        console.log(`🍪 Đã merge thêm ${newParts.length} cookie mới từ response`);
    }
    
    // Kiểm tra đăng nhập
    if (finalUrl.includes('/login') || html.includes('login_form')) {
        return { success: false, error: "Cookie hết hạn! Khầy cần cập nhật bằng lệnh /cookie trên Telegram." };
    }
    
    // Nếu composer bị chặn (ép tải app), thử trang chủ với Desktop UA
    if (!html.includes('xc_message')) {
        console.log("⚠️ Composer bị chặn, thử trang chủ mbasic...");
        const homeRes2 = await axios.get('https://mbasic.facebook.com/', {
            headers: baseHeaders,
            maxRedirects: 5,
            validateStatus: () => true,
        });
        html = homeRes2.data;
        // Merge thêm cookie
        const setCookies2 = homeRes2.headers['set-cookie'];
        if (setCookies2 && setCookies2.length > 0) {
            const newParts2 = setCookies2.map(c => c.split(';')[0]);
            mergedCookieHeader = mergedCookieHeader + '; ' + newParts2.join('; ');
        }
    }
    
    // Bước 2: Parse form composer — tìm form chứa xc_message
    const formRegex = /<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/gi;
    let composerForm = null;
    let formAction = null;
    let match;
    
    while ((match = formRegex.exec(html)) !== null) {
        if (match[2].includes('xc_message')) {
            formAction = match[1];
            composerForm = match[2];
            break;
        }
    }
    
    // Nếu vẫn không có form, thử tìm fb_dtsg bất kỳ đâu trên trang và POST trực tiếp
    if (!composerForm || !formAction) {
        console.log("⚠️ Không thấy form xc_message, thử POST trực tiếp...");
        const dtsgFallback = html.match(/name="fb_dtsg" value="([^"]+)"/);
        const jazoestFallback = html.match(/name="jazoest" value="([^"]+)"/);
        
        if (dtsgFallback) {
            console.log("🔑 Tìm thấy fb_dtsg, POST trực tiếp lên /composer/mbasic/...");
            const directForm = new URLSearchParams();
            directForm.append('fb_dtsg', dtsgFallback[1]);
            if (jazoestFallback) directForm.append('jazoest', jazoestFallback[1]);
            directForm.append('xc_message', content);
            directForm.append('view_post', 'Đăng');
            
            const directRes = await axios.post('https://mbasic.facebook.com/composer/mbasic/', directForm.toString(), {
                headers: {
                    ...baseHeaders,
                    'Cookie': mergedCookieHeader,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': 'https://mbasic.facebook.com/',
                    'Origin': 'https://mbasic.facebook.com',
                },
                maxRedirects: 5,
                validateStatus: () => true,
            });
            
            console.log(`📬 Direct POST: Status ${directRes.status}`);
            if (directRes.status >= 200 && directRes.status < 400) {
                return { success: true };
            }
            return { success: false, error: `Direct POST thất bại: HTTP ${directRes.status}` };
        }
        
        const debugPath = path.join(__dirname, `fb_debug_html_${Date.now()}.html`);
        fs.writeFileSync(debugPath, html);
        console.log(`⚠️ Không tìm thấy form composer! HTML lưu tại: ${debugPath}`);
        return { success: false, error: 'Không tìm thấy form đăng bài và không có fb_dtsg token.' };
    }
    
    console.log(`✅ Tìm thấy form! Action: ${formAction}`);
    
    // Bước 3: Thu thập tất cả hidden inputs
    const hiddenFields = {};
    const inputRegex = /<input[^>]*>/gi;
    let inputMatch;
    
    while ((inputMatch = inputRegex.exec(composerForm)) !== null) {
        const tag = inputMatch[0];
        if (tag.includes('type="hidden"') || (!tag.includes('type=') && !tag.includes('textarea'))) {
            const nameMatch = tag.match(/name="([^"]+)"/);
            const valueMatch = tag.match(/value="([^"]*)"/);
            if (nameMatch && nameMatch[1] !== 'xc_message') {
                hiddenFields[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
            }
        }
    }
    
    console.log(`📋 Đã thu thập ${Object.keys(hiddenFields).length} hidden fields: [${Object.keys(hiddenFields).join(', ')}]`);
    
    // Kiểm tra fb_dtsg (CSRF token bắt buộc)
    if (!hiddenFields['fb_dtsg']) {
        // Thử tìm fb_dtsg ở ngoài form (Facebook đôi khi đặt riêng)
        const dtsgGlobal = html.match(/name="fb_dtsg" value="([^"]+)"/);
        if (dtsgGlobal) {
            hiddenFields['fb_dtsg'] = dtsgGlobal[1];
            console.log("🔑 Tìm fb_dtsg từ bên ngoài form");
        } else {
            return { success: false, error: "Không tìm thấy token CSRF (fb_dtsg). Cookie có thể hết hạn." };
        }
    }
    
    // Bước 4: Gửi POST đăng bài
    console.log("🔥 POST bài viết lên Facebook...");
    
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(hiddenFields)) {
        formData.append(key, value);
    }
    formData.append('xc_message', content);
    formData.append('view_post', 'Đăng');
    
    // Decode HTML entities trong formAction
    const decodedAction = formAction.replace(/&amp;/g, '&');
    const postUrl = decodedAction.startsWith('http') ? decodedAction : `https://mbasic.facebook.com${decodedAction}`;
    
    const postRes = await axios.post(postUrl, formData.toString(), {
        headers: {
            ...baseHeaders,
            'Cookie': mergedCookieHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://mbasic.facebook.com/',
            'Origin': 'https://mbasic.facebook.com',
        },
        maxRedirects: 5,
        validateStatus: () => true,
    });
    
    console.log(`📬 POST Response: Status ${postRes.status}`);
    
    // Kiểm tra kết quả
    if (postRes.status >= 200 && postRes.status < 400) {
        const resHtml = typeof postRes.data === 'string' ? postRes.data : '';
        if (resHtml.includes('login') && resHtml.includes('password')) {
            return { success: false, error: "Facebook đòi đăng nhập lại sau khi POST. Cookie hết hạn." };
        }
        console.log("✅ Đăng bài thành công qua HTTP Engine!");
        return { success: true };
    }
    
    return { success: false, error: `POST thất bại với HTTP Status: ${postRes.status}` };
}


// ====================================================================
// ENGINE 2: PUPPETEER (Backup — khi HTTP Engine thất bại)  
// ====================================================================
async function postViaPuppeteer(content) {
    console.log("🦾 [Puppeteer Engine] Fallback — mở trình duyệt tàng hình...");
    
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            defaultViewport: { width: 1280, height: 800 },
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        console.log("✅ Chrome đã mở!");
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        
        // Nạp Cookie
        const cookiesString = fs.readFileSync(path.join(__dirname, 'fb_cookie.json'), 'utf8');
        const rawCookies = JSON.parse(cookiesString);
        const cleanCookies = rawCookies.map(c => {
            const cleaned = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure };
            if (c.sameSite === 'lax') cleaned.sameSite = 'Lax';
            else if (c.sameSite === 'strict') cleaned.sameSite = 'Strict';
            else if (c.sameSite === 'no_restriction') cleaned.sameSite = 'None';
            if (cleaned.sameSite === 'None') cleaned.secure = true;
            return cleaned;
        });
        await page.setCookie(...cleanCookies);
        
        // Truy cập mbasic
        await page.goto('https://mbasic.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
            const img = path.join(__dirname, `fb_login_${Date.now()}.png`);
            await page.screenshot({ path: img });
            return { success: false, error: "Cookie hết hạn", screenshot: img };
        }
        
        // Tìm và nhập nội dung
        let textarea = await page.$('textarea[name="xc_message"]');
        if (!textarea) {
            await page.goto('https://mbasic.facebook.com/composer/?text=&returnURI=%2F', { waitUntil: 'domcontentloaded', timeout: 15000 });
            textarea = await page.$('textarea[name="xc_message"]') || await page.$('textarea');
        }
        
        if (!textarea) {
            const img = path.join(__dirname, `fb_nobox_${Date.now()}.png`);
            await page.screenshot({ path: img, fullPage: true });
            return { success: false, error: "Không tìm thấy ô nhập", screenshot: img };
        }
        
        await textarea.click();
        await textarea.type(content, { delay: 50 });
        
        // Nhấn Đăng
        const submitBtn = await page.$('input[name="view_post"]');
        if (submitBtn) {
            await submitBtn.click();
        } else {
            await page.evaluate(() => { const f = document.querySelector('form[method="post"]'); if(f) f.submit(); });
        }
        
        await new Promise(r => setTimeout(r, 5000));
        const img = path.join(__dirname, `fb_success_${Date.now()}.png`);
        await page.screenshot({ path: img });
        
        return { success: true, screenshot: img };
        
    } catch (error) {
        console.error("❌ Puppeteer Engine lỗi:", error.message);
        let screenshot = null;
        try {
            if (browser) {
                const pages = await browser.pages();
                if (pages.length > 0) {
                    screenshot = path.join(__dirname, `fb_pup_err_${Date.now()}.png`);
                    await pages[pages.length - 1].screenshot({ path: screenshot });
                }
            }
        } catch(e) { /* ignore */ }
        return { success: false, error: error.message, screenshot };
    } finally {
        if (browser) try { await browser.close(); } catch(e) { /* ignore */ }
    }
}


// ====================================================================
// HÀM CHÍNH: Thử HTTP trước, Puppeteer sau
// ====================================================================
async function autoPostFacebook(content) {
    console.log("🚀 Bắt đầu quá trình Tự động Đăng Facebook...");
    console.log(`📝 Nội dung: "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`);
    
    // Ưu tiên 1: HTTP Engine (nhanh, nhẹ, ổn định)
    try {
        const httpResult = await postViaHTTP(content);
        if (httpResult.success) {
            console.log("🎉 HTTP Engine đăng thành công!");
            return httpResult;
        }
        console.log(`⚠️ HTTP Engine thất bại: ${httpResult.error}`);
        // Nếu lỗi do Cookie hết hạn thì không cần thử Puppeteer
        if (httpResult.error && httpResult.error.includes('Cookie')) {
            return httpResult;
        }
    } catch (err) {
        console.error("❌ HTTP Engine crash:", err.message);
    }
    
    // Ưu tiên 2: Puppeteer Engine (nặng hơn nhưng có thể chụp ảnh)
    console.log("🔄 Chuyển sang Puppeteer Engine (backup)...");
    try {
        const pupResult = await postViaPuppeteer(content);
        return pupResult;
    } catch (err) {
        console.error("❌ Puppeteer Engine crash:", err.message);
        return { success: false, error: `Cả 2 Engine đều thất bại. HTTP: lỗi trước đó. Puppeteer: ${err.message}` };
    }
}

module.exports = { autoPostFacebook };
