const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { autoPostFacebook } = require('./fb_claw');
const { askGeminiProHelper } = require('./gemini_puppeteer_claw');

// ĐỘI QUÂN TÔM — Multi-Agent System
const { AGENTS } = require('./agents/definitions');
const registry = require('./agents/agent_registry');
const { callAgent, runPipeline } = require('./agents/agent_pipeline');
const { orchestrate, detectMention } = require('./agents/agent_orchestrator');

// Replace with the token provided by the user
const token = '8510268058:AAGCBBl9-q-BvMzG4v5vjSaTN_MiItv7224';
const bot = new TelegramBot(token, { polling: true });

const MODEL_NAME = 'gemma4:26b';

// Memory Optimization: Keep only trailing window of conversation
const chatHistories = {};
const MAX_HISTORY = 6; 

// Layer 2: System Prompt Optimization
const SYSTEM_PROMPT = `Tên của em là Tôm Nướng, một trợ lý AI thông minh, nhiệt tình và xuất sắc. Hiện đang chạy lõi Gemma 4 26B A4B.
CHỈ THỊ BẮT BUỘC (TUYỆT ĐỐI TUÂN THỦ):
1. Xưng hô: PHẢI luôn xưng là "Em" (hoặc "Tôm Nướng") và gọi người dùng là "Khầy" một cách tôn trọng và gần gũi.
2. TRẢ LỜI CỰC KỲ SÚC TÍCH, NGẮN GỌN. Trực tiếp đi vào vấn đề không dông dài, không vòng vo.
3. KHÔNG ĐƯỢC PHÉP sử dụng bừa bãi các ký tự định dạng như dấu sao (*) hoặc dấu thăng (#) trong văn bản trả lời. Hãy trả lời trơn tru, rành mạch bằng các dòng chữ tự nhiên, trừ khi bắt buộc phải viết code block.`;

