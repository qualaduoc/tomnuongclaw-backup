// ===================================================================
// DEFINITIONS.JS — Sổ Đăng Bộ Đội Quân Tôm
// Mỗi con Tôm = 1 Agent AI chuyên biệt với tính cách & kỹ năng riêng
// ===================================================================

const AGENTS = {
    director: {
        id: 'director',
        name: 'Tôm Chỉ Huy',
        emoji: '🎖️',
        role: 'Phân tích yêu cầu, định tuyến thông minh và chia task',
        model: 'gemini-2.5-flash',
        useGemini: true,
        active: true,
        color: '#F59E0B'
    },
    coder: {
        id: 'coder',
        name: 'Tôm Coder',
        emoji: '👨‍💻',
        role: 'Chuyên viết code, tạo ứng dụng, website, script',
        model: 'gemma4:26b',
        useGemini: false,
        active: true,
        color: '#3B82F6'
    },
    reviewer: {
        id: 'reviewer',
        name: 'Tôm Reviewer',
        emoji: '🔍',
        role: 'Kiểm duyệt code, phát hiện bug, đề xuất cải tiến',
        model: 'gemma4:26b',
        useGemini: false,
        active: true,
        color: '#10B981'
    },
    tester: {
        id: 'tester',
        name: 'Tôm Tester',
        emoji: '🧪',
        role: 'Viết test case, kiểm thử, đánh giá chất lượng',
        model: 'gemma4:26b',
        useGemini: false,
        active: true,
        color: '#8B5CF6'
    },
    secretary: {
        id: 'secretary',
        name: 'Tôm Thư Ký',
        emoji: '📝',
        role: 'Trả lời câu hỏi, tóm tắt, soạn email, viết bài',
        model: 'gemma4:26b',
        useGemini: false,
        active: true,
        color: '#EC4899'
    },
    facebook: {
        id: 'facebook',
        name: 'Tôm Facebook',
        emoji: '📘',
        role: 'Quản lý Facebook, đăng bài, tương tác mạng xã hội',
        model: 'gemma4:26b',
        useGemini: false,
        active: true,
        color: '#1877F2'
    },
    gemini: {
        id: 'gemini',
        name: 'Tôm Gemini PRO',
        emoji: '⚡',
        role: 'Sử dụng lõi Gemini Cloud cho tác vụ nặng, phân tích phức tạp',
        model: 'gemini-2.5-flash',
        useGemini: true,
        active: true,
        color: '#F43F5E'
    },
    zalo: {
        id: 'zalo',
        name: 'Tôm Zalo',
        emoji: '💬',
        role: 'Quản lý Zalo, gửi tin nhắn, tự động hóa Zalo',
        model: 'gemma4:26b',
        useGemini: false,
        active: false, // Đang ngủ khò khò
        color: '#0068FF'
    },
    designer: {
        id: 'designer',
        name: 'Tôm Designer',
        emoji: '🎨',
        role: 'Thiết kế UI/UX, tạo giao diện đẹp, chọn màu sắc',
        model: 'gemma4:26b',
        useGemini: false,
        active: false, // Đang ngủ khò khò
        color: '#F59E0B'
    },
    devops: {
        id: 'devops',
        name: 'Tôm DevOps',
        emoji: '🔧',
        role: 'Quản lý server, deploy, CI/CD, giám sát hệ thống',
        model: 'gemma4:26b',
        useGemini: false,
        active: false, // Đang ngủ khò khò
        color: '#6366F1'
    }
};

// Pipeline mặc định: Viết code → Review → Test
const PIPELINES = {
    code: {
        name: 'Code Pipeline',
        description: 'Viết code → Review → Test',
        steps: ['coder', 'reviewer', 'tester']
    },
    content: {
        name: 'Content Pipeline',
        description: 'Viết bài → Review → Đăng',
        steps: ['secretary', 'reviewer', 'facebook']
    }
};

module.exports = { AGENTS, PIPELINES };
