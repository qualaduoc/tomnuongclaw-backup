// ===================================================================
// DATABASE.JS — Kho Dữ Liệu Trung Tâm OpenClaw (SQLite)
// Quản lý: Lịch sử chat, Agent config, API Keys, Settings
// ===================================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'openclaw.db');
const db = new Database(DB_PATH);

// Bật WAL mode để tăng tốc đọc/ghi đồng thời (quan trọng cho PM2 cluster)
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// ===================================================================
// KHỞI TẠO BẢNG
// ===================================================================
db.exec(`
    -- 1. LỊCH SỬ CHAT (Lò Rèn)
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'system',          -- 'user' | 'bot' | 'system'
        sender TEXT DEFAULT '',                        -- Tên agent hoặc 'Khầy'
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    -- 2. CẤU HÌNH AGENT (thay definitions.js + agent_cores.json)
    CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '🦐',
        role TEXT DEFAULT '',
        model TEXT DEFAULT 'gemma4:26b',
        use_gemini INTEGER DEFAULT 0,                  -- 0=Ollama, 1=Gemini
        active INTEGER DEFAULT 1,
        color TEXT DEFAULT '#3B82F6',
        system_prompt TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    -- 3. API KEYS (thay gemini_keys.json)
    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL DEFAULT 'gemini',       -- 'gemini' | 'openai' | 'anthropic'
        api_key TEXT NOT NULL,
        label TEXT DEFAULT '',                         -- Nhãn để nhận biết (ví dụ: "Key 1 - Free tier")
        active INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    -- 4. CÀI ĐẶT HỆ THỐNG
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT DEFAULT '',
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    -- 5. DỰ ÁN (Kho Dự Án)
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',                 -- 'pending' | 'in_progress' | 'done' | 'failed'
        review_score REAL DEFAULT 0,
        files_count INTEGER DEFAULT 0,
        preview_url TEXT DEFAULT '',
        download_url TEXT DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
`);

// ===================================================================
// CHAT MESSAGES — CRUD
// ===================================================================
const chatDB = {
    add(type, sender, content) {
        return db.prepare('INSERT INTO chat_messages (type, sender, content) VALUES (?, ?, ?)').run(type, sender, content);
    },
    
    getRecent(limit = 50) {
        return db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?').all(limit).reverse();
    },
    
    getAll() {
        return db.prepare('SELECT * FROM chat_messages ORDER BY id ASC').all();
    },
    
    clearAll() {
        return db.prepare('DELETE FROM chat_messages').run();
    },
    
    deleteById(id) {
        return db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
    }
};