async function startBot() {
    console.log("🚀 Telegram Bot is starting directly on VPS...");

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, '⚡ Em là Tôm Nướng đã sẵn sàng thưa Khầy!\nPhiên bản TỐI ƯU HÓA ĐẶC BIỆT: Real-time Streaming, gò cấu trúc, và ép xung CPU.\n\nKhầy hãy thử hỏi em một câu đơn giản để kiểm tra phản xạ nhé!');
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text || text.startsWith('/start')) return;

        // ==========================================
        // ĐỘI QUÂN TÔM — Các lệnh điều khiển Agent
        // ==========================================

        // /agents — Xem danh sách đội quân
        if (text === '/agents') {
            return bot.sendMessage(chatId, registry.formatAgentListTelegram());
        }

        // /wake <id> — Đánh thức agent
        if (text.startsWith('/wake ')) {
            const agentId = text.substring(6).trim().toLowerCase();
            const agent = registry.getAgent(agentId);
            if (!agent) return bot.sendMessage(chatId, `❌ Không tìm thấy Agent "${agentId}". Gõ /agents để xem danh sách.`);
            registry.wakeAgent(agentId);
            return bot.sendMessage(chatId, `${agent.emoji} ${agent.name} đã THỨC DẬY và sẵn sàng nhận lệnh!`);
        }

        // /sleep <id> — Cho agent ngủ
        if (text.startsWith('/sleep ')) {
            const agentId = text.substring(7).trim().toLowerCase();
            const agent = registry.getAgent(agentId);
            if (!agent) return bot.sendMessage(chatId, `❌ Không tìm thấy Agent "${agentId}".`);
            registry.sleepAgent(agentId);
            return bot.sendMessage(chatId, `${agent.emoji} ${agent.name} đã đi ngủ khò khò... 💤`);
        }

        // /tom <agentId> <prompt> — Giao việc cho 1 Agent cụ thể
        if (text.startsWith('/tom ')) {
            const parts = text.substring(5).trim().split(/\s+/);
            const agentId = parts[0]?.toLowerCase();
            const prompt = parts.slice(1).join(' ');
            const agent = registry.getAgent(agentId);
            if (!agent) return bot.sendMessage(chatId, `❌ Agent "${agentId}" không tồn tại. Gõ /agents xem danh sách.`);
            if (agent.status === 'sleeping') return bot.sendMessage(chatId, `💤 ${agent.name} đang ngủ! Gõ /wake ${agentId} để đánh thức.`);
            if (!prompt) return bot.sendMessage(chatId, `Cú pháp: /tom ${agentId} <yêu cầu của Khầy>`);

            bot.sendChatAction(chatId, 'typing');
            const statusMsg = await bot.sendMessage(chatId, `${agent.emoji} ${agent.name} đang nhận lệnh... 🧠`);
            registry.setWorking(agentId, prompt.substring(0, 50));
            try {
                const result = await callAgent(agentId, prompt);
                registry.setIdle(agentId);
                // Chia nhỏ nếu quá 4000 ký tự
                const chunks = [];
                for (let i = 0; i < result.length; i += 4000) chunks.push(result.substring(i, i + 4000));
                await bot.editMessageText(`${agent.emoji} ${agent.name} báo cáo:\n\n${chunks[0]}`, { chat_id: chatId, message_id: statusMsg.message_id });
                for (let i = 1; i < chunks.length; i++) {
                    await bot.sendMessage(chatId, chunks[i]);
                }
            } catch (err) {
                registry.setIdle(agentId);
                await bot.editMessageText(`❌ ${agent.name} gặp lỗi: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
            }
            return;
        }

        // /pipeline <yêu cầu> — Chạy dây chuyền Code → Review → Test
        if (text.startsWith('/pipeline ')) {
            const request = text.substring(10).trim();
            if (!request) return bot.sendMessage(chatId, 'Cú pháp: /pipeline <yêu cầu viết code>');

            const headerMsg = await bot.sendMessage(chatId, '⛓️ KHỞI ĐỘNG DÂY CHUYỀN SẢN XUẤT CODE\n\nBước 1/3: Đang chờ...');

            try {
                const pipelineResult = await runPipeline('code', request,
                    async (agent, step, total) => {
                        await bot.editMessageText(`⛓️ DÂY CHUYỀN CODE\n\nBước ${step}/${total}: ${agent.emoji} ${agent.name} ĐANG LÀM VIỆC...`, { chat_id: chatId, message_id: headerMsg.message_id });
                    },
                    async (agent, step, total, output) => {
                        const preview = output.substring(0, 3800);
                        await bot.sendMessage(chatId, `${agent.emoji} ${agent.name} — HOÀN THÀNH (Bước ${step}/${total}):\n\n${preview}`);
                    }
                );

                const summary = pipelineResult.results.map(r =>
                    `${r.agentEmoji} ${r.agentName}: ${r.status === 'success' ? 'PASS' : 'FAIL'}`
                ).join('\n');
                await bot.editMessageText(`✅ DÂY CHUYỀN HOÀN TẤT!\n\n${summary}`, { chat_id: chatId, message_id: headerMsg.message_id });

                const fs = require('fs');
                const path = require('path');
                const logDir = path.join(__dirname, 'pipeline_logs');
                if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
                fs.writeFileSync(path.join(logDir, `pipeline_${Date.now()}.json`), JSON.stringify(pipelineResult, null, 2));

            } catch (err) {
                await bot.editMessageText(`❌ DÂY CHUYỀN GẶP SỰ CỐ: ${err.message}`, { chat_id: chatId, message_id: headerMsg.message_id });
            }
            return;
        }

        // ==========================================
        // /ask <yêu cầu> — CHỈ HUY THÔNG MINH phân công tự động
        // Hoặc dùng @mention: "@coder viết landing page"
        // ==========================================
        if (text.startsWith('/ask ') || detectMention(text)) {
            const userRequest = text.startsWith('/ask ') ? text.substring(5).trim() : text;
            if (!userRequest) return bot.sendMessage(chatId, 'Cú pháp: /ask <yêu cầu bất kỳ>\nHoặc: @coder viết landing page');

            bot.sendChatAction(chatId, 'typing');
            const headerMsg = await bot.sendMessage(chatId, '🎖️ Tôm Chỉ Huy đang phân tích yêu cầu...');

            try {
                const result = await orchestrate(userRequest, {
                    onRouting: async () => {
                        await bot.editMessageText('🎖️ Tôm Chỉ Huy đang phân tích và chọn Agent phù hợp...', { chat_id: chatId, message_id: headerMsg.message_id });
                    },
                    onAgentStart: async (agent, reason) => {
                        await bot.editMessageText(`🎖️ Chỉ Huy phân công: ${agent.emoji} ${agent.name}\n📋 Lý do: ${reason}`, { chat_id: chatId, message_id: headerMsg.message_id });
                    },
                    onAgentDone: async (agent, output, routing) => {
                        const chunks = [];
                        for (let i = 0; i < output.length; i += 3800) chunks.push(output.substring(i, i + 3800));
                        await bot.editMessageText(
                            `🎖️ Chỉ Huy phân công: ${agent.emoji} ${agent.name}\n📋 ${routing.reason}\n\n━━━━━ KẾT QUẢ ━━━━━\n\n${chunks[0]}`,
                            { chat_id: chatId, message_id: headerMsg.message_id }
                        );
                        for (let i = 1; i < chunks.length; i++) {
                            await bot.sendMessage(chatId, chunks[i]);
                        }
                    },
                    onPipelineStep: async (agent, step, total, status, output) => {
                        if (status === 'start') {
                            await bot.editMessageText(`⛓️ PIPELINE TỰ ĐỘNG\n\nBước ${step}/${total}: ${agent.emoji} ${agent.name} đang làm...`, { chat_id: chatId, message_id: headerMsg.message_id });
                        } else if (status === 'done' && output) {
                            await bot.sendMessage(chatId, `${agent.emoji} ${agent.name} (${step}/${total}) XONG:\n\n${output.substring(0, 3800)}`);
                        }
                    },
                    onComplete: async (pipelineResult, routing) => {
                        const summary = pipelineResult.results.map(r =>
                            `${r.agentEmoji} ${r.agentName}: ${r.status === 'success' ? 'PASS' : 'FAIL'}`
                        ).join('\n');
                        await bot.editMessageText(`✅ PIPELINE HOÀN TẤT — Chỉ Huy tổng hợp:\n\n${summary}`, { chat_id: chatId, message_id: headerMsg.message_id });

                        const fs = require('fs');
                        const path = require('path');
                        const logDir = path.join(__dirname, 'pipeline_logs');
                        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
                        fs.writeFileSync(path.join(logDir, `pipeline_${Date.now()}.json`), JSON.stringify(pipelineResult, null, 2));
                    }
                });
            } catch (err) {
                await bot.editMessageText(`❌ Lỗi hệ thống: ${err.message}`, { chat_id: chatId, message_id: headerMsg.message_id });
            }
            return;
        }

        // == LỆNH BƠM MÁU: NẠP COOKIE FACEBOOK TRỰC TIẾP ==
        if (text.startsWith('/cookie ')) {
            const newCookie = text.substring(8).trim();
            try {
                const parsedCookie = JSON.parse(newCookie);
                if (Array.isArray(parsedCookie)) {
                    const fs = require('fs');
                    const path = require('path');
                    fs.writeFileSync(path.join(__dirname, 'fb_cookie.json'), JSON.stringify(parsedCookie, null, 2));
                    return bot.sendMessage(chatId, "✅ Dạ thưa Khầy, em đã ngậm Cookie Facebook mới thành công. Móng vuốt đã sắc bén sẵn sàng cào phím!");
                }
            } catch(e) {
                return bot.sendMessage(chatId, "❌ Ôi Khầy ơi, bánh quy này hỏng rồi (Không đúng định dạng JSON chuẩn). Khầy Export JSON từ EditThisCookie rồi gửi lại em nha!");
            }
            return bot.sendMessage(chatId, "❌ Cookie phải là một danh sách Mảng (Array JSON) nha Khầy.");
        }

        // == CHẾ ĐỘ GOOGLE AI PRO (Móng vuốt tàng hình) ==
        if (text.toLowerCase().startsWith('/pro ')) {
            const prompt = text.substring(5).trim();
            bot.sendChatAction(chatId, 'typing');
            let statusMessage = await bot.sendMessage(chatId, '🚀 Tôm đang dùng cỗ máy Xoay Vòng API để gọi Gemini 2.5 Flash...\n(Tốc độ bàn thờ, Khầy giữ chặt ghế nhé!)');
            
            try {
                const responseText = await askGeminiProHelper(prompt);
                // Vì kết quả có thể dài quá 4096 ký tự của Telegram, cắt an toàn hoặc edit
                await bot.editMessageText(responseText.substring(0, 4000), { chat_id: chatId, message_id: statusMessage.message_id });
            } catch (err) {
                await bot.editMessageText("❌ Quá trình cào AI PRO bị đổ bể do lỗi hệ thống.", { chat_id: chatId, message_id: statusMessage.message_id });
            }
            return; // Dừng lại không chạy xuống GemmaVPS nữa
        }

        bot.sendChatAction(chatId, 'typing');
        
        if (!chatHistories[chatId]) {
            chatHistories[chatId] = [
                { role: "system", content: SYSTEM_PROMPT }
            ];
        }

        chatHistories[chatId].push({ role: "user", content: text });

        // Tỉa lịch sử chat tiết kiệm bộ nhớ Ngữ cảnh (Context Window)
        if (chatHistories[chatId].length > MAX_HISTORY) {
             chatHistories[chatId] = [
                 chatHistories[chatId][0],
                 ...chatHistories[chatId].slice(-(MAX_HISTORY - 1))
             ];
        }

        try {
            console.log("💬 Bắt đầu nhắn tin gửi Telegram placeholder...");
            let statusMessage = await bot.sendMessage(chatId, '🧠 Tôm đang tìm não...');
            console.log("✅ Gửi Telegram placeholder thành công! ID:", statusMessage.message_id);
            let messageIdToEdit = statusMessage.message_id;

            console.log("🤖 Đang gọi axios sang Ollama 127.0.0.1...");
            const response = await axios({
                method: 'post',
                url: `http://127.0.0.1:11434/api/chat`,
                data: {
                    model: MODEL_NAME,
                    messages: chatHistories[chatId],
                    stream: true,
                    keep_alive: -1,      // Giữ Model luôn thức trong RAM (không mất thời gian nạp lại)
                    options: {
                        // Đã gỡ bỏ num_thread: 4 để Ollama tự động bung hết hiệu năng đa luồng của VPS
                        num_ctx: 4096,       // Tăng giới hạn ngữ cảnh lên 4096 để đọc bài Facebook mượt hơn
                        temperature: 0.1,    // Hạ nhiệt độ xuống 0.1 để CPU không phải "sáng tạo" rườm rà, nhảy chữ nhanh hơn
                        top_k: 40,           // Mặc định chuẩn
                        top_p: 0.9           // Mặc định chuẩn
                    }
                },
                responseType: 'stream',
                timeout: 300000 
            });
            console.log("✅ Axios nhận stream response từ Ollama!");

            let fullResponseText = "";
            let responseBuffer = "";
            let lastEditTime = Date.now();
            let currentMessageIndex = 0;

            response.data.on('data', async (chunk) => {
                responseBuffer += chunk.toString();
                const lines = responseBuffer.split('\n');
                responseBuffer = lines.pop(); 

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.content) {
                            fullResponseText += parsed.message.content;
                        }
                    } catch (e) {
                    }
                }

                const now = Date.now();
                if (now - lastEditTime > 1500 && fullResponseText.trim().length > 0) {
                    lastEditTime = now;
                    
                    const MAX_LENGTH = 4000;
                    const parts = [];
                    for (let i = 0; i < fullResponseText.length; i += MAX_LENGTH) {
                        parts.push(fullResponseText.substring(i, i + MAX_LENGTH));
                    }
                    
                    if (parts.length - 1 > currentMessageIndex) {
                        bot.editMessageText(parts[currentMessageIndex], { chat_id: chatId, message_id: messageIdToEdit }).catch(() => {});
                        currentMessageIndex++;
                        let nextMsg = await bot.sendMessage(chatId, "✍️...");
                        messageIdToEdit = nextMsg.message_id;
                    }

                    bot.editMessageText(parts[currentMessageIndex] + " ✍️", { chat_id: chatId, message_id: messageIdToEdit }).catch(() => {});
                }
            });

            response.data.on('end', async () => {
                console.log("✅ Ollama đã stream xong toàn bộ văn bản!");
                const MAX_LENGTH = 4000;
                const parts = [];
                for (let i = 0; i < fullResponseText.length; i += MAX_LENGTH) {
                    parts.push(fullResponseText.substring(i, i + MAX_LENGTH));
                }
                const finalText = (!parts[currentMessageIndex] || parts[currentMessageIndex].trim() === '') ? 'Bot không có phần tiếp theo.' : parts[currentMessageIndex];
                
                // MÓNG VUỐT KÉP: Kiểm tra xem não bộ có quyết định đăng bài không
                if (text.toLowerCase().includes('đăng bài facebook') || text.toLowerCase().includes('đăng lên tường')) {
                     // Trích nội dung bài đăng từ tin nhắn gốc của Khầy
                     let postContent = text;
                     // Tìm nội dung sau dấu ':' hoặc trong dấu nháy
                     const quoteMatch = text.match(/['''"](.*?)['''"]/s);
                     const colonMatch = text.match(/(?:trạng thái|nội dung|này|nhé)[:\s]+(.+)/is);
                     if (quoteMatch) {
                         postContent = quoteMatch[1];
                     } else if (colonMatch) {
                         postContent = colonMatch[1].trim();
                     }
                     
                     bot.sendMessage(chatId, `🤖 Đã nhận lệnh đăng Facebook!\n📝 Nội dung: "${postContent}"\n\nEm đang mở trình duyệt tàng hình... Chờ 15 giây nhé!`);
                     const result = await autoPostFacebook(postContent);
                     if(result === true || (result && result.success)) {
                         bot.sendMessage(chatId, "✅ Thưa Khầy, em đã đăng bài lên dòng thời gian thành công rực rỡ! (Từ Trình duyệt tàng hình VPS)");
                         if (result.screenshot) {
                             bot.sendPhoto(chatId, result.screenshot, { caption: "📸 Ảnh chụp kết quả sau khi đăng:" });
                         }
                     } else {
                         const errorReason = result?.error ? `\n\n📌 Lý do: ${result.error}` : "";
                         bot.sendMessage(chatId, "❌ Thưa Khầy, có vẻ như mạng nhà anh Mark răn đe nên móng vuốt đăng bài bị chặn." + errorReason);
                         if (result && result.screenshot) {
                             bot.sendPhoto(chatId, result.screenshot, { caption: "📸 CẤP CỨU: Tôm Nướng bị chặn! Xin Khầy xem ảnh màn hình:" });
                         }
                     }
                } else {
                     bot.editMessageText(finalText, { chat_id: chatId, message_id: messageIdToEdit }).catch(() => {});
                }
                
                chatHistories[chatId].push({ role: "assistant", content: fullResponseText });

                // -- MÓNG VUỐT 3: Trích xuất Code HTML, Prettier và Preview Hình Web --
                try {
                    let codeBlock = '';
                    const htmlMatch = fullResponseText.match(/```(?:html|xml)\n([\s\S]*?)\n```/i);
                    if (htmlMatch) {
                        codeBlock = htmlMatch[1];
                    } else if (fullResponseText.includes('<!DOCTYPE html>') || fullResponseText.includes('<html')) {
                        const rawHtmlMatch = fullResponseText.match(/<(?:!DOCTYPE )?html[\s\S]*<\/html>/i);
                        if (rawHtmlMatch) {
                            codeBlock = rawHtmlMatch[0];
                        }
                    }

                    if (codeBlock && codeBlock.length > 50) {
                        const fs = require('fs');
                        const path = require('path');
                        const puppeteer = require('puppeteer');
                        const prettier = require('prettier');
                        
                        // Định dạng lề lõng láng o
                        let formattedHTML = codeBlock;
                        try {
                             formattedHTML = await prettier.format(codeBlock, { parser: "html" });
                        } catch(e) { console.error("Lỗi dóng lề:", e); }

                        // Ghi ra thư mục public /previews
                        const dirPreview = path.join(__dirname, 'previews');
                        if (!fs.existsSync(dirPreview)) fs.mkdirSync(dirPreview);
                        
                        const tempFileName = `Web_Tom_Nuong_${Date.now()}.html`;
                        const tempFilePath = path.join(dirPreview, tempFileName);
                        fs.writeFileSync(tempFilePath, formattedHTML);
                        
                        const previewUrl = `https://suites-holders-beginning-increases.trycloudflare.com/previews/${tempFileName}`;
                        
                        // Khởi động móng vuốt chụp hình tàng hình
                        await bot.sendMessage(chatId, "📸 Tôm nướng đã quật ra Web chạy mượt láng o! Đang nhét code vào Trình duyệt tàng hình chụp Demo cho Khầy...");
                        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                        const page = await browser.newPage();
                        await page.setViewport({ width: 1440, height: 900 });
                        await page.setContent(formattedHTML, { waitUntil: 'networkidle0' });
                        const screenshotBuffer = await page.screenshot({ fullPage: false });
                        await browser.close();
                        
                        // Gửi nút Bấm Telegram URL
                        await bot.sendPhoto(chatId, screenshotBuffer, {
                            caption: "🎉 **SIÊU PHẨM WEB RA LÒ TRONG TÍCH TẮC!**\n\nMã nguồn đính kèm bên dưới đã thục rình lề lối sạch đẹp như Code Mỹ.\nKhầy vuốt nhẹ nút bấm dưới đây để sờ/chạm vào trang web thật 100%!",
                            parse_mode: "Markdown",
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: "🚀 XEM & CHẠY WEB THỰC TẾ", url: previewUrl }
                                ]]
                            }
                        });
                        
                        await bot.sendDocument(chatId, tempFilePath);
                    }
                } catch(e) {
                    console.error("Lỗi xuất file web/ngrok doc:", e);
                }
            });
            
            response.data.on('error', (err) => {
                console.error("❌ Lỗi Event Stream On Error: ", err);
                bot.sendMessage(chatId, "⚠️ Đã xảy ra lỗi khi nhận dữ liệu từ AI.");
            });

        } catch (error) {
            console.error("❌ AI Error Full Stack: ", error);
            bot.sendMessage(chatId, "⚠️ Đã xảy ra lỗi hệ thống khi kết nối tới Máy chủ VPS.");
        }
    });

    console.log("✅ Optimized Bot is online with Real-time Streaming capabilities!");
}

startBot().catch(err => console.error("Critical Error: ", err));
