// ===================================================================
// PROJECT_MANAGER.JS — Quản Lý Kho Dự Án Đội Quân Tôm
// Tạo / Xóa / Liệt kê / ZIP / Tính dung lượng dự án
// ===================================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECTS_DIR = path.join(__dirname, '..', 'projects');
const MAX_PROJECT_SIZE = 2 * 1024 * 1024 * 1024; // 2GB/project

// Đảm bảo thư mục projects tồn tại
function ensureProjectsDir() {
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// Tạo dự án mới
function createProject({ name, description, requestedBy, agents }) {
    ensureProjectsDir();
    const id = `proj_${Date.now()}`;
    const projectPath = path.join(PROJECTS_DIR, id);
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'reports'), { recursive: true });

    const meta = {
        id,
        name: name || 'Dự án chưa đặt tên',
        description: description || '',
        status: 'planning', // planning | in_progress | reviewing | completed | failed
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requestedBy: requestedBy || 'Khầy',
        agents: agents || [],
        files: [],
        timeline: [
            { time: new Date().toISOString(), agent: '🎖️ Chỉ Huy', action: 'Khởi tạo dự án', detail: name }
        ],
        feedbackRounds: 0,
        maxFeedbackRounds: 2
    };

    fs.writeFileSync(path.join(projectPath, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
}

// Đọc meta dự án
function getProjectMeta(projectId) {
    const metaPath = path.join(PROJECTS_DIR, projectId, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

// Cập nhật meta
function updateProjectMeta(projectId, updates) {
    const meta = getProjectMeta(projectId);
    if (!meta) return null;
    Object.assign(meta, updates, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(path.join(PROJECTS_DIR, projectId, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
}

// Thêm sự kiện vào timeline
function addTimeline(projectId, agent, action, detail) {
    const meta = getProjectMeta(projectId);
    if (!meta) return;
    meta.timeline.push({ time: new Date().toISOString(), agent, action, detail: (detail || '').substring(0, 200) });
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(PROJECTS_DIR, projectId, 'meta.json'), JSON.stringify(meta, null, 2));
}

// Lưu file vào dự án
function saveProjectFile(projectId, relativePath, content) {
    const filePath = path.join(PROJECTS_DIR, projectId, 'src', relativePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);

    // Cập nhật danh sách file trong meta
    const meta = getProjectMeta(projectId);
    if (meta) {
        const existing = meta.files.findIndex(f => f.path === relativePath);
        const fileInfo = { path: relativePath, size: Buffer.byteLength(content), updatedAt: new Date().toISOString() };
        if (existing >= 0) meta.files[existing] = fileInfo;
        else meta.files.push(fileInfo);
        meta.updatedAt = new Date().toISOString();
        fs.writeFileSync(path.join(PROJECTS_DIR, projectId, 'meta.json'), JSON.stringify(meta, null, 2));
    }
    return filePath;
}

// Lưu báo cáo pipeline
function saveReport(projectId, reportName, data) {
    const reportPath = path.join(PROJECTS_DIR, projectId, 'reports', reportName);
    fs.writeFileSync(reportPath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// Tính dung lượng thư mục (đệ quy)
function getDirSize(dirPath) {
    let size = 0;
    if (!fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') {
                // Ước tính node_modules để tránh scan quá lâu
                size += 200 * 1024 * 1024; // ~200MB ước tính
            } else {
                size += getDirSize(fullPath);
            }
        } else {
            size += fs.statSync(fullPath).size;
        }
    }
    return size;
}

// Liệt kê tất cả dự án
function listProjects() {
    ensureProjectsDir();
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('proj_'))
        .map(d => {
            const meta = getProjectMeta(d.name);
            if (!meta) return null;
            const size = getDirSize(path.join(PROJECTS_DIR, d.name));
            return { ...meta, totalSize: size, sizeFormatted: formatSize(size) };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return dirs;
}

// Xóa dự án (HOÀN TOÀN — bao gồm node_modules)
function deleteProject(projectId) {
    const projectPath = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectPath)) return false;
    fs.rmSync(projectPath, { recursive: true, force: true });
    return true;
}

// Danh sách file/folder loại trừ khi ZIP và khi push Git
const IGNORE_PATTERNS = [
    'node_modules',
    '.env',
    '.env.local',
    '.env.production',
    '.DS_Store',
    'Thumbs.db',
    'dist',
    'build',
    '.cache',
    '.parcel-cache',
    '.next',
    '.nuxt',
    '.vite',
    'coverage',
    '*.log',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    '.idea',
    '.vscode',
    '*.swp',
    '*.swo',
    '__pycache__',
    '*.pyc',
    '.git'
];

// Tạo file .gitignore chuẩn trong project
function ensureGitignore(projectId) {
    const srcPath = path.join(PROJECTS_DIR, projectId, 'src');
    const gitignorePath = path.join(srcPath, '.gitignore');
    
    // Nếu đã có thì không ghi đè
    if (fs.existsSync(gitignorePath)) return;

    const content = `# ===== Auto-generated by Đội Quân Tôm =====
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Build output
dist/
build/
.next/
.nuxt/
.vite/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Cache
.cache/
.parcel-cache/
coverage/

# Misc
*.tgz
*.zip
`;
    fs.writeFileSync(gitignorePath, content);
    addTimeline(projectId, '⚙️ DevOps', 'Tạo .gitignore', 'File loại trừ chuẩn');
}

// Tạo file ZIP cho dự án (loại trừ node_modules và file thừa)
function zipProject(projectId) {
    const projectPath = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectPath)) return null;

    // Đảm bảo có .gitignore
    ensureGitignore(projectId);

    const meta = getProjectMeta(projectId);
    const safeName = (meta?.name || projectId).replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 50);
    const zipName = `${safeName}.zip`;
    const zipPath = path.join(projectPath, zipName);

    // Xóa zip cũ nếu có
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    // Build exclude flags cho zip
    const excludeFlags = IGNORE_PATTERNS.map(p => `-x "${p}" "${p}/*"`).join(' ');

    try {
        execSync(
            `cd "${path.join(projectPath, 'src')}" && zip -r "${zipPath}" . ${excludeFlags} 2>/dev/null`,
            { timeout: 120000 }
        );
    } catch (e) {
        // Fallback: tar.gz với exclude
        try {
            const tarPath = zipPath.replace('.zip', '.tar.gz');
            const tarExcludes = IGNORE_PATTERNS.map(p => `--exclude='${p}'`).join(' ');
            execSync(
                `tar -czf "${tarPath}" ${tarExcludes} -C "${path.join(projectPath, 'src')}" .`,
                { timeout: 120000 }
            );
            return tarPath;
        } catch (e2) {
            return null;
        }
    }
    return zipPath;
}

// ===== GITHUB INTEGRATION =====

// File lưu GitHub token trên VPS
const TOKEN_FILE = path.join(__dirname, '..', '.github_token');

function setGithubToken(token) {
    fs.writeFileSync(TOKEN_FILE, token.trim());
    return true;
}

function getGithubToken() {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

// Inject token vào URL HTTPS
function injectTokenToUrl(repoUrl) {
    const token = getGithubToken();
    if (!token) return repoUrl;
    if (repoUrl.includes('@') && !repoUrl.startsWith('git@')) return repoUrl;
    if (repoUrl.startsWith('https://')) {
        return repoUrl.replace('https://', 'https://' + token + '@');
    }
    return repoUrl;
}

// Tạo commit message thông minh
function buildCommitMessage(projectId) {
    const meta = getProjectMeta(projectId);
    if (!meta) return 'Cap nhat du an';

    const files = meta.files || [];
    const fileTypes = {};
    files.forEach(f => {
        const ext = path.extname(f.path).toLowerCase() || '.other';
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    });

    const parts = [];
    if (fileTypes['.html']) parts.push(fileTypes['.html'] + ' trang HTML');
    if (fileTypes['.css']) parts.push(fileTypes['.css'] + ' file CSS');
    const jsCount = (fileTypes['.js']||0) + (fileTypes['.jsx']||0) + (fileTypes['.ts']||0) + (fileTypes['.tsx']||0);
    if (jsCount) parts.push(jsCount + ' file JS/TS');
    if (fileTypes['.json']) parts.push(fileTypes['.json'] + ' config');

    const summary = parts.length > 0 ? parts.join(', ') : files.length + ' files';
    const reviewInfo = meta.feedbackRounds > 0 ? ' | Review ' + meta.feedbackRounds + ' vong' : '';

    return meta.name + ': ' + summary + reviewInfo;
}

// Tạo README.md tự động
function ensureReadme(projectId) {
    const readmePath = path.join(PROJECTS_DIR, projectId, 'src', 'README.md');
    if (fs.existsSync(readmePath)) return;

    const meta = getProjectMeta(projectId);
    if (!meta) return;

    const filesList = (meta.files || []).map(f => '- `' + f.path + '`').join('\n');
    const content = '# ' + meta.name + '\n\n'
        + '> ' + (meta.description || 'Du an duoc tao boi Doi Quan Tom') + '\n\n'
        + '## Thong tin\n'
        + '- **Ngay tao:** ' + new Date(meta.createdAt).toLocaleDateString('vi-VN') + '\n'
        + '- **Trang thai:** ' + meta.status + '\n'
        + '- **Review:** ' + (meta.feedbackRounds || 0) + ' vong\n\n'
        + '## Danh sach file\n' + (filesList || '(chua co file)') + '\n\n'
        + '---\n*Duoc tao tu dong boi Doi Quan Tom*\n';
    fs.writeFileSync(readmePath, content);
}

// Push code lên GitHub
function pushToGithub(projectId, repoUrl, customCommitMsg) {
    const srcPath = path.join(PROJECTS_DIR, projectId, 'src');
    if (!fs.existsSync(srcPath)) return { success: false, error: 'Thu muc src khong ton tai' };

    ensureGitignore(projectId);
    ensureReadme(projectId);

    const commitMsg = customCommitMsg || buildCommitMessage(projectId);
    const authUrl = injectTokenToUrl(repoUrl);
    const displayUrl = repoUrl.replace(/https:\/\/[^@]+@/, 'https://');

    try {
        const gitDir = path.join(srcPath, '.git');
        if (!fs.existsSync(gitDir)) {
            execSync('git init', { cwd: srcPath, timeout: 10000 });
            execSync('git branch -M main', { cwd: srcPath, timeout: 10000 });
            addTimeline(projectId, '🚀 DevOps', 'git init', 'Khoi tao Git repository');
        }

        execSync('git add -A', { cwd: srcPath, timeout: 30000 });
        
        try {
            const safeMsg = commitMsg.replace(/"/g, "'");
            execSync('git commit -m "' + safeMsg + '"', { cwd: srcPath, timeout: 30000 });
        } catch (e) {
            if (!e.message.includes('nothing to commit')) throw e;
        }

        try { execSync('git remote remove origin', { cwd: srcPath, timeout: 5000 }); } catch(e) {}
        execSync('git remote add origin ' + authUrl, { cwd: srcPath, timeout: 5000 });

        let pushOutput = '';
        try {
            pushOutput = execSync('git push -u origin main --force 2>&1', { cwd: srcPath, timeout: 60000 }).toString();
        } catch (e) {
            pushOutput = (e.stderr ? e.stderr.toString() : '') || e.message;
            if (!pushOutput.includes('->') && !pushOutput.includes('Everything up-to-date')) throw e;
        }
        
        addTimeline(projectId, '🚀 DevOps', 'Push GitHub thanh cong', displayUrl);
        updateProjectMeta(projectId, { githubUrl: displayUrl });

        return { success: true, output: pushOutput, commitMsg, repoUrl: displayUrl };

    } catch (e) {
        const errMsg = e.message.replace(/https:\/\/[^@]+@/g, 'https://***@');
        addTimeline(projectId, '🚀 DevOps', 'Push GitHub THAT BAI', errMsg.substring(0, 150));
        return { success: false, error: errMsg };
    }
}

// Chạy npm install trong dự án
function npmInstall(projectId) {
    const srcPath = path.join(PROJECTS_DIR, projectId, 'src');
    const pkgPath = path.join(srcPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return { success: false, error: 'Không tìm thấy package.json' };

    try {
        const output = execSync('npm install --production=false', { cwd: srcPath, timeout: 120000 }).toString();
        addTimeline(projectId, '⚙️ DevOps', 'npm install', 'Cài đặt thư viện thành công');
        return { success: true, output };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Chạy npm run build
function npmBuild(projectId) {
    const srcPath = path.join(PROJECTS_DIR, projectId, 'src');
    try {
        const output = execSync('npm run build', { cwd: srcPath, timeout: 180000 }).toString();
        addTimeline(projectId, '⚙️ DevOps', 'npm run build', 'Build thành công');
        return { success: true, output };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Format kích thước file
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Kiểm tra dung lượng có vượt giới hạn không
function checkSizeLimit(projectId) {
    const size = getDirSize(path.join(PROJECTS_DIR, projectId));
    if (size > MAX_PROJECT_SIZE) {
        return { exceeded: true, current: formatSize(size), limit: formatSize(MAX_PROJECT_SIZE) };
    }
    return { exceeded: false, current: formatSize(size), limit: formatSize(MAX_PROJECT_SIZE) };
}

module.exports = {
    createProject, getProjectMeta, updateProjectMeta, addTimeline,
    saveProjectFile, saveReport, listProjects, deleteProject,
    zipProject, ensureGitignore, pushToGithub,
    setGithubToken, getGithubToken, ensureReadme,
    npmInstall, npmBuild, getDirSize, formatSize, checkSizeLimit,
    PROJECTS_DIR
};
