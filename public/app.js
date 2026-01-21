// ===== CONFIG =====
//const API_BASE_URL = window.location.origin; // Tự động lấy URL hiện tại
// Tự động phát hiện môi trường
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:5000'  // Local development
    : window.location.origin;  // Production (Vercel)
// ===== STATE =====
let currentSessionId = null;
let uploadedImageUrl = null;
let sessions = [];

// ===== DOM ELEMENTS =====
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const newChatBtn = document.getElementById('newChatBtn');
const chatHistory = document.getElementById('chatHistory');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const imagePreview = document.getElementById('imagePreview');
const previewImg = document.getElementById('previewImg');
const removeImageBtn = document.getElementById('removeImageBtn');

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    loadSessions();
    setupEventListeners();
    createNewSession(); // Tạo session mặc định
});

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Toggle sidebar
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // New chat
    newChatBtn.addEventListener('click', createNewSession);

    // Send message
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = messageInput.scrollHeight + 'px';
    });

    // Upload image
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
    removeImageBtn.addEventListener('click', removeImage);

    // Paste image
    messageInput.addEventListener('paste', handlePaste);
}

// ===== SESSION MANAGEMENT =====
async function loadSessions() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/sessions`);
        const data = await response.json();
        
        if (data.success) {
            sessions = data.sessions;
            renderSessions();
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
    }
}

async function createNewSession() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'New Chat' })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = data.session.id;
            sessions.unshift(data.session);
            renderSessions();
            clearMessages();
            messageInput.focus();
        }
    } catch (error) {
        console.error('Error creating session:', error);
        alert('Cannot create new chat session. Please try again.');
    }
}

async function loadSession(sessionId) {
    try {
        currentSessionId = sessionId;
        
        const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/messages`);
        const data = await response.json();
        
        if (data.success) {
            clearMessages();
            data.messages.forEach(msg => {
                addMessage(msg.role, msg.content, msg.image_url, false);
            });
            
            // Update active state
            renderSessions();
        }
    } catch (error) {
        console.error('Error loading session:', error);
    }
}

async function renameSession(sessionId, currentTitle) {
    const newTitle = prompt('Rename session:', currentTitle);
    
    if (newTitle && newTitle !== currentTitle) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            });
            
            const data = await response.json();
            
            if (data.success) {
                const session = sessions.find(s => s.id === sessionId);
                if (session) {
                    session.title = newTitle;
                    renderSessions();
                }
            }
        } catch (error) {
            console.error('Error renaming session:', error);
        }
    }
}

function renderSessions() {
    chatHistory.innerHTML = '';
    
    sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = `chat-item ${session.id === currentSessionId ? 'active' : ''}`;
        
        div.innerHTML = `
            <i class="fas fa-comment chat-item-icon"></i>
            <span class="chat-item-title">${escapeHtml(session.title)}</span>
            <div class="chat-item-actions">
                <button class="chat-item-action rename-btn" title="Rename">
                    <i class="fas fa-edit"></i>
                </button>
            </div>
        `;
        
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.chat-item-action')) {
                loadSession(session.id);
            }
        });
        
        div.querySelector('.rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            renameSession(session.id, session.title);
        });
        
        chatHistory.appendChild(div);
    });
}

// ===== MESSAGE HANDLING =====
async function sendMessage() {
    const message = messageInput.value.trim();
    
    if (!message && !uploadedImageUrl) return;
    if (!currentSessionId) {
        await createNewSession();
    }
    
    // Disable input
    messageInput.disabled = true;
    sendBtn.disabled = true;
    
    // Add user message to UI
    addMessage('user', message, uploadedImageUrl);
    
    // Clear input
    messageInput.value = '';
    messageInput.style.height = 'auto';
    removeImage();
    
    // Show typing indicator
    const typingId = showTypingIndicator();
    
    try {
        // Send to backend
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: currentSessionId,
                message: message,
                imageUrl: uploadedImageUrl
            })
        });
        
        const data = await response.json();
        
        // Remove typing indicator
        removeTypingIndicator(typingId);
        
        if (data.success) {
            // Add bot response
            addMessage('assistant', data.reply);
            
            // Update session title if it's the first message
            const session = sessions.find(s => s.id === currentSessionId);
            if (session && session.title === 'New Chat') {
                const firstWords = message.split(' ').slice(0, 5).join(' ');
                session.title = firstWords || 'New Chat';
                
                // Update on server
                await fetch(`${API_BASE_URL}/api/sessions/${currentSessionId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: session.title })
                });
                
                renderSessions();
            }
        } else {
            addMessage('assistant', 'Sorry, there was an error.Please try again.');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        removeTypingIndicator(typingId);
        addMessage('assistant', 'Cannot connect to server. Please check your connection.');
    } finally {
        // Re-enable input
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function addMessage(role, content, imageUrl = null, scroll = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'message-image';
        img.alt = 'Uploaded image';
        contentDiv.appendChild(img);
    }
    
    if (content) {
        const text = document.createElement('div');
        text.innerHTML = content.replace(/\n/g, '<br>'); // ← SỬA DÒNG NÀY
        contentDiv.appendChild(text);
    }
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    
    // Remove welcome message if exists
    const welcomeMsg = messagesContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    messagesContainer.appendChild(messageDiv);
    
    if (scroll) {
        scrollToBottom();
    }
}

function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = id;
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(typingDiv);
    scrollToBottom();
    
    return id;
}

function removeTypingIndicator(id) {
    const element = document.getElementById(id);
    if (element) {
        element.remove();
    }
}

function clearMessages() {
    messagesContainer.innerHTML = `
        <div class="welcome-message">
            <h2>Hello! </h2>
            <p>I am ATM WIGS Assistant. How can I help you today?</p>
        </div>
    `;
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ===== IMAGE HANDLING =====
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) {
        await uploadImage(file);
    }
}

async function handlePaste(e) {
    const items = e.clipboardData.items;
    
    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            await uploadImage(file);
            break;
        }
    }
}

async function uploadImage(file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file!');
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert('Image size must not exceed 5MB!');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            uploadedImageUrl = data.url;
            previewImg.src = data.url;
            imagePreview.style.display = 'block';
        } else {
            alert('Cannot upload image. Please try again.');
        }
    } catch (error) {
        console.error('Error uploading image:', error);
        alert('Error uploading image!');
    }
    
    // Reset file input
    fileInput.value = '';
}

function removeImage() {
    uploadedImageUrl = null;
    imagePreview.style.display = 'none';
    previewImg.src = '';
}

// ===== UTILITIES =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}