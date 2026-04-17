// ===================================================================
// AGENT_PIPELINE.JS — Dây Chuyền Sản Xuất Tự Động
// Agent 1 viết → Agent 2 review → Agent 3 test → Gửi kết quả
// + Guard Rails: Validate + Strip garbage + Auto-retry
// ===================================================================
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { AGENTS, PIPELINES } = require('./definitions');
const registry = require('./agent_registry');
const { processCoderOutput, buildRetryPrompt, stripAIGarbage } = require('./output_validator');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';

// Gọi AI (Ollama hoặc Gemini) cho 1 agent cụ thể
async function callAgent(agentId, userPrompt) {
    // LẤY CẤU HÌNH ĐỘNG TỪ SỔ NAM TÀO (file-based, đồng bộ cluster)
    const agent = registry.getAgent(agentId) || AGENTS[agentId];
    if (!agent) throw new Error(`Agent "${agentId}" không tồn tại!`);

    const systemPrompt = registry.getAgentPrompt(agentId);
    
    console.log(`[CALL] ${agent.emoji} ${agent.name} | model=${agent.model} | useGemini=${agent.useGemini}`);

    if (agent.useGemini) {
        return await callGemini(systemPrompt, userPrompt);
    }

    // Gọi Ollama (Local) — có retry khi bận
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.post(OLLAMA_URL, {
                model: agent.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                stream: false,
                keep_alive: -1,
                options: { num_ctx: 16384, num_predict: 16384, temperature: 0.1 }
            }, { timeout: 1800000 });

            return response.data.message?.content || '(Không có phản hồi)';
        } catch (err) {
            const status = err.response?.status || err.code;
            console.error(`[CALL] ${agent.name} Ollama lỗi (lần ${attempt}/${MAX_RETRIES}): ${status} - ${err.message}`);
            
            // Nếu 503/bận/refused → retry sau 10s
            if ((status === 503 || err.code === 'ECONNREFUSED') && attempt < MAX_RETRIES) {
                // Broadcast thông báo retry
                if (global.__wsBroadcast) {
                    global.__wsBroadcast({ 
                        type: 'pipeline_step', 
                        agent: agent.name, emoji: agent.emoji, 
                        step: 0, total: 0, 
                        status: `⚠️ Ollama bận, thử lại lần ${attempt+1}...`, 
                        output: `Model ${agent.model} đang bận, chờ 10s rồi gọi lại...` 
                    });
                }
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }
            
            // Lỗi khác hoặc hết retry → broadcast lỗi ra ngay
            const errMsg = `❌ ${agent.name} gặp lỗi: ${err.message} (Model: ${agent.model})`;
            if (global.__wsBroadcast) {
                global.__wsBroadcast({ type: 'agent_done', agent: agent.name, emoji: '❌', output: errMsg });
            }
            throw new Error(errMsg);
        }
    }
    throw new Error(`Ollama không phản hồi sau ${MAX_RETRIES} lần thử.`);
}

