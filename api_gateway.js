const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = 3000;
const API_KEY = 'khay_vip_2026';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL_NAME = 'gemma4:26b';

// ===== HỆ THỐNG CACHE VÀ LOAD BALANCING (ROUND-ROBIN) =====
let CACHED_KEYS = [];
let currentKeyIndex = 0;

function refreshApiKeys() {
    try {
        const db = getDB();
        if (db) {
            const activeKeys = db.keyDB.getActive('gemini');
            CACHED_KEYS = activeKeys.map(k => ({ key: k.api_key, id: k.id }));
            console.log(`[SYS] Cache Refreshed: Đang nạp ${CACHED_KEYS.length} Gemini API Keys từ DB.`);
        }
    } catch (err) {
        console.log(`[SYS] Lỗi Refresh Cache: ${err.message}`);
    }
}

// Khởi chạy nạp đạn lần đầu
refreshApiKeys();
// Tự làm mới Cache mỗi 3 phút (3 * 60 * 1000 ms) như quy định
setInterval(refreshApiKeys, 180000);

async function askGeminiOfficial(contents, systemInstruction) {
    if (CACHED_KEYS.length === 0) {
        return "❌ Khầy chưa cấu hình API Key nào! Hãy mở Kho Dự Án -> Cài đặt hệ thống để thêm Key Gemini.";
    }

    // Cơ chế Xoay Tua (Round Robin) + Tự động chuyển Key khi bị 429
    // N key x 15 RPM = Rất nhiều Throughput
    for (let i = 0; i < CACHED_KEYS.length; i++) {
        const keyItem = CACHED_KEYS[currentKeyIndex];
        const apiKey = keyItem.key;
        currentKeyIndex = (currentKeyIndex + 1) % CACHED_KEYS.length;

        try {
            // Sử dụng model Flash siêu tốc và chi phí rẻ nhất: gemini-2.5-flash
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const payload = {
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: contents
            };
            
            const res = await axios.post(url, payload);
            try { getDB().keyDB.incrementUsage(keyItem.id); } catch(e){}
            return res.data.candidates[0].content.parts[0].text;

        } catch (error) {
            const status = error.response?.status;
            if (status === 429) {
                console.log(`[API KEY] Key ${apiKey.substring(0, 5)}... bị Rate Limit (429). Tự động chuyển...`);
                continue; // Vòng lặp sẽ chạy tiếp để thử key kế tiếp
            }
            console.error("❌ Gemini API Error: ", error.response?.data || error.message);
            throw new Error(`Google API ngắt kết nối (Mã lỗi: ${status || 'Không xác định'}).`);
        }
    }
    
    return "❌ Cạn kiệt đạn dược! Toàn bộ mảng API Key của Khầy đều đã bị quá tải (429 Limit). Vui lòng đợi hoặc nạp thêm Key mới.";
}

// Increase payload limit
app.use(express.json({limit: '50mb'}));

// CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        return res.status(200).json({});
    }
    next();
});

// Mở khoáng cổng giao tiếp trực tiếp để Xem Web (Bỏ qua khóa Bảo Mật)
app.use('/previews', express.static(path.join(__dirname, 'previews')));

// Dashboard Pixel Office (public)
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// ===== OLLAMA PROXY CHO OPENCODE (public — không cần API Key) =====
// OpenCode app kết nối qua: http://<domain>/ollama/api/tags
// Proxy mọi request /ollama/* → Ollama localhost:11434
const { createProxyMiddleware } = (() => {
    try { return require('http-proxy-middleware'); } catch(e) { return {}; }
})();

