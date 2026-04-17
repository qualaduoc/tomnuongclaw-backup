// ===================================================================
// AGENT_ORCHESTRATOR.JS — Bộ Chỉ Huy Thông Minh
// Tôm Chỉ Huy phân tích yêu cầu → phân công → pipeline → tổng hợp
// ===================================================================
const { AGENTS } = require('./definitions');
const registry = require('./agent_registry');
const { callAgent, runPipeline, runProjectPipeline } = require('./agent_pipeline');

// Regex phát hiện @mention: @coder, @reviewer, @Tôm Coder, etc.
const MENTION_PATTERNS = {
    coder:    /@(coder|tom\s*coder|tôm\s*coder)/i,
    reviewer: /@(reviewer|tom\s*reviewer|tôm\s*reviewer)/i,
    tester:   /@(tester|tom\s*tester|tôm\s*tester)/i,
    facebook: /@(facebook|tom\s*facebook|tôm\s*facebook)/i,
    secretary:/@(secretary|thư\s*ký|tom\s*thư\s*ký|tôm\s*thư\s*ký)/i,
    gemini:   /@(gemini|tom\s*gemini|tôm\s*gemini)/i,
    director: /@(director|chỉ\s*huy|tom\s*chỉ\s*huy|tôm\s*chỉ\s*huy)/i
};

// Phát hiện @mention trong tin nhắn
function detectMention(text) {
    for (const [agentId, pattern] of Object.entries(MENTION_PATTERNS)) {
        if (pattern.test(text)) {
            return agentId;
        }
    }
    return null;
}

// Dọn @mention khỏi tin nhắn, lấy nội dung thuần
function cleanMention(text) {
    for (const pattern of Object.values(MENTION_PATTERNS)) {
        text = text.replace(pattern, '').trim();
    }
    return text;
}

// Phân tích yêu cầu bằng keyword (fallback nhanh, không cần AI)
function quickRouteByKeyword(text) {
    const lower = text.toLowerCase();
    
    // Code-related keywords → LUÔN LUÔN chạy Project Pipeline khép kín
    // (Chỉ Huy lập kế hoạch → Coder viết → Reviewer soi → Tester test → Đóng gói → Báo cáo Khầy)
    if (/\b(viết code|tạo web|landing ?page|html|css|javascript|react|api|script|app|ứng dụng|website|component|function|database|sql|thiết kế|design|giao diện|page|trang web|frontend|backend|fullstack|create|build|xây dựng|dự án|project|triển khai)/i.test(lower)) {
        return { agent: null, pipeline: null, projectMode: true, reason: 'Yêu cầu tạo code/thiết kế → Project Pipeline: Lập kế hoạch → Code → Review → Test → Đóng gói' };
    }
    
    // Review keywords
    if (/\b(review|kiểm tra code|check code|xem code|soi code|debug|tìm bug|fix bug)\b/i.test(lower)) {
        return { agent: 'reviewer', pipeline: null, reason: 'Yêu cầu review/kiểm tra code' };
    }
    
    // Test keywords
    if (/\b(test|kiểm thử|test case|unit test|viết test|chạy test)\b/i.test(lower)) {
        return { agent: 'tester', pipeline: null, reason: 'Yêu cầu testing' };
    }
    
    // Facebook / Marketing keywords
    if (/\b(facebook|fanpage|đăng bài|viết post|content|marketing|mxh|mạng xã hội|caption|hashtag|viral)\b/i.test(lower)) {
        return { agent: 'facebook', pipeline: null, reason: 'Yêu cầu liên quan Facebook/Marketing' };
    }
    
    // Writing / Secretary keywords
    if (/\b(viết email|soạn|tóm tắt|dịch|translate|letter|thư|văn bản|báo cáo|report)\b/i.test(lower)) {
        return { agent: 'secretary', pipeline: null, reason: 'Yêu cầu viết văn bản/soạn thảo' };
    }
    
    // Complex analysis → Gemini
    if (/\b(phân tích|so sánh|chiến lược|xu hướng|trend|đánh giá|research|nghiên cứu)\b/i.test(lower)) {
        return { agent: 'gemini', pipeline: null, reason: 'Yêu cầu phân tích phức tạp → Gemini Cloud' };
    }
    
    // Default → Secretary (general assistant)
    return { agent: 'secretary', pipeline: null, reason: 'Câu hỏi chung → Thư ký trả lời' };
}