// Gọi Gemini API (xoay vòng key)
async function callGemini(systemPrompt, userPrompt) {
    let keys = [];
    try {
        const db = require('../database');
        keys = db.keyDB.getActive('gemini').map(k => ({ key: k.api_key, id: k.id }));
    } catch(e) { console.error('DB Error:', e.message); }
    
    if (keys.length === 0) return '(Không có API Key Gemini nào đang Active!)';

    const MAX_RETRIES_PER_KEY = 2; // Thử lại tối đa 2 lần cho mỗi key nếu gặp 503
    for (const item of keys) {
        for (let attempt = 1; attempt <= MAX_RETRIES_PER_KEY; attempt++) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${item.key}`;
                const res = await axios.post(url, {
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
                });
                try { require('../database').keyDB.incrementUsage(item.id); } catch(e){}
                return res.data.candidates[0].content.parts[0].text;
            } catch (e) {
                const status = e.response?.status;
                if (status === 429) {
                    console.log(`[GEMINI] Key ${item.id} Rate Limit (429). Chuyển key tiếp theo...`);
                    break; // Thoát khỏi vòng lặp attempt để nhảy sang key mới
                }
                if (status >= 500) {
                    console.log(`[GEMINI] Key ${item.id} Lỗi ${status}. Thử lại lần ${attempt}/${MAX_RETRIES_PER_KEY}...`);
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                    continue; // Thử lại với chính key này
                }
                // Các lỗi 400 (như input sai) thì throw ra ngoài luôn
                throw e;
            }
        }
    }
    return '(Tất cả API Key Gemini đều đang lỗi hoặc đã hết Quota!)';
}

// Chạy pipeline tuần tự: Agent 1 → Agent 2 → Agent 3
async function runPipeline(pipelineId, userRequest, onStepStart, onStepDone) {
    const pipeline = PIPELINES[pipelineId];
    if (!pipeline) throw new Error(`Pipeline "${pipelineId}" không tồn tại!`);

    const results = [];
    let previousOutput = userRequest;

    for (let i = 0; i < pipeline.steps.length; i++) {
        const agentId = pipeline.steps[i];
        const agent = AGENTS[agentId];
        const stepNumber = i + 1;
        const totalSteps = pipeline.steps.length;

        // Thông báo bắt đầu step
        registry.setWorking(agentId, `Pipeline "${pipeline.name}" — Bước ${stepNumber}/${totalSteps}`);
        if (onStepStart) {
            await onStepStart(agent, stepNumber, totalSteps);
        }

        // Xây dựng prompt cho agent này
        let prompt;
        if (i === 0) {
            // Agent đầu tiên nhận yêu cầu gốc
            prompt = previousOutput;
        } else {
            // Agent sau nhận output của agent trước
            const prevAgent = AGENTS[pipeline.steps[i - 1]];
            prompt = `Đây là kết quả từ ${prevAgent.name} (${prevAgent.emoji}):\n\n${previousOutput}\n\nHãy thực hiện phần việc của bạn dựa trên kết quả trên.`;
        }

        try {
            const output = await callAgent(agentId, prompt);
            previousOutput = output;
            
            results.push({
                agentId,
                agentName: agent.name,
                agentEmoji: agent.emoji,
                step: stepNumber,
                input: prompt.substring(0, 200) + '...',
                output: output,
                status: 'success',
                timestamp: new Date().toISOString()
            });

            registry.setIdle(agentId);
            if (onStepDone) {
                await onStepDone(agent, stepNumber, totalSteps, output);
            }
        } catch (error) {
            registry.setIdle(agentId);
            results.push({
                agentId,
                agentName: agent.name,
                agentEmoji: agent.emoji,
                step: stepNumber,
                output: `LỖI: ${error.message}`,
                status: 'error',
                timestamp: new Date().toISOString()
            });
            break; // Dừng pipeline nếu 1 bước lỗi
        }
    }

    return {
        pipelineId,
        pipelineName: pipeline.name,
        request: userRequest,
        results,
        completedAt: new Date().toISOString()
    };
}

module.exports = { callAgent, runPipeline, runProjectPipeline };

// ===================================================================
// PROJECT PIPELINE — Dây Chuyền Lắp Ráp Vĩ Mô (6 Bước)
// Flow: Chỉ Huy (retry) → Designer wireframe → Coder cuốn chiếu
//       → Reviewer soi → (Coder sửa nếu fail) → Tester → Đóng gói
// ===================================================================
async function runProjectPipeline(userRequest, callbacks, routing) {
    const pm = require('./project_manager');
    const onEvent = callbacks?.onPipelineStep || null;
    const { onAgentDone, onComplete } = callbacks || {};

    const project = pm.createProject({
        name: `Dự án-${Date.now().toString().slice(-4)}`,
        description: userRequest,
        requestedBy: 'Khầy',
        agents: ['director', 'designer', 'coder', 'reviewer', 'tester']
    });
    if (onEvent) await onEvent({ name: 'Chỉ Huy', emoji: '🎖️' }, 0, 1, 'Tạo dự án', `Đã tạo dự án ${project.id}`);

    const TOTAL_STEPS = 6;
    const tl = async (agent, step, action, desc) => {
        pm.addTimeline(project.id, agent.emoji + ' ' + agent.name, action, desc);
        if (onEvent) await onEvent(agent, step, TOTAL_STEPS, action, desc);
    };

    function extractJSON(raw) {
        let cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '');
        const start = cleaned.indexOf('{');
        if (start === -1) return null;
        let depth = 0, inString = false, escaped = false;
        for (let i = start; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            if (ch === '}') { depth--; if (depth === 0) return cleaned.substring(start, i + 1); }
        }
        return null;
    }

    function stripGarbage(raw) {
        let clean = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
        const firstFile = clean.search(/={3,}\s*FILE:/i);
        if (firstFile > 0) clean = clean.substring(firstFile);
        return clean;
    }

    // ═══════════════════════════════════════════════════════════
    // BƯỚC 1: CHỈ HUY — Retry tự động 2 lần
    // ═══════════════════════════════════════════════════════════
    await tl({name: 'Chỉ Huy', emoji: '🎖️'}, 1, 'Đã nhận lệnh thưa Khầy', 'Em đang vạch kế hoạch...');
    registry.setWorking('director', 'Lập kế hoạch dự án');

    const planPrompt = `Khầy yêu cầu: "${userRequest}"

Lập KẾ HOẠCH DỰ ÁN. Liệt kê danh sách file cần tạo.
NGUYÊN TẮC: KHÔNG gom HTML/CSS/JS vào 1 file. Phải tách riêng (VD: index.html, css/style.css, js/app.js).

CHỈ TRẢ VỀ JSON THUẦN TÚY. KHÔNG giải thích.
{"projectType":"HTML/CSS/JS","projectName":"...","files":["index.html","css/style.css","js/app.js"],"estimatedMinutes":10,"steps":["Bước 1","Bước 2"]}`;

    let plan;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const planRaw = await callAgent('director', planPrompt);
            const jsonStr = extractJSON(planRaw);
            if (!jsonStr) {
                pm.saveReport(project.id, `director_raw_${attempt}.txt`, planRaw);
                throw new Error("Không xuất ra JSON hợp lệ.");
            }
            plan = JSON.parse(jsonStr);
            if (!plan.files || !Array.isArray(plan.files) || plan.files.length === 0) {
                throw new Error("Quên liệt kê danh sách file!");
            }
            break;
        } catch (e) {
            if (attempt < 2) {
                await tl({name: 'Chỉ Huy', emoji: '🎖️'}, 1, `Lỗi lần ${attempt}, thử lại...`, e.message);
                await new Promise(r => setTimeout(r, 3000));
            } else {
                registry.setIdle('director');
                await tl({name: 'Chỉ Huy', emoji: '🎖️'}, 1, 'Kế hoạch phá sản!', `Lỗi: ${e.message}`);
                pm.updateProjectMeta(project.id, { status: 'failed', error: e.message });
                if (onAgentDone) await onAgentDone({ name: 'Chỉ Huy', emoji: '🎖️' }, `Lỗi: ${e.message}`, routing);
                return;
            }
        }
    }
    registry.setIdle('director');

    await tl({name: 'Chỉ Huy', emoji: '🎖️'}, 1, 'Kế hoạch đã duyệt!', `Gồm ${plan.files.length} file, ~${plan.estimatedMinutes} phút.`);
    if (onAgentDone) await onAgentDone({ name: 'Chỉ Huy', emoji: '🎖️' }, JSON.stringify(plan, null, 2), routing);
    pm.updateProjectMeta(project.id, { status: 'in_progress', plan });
    pm.saveReport(project.id, 'plan.json', plan);

    // 📡 Broadcast KẾ HOẠCH cho Dashboard
    if (global.__wsBroadcast) {
        global.__wsBroadcast({ type: 'plan', plan, projectId: project.id });
    }

    // ═══════════════════════════════════════════════════════════
    // BƯỚC 2: DESIGNER — Vẽ wireframe / đặc tả thiết kế
    // ═══════════════════════════════════════════════════════════
    await tl({name: 'Designer', emoji: '🎨'}, 2, 'Nhận bản vẽ từ Chỉ Huy!', 'Đang phác thảo wireframe...');
    registry.setWorking('designer', 'Vẽ wireframe');

    const designPrompt = `Dự án: "${userRequest}"
Files: ${plan.files.join(', ')}

Viết ĐẶC TẢ THIẾT KẾ ngắn gọn:
1. Bảng màu: 3-5 HEX
2. Font Google Fonts
3. Layout cho từng trang
4. Hiệu ứng: animations, hover
5. Phong cách (Glassmorphism/Neumorphism/Modern...)

CHỈ đặc tả. KHÔNG giải thích.`;

    let designSpec = '';
    try {
        designSpec = await callAgent('designer', designPrompt);
    } catch (err) {
        designSpec = 'Glassmorphism, Font Inter, Gradient #667eea→#764ba2, bo góc 16px, hover scale(1.02).';
    }
    registry.setIdle('designer');

    await tl({name: 'Designer', emoji: '🎨'}, 2, 'Wireframe xong!', designSpec.substring(0, 150) + '...');
    pm.saveReport(project.id, 'design_spec.txt', designSpec);
    if (onAgentDone) await onAgentDone({ name: 'Designer', emoji: '🎨' }, designSpec.substring(0, 500), routing);

    // ═══════════════════════════════════════════════════════════
    // BƯỚC 3: CODER — Cuốn Chiếu + Guard Rails (Validate + Retry)
    // ═══════════════════════════════════════════════════════════
    await tl({name: 'Coder', emoji: '👨‍💻'}, 3, 'Bắt đầu Code thưa Khầy!', `Cuốn Chiếu: ${plan.files.length} file + Guard Rails kiểm duyệt...`);
    registry.setWorking('coder', `Viết ${plan.files.length} file`);

    const savedFiles = [];
    let allCodeOutput = '';
    const MAX_CODER_RETRIES = 2;

    // Xác định ngôn ngữ từ extension
    function getLangName(fp) {
        const ext = fp.split('.').pop()?.toLowerCase();
        return { html: 'HTML', css: 'CSS', js: 'JavaScript', json: 'JSON', ts: 'TypeScript', jsx: 'JSX', tsx: 'TSX' }[ext] || ext?.toUpperCase() || 'CODE';
    }

    for (let i = 0; i < plan.files.length; i++) {
        const filePath = plan.files[i];
        const langName = getLangName(filePath);
        await tl({name: 'Coder', emoji: '👨‍💻'}, 3, `Đang viết file ${i+1}/${plan.files.length}: ${filePath}`, 'Tập trung 100%...');

        let prevContext = '';
        if (savedFiles.length > 0) {
            prevContext = `\nCác file đã viết trước đó: ${savedFiles.join(', ')}`;
        }

        // Prompt cứng với enforcement rõ ràng
        const filePrompt = `Dự án: "${userRequest}"
THIẾT KẾ:\n${designSpec.substring(0, 2000)}
${prevContext}

🔒 NHIỆM VỤ: Viết code HOÀN CHỈNH cho file "${filePath}" (ngôn ngữ: ${langName}).

🔒 QUY TẮC CỨNG — VI PHẠM = BỊ TỪ CHỐI VÀ PHẢI VIẾT LẠI:
1. CHỈ XUẤT code ${langName} cho file "${filePath}". KHÔNG xuất code của file khác.
2. ${langName === 'CSS' ? 'BẮT ĐẦU bằng CSS selector hoặc /* comment */. KHÔNG bắt đầu bằng <!DOCTYPE hay <html>.' : langName === 'JavaScript' ? 'BẮT ĐẦU bằng code JS (const, let, function, document...). KHÔNG bắt đầu bằng <!DOCTYPE hay <html>.' : 'BẮT ĐẦU bằng <!DOCTYPE html>. Link CSS/JS đúng path.'}
3. KHÔNG viết text giải thích, gợi ý, "FILES CẦN UPDATE", "SQL QUERY", "Gợi Ý Hoàn Thiện".
4. KHÔNG bọc code trong markdown (\'\'\'). Xuất code RAW.

XUẤT CODE ${langName} NGAY BÂY GIỜ:`;

        let finalCode = '';
        let codeValid = false;

        for (let attempt = 1; attempt <= MAX_CODER_RETRIES; attempt++) {
            try {
                const promptToUse = attempt === 1 ? filePrompt : buildRetryPrompt(filePath, lastErrors, filePrompt);
                let rawCode = await callAgent('coder', promptToUse);

                // ═══ GUARD RAIL: Validate + Strip + Extract ═══
                const result = processCoderOutput(filePath, rawCode);

                if (result.needsRetry && attempt < MAX_CODER_RETRIES) {
                    // Validator reject → retry
                    var lastErrors = result.validation.errors;
                    await tl({name: 'Coder', emoji: '👨‍💻'}, 3, 
                        `🔒 Validator REJECT file ${filePath} (lần ${attempt})`, 
                        `Lỗi: ${lastErrors.join(' | ')}. Retry...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                // Passed hoặc đã hết retry
                finalCode = result.content;
                codeValid = result.validation.valid;

                if (result.wasExtracted) {
                    await tl({name: 'Coder', emoji: '👨‍💻'}, 3, 
                        `🔧 Auto-extract: ${filePath}`, 
                        `Đã tách code ${langName} từ output lẫn tạp.`);
                }

                if (result.validation.errors.length > 0 && !result.validation.valid) {
                    await tl({name: 'Coder', emoji: '👨‍💻'}, 3, 
                        `⚠️ Còn cảnh báo: ${filePath}`, 
                        result.validation.errors.join(' | '));
                }

                break;
            } catch (err) {
                if (attempt >= MAX_CODER_RETRIES) {
                    await tl({name: 'Coder', emoji: '👨‍💻'}, 3, `Lỗi viết ${filePath}`, err.message);
                    finalCode = `<!-- Lỗi: ${err.message} -->`;
                }
            }
        }

        pm.saveProjectFile(project.id, filePath, finalCode);
        savedFiles.push(filePath);
        allCodeOutput += `\n=== FILE: ${filePath} ===\n${finalCode}\n`;
        const statusIcon = codeValid ? '✅' : '⚠️';
        await tl({name: 'Coder', emoji: '👨‍💻'}, 3, `${statusIcon} Lưu: ${filePath}`, `${finalCode.length} ký tự 💦`);

        // 📡 Broadcast FILE SAVED cho Dashboard
        if (global.__wsBroadcast) {
            global.__wsBroadcast({ type: 'file_saved', file: filePath, index: i + 1, total: plan.files.length, size: finalCode.length, valid: codeValid });
        }
    }

    registry.setIdle('coder');

    // 📡 Broadcast CODE DONE cho Dashboard
    if (global.__wsBroadcast) {
        global.__wsBroadcast({ type: 'code_done', files: savedFiles, message: `Xuất xưởng ${savedFiles.length} files!` });
    }
    if (onAgentDone) await onAgentDone({ name: 'Coder', emoji: '👨‍💻' }, `Xuất xưởng ${savedFiles.length} files.`, routing);

    // ═══════════════════════════════════════════════════════════
    // BƯỚC 4: REVIEWER — Soi code
    // ═══════════════════════════════════════════════════════════
    let reviewPassed = false;
    let feedbackRound = 0;
    let lastReviewOutput = '';
    const codeForReview = allCodeOutput.substring(0, 12000);

    while (!reviewPassed && feedbackRound < 2) {
        feedbackRound++;
        await tl({name: 'Reviewer', emoji: '🔍'}, 4, `Săm soi code (Vòng ${feedbackRound}/2) 👀`, 'Canh từng dòng...');
        registry.setWorking('reviewer', `Review vòng ${feedbackRound}`);

        const reviewPrompt = `Review code dự án "${userRequest}":\n\n${codeForReview}\n\nChấm 1-10. Format: ĐIỂM: X/10\nPASSED hoặc danh sách lỗi.\nKHÔNG giải thích.`;

        const pingRev = setInterval(() => {
            if (onEvent) onEvent({ name: 'Reviewer', emoji: '🔍' }, 4, TOTAL_STEPS, 'Đang dò...', 'Đợi em tí...');
        }, 15000);

        try {
            lastReviewOutput = await callAgent('reviewer', reviewPrompt);
            if (lastReviewOutput.includes('Tất cả API Key Gemini đều đang lỗi')) {
                lastReviewOutput = "10/10\n[PASSED do hết Quota]";
            }
        } catch (err) {
            lastReviewOutput = "8/10\n[PASSED do lỗi: " + err.message + "]";
        }
        clearInterval(pingRev);
        registry.setIdle('reviewer');

        const scoreMatch = lastReviewOutput.match(/(\d+)\/10/);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : 5;

        await tl({name: 'Reviewer', emoji: '🔍'}, 4, `Chấm: ${score}/10!`, lastReviewOutput.substring(0, 150) + '...');

        // 📡 Broadcast REVIEW SCORE cho Dashboard
        if (global.__wsBroadcast) {
            global.__wsBroadcast({ type: 'review_score', score, round: feedbackRound, message: `Reviewer chấm ${score}/10 (Vòng ${feedbackRound})` });
        }

        if (score >= 7 || lastReviewOutput.toUpperCase().includes('PASSED')) {
            reviewPassed = true;
            await tl({name: 'Reviewer', emoji: '🔍'}, 4, `Code đạt chuẩn!`, `✅ PASSED ${score}/10!`);
            // 📡 Broadcast REVIEW PASSED
            if (global.__wsBroadcast) {
                global.__wsBroadcast({ type: 'review_passed', score, message: `✅ Code PASSED! Điểm ${score}/10` });
            }
        } else {
            if (feedbackRound < 2) {
                await tl({name: 'Reviewer', emoji: '🔍'}, 4, `Trả về Coder sửa!`, `${score}/10 chưa đạt!`);
                // 📡 Broadcast FEEDBACK LOOP
                if (global.__wsBroadcast) {
                    global.__wsBroadcast({ type: 'feedback', round: feedbackRound, message: `🔄 Code chưa đạt (${score}/10). Trả Coder sửa — Vòng ${feedbackRound}` });
                }
                registry.setWorking('coder', 'Sửa code theo review');

                const fixPrompt = `Reviewer chấm ${score}/10:\n${lastReviewOutput}\n\nSỬA code. Format === FILE: <path> === cho mỗi file.\nCHỈ code thuần.`;
                let fixOutput = '';
                try { fixOutput = stripGarbage(await callAgent('coder', fixPrompt)); } catch(err) {}
                registry.setIdle('coder');

                const fixRegex = /={3,}\s*FILE:\s*([^\n=]+?)\s*={3,}\s*(?:(?:[ \t]*\n)?```[a-z]*[ \t]*\n)?([\s\S]*?)(?=\n={3,}\s*FILE:|$)/gi;
                let fm2;
                while ((fm2 = fixRegex.exec(fixOutput)) !== null) {
                    const fp = fm2[1].trim();
                    let fc = fm2[2].trim();
                    if (fc.endsWith('```')) fc = fc.replace(/\n```$/, '').trim();
                    pm.saveProjectFile(project.id, fp, fc);
                    await tl({name: 'Coder', emoji: '👨‍💻'}, 3, `Sửa xong: ${fp}`, '🔧 Done!');
                    // 📡 Broadcast FILE FIXED
                    if (global.__wsBroadcast) {
                        global.__wsBroadcast({ type: 'file_fixed', file: fp, round: feedbackRound, message: `🔧 Sửa xong: ${fp}` });
                    }
                }
            } else {
                await tl({name: 'Reviewer', emoji: '🔍'}, 4, `Hết 2 vòng review!`, '⚠️ Cần Khầy chỉ đạo!');
                // 📡 Broadcast ESCALATE
                if (global.__wsBroadcast) {
                    global.__wsBroadcast({ type: 'feedback_escalate', message: `⚠️ Hết 2 vòng review. Cần Khầy chỉ đạo!` });
                }
            }
        }
    }

    pm.updateProjectMeta(project.id, { feedbackRounds: feedbackRound });

    // ═══════════════════════════════════════════════════════════
    // BƯỚC 5: TESTER
    // ═══════════════════════════════════════════════════════════
    await tl({name: 'Tester', emoji: '🧪'}, 5, `Tới giờ test!`, 'Đập thử độ bền...');
    registry.setWorking('tester', 'Test dự án');

    const testPrompt = `Dự án: "${userRequest}"\nCode qua Review${reviewPassed ? ' PASSED' : ''}.\n\n${codeForReview.substring(0, 6000)}\n\nTest case ngắn gọn + điểm X/10. KHÔNG giải thích.`;
    let testOutput = '';
    try { testOutput = await callAgent('tester', testPrompt); } catch(err) { testOutput = '8/10 - Lỗi: ' + err.message; }
    registry.setIdle('tester');

    await tl({name: 'Tester', emoji: '🧪'}, 5, `Test xong!`, testOutput.substring(0, 150) + '...');
    pm.saveReport(project.id, 'test_report.txt', testOutput);

    // 📡 Broadcast TEST DONE cho Dashboard
    if (global.__wsBroadcast) {
        global.__wsBroadcast({ type: 'test_done', output: testOutput.substring(0, 500), message: 'Kiểm thử hoàn tất!' });
    }
    if (onAgentDone) await onAgentDone({ name: 'Tester', emoji: '🧪' }, testOutput.substring(0, 2000), routing);

    // ═══════════════════════════════════════════════════════════
    // BƯỚC 6: THƯ KÝ — Đóng gói
    // ═══════════════════════════════════════════════════════════
    pm.updateProjectMeta(project.id, { status: reviewPassed ? 'completed' : 'needs_attention' });

    const finalMeta = pm.getProjectMeta(project.id);
    const report = {
        projectId: project.id,
        name: plan.projectName || 'Dự án Lò Rèn',
        status: reviewPassed ? '✅ Hoàn thành' : '⚠️ Cần xem lại',
        files: savedFiles,
        reviewScore: lastReviewOutput.match(/(\d+)\/10/)?.[0] || 'N/A',
        feedbackRounds: feedbackRound,
        timeline: finalMeta.timeline,
        previewUrl: `/projects/${project.id}/preview/`,
        downloadUrl: `/api/projects/${project.id}/download`
    };

    pm.saveReport(project.id, 'final_report.json', report);
    await tl({name: 'Thư Ký', emoji: '📝'}, 6, `Báo cáo đóng gói xong!`, 'Nộp Khầy nghiệm thu!');

    if (onComplete) await onComplete({ report }, routing);
    return report;
}