// ===================================================================
// AGENTS — CRUD
// ===================================================================
const agentDB = {
    getAll() {
        return db.prepare('SELECT * FROM agents ORDER BY sort_order ASC').all();
    },
    
    getById(id) {
        return db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    },
    
    upsert(agent) {
        return db.prepare(`
            INSERT INTO agents (id, name, emoji, role, model, use_gemini, active, color, system_prompt, sort_order)
            VALUES (@id, @name, @emoji, @role, @model, @use_gemini, @active, @color, @system_prompt, @sort_order)
            ON CONFLICT(id) DO UPDATE SET
                name=@name, emoji=@emoji, role=@role, model=@model, use_gemini=@use_gemini,
                active=@active, color=@color, system_prompt=@system_prompt, sort_order=@sort_order,
                updated_at=datetime('now','localtime')
        `).run(agent);
    },
    
    updateCore(id, useGemini, model) {
        return db.prepare(`UPDATE agents SET use_gemini = ?, model = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
            .run(useGemini ? 1 : 0, model, id);
    },
    
    updateField(id, field, value) {
        // Chỉ cho phép cập nhật các field an toàn
        const allowed = ['name', 'emoji', 'role', 'model', 'use_gemini', 'active', 'color', 'system_prompt', 'sort_order'];
        if (!allowed.includes(field)) throw new Error(`Field "${field}" không được phép cập nhật`);
        return db.prepare(`UPDATE agents SET ${field} = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(value, id);
    },

    deleteById(id) {
        return db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    }
};

// ===================================================================
// API KEYS — CRUD
// ===================================================================
const keyDB = {
    getAll(provider = 'gemini') {
        return db.prepare('SELECT * FROM api_keys WHERE provider = ? ORDER BY id ASC').all(provider);
    },
    
    getActive(provider = 'gemini') {
        return db.prepare('SELECT * FROM api_keys WHERE provider = ? AND active = 1 ORDER BY usage_count ASC').all(provider);
    },
    
    add(provider, apiKey, label = '') {
        return db.prepare('INSERT INTO api_keys (provider, api_key, label) VALUES (?, ?, ?)').run(provider, apiKey, label);
    },
    
    toggle(id, active) {
        return db.prepare('UPDATE api_keys SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    },
    
    incrementUsage(id) {
        return db.prepare(`UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },
    
    deleteById(id) {
        return db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    }
};

// ===================================================================
// SETTINGS — Key-Value Store
// ===================================================================
const settingsDB = {
    get(key, defaultValue = null) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : defaultValue;
    },
    
    set(key, value, description = '') {
        return db.prepare(`
            INSERT INTO settings (key, value, description) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now','localtime')
        `).run(key, value, description, value);
    },
    
    getAll() {
        return db.prepare('SELECT * FROM settings ORDER BY key ASC').all();
    },
    
    delete(key) {
        return db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    }
};

// ===================================================================
// PROJECTS — CRUD
// ===================================================================
const projectDB = {
    create(project) {
        return db.prepare(`
            INSERT INTO projects (id, name, description, status, files_count, preview_url, download_url)
            VALUES (@id, @name, @description, @status, @files_count, @preview_url, @download_url)
        `).run(project);
    },
    
    getAll() {
        return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    },
    
    getById(id) {
        return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    },
    
    update(id, data) {
        const sets = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
        data.id = id;
        return db.prepare(`UPDATE projects SET ${sets}, updated_at = datetime('now','localtime') WHERE id = @id`).run(data);
    },
    
    deleteById(id) {
        return db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    }
};

// ===================================================================
// MIGRATION: Import dữ liệu từ files cũ (chỉ chạy 1 lần)
// ===================================================================
function migrateFromFiles() {
    // 1. Import Agents từ definitions.js (nếu bảng agents trống)
    const agentCount = db.prepare('SELECT COUNT(*) as cnt FROM agents').get().cnt;
    if (agentCount === 0) {
        console.log('[DB] Migrating agents from definitions.js...');
        try {
            const { AGENTS } = require('./agents/definitions');
            const promptsPath = path.join(__dirname, 'agents', 'prompts');
            let order = 0;
            for (const [id, a] of Object.entries(AGENTS)) {
                let prompt = '';
                // Đọc system prompt từ file nếu có
                const promptFile = path.join(promptsPath, `${id}.md`);
                if (fs.existsSync(promptFile)) {
                    prompt = fs.readFileSync(promptFile, 'utf8');
                }
                agentDB.upsert({
                    id, name: a.name, emoji: a.emoji, role: a.role || '',
                    model: a.model || 'gemma4:26b', use_gemini: a.useGemini ? 1 : 0,
                    active: a.active ? 1 : 0, color: a.color || '#3B82F6',
                    system_prompt: prompt, sort_order: order++
                });
            }
            console.log(`[DB] Migrated ${Object.keys(AGENTS).length} agents.`);
        } catch(e) { console.error('[DB] Agent migration error:', e.message); }
    }

    // 2. Import agent_cores.json (override model settings)
    const coresPath = path.join(__dirname, 'agent_cores.json');
    if (fs.existsSync(coresPath)) {
        try {
            const cores = JSON.parse(fs.readFileSync(coresPath, 'utf8'));
            for (const [id, c] of Object.entries(cores)) {
                agentDB.updateCore(id, c.useGemini, c.model);
            }
            console.log('[DB] Applied agent_cores.json overrides.');
        } catch(e) {}
    }
    
    // 3. Import Gemini keys từ gemini_keys.json (nếu bảng api_keys trống)
    const keyCount = db.prepare('SELECT COUNT(*) as cnt FROM api_keys').get().cnt;
    if (keyCount === 0) {
        const keysPath = path.join(__dirname, 'gemini_keys.json');
        if (fs.existsSync(keysPath)) {
            try {
                const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
                for (const k of keys) {
                    keyDB.add('gemini', k.key, k.label || `Key ${keys.indexOf(k) + 1}`);
                    if (!k.active) keyDB.toggle(keyDB.getAll('gemini').pop().id, false);
                }
                console.log(`[DB] Migrated ${keys.length} Gemini API keys.`);
            } catch(e) { console.error('[DB] Key migration error:', e.message); }
        }
    }
}

// Chạy migration
migrateFromFiles();

module.exports = { db, chatDB, agentDB, keyDB, settingsDB, projectDB };
