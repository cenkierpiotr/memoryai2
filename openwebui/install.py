#!/usr/bin/env python3
"""
MemoryAI Open WebUI Installer
Installs MemoryAI Filter and Tools directly into Open WebUI database.
Run inside the Open WebUI container: python3 install.py

Usage:
  docker cp install.py open-webui:/tmp/
  docker cp memoryai_filter.py open-webui:/tmp/
  docker cp memoryai_tools.py open-webui:/tmp/
  docker exec open-webui python3 /tmp/install.py
"""
import sqlite3, json, time, sys, os

# Config — edit these
MEMORYAI_URL = os.environ.get('MEMORYAI_URL', 'http://localhost:3010')
MEMORYAI_TOKEN = os.environ.get('MEMORYAI_TOKEN', '')
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = '/app/backend/data/webui.db'

now = int(time.time())

# Load filter and tools code
filter_path = os.path.join(SCRIPT_DIR, 'memoryai_filter.py')
tools_path = os.path.join(SCRIPT_DIR, 'memoryai_tools.py')

# If running from /tmp inside container, look there
if not os.path.exists(filter_path):
    filter_path = '/tmp/memoryai_filter.py'
    tools_path = '/tmp/memoryai_tools.py'

with open(filter_path) as f:
    filter_code = f.read()
with open(tools_path) as f:
    tools_code = f.read()

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# Get admin user
cur.execute('SELECT id, email FROM user WHERE role="admin" LIMIT 1')
row = cur.fetchone()
if not row:
    print('ERROR: No admin user found.')
    sys.exit(1)
admin_id, admin_email = row
print(f'Admin: {admin_email} ({admin_id[:8]})')

# Tool specs (OpenAI format)
specs = [
  {"type":"function","function":{"name":"memory_search","description":"Search persistent memory for facts, decisions, and context from previous sessions.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Topic to search for"},"limit":{"type":"integer","description":"Max results (default 8)"}},"required":["query"]}}},
  {"type":"function","function":{"name":"memory_save","description":"Save a fact, decision, or preference to persistent memory.","parameters":{"type":"object","properties":{"content":{"type":"string","description":"The fact to remember"},"memory_type":{"type":"string","description":"fact|decision|preference|instruction|entity_relation|summary"},"importance":{"type":"number","description":"Importance 0.0-1.0"}},"required":["content"]}}},
  {"type":"function","function":{"name":"entity_get","description":"Get all known facts about a named entity (person, project, tool).","parameters":{"type":"object","properties":{"name":{"type":"string","description":"Entity name"}},"required":["name"]}}},
  {"type":"function","function":{"name":"entity_save","description":"Save or update a named entity with facts.","parameters":{"type":"object","properties":{"name":{"type":"string"},"entity_type":{"type":"string","description":"person|project|company|tool|server|other"},"facts":{"type":"array","items":{"type":"string"}},"description":{"type":"string"}},"required":["name","entity_type","facts"]}}},
  {"type":"function","function":{"name":"memory_get_context","description":"Load memory context for multiple topics at once.","parameters":{"type":"object","properties":{"topics":{"type":"string","description":"Topics to load context for"}},"required":["topics"]}}}
]

filter_valves = json.dumps({'memoryai_url': MEMORYAI_URL, 'memoryai_token': MEMORYAI_TOKEN, 'max_memories': 6, 'min_score': 0.45, 'inject_entities': True, 'max_entities': 3, 'save_to_session': True, 'priority': 0})
filter_meta = json.dumps({'description': 'Automatically injects MemoryAI context into every conversation.', 'manifest': {}})
tools_valves = json.dumps({'memoryai_url': MEMORYAI_URL, 'memoryai_token': MEMORYAI_TOKEN})
tools_meta = json.dumps({'description': 'Direct MemoryAI tools: search memories, save facts, manage entities.', 'manifest': {}})

cur.execute('DELETE FROM function WHERE id="memoryai_filter"')
cur.execute('INSERT INTO function (id,user_id,name,type,content,meta,valves,is_active,is_global,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ('memoryai_filter',admin_id,'MemoryAI Filter','filter',filter_code,filter_meta,filter_valves,1,1,now,now))
print('Filter installed (global, active).')

cur.execute('DELETE FROM tool WHERE id="memoryai_tools"')
cur.execute('INSERT INTO tool (id,user_id,name,content,specs,meta,valves,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ('memoryai_tools',admin_id,'MemoryAI Tools',tools_code,json.dumps(specs),tools_meta,tools_valves,now,now))
print('Tools installed.')

conn.commit()
conn.close()
print('Done. Restart Open WebUI if needed: docker restart open-webui')