// Phân công thông minh bằng AI Director (gọi Gemma 4)
async function smartRoute(text) {
    try {
        const result = await callAgent('director', text);
        
        // Parse JSON từ <DISPATCH> block
        const match = result.match(/<DISPATCH>\s*(\{[\s\S]*?\})\s*<\/DISPATCH>/);
        if (match) {
            const dispatch = JSON.parse(match[1]);
            return {
                agent: dispatch.agent || null,
                pipeline: dispatch.pipeline || null,
                projectMode: !!dispatch.projectMode,
                reason: dispatch.reason || 'Director phân công'
            };
        }
    } catch (e) {
        console.error('Director routing error:', e.message);
    }
    
    // Fallback: keyword-based routing
    return quickRouteByKeyword(text);
}

// === HÀM CHÍNH: Orchestrate ===
// Nhận tin nhắn từ Khầy → phân tích → phân công → thực thi → tổng hợp kết quả
async function orchestrate(userMessage, callbacks = {}) {
    const { onRouting, onAgentStart, onAgentDone, onPipelineStep, onComplete } = callbacks;
    
    // BƯỚC 1: Kiểm tra @mention
    const mentionedAgent = detectMention(userMessage);
    const cleanText = cleanMention(userMessage);
    
    let routing;
    
    if (mentionedAgent) {
        // Khầy @mention cụ thể → giao thẳng
        routing = {
            agent: mentionedAgent,
            pipeline: null,
            reason: `Khầy chỉ định @${AGENTS[mentionedAgent]?.name || mentionedAgent}`
        };
    } else {
        // Không @mention → Chỉ Huy phân tích
        if (onRouting) await onRouting();
        routing = await smartRoute(cleanText || userMessage);
    }
    
    // BƯỚC 2: Thực thi
    const taskText = cleanText || userMessage;
    
    // === CHẾ ĐỘ DỰ ÁN LỚN (Project Pipeline) ===
    if (routing.projectMode) {
        const events = [];
        
        // Gọi đúng signature: runProjectPipeline(userRequest, callbacks, routing)
        const report = await runProjectPipeline(taskText, {
            onPipelineStep: async (agent, step, total, status, output) => {
                events.push({ type: 'step', agent: agent.name, emoji: agent.emoji, step, total, status, output });
                if (onPipelineStep) await onPipelineStep(agent, step, total, status, output);
            },
            onAgentDone: async (agent, output, rt) => {
                if (onAgentDone) await onAgentDone(agent, output, rt || routing);
            },
            onComplete: async (result, rt) => {
                if (onComplete) await onComplete(result, rt || routing);
            }
        }, routing);
        
        if (onComplete) await onComplete({ results: events, report }, routing);
        return { type: 'project', routing, report, events };
    }
    
    if (routing.pipeline) {
        // Chạy Pipeline thường
        const result = await runPipeline(routing.pipeline, taskText,
            async (agent, step, total) => {
                if (onPipelineStep) await onPipelineStep(agent, step, total, 'start');
            },
            async (agent, step, total, output) => {
                if (onPipelineStep) await onPipelineStep(agent, step, total, 'done', output);
            }
        );
        
        if (onComplete) await onComplete(result, routing);
        return { type: 'pipeline', routing, result };
        
    } else if (routing.agent) {
        // Giao cho 1 Agent
        const agent = registry.getAgent(routing.agent) || AGENTS[routing.agent];
        if (!agent) throw new Error(`Agent "${routing.agent}" không tồn tại`);
        
        registry.setWorking(routing.agent, taskText.substring(0, 50));
        if (onAgentStart) await onAgentStart(agent, routing.reason);
        
        // PING liên tục mỗi 15s để báo hiệu agent còn đang gõ phím
        const pingInterval = setInterval(async () => {
             if (onPipelineStep) await onPipelineStep(agent, 1, 1, 'Đang làm...', 'Vẫn đang gõ phím, Khầy chờ ly cafe nhé...');
        }, 15000);

        try {
            const output = await callAgent(routing.agent, taskText);
            clearInterval(pingInterval);
            registry.setIdle(routing.agent);
            
            if (onAgentDone) await onAgentDone(agent, output, routing);
            return { type: 'single', routing, agent, output };
        } catch (err) {
            clearInterval(pingInterval);
            registry.setIdle(routing.agent);
            throw err;
        }
    }
    
    throw new Error('Không xác định được Agent hoặc Pipeline');
}

module.exports = { orchestrate, detectMention, cleanMention, quickRouteByKeyword };
