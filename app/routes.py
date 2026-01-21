from flask import request, jsonify
import requests
from datetime import datetime
import uuid
from app.database import get_supabase, get_n8n_url

def register_routes(app):
    
    @app.route('/')
    @app.route('/api')
    def home():
        return jsonify({
            'status': 'Backend is running!',
            'endpoints': {
                'sessions': '/api/sessions',
                'chat': '/api/chat',
                'upload': '/api/upload'
            }
        })
    
    @app.route('/api/sessions', methods=['GET', 'POST', 'OPTIONS'])
    def sessions():
        if request.method == 'OPTIONS':
            return '', 204
        
        supabase = get_supabase()
        if not supabase:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500
            
        if request.method == 'GET':
            try:
                result = supabase.table('chat_sessions').select('*').order('updated_at', desc=True).execute()
                return jsonify({'success': True, 'sessions': result.data})
            except Exception as e:
                return jsonify({'success': False, 'error': str(e)}), 500
        
        elif request.method == 'POST':
            try:
                data = request.json
                title = data.get('title', 'New Chat')
                result = supabase.table('chat_sessions').insert({'title': title}).execute()
                return jsonify({'success': True, 'session': result.data[0]})
            except Exception as e:
                return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/sessions/<session_id>/messages', methods=['GET', 'OPTIONS'])
    def get_messages(session_id):
        if request.method == 'OPTIONS':
            return '', 204
        
        supabase = get_supabase()
        if not supabase:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500
            
        try:
            result = supabase.table('messages').select('*').eq('session_id', session_id).order('created_at').execute()
            return jsonify({'success': True, 'messages': result.data})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/sessions/<session_id>', methods=['PATCH', 'OPTIONS'])
    def rename_session(session_id):
        if request.method == 'OPTIONS':
            return '', 204
        
        supabase = get_supabase()
        if not supabase:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500
            
        try:
            data = request.json
            new_title = data.get('title')
            result = supabase.table('chat_sessions').update({'title': new_title}).eq('id', session_id).execute()
            return jsonify({'success': True, 'session': result.data[0]})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/chat', methods=['POST', 'OPTIONS'])
    def chat():
        if request.method == 'OPTIONS':
            return '', 204
        
        supabase = get_supabase()
        n8n_url = get_n8n_url()
        
        if not supabase:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500
        
        if not n8n_url:
            return jsonify({'success': False, 'error': 'N8N webhook not configured'}), 500
            
        try:
            data = request.json
            session_id = data.get('sessionId')
            message = data.get('message')
            image_url = data.get('imageUrl')
            
            # 1. Save user message
            user_message = {
                'session_id': session_id,
                'role': 'user',
                'content': message,
                'image_url': image_url
            }
            supabase.table('messages').insert(user_message).execute()
            
            # 2. Call n8n
            n8n_payload = {
                'sessionId': session_id,
                'message': message,
                'imageUrl': image_url
            }
            
            n8n_response = requests.post(n8n_url, json=n8n_payload, timeout=30)
            bot_reply = n8n_response.json().get('reply', 'Xin lỗi, tôi không thể trả lời.')
            
            # 3. Save bot message
            bot_message = {
                'session_id': session_id,
                'role': 'assistant',
                'content': bot_reply,
                'image_url': None
            }
            supabase.table('messages').insert(bot_message).execute()
            
            # 4. Update session
            supabase.table('chat_sessions').update({
                'updated_at': datetime.now().isoformat()
            }).eq('id', session_id).execute()
            
            return jsonify({'success': True, 'reply': bot_reply})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/upload', methods=['POST', 'OPTIONS'])
    def upload_image():
        if request.method == 'OPTIONS':
            return '', 204
        
        supabase = get_supabase()
        if not supabase:
            return jsonify({'success': False, 'error': 'Database not configured'}), 500
            
        try:
            file = request.files['file']
            file_ext = file.filename.split('.')[-1]
            file_name = f"{uuid.uuid4()}.{file_ext}"
            
            supabase.storage.from_('chat-images').upload(
                file_name,
                file.read(),
                {'content-type': file.content_type}
            )
            
            public_url = supabase.storage.from_('chat-images').get_public_url(file_name)
            
            return jsonify({'success': True, 'url': public_url})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500