// ===================================================================
// AGENT_REGISTRY.JS — Quản Lý Trạng Thái Đội Quân Tôm
// Theo dõi real-time: ai đang làm, ai đang ngủ, ai đang bận
// + Prompt Compression: Nén skill thay vì dump nguyên file
// ===================================================================
const fs = require('fs');
const path = require('path');
const { AGENTS } = require('./definitions');
const { SKILL_SUMMARIES } = require('./skill_summaries');

// ═══ CẤU HÌNH QUAN TRỌNG ═══
// true = Dùng bản tóm tắt nén (~500 từ/agent) → Model nhớ tốt, tuân thủ rule
// false = Dump toàn bộ file SKILL.md (~50K tokens) → Model quên instruction cuối
const USE_COMPRESSED_SKILLS = true;

// Trạng thái runtime (không lưu file, mất khi restart)
const agentStates = {};

// Khởi tạo trạng thái ban đầu cho tất cả agents
function initStates() {
    for (const [id, agent] of Object.entries(AGENTS)) {
        agentStates[id] = {
            ...agent,
            status: agent.active ? 'idle' : 'sleeping',
            currentTask: null,
            lastActive: null,
            taskCount: 0
        };
    }
}
initStates();

// Map các skills cho từng Agent (dùng khi USE_COMPRESSED_SKILLS = false)
const AGENT_SKILLS_MAP = {
    director: ['intelligent-routing', 'parallel-agents', 'plan-writing', 'architecture', 'behavioral-modes', 'brainstorming', 'ui-ux-pro-max'],
    coder: ['clean-code', 'python-patterns', 'nextjs-react-expert', 'nodejs-best-practices', 'app-builder', 'tailwind-patterns', 'ui-ux-pro-max', 'frontend-design', 'web-design-guidelines'],
    reviewer: ['code-review-checklist', 'vulnerability-scanner', 'red-team-tactics', 'database-design', 'web-design-guidelines'],
    tester: ['tdd-workflow', 'testing-patterns', 'webapp-testing', 'systematic-debugging'],
    designer: ['ui-ux-pro-max', 'frontend-design', 'mobile-design', 'web-design-guidelines'],
    devops: ['server-management', 'deployment-procedures', 'performance-profiling', 'bash-linux', 'powershell-windows'],
    facebook: ['seo-fundamentals', 'geo-fundamentals'],
    zalo: ['seo-fundamentals', 'geo-fundamentals'],
    secretary: ['documentation-templates', 'i18n-localization']
};

// Lấy system prompt của agent từ file + skill (nén hoặc đầy đủ)
function getAgentPrompt(agentId) {
    const promptFile = path.join(__dirname, 'prompts', `tom_${agentId}.txt`);
    let promptStr = '';
    try {
        promptStr = fs.readFileSync(promptFile, 'utf8');
    } catch (e) {
        const agent = AGENTS[agentId];
        promptStr = `Bạn là ${agent?.name || 'Tôm Nướng'}. Xưng "Em", gọi người dùng là "Khầy". ${agent?.role || ''}. KHÔNG dùng ** hay ##.`;
    }

    if (USE_COMPRESSED_SKILLS) {
        // ═══ CHẾ ĐỘ NÉN: Dùng bản tóm tắt ~500 từ ═══
        const summary = SKILL_SUMMARIES[agentId];
        if (summary) {
            promptStr += '\n\n=========================================\n' +
                         '🔒 QUY TẮC BẮT BUỘC (BẢN NÉN — PHẢI TUÂN THỦ TUYỆT ĐỐI)\n' +
                         '=========================================\n' +
                         summary;
        }
    } else {
        // ═══ CHẾ ĐỘ ĐẦY ĐỦ: Dump toàn bộ SKILL.md (CẨN THẬN: có thể gây context overflow!) ═══
        const mappedSkills = AGENT_SKILLS_MAP[agentId] || [];
        if (mappedSkills.length > 0) {
            promptStr += '\n\n=========================================\n' +
                         '👉 BỘ KỸ NĂNG VÀ QUY TẮC BẮT BUỘC (LÕI HỆ THỐNG) 👈\n' +
                         '=========================================\n' +
                         'Dưới đây là các kỹ năng chuyên môn bạn ĐÃ HỌC và PHẢI ÁP DỤNG MỘT CÁCH TUYỆT ĐỐI:\n\n';
            for (const skill of mappedSkills) {
                const skillPath = path.join(__dirname, '..', '.agent', 'skills', skill, 'SKILL.md');
                try {
                    if (fs.existsSync(skillPath)) {
                        promptStr += `\n--- [KỸ NĂNG: ${skill.toUpperCase()}] ---\n${fs.readFileSync(skillPath, 'utf8')}\n`;
                    }
                } catch (err) {
                    console.error(`Không thể đọc skill ${skillPath}:`, err.message);
                }
            }
        }
    }

    return promptStr;
}

// Đánh thức agent (chuyển từ sleeping → idle)
function wakeAgent(agentId) {
    if (agentStates[agentId]) {
        agentStates[agentId].status = 'idle';
        agentStates[agentId].active = true;
    }
}