if (createProxyMiddleware) {
    app.use('/ollama', createProxyMiddleware({
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        pathRewrite: { '^/ollama': '' },
        ws: true,
        onProxyRes: (proxyRes) => {
            // Cho phép CORS từ OpenCode app
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        }
    }));
    console.log('[SYS] ✅ Ollama Proxy đã kích hoạt tại /ollama/ (cho OpenCode)');
} else {
    // Fallback: Proxy thủ công bằng axios (không cần thêm package)
    // Dùng app.use để match cả /ollama, /ollama/, /ollama/api/tags, etc.
    app.use('/ollama', async (req, res) => {
        try {
            const targetPath = req.path === '/' ? '/' : req.path;
            const targetUrl = `http://127.0.0.1:11434${targetPath}`;
            
            // Streaming support cho generate/chat endpoints
            if (req.method === 'POST' && (targetPath.includes('/api/chat') || targetPath.includes('/api/generate'))) {
                const response = await axios.post(targetUrl, req.body, {
                    responseType: 'stream',
                    timeout: 600000 // 10 phút cho model lớn
                });
                res.setHeader('Content-Type', response.headers['content-type'] || 'application/x-ndjson');
                response.data.pipe(res);
            } else if (req.method === 'POST') {
                const response = await axios.post(targetUrl, req.body, { timeout: 60000 });
                res.json(response.data);
            } else if (req.method === 'DELETE') {
                const response = await axios.delete(targetUrl, { timeout: 30000 });
                res.json(response.data);
            } else {
                const response = await axios.get(targetUrl, { timeout: 30000 });
                // Trả đúng content-type từ Ollama (string vs JSON)
                const ct = response.headers['content-type'] || '';
                if (ct.includes('json')) {
                    res.json(response.data);
                } else {
                    res.send(response.data);
                }
            }
        } catch (err) {
            console.error('[Ollama Proxy] Error:', err.message);
            res.status(err.response?.status || 502).json({ 
                error: `Ollama proxy error: ${err.message}` 
            });
        }
    });
    console.log('[SYS] ✅ Ollama Proxy (axios fallback) đã kích hoạt tại /ollama/');
}

// ===== PROJECT MANAGEMENT APIs =====
const pm = require('./agents/project_manager');

// Preview dự án (serve static từ src/)
app.use('/projects/:id/preview', (req, res, next) => {
    const projectPath = path.join(pm.PROJECTS_DIR, req.params.id, 'src');
    if (!fs.existsSync(projectPath)) return res.status(404).json({ error: 'Project not found' });
    express.static(projectPath)(req, res, next);
});

