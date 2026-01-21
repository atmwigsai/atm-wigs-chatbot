from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
from supabase import create_client, Client
from datetime import datetime
from dotenv import load_dotenv
import uuid

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Cho phép tất cả origins

# Khởi tạo Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL")

print(f"SUPABASE_URL: {SUPABASE_URL}")
print(f"N8N_WEBHOOK_URL: {N8N_WEBHOOK_URL}")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===== ROUTES =====

# Test route
@app.route('/')
def home():
    return jsonify({
        'status': 'Backend is running!',
        'endpoints': {
            'chat': '/api/chat',
            'sessions': '/api/sessions',
            'upload': '/api/upload'
        }
    })

# ===== CHAT ENDPOINT =====
@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        session_id = data.get('sessionId')
        message = data.get('message')
        image_url = data.get('imageUrl')
        
        # 1. Lưu tin nhắn user
        user_message = {
            'session_id': session_id,
            'role': 'user',
            'content': message,
            'image_url': image_url
        }
        supabase.table('messages').insert(user_message).execute()
        
        # 2. Gửi tới n8n
        n8n_payload = {
            'sessionId': session_id,
            'message': message,
            'imageUrl': image_url
        }
        
        n8n_response = requests.post(
            N8N_WEBHOOK_URL,
            json=n8n_payload,
            timeout=30
        )
        
        # 3. Lấy response từ n8n
        bot_reply = n8n_response.json().get('reply', 'Xin lỗi, tôi không thể trả lời.')
        
        # 4. Lưu tin nhắn bot
        bot_message = {
            'session_id': session_id,
            'role': 'assistant',
            'content': bot_reply,
            'image_url': None
        }
        supabase.table('messages').insert(bot_message).execute()
        
        # 5. Update session
        supabase.table('chat_sessions').update({
            'updated_at': datetime.now().isoformat()
        }).eq('id', session_id).execute()
        
        return jsonify({
            'success': True,
            'reply': bot_reply
        })
        
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== SESSION MANAGEMENT =====

# Tạo session mới
@app.route('/api/sessions', methods=['POST'])
def create_session():
    try:
        data = request.json
        title = data.get('title', 'New Chat')
        
        result = supabase.table('chat_sessions').insert({
            'title': title
        }).execute()
        
        return jsonify({
            'success': True,
            'session': result.data[0]
        })
    except Exception as e:
        print(f"Error creating session: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Lấy danh sách sessions
@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    try:
        result = supabase.table('chat_sessions').select('*').order('updated_at', desc=True).execute()
        
        return jsonify({
            'success': True,
            'sessions': result.data
        })
    except Exception as e:
        print(f"Error getting sessions: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Lấy messages của session
@app.route('/api/sessions/<session_id>/messages', methods=['GET'])
def get_messages(session_id):
    try:
        result = supabase.table('messages').select('*').eq('session_id', session_id).order('created_at').execute()
        
        return jsonify({
            'success': True,
            'messages': result.data
        })
    except Exception as e:
        print(f"Error getting messages: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Rename session
@app.route('/api/sessions/<session_id>', methods=['PATCH'])
def rename_session(session_id):
    try:
        data = request.json
        new_title = data.get('title')
        
        result = supabase.table('chat_sessions').update({
            'title': new_title
        }).eq('id', session_id).execute()
        
        return jsonify({
            'success': True,
            'session': result.data[0]
        })
    except Exception as e:
        print(f"Error renaming session: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== UPLOAD IMAGE =====
@app.route('/api/upload', methods=['POST'])
def upload_image():
    try:
        file = request.files['file']
        
        # Tạo tên file unique
        file_ext = file.filename.split('.')[-1]
        file_name = f"{uuid.uuid4()}.{file_ext}"
        
        # Upload lên Supabase Storage
        supabase.storage.from_('chat-images').upload(
            file_name,
            file.read(),
            {'content-type': file.content_type}
        )
        
        # Lấy public URL
        public_url = supabase.storage.from_('chat-images').get_public_url(file_name)
        
        return jsonify({
            'success': True,
            'url': public_url
        })
    except Exception as e:
        print(f"Error uploading image: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)