// Cho agent ngủ (chuyển → sleeping)
function sleepAgent(agentId) {
    if (agentStates[agentId]) {
        agentStates[agentId].status = 'sleeping';
        agentStates[agentId].active = false;
        agentStates[agentId].currentTask = null;
    }
}

// Đánh dấu agent đang làm việc
function setWorking(agentId, taskDescription) {
    if (agentStates[agentId]) {
        agentStates[agentId].status = 'working';
        agentStates[agentId].currentTask = taskDescription;
        agentStates[agentId].lastActive = new Date().toISOString();
    }
}

// Đánh dấu agent đã hoàn thành
function setIdle(agentId) {
    if (agentStates[agentId]) {
        agentStates[agentId].status = 'idle';
        agentStates[agentId].currentTask = null;
        agentStates[agentId].taskCount++;
    }
}

// Lấy danh sách tất cả agents kèm trạng thái
function getAllAgents() {
    return Object.values(agentStates);
}

// Lấy agents đang hoạt động (không ngủ)
function getActiveAgents() {
    return Object.values(agentStates).filter(a => a.status !== 'sleeping');
}

// Lấy 1 agent cụ thể
function getAgent(agentId) {
    return agentStates[agentId] || null;
}

// Format danh sách agents cho Telegram
function formatAgentListTelegram() {
    const lines = ['🦐 ĐỘI QUÂN TÔM NƯỚNG — Bảng Điều Khiển\n'];
    
    const active = Object.values(agentStates).filter(a => a.status !== 'sleeping');
    const sleeping = Object.values(agentStates).filter(a => a.status === 'sleeping');
    
    lines.push('ĐANG TÚC TRỰC:');
    for (const a of active) {
        const statusIcon = a.status === 'working' ? '🔴 ĐANG LÀM' : '🟢 Sẵn sàng';
        lines.push(`  ${a.emoji} ${a.name} — ${statusIcon}`);
        if (a.status === 'working' && a.currentTask) {
            lines.push(`     └─ ${a.currentTask}`);
        }
    }
    
    if (sleeping.length > 0) {
        lines.push('\nĐANG NGỦ KHÒ KHÒ:');
        for (const a of sleeping) {
            lines.push(`  ${a.emoji} ${a.name} 💤 (gõ /wake ${a.id} để đánh thức)`);
        }
    }
    
    lines.push('\nLỆNH ĐIỀU KHIỂN:');
    lines.push('  /ask <yêu cầu> — Chỉ Huy tự phân công Agent phù hợp');
    lines.push('  @coder <yêu cầu> — Giao trực tiếp cho Agent cụ thể');
    lines.push('  /tom <tên> <câu hỏi> — Giao việc cho Agent cụ thể');
    lines.push('  /pipeline <yêu cầu> — Chạy dây chuyền Code→Review→Test');
    lines.push('  /wake <tên> / /sleep <tên> — Đánh thức / cho ngủ');
    
    return lines.join('\n');
}

// ===== CORE CONFIG: ĐỌC/GHI TỪ SQLITE ĐỂ ĐỒNG BỘ CLUSTER =====
let _agentDB = null;
function _getDB() {
    if (!_agentDB) {
        try { _agentDB = require('../database').agentDB; } catch(e) { console.error('[Registry] DB not ready:', e.message); }
    }
    return _agentDB;
}

// Update Model Core for Agent — ghi DB để tất cả process cluster đều thấy
function updateAgentCore(agentId, useGemini, model) {
    if (!agentStates[agentId]) return null;
    
    // Cập nhật RAM process hiện tại
    agentStates[agentId].useGemini = useGemini;
    if (model) agentStates[agentId].model = model;
    
    // Ghi xuống SQLite (TẤT CẢ process cluster tự thấy vì dùng chung 1 file DB)
    const db = _getDB();
    if (db) db.updateCore(agentId, useGemini, model);
    
    return agentStates[agentId];
}

// Lấy agent với cấu hình THỰC TẾ từ DB (đồng bộ cluster tự nhiên)
function getAgentLive(agentId) {
    const agent = agentStates[agentId];
    if (!agent) return null;
    
    const db = _getDB();
    if (db) {
        const row = db.getById(agentId);
        if (row) {
            agent.useGemini = !!row.use_gemini;
            agent.model = row.model || agent.model;
        }
    }
    return agent;
}

// Lấy TẤT CẢ agents với config mới nhất từ DB
function getAllAgentsLive() {
    const db = _getDB();
    let dbAgents = {};
    if (db) {
        const rows = db.getAll();
        for (const r of rows) dbAgents[r.id] = r;
    }
    
    return Object.values(agentStates).map(a => {
        const live = { ...a };
        const row = dbAgents[a.id];
        if (row) {
            live.useGemini = !!row.use_gemini;
            live.model = row.model || live.model;
        }
        return live;
    });
}

module.exports = {
    getAgentPrompt,
    wakeAgent,
    sleepAgent,
    setWorking,
    setIdle,
    getAllAgents: getAllAgentsLive,
    getActiveAgents,
    getAgent: getAgentLive,
    updateAgentCore,
    formatAgentListTelegram
};