// Liệt kê tất cả dự án
app.get('/api/projects', (req, res) => {
    try {
        const projects = pm.listProjects();
        res.json({ success: true, projects });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Chi tiết 1 dự án (kèm timeline)
app.get('/api/projects/:id', (req, res) => {
    try {
        const meta = pm.getProjectMeta(req.params.id);
        if (!meta) return res.status(404).json({ success: false, error: 'Không tìm thấy dự án' });
        const sizeInfo = pm.checkSizeLimit(req.params.id);
        res.json({ success: true, project: { ...meta, ...sizeInfo } });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Timeline dự án (báo cáo ai làm gì)
app.get('/api/projects/:id/timeline', (req, res) => {
    try {
        const meta = pm.getProjectMeta(req.params.id);
        if (!meta) return res.status(404).json({ success: false, error: 'Không tìm thấy dự án' });
        res.json({ success: true, timeline: meta.timeline, agents: meta.agents });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Download ZIP dự án
app.get('/api/projects/:id/download', (req, res) => {
    try {
        const zipPath = pm.zipProject(req.params.id);
        if (!zipPath) return res.status(404).json({ error: 'Không tạo được ZIP' });
        res.download(zipPath);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Xóa dự án
app.delete('/api/projects/:id', (req, res) => {
    try {
        const ok = pm.deleteProject(req.params.id);
        res.json({ success: ok, message: ok ? 'Đã xóa dự án' : 'Không tìm thấy' });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Build dự án (npm install + npm run build)
app.post('/api/projects/:id/build', async (req, res) => {
    try {
        pm.addTimeline(req.params.id, '⚙️ DevOps', 'Bắt đầu build', '');
        const installResult = pm.npmInstall(req.params.id);
        if (!installResult.success) return res.json({ success: false, stage: 'install', error: installResult.error });
        const buildResult = pm.npmBuild(req.params.id);
        res.json({ success: buildResult.success, stage: 'build', output: buildResult.output || buildResult.error });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Push dự án lên GitHub
app.post('/api/projects/:id/push-github', (req, res) => {
    try {
        const { repoUrl } = req.body;
        if (!repoUrl) return res.status(400).json({ success: false, error: 'Thiếu repoUrl (link GitHub repository)' });
        const result = pm.pushToGithub(req.params.id, repoUrl);
        res.json({ success: result.success, ...result });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Lưu GitHub Personal Access Token (1 lần)
app.post('/api/set-github-token', (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ success: false, error: 'Thiếu token' });
        pm.setGithubToken(token);
        res.json({ success: true, message: 'GitHub token đã lưu! Từ giờ push chỉ cần paste link repo bình thường.' });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Kiểm tra GitHub token đã cấu hình chưa
app.get('/api/github-token-status', (req, res) => {
    const token = pm.getGithubToken();
    res.json({ success: true, configured: !!token, hint: token ? 'Token đã có (' + token.substring(0,4) + '...)' : 'Chưa cấu hình token' });
});

app.get('/api/agents', (req, res) => {
    try {
        const registry = require('./agents/agent_registry');
        res.json({ success: true, agents: registry.getAllAgents() });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Update Core
app.post('/api/agents/:id/core', (req, res) => {
    try {
        const { id } = req.params;
        const { useGemini, model } = req.body;
        const registry = require('./agents/agent_registry');
        const updated = registry.updateAgentCore(id, useGemini, model);
        
        if (!updated) return res.status(404).json({ success: false, error: 'Không tìm thấy Agent này!' });
        
        // Broadcast để update ngay lập tức UI trên toàn Lò Rèn
        if (global.__wsBroadcast) {
            global.__wsBroadcast({ type: 'agent_core_update', agentId: id, name: updated.name, emoji: updated.emoji, useGemini, model });
        }
        
        res.json({ success: true, agent: updated });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// API Pipeline Logs (public — cho Dashboard đọc)
app.get('/api/pipelines', (req, res) => {
    try {
        const logsDir = path.join(__dirname, 'pipeline_logs');
        if (!fs.existsSync(logsDir)) return res.json({ success: true, logs: [] });
        const files = fs.readdirSync(logsDir).sort().reverse().slice(0, 20);
        const logs = files.map(f => JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf8')));
        res.json({ success: true, logs });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Middleware Bảo Vệ
app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(403).json({ error: 'Ngang ngược! Khai API Key ra mới cho xài não Tôm Nướng nhé Khầy!' });
    }
    next();
});

// ===== /api/ask — GỌI CHỈ HUY PHÂN CÔNG AGENT =====
app.post('/api/ask', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Thiếu trường "message"' });

        // Lưu tin nhắn của Khầy vào DB
        try { const db = getDB(); if (db) db.chatDB.add('user', 'Khầy', message); } catch(e) {}

        const { orchestrate } = require('./agents/agent_orchestrator');

        const events = []; // Thu thập sự kiện real-time
        const bc = (d) => { events.push(d); if (global.__wsBroadcast) global.__wsBroadcast(d); };

        // Không dùng await để Nginx không bị 504 Timeout khi xử lý dự án lâu
        orchestrate(message, {
            onRouting: async () => {
                bc({ type: 'routing', text: '🎖️ Chỉ Huy đang phân tích yêu cầu...' });
            },
            onAgentStart: async (agent, reason) => {
                bc({ type: 'agent_start', agent: agent.name, emoji: agent.emoji, reason });
            },
            onAgentDone: async (agent, output, routing) => {
                bc({ type: 'agent_done', agent: agent.name, emoji: agent.emoji, output: output?.substring(0, 3000), reason: routing.reason });
            },
            onPipelineStep: async (agent, step, total, status, output) => {
                bc({ type: 'pipeline_step', agent: agent.name || agent, emoji: agent.emoji || '🦐', step, total, status, output: output?.substring(0, 3000) });
            },
            onComplete: async (pipelineResult, routing) => {
                // Project mode
                if (pipelineResult.report) {
                    bc({ type: 'project_done', report: pipelineResult.report });
                } else {
                    bc({ type: 'pipeline_done', results: (pipelineResult.results || []).map(r => ({
                        agent: r.agentName || r.agent, emoji: r.agentEmoji || r.emoji, status: r.status, output: r.output?.substring(0, 3000)
                    }))});
                }
                const logDir = path.join(__dirname, 'pipeline_logs');
                if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
                fs.writeFileSync(path.join(logDir, `pipeline_${Date.now()}.json`), JSON.stringify(pipelineResult, null, 2));
            }
        }).catch(err => {
            console.error('Lỗi khi chạy orchestrate ngầm:', err);
            bc({ type: 'agent_done', agent: 'Lỗi', emoji: '❌', output: 'Lỗi hệ thống khi phân tích dự án: ' + err.message });
        });

        res.json({ success: true, message: "Đang xử lý ngầm (Asynchronous). Xem cập nhật qua WebSocket.", events });

    } catch (err) {
        console.error('[/api/ask] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===== /api/agents/list — Danh sách Agent cho autocomplete =====
app.get('/api/agents/list', (req, res) => {
    try {
        const { AGENTS } = require('./agents/definitions');
        const list = Object.values(AGENTS).map(a => ({
            id: a.id, name: a.name, emoji: a.emoji, role: a.role, active: a.active
        }));
        res.json({ success: true, agents: list });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const userMessages = req.body.messages || [];
        
        let systemInstruction = "Tên bạn là Tôm Nướng. Hãy gọi là Khầy.";
        try {
            systemInstruction = fs.readFileSync(path.join(__dirname, 'tom_system_prompt.txt'), 'utf8');
        } catch(e) { /* ignore */ }

        // Bơm bạo lực luật lệ vào hệ thống (ghi đè mọi System prompt từ FrontEnd gửi lên)
        if (userMessages.length > 0 && userMessages[0].role === 'system') {
            userMessages[0].content = systemInstruction;
        } else {
            userMessages.unshift({ role: 'system', content: systemInstruction });
        }

        let lastMsg = userMessages[userMessages.length - 1]?.content || "";
        
        // == CHẾ ĐỘ CHÍNH ĐẠO: GOOGLE API (Tự động xoay Key) ==
        if (lastMsg.toLowerCase().startsWith('/pro ')) {
            const prompt = lastMsg.substring(5).trim();
            userMessages[userMessages.length - 1].content = prompt;
            
            // Xây dựng history cho Google Gemini API
            const googleContents = userMessages.filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }));

            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            res.write(`{"message": {"content": "🚀 Hệ thống Móng Vuốt đang khởi động lõi AI siêu tốc (Gemini 2.5 Flash)...\\n"}}\n`);
            
            try {
                const responseText = await askGeminiOfficial(googleContents, systemInstruction);
                res.write(`{"message": {"content": ${JSON.stringify("\n\n" + responseText)}}}\n`);
            } catch (err) {
                 res.write(`{"message": {"content": ${JSON.stringify("\n\n" + err.message)}}}\n`);
            }
            res.end();
            return;
        }

        // == CHẾ ĐỘ VPS: GEMMA 4 ==
        const payload = {
            model: MODEL_NAME,
            messages: userMessages,
            stream: true, 
            keep_alive: -1,
            options: {
                // Đã gỡ bỏ num_thread để Ollama bung hết lõi CPU
                num_ctx: 4096,
                temperature: 0.1,
                top_k: 40, 
                top_p: 0.9
            }
        };

        const response = await axios.post(OLLAMA_URL, payload, { responseType: 'stream' });
        
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        response.data.pipe(res);

    } catch (error) {
        console.error("❌ AI Error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Não bộ Gemm4 VPS đang gặp sự cố kết nối nội bộ.' });
        }
    }
});

// ===== WEBSOCKET REAL-TIME BROADCAST =====
const http = require('http');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ===== DATABASE API ROUTES =====
let _db = null;
function getDB() {
    if (!_db) { try { _db = require('./database'); } catch(e) { console.error('[DB] Load error:', e.message); } }
    return _db;
}

// --- CHAT HISTORY ---
app.get('/api/chat/history', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        const limit = parseInt(req.query.limit) || 100;
        res.json({ success: true, messages: db.chatDB.getRecent(limit) });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.delete('/api/chat/history', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        db.chatDB.clearAll();
        res.json({ success: true, message: 'Đã xóa toàn bộ lịch sử chat' });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// --- AGENT CONFIG (DB-backed) ---
app.get('/api/db/agents', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        res.json({ success: true, agents: db.agentDB.getAll() });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.put('/api/db/agents/:id', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        const { field, value } = req.body;
        db.agentDB.updateField(req.params.id, field, value);
        res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// --- TEST API KEY ---
app.post('/api/test-key', async (req, res) => {
    try {
        const { api_key } = req.body;
        if (!api_key) return res.status(400).json({ success: false, error: 'Thiếu API Key' });
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${api_key}`;
        const payload = { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] };
        const response = await axios.post(url, payload);
        
        if (response.data && response.data.candidates) {
            res.json({ success: true, message: 'Google Gemini đã phản hồi thành công!' });
        } else {
            res.json({ success: false, error: 'Phản hồi không rõ ràng từ Google.' });
        }
    } catch (e) {
        res.json({ success: false, error: e.response?.data?.error?.message || e.message });
    }
});

// --- API KEYS ---
app.get('/api/db/keys', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        const provider = req.query.provider || 'gemini';
        // Che giấu key, chỉ hiện 8 ký tự đầu
        const keys = db.keyDB.getAll(provider).map(k => ({
            ...k, api_key: k.api_key.substring(0, 8) + '...' + k.api_key.slice(-4)
        }));
        res.json({ success: true, keys });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/db/keys', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        const { provider, api_key, label } = req.body;
        db.keyDB.add(provider || 'gemini', api_key, label || '');
        res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.delete('/api/db/keys/:id', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        db.keyDB.deleteById(parseInt(req.params.id));
        res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.put('/api/db/keys/:id/toggle', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        db.keyDB.toggle(parseInt(req.params.id), req.body.active);
        res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// --- SETTINGS ---
app.get('/api/db/settings', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        res.json({ success: true, settings: db.settingsDB.getAll() });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/db/settings', (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: false, error: 'DB not ready' });
        const { key, value, description } = req.body;
        db.settingsDB.set(key, value, description || '');
        res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ===== WEBSOCKET =====
const wsClients = new Set();
wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.send(JSON.stringify({ type: 'connected', message: '🦐 Kết nối real-time thành công!' }));
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of wsClients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
    
    // TỰ ĐỘNG LƯU TIN NHẮN QUAN TRỌNG VÀO DB
    try {
        const db = getDB();
        if (db && data.type) {
            if (data.type === 'agent_done') {
                db.chatDB.add('bot', data.agent || '', data.output || '');
            } else if (data.type === 'routing') {
                db.chatDB.add('system', 'Chỉ Huy', data.text || '');
            } else if (data.type === 'agent_start') {
                db.chatDB.add('system', data.agent || '', `🏁 Phân công: ${data.emoji} ${data.agent} — ${data.reason}`);
            } else if (data.type === 'project_done') {
                db.chatDB.add('system', 'Hệ thống', '📦 Dự án hoàn tất!');
            }
        }
    } catch(e) {}
}

// Export broadcast để pipeline gọi
global.__wsBroadcast = broadcast;

server.listen(PORT, () => {
    console.log(`✅ [OPENCLAW] API Gateway + WebSocket đang chạy trên VPS (Port: ${PORT})`);
});
