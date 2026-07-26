import json
import http.server
import socketserver
import os
import subprocess
import threading
import time
import sys
from datetime import datetime
import socket
import re
import pickle
import hashlib
from collections import defaultdict
import signal

PORT = 8484
REFRESH_MINUTES = 30

# Cache per gli hash dei nodi
HASH_CACHE_FILE = 'hash_cache.pkl'
hash_cache = defaultdict(dict)

# Variabili globali per percorsi comandi
RNID_PATH = None
RNPATH_PATH = None
RNPROBE_PATH = None
RNSTATUS_PATH = None


def setup_environment():
    """Configura l'ambiente per systemd"""
    home = os.path.expanduser('~')
    local_bin = os.path.join(home, '.local', 'bin')
    
    if local_bin not in os.environ.get('PATH', ''):
        os.environ['PATH'] = local_bin + ':' + os.environ.get('PATH', '')
    
    if 'HOME' not in os.environ:
        os.environ['HOME'] = home
    
    if 'USER' not in os.environ:
        os.environ['USER'] = os.path.basename(home)

setup_environment()

print(f"PATH: {os.environ.get('PATH')}")
print(f"HOME: {os.environ.get('HOME')}")
print(f"USER: {os.environ.get('USER')}")


try:
    from locations import GEOCODE_LOCATION, validate_and_correct_coordinates
    print("✅ locations.py caricato")
except ImportError as e:
    print(f"❌ Errore import locations.py: {e}")
    def GEOCODE_LOCATION(node_name, reachable_on):
        return None
    def validate_and_correct_coordinates(coords, node_name, location_desc):
        return coords

LOCAL_NODE_CONFIG = {
    "name": "RNS-VPS REPMap ITALY",
    "latitude": 44.5,
    "longitude": 11.5,
    "reachable_on": "82.223.44.241",
    "port": 4242,
    "type": "BackboneInterface",
    "status": "available",
    "status_code": 1000,
    "geolocated": True,
    "location_source": "manual",
    "location_desc": "Server node",
    "is_local_node": True,
    "value": 26,
    "height": None,
    "hops": 0,
}

# ============ FUNZIONI CACHE ============

def load_hash_cache():
    global hash_cache
    try:
        if os.path.exists(HASH_CACHE_FILE):
            with open(HASH_CACHE_FILE, 'rb') as f:
                hash_cache = pickle.load(f)
            print(f"✅ Cache hash caricata: {len(hash_cache)} nodi")
    except Exception as e:
        print(f"❌ Errore caricamento cache: {e}")
        hash_cache = defaultdict(dict)

def save_hash_cache():
    try:
        with open(HASH_CACHE_FILE, 'wb') as f:
            pickle.dump(hash_cache, f)
        print("💾 Cache hash salvata")
    except Exception as e:
        print(f"❌ Errore salvataggio cache: {e}")

def get_cached_hash(transport_id, handler):
    if transport_id in hash_cache and handler in hash_cache[transport_id]:
        cached_data = hash_cache[transport_id][handler]
        if time.time() - cached_data['timestamp'] < 86400:
            return cached_data['hash']
    return None

def cache_hash(transport_id, handler, hash_value):
    hash_cache[transport_id][handler] = {
        'hash': hash_value,
        'timestamp': time.time(),
        'handler': handler
    }
    save_hash_cache()

# ============ FUNZIONI DI SUPPORTO ============

def find_command_path(cmd_name):
    try:
        import shutil
        path = shutil.which(cmd_name)
        if path:
            print(f"✅ {cmd_name} trovato: {path}")
            return path
    except:
        pass
    print(f"⚠️  {cmd_name} non trovato nel PATH, usando nome comando")
    return cmd_name

def init_command_paths():
    global RNID_PATH, RNPATH_PATH, RNPROBE_PATH, RNSTATUS_PATH
    RNID_PATH = find_command_path('rnid')
    RNPATH_PATH = find_command_path('rnpath')
    RNPROBE_PATH = find_command_path('rnprobe')
    RNSTATUS_PATH = find_command_path('rnstatus')

def get_local_node_identifiers():
    try:
        print("🔑 Recupero identificatori nodo locale...")
        cmd = f"{RNID_PATH} -i ~/.reticulum/storage/transport_identity -p"
        
        result = subprocess.run(
            cmd, 
            shell=True, 
            capture_output=True, 
            text=True, 
            timeout=10
        )
        
        if result.returncode == 0:
            output = result.stdout
            identity_match = re.search(r'Loaded Identity <([a-f0-9]{32})>', output)
            pubkey_match = re.search(r'Public Key\s*:\s*([a-f0-9]{128})', output)
            
            if identity_match and pubkey_match:
                transport_id = identity_match.group(1)
                network_id = transport_id
                public_key = pubkey_match.group(1)
                discovery_hash = public_key[:64]
                
                print(f"✅ Identificatori recuperati:")
                print(f"   Transport ID: {transport_id}")
                print(f"   Network ID: {network_id}")
                print(f"   Discovery Hash: {discovery_hash[:16]}...")
                
                return {
                    'transport_id': transport_id,
                    'network_id': network_id,
                    'discovery_hash': discovery_hash,
                    'public_key': public_key
                }
            else:
                print("⚠️  Impossibile estrarre identificatori dall'output di rnid")
        else:
            print(f"❌ Errore rnid: {result.stderr}")
    
    except Exception as e:
        print(f"❌ Errore recupero identificatori: {e}")
    
    print("⚠️  Usando identificatori generati...")
    hash_string = f"{LOCAL_NODE_CONFIG['name']}{LOCAL_NODE_CONFIG['reachable_on']}{LOCAL_NODE_CONFIG['port']}"
    discovery_hash = hashlib.sha256(hash_string.encode()).hexdigest()
    
    return {
        'transport_id': discovery_hash[:32],
        'network_id': discovery_hash[:32],
        'discovery_hash': discovery_hash,
        'public_key': None
    }

def extract_hash_from_output(output, handler):
    try:
        pattern1 = rf'{re.escape(handler)}\s+destination.*?<([a-f0-9]{{32}})>'
        match = re.search(pattern1, output, re.IGNORECASE)
        if match:
            return match.group(1)
        
        pattern2 = r'<([a-f0-9]{32})>'
        matches = re.findall(pattern2, output)
        
        if len(matches) == 1:
            return matches[0]
        
        lines = output.split('\n')
        for i, line in enumerate(lines):
            if handler.lower() in line.lower():
                for offset in [0, 1, -1, 2, -2]:
                    if 0 <= i + offset < len(lines):
                        check_line = lines[i + offset]
                        hash_match = re.search(pattern2, check_line)
                        if hash_match:
                            return hash_match.group(1)
        
        return None
    except:
        return None

# ============ FUNZIONI PRINCIPALI ============

def get_node_handler_hash(transport_id, handler):
    try:
        cached_hash = get_cached_hash(transport_id, handler)
        if cached_hash:
            print(f"✅ Hash per {handler} trovato in cache: {cached_hash[:16]}...")
            return cached_hash
        
        print(f"🔍 Ottenimento hash per {handler} via rnid...")
        cmd = f"{RNID_PATH} -R -i {transport_id} -H {handler}"
        
        env = os.environ.copy()
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=30, env=env
        )
        
        if result.returncode == 0:
            handler_hash = extract_hash_from_output(result.stdout, handler)
            if handler_hash:
                cache_hash(transport_id, handler, handler_hash)
                print(f"✅ Hash per {handler} ottenuto: {handler_hash[:16]}...")
                return handler_hash
            else:
                print(f"❌ Hash per {handler} non trovato nell'output")
        else:
            print(f"❌ Errore rnid per {handler}: {result.stderr}")
        
        return None
        
    except Exception as e:
        print(f"❌ Errore ottenimento hash per {handler}: {e}")
        return None

def execute_rnid_command(transport_id, handler):
    try:
        handler_hash = get_node_handler_hash(transport_id, handler)
        
        if handler_hash:
            return {
                'success': True,
                'transport_id': transport_id,
                'handler': handler,
                'hash': handler_hash,
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'success': False,
                'transport_id': transport_id,
                'handler': handler,
                'error': f'Impossibile ottenere hash per {handler}',
                'timestamp': datetime.now().isoformat()
            }
            
    except Exception as e:
        return {
            'success': False,
            'transport_id': transport_id,
            'handler': handler,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

def execute_rnpath_direct(hash_value):
    try:
        cmd = f"{RNPATH_PATH} {hash_value}"
        print(f"🛣️  Esecuzione rnpath con hash: {hash_value[:16]}...")
        
        env = os.environ.copy()
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=30, env=env
        )
        
        if result.returncode == 0:
            return {
                'success': True,
                'handler_hash': hash_value,
                'output': result.stdout.strip(),
                'parsed_result': parse_rnpath_output(result.stdout),
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'success': False,
                'handler_hash': hash_value,
                'error': result.stderr.strip(),
                'output': result.stdout.strip(),
                'timestamp': datetime.now().isoformat()
            }
            
    except Exception as e:
        return {
            'success': False,
            'handler_hash': hash_value,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

def execute_rnprobe_direct(hash_value):
    try:
        cmd = f"{RNPROBE_PATH} rnstransport.probe {hash_value}"
        print(f"🔍 Esecuzione rnprobe con hash: {hash_value[:16]}...")
        
        env = os.environ.copy()
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=30, env=env
        )
        
        if result.returncode == 0:
            return {
                'success': True,
                'handler_hash': hash_value,
                'output': result.stdout.strip(),
                'parsed_result': parse_rnprobe_output(result.stdout),
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'success': False,
                'handler_hash': hash_value,
                'error': result.stderr.strip(),
                'output': result.stdout.strip(),
                'timestamp': datetime.now().isoformat()
            }
            
    except Exception as e:
        return {
            'success': False,
            'handler_hash': hash_value,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

def execute_ping_command(address):
    try:
        if ':' in address:
            host = address.split(':')[0]
        else:
            host = address
        
        import platform
        if platform.system() == "Windows":
            cmd = f'ping -n 2 -w 2000 -p 4242 {host}'
        else:
            cmd = f'ping -c 2 -W 2 -i 2 -p 4242 {host}'
        
        print(f"🏓 Esecuzione ping: {cmd}")
        
        result = subprocess.run(
            cmd, 
            shell=True, 
            capture_output=True, 
            text=True, 
            timeout=10
        )
        
        output = result.stdout.strip()
        
        parsed = parse_ping_output(output, host)
        
        return {
            'success': result.returncode == 0 or "time=" in output,
            'address': address,
            'host': host,
            'output': output,
            'parsed_result': parsed,
            'timestamp': datetime.now().isoformat()
        }
            
    except Exception as e:
        return {
            'success': False,
            'address': address,
            'host': host if 'host' in locals() else address,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

def execute_netcat_test(host, port, timeout=2):
    try:
        if ':' in host:
            host = host.split(':')[0]
        
        port = int(port)
        
        cmd = f"nc -W {timeout} {host} {port}"
        
        print(f"🔌 Esecuzione netcat: {cmd}")
        
        env = os.environ.copy()
        result = subprocess.run(
            cmd, 
            shell=True, 
            capture_output=True,
            timeout=timeout + 2,
            env=env
        )
        
        success = result.returncode == 0
        
        output_bytes = b""
        if result.stdout:
            output_bytes += result.stdout
        if result.stderr:
            output_bytes += b"\n[STDERR] " + result.stderr
        
        output = repr(output_bytes)
        
        return {
            'success': success,
            'host': host,
            'port': port,
            'protocol': 'TCP',
            'output': output,
            'raw_bytes': output_bytes.hex(),
            'bytes_length': len(output_bytes),
            'error': None if success else f"Exit code: {result.returncode}",
            'timestamp': datetime.now().isoformat()
        }
            
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'host': host,
            'port': port,
            'protocol': 'TCP',
            'error': f"Timeout ({timeout}s) expired",
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return {
            'success': False,
            'host': host,
            'port': port,
            'protocol': 'TCP',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

def execute_netcat_test_with_data(host, port, data=None, timeout=5):
    try:
        if ':' in host:
            host = host.split(':')[0]
        
        port = int(port)
        
        cmd = f"nc -W {timeout} {host} {port}"
        
        result = subprocess.run(
            cmd, 
            shell=True, 
            capture_output=True,
            timeout=timeout + 2
        )
        
        success = result.returncode == 0
        
        all_bytes = b""
        if result.stdout:
            all_bytes += result.stdout
        if result.stderr:
            all_bytes += b"\n--- STDERR ---\n" + result.stderr
        
        output_repr = repr(all_bytes)
        
        return {
            'success': success,
            'host': host,
            'port': port,
            'output': output_repr,
            'raw_bytes': all_bytes.hex(),
            'bytes_length': len(all_bytes),
            'error': None if success else f"Exit code: {result.returncode}"
        }
            
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'host': host,
            'port': port,
            'error': f"Timeout ({timeout}s) expired"
        }
    except Exception as e:
        return {
            'success': False,
            'host': host,
            'port': port,
            'error': str(e)
        }

def enrich_nodes_with_hashes():
    try:
        if not os.path.exists('nodes_geo.json'):
            return False
            
        with open('nodes_geo.json', 'r') as f:
            nodes = json.load(f)
        
        updated = False
        
        for node in nodes:
            transport_id = node.get('transport_id')
            if not transport_id:
                continue
            
            if transport_id in hash_cache:
                if 'handler_hashes' not in node:
                    node['handler_hashes'] = {}
                
                for handler, cache_data in hash_cache[transport_id].items():
                    if handler not in node['handler_hashes']:
                        node['handler_hashes'][handler] = cache_data['hash']
                        updated = True
                        print(f"✅ Aggiunto hash per {handler} al nodo {transport_id[:16]}...")
        
        if updated:
            with open('nodes_geo.json', 'w') as f:
                json.dump(nodes, f, indent=2)
            print(f"💾 nodes_geo.json aggiornato con {len([n for n in nodes if 'handler_hashes' in n])} nodi arricchiti")
        
        return updated
            
    except Exception as e:
        print(f"❌ Errore arricchimento nodi con hash: {e}")
        return False

def cache_hash(transport_id, handler, hash_value):
    try:
        hash_cache[transport_id][handler] = {
            'hash': hash_value,
            'timestamp': time.time(),
            'handler': handler
        }
        save_hash_cache()
        
        save_hash_to_nodes_json(transport_id, handler, hash_value)
        
        print(f"💾 Hash salvato per {handler}: cache + JSON")
        
    except Exception as e:
        print(f"❌ Errore salvataggio hash completo: {e}")

def save_hash_to_nodes_json(transport_id, handler, hash_value):
    try:
        if not os.path.exists('nodes_geo.json'):
            return False
            
        with open('nodes_geo.json', 'r') as f:
            nodes = json.load(f)
        
        updated = False
        
        for node in nodes:
            if node.get('transport_id') == transport_id:
                if 'handler_hashes' not in node:
                    node['handler_hashes'] = {}
                
                node['handler_hashes'][handler] = hash_value
                updated = True
                break
        
        if updated:
            with open('nodes_geo.json', 'w') as f:
                json.dump(nodes, f, indent=2)
            return True
            
    except Exception as e:
        print(f"❌ Errore salvataggio hash in JSON: {e}")
    
    return False

# ============ FUNZIONI PARSING ============

def parse_ping_output(output, host):
    parsed = {
        'host': host,
        'packets_transmitted': 0,
        'packets_received': 0,
        'packet_loss': 100,
        'round_trip_min': None,
        'round_trip_avg': None,
        'round_trip_max': None,
        'reachable': False
    }
    
    try:
        lines = output.strip().split('\n')
        
        for line in lines:
            line_lower = line.lower()
            
            if line.startswith('PATTERN:'):
                continue
                
            if 'packets transmitted' in line_lower and 'received' in line_lower:
                match = re.search(r'(\d+)\s*packets transmitted,\s*(\d+)\s*received', line_lower)
                if match:
                    parsed['packets_transmitted'] = int(match.group(1))
                    parsed['packets_received'] = int(match.group(2))
                    if parsed['packets_transmitted'] > 0:
                        parsed['packet_loss'] = 100 * (1 - parsed['packets_received'] / parsed['packets_transmitted'])
            
            if 'min/avg/max' in line_lower or 'round-trip' in line_lower:
                match = re.search(r'=\s*([\d.]+)/([\d.]+)/([\d.]+)', line)
                if match:
                    parsed['round_trip_min'] = float(match.group(1))
                    parsed['round_trip_avg'] = float(match.group(2))
                    parsed['round_trip_max'] = float(match.group(3))
            
            if 'time=' in line_lower or 'ttl=' in line_lower:
                parsed['reachable'] = True
        
        if parsed['packets_received'] > 0:
            parsed['reachable'] = True
            
    except Exception as e:
        print(f"⚠️  Errore parsing ping output: {e}")
    
    return parsed

def parse_netcat_with_data_output(output, success, host, port, data_sent):
    parsed = {
        'host': host,
        'port': port,
        'reachable': success,
        'service': 'unknown',
        'data_exchanged': False,
        'response_received': False,
        'response_length': 0,
        'response_preview': '',
        'details': {}
    }
    
    try:
        if success:
            parsed['status'] = 'connected'
            parsed['data_exchanged'] = data_sent is not None and len(data_sent) > 0
            
            if output and len(output) > 0:
                parsed['response_received'] = True
                parsed['response_length'] = len(output)
                parsed['response_preview'] = output[:200] + ('...' if len(output) > 200 else '')
                
                if 'HTTP' in output.upper() or 'Content-Type:' in output or 'Server:' in output:
                    parsed['service'] = 'http'
                    http_match = re.search(r'HTTP/\d\.\d\s+(\d{3})', output)
                    if http_match:
                        parsed['details']['http_status'] = int(http_match.group(1))
                        
                elif 'SSH' in output.upper():
                    parsed['service'] = 'ssh'
                elif 'SMTP' in output.upper():
                    parsed['service'] = 'smtp'
                elif 'POP3' in output.upper():
                    parsed['service'] = 'pop3'
                elif 'IMAP' in output.upper():
                    parsed['service'] = 'imap'
                elif 'FTP' in output.upper():
                    parsed['service'] = 'ftp'
                elif any(x in output.upper() for x in ['RETICULUM', 'RNS']):
                    parsed['service'] = 'reticulum'
                else:
                    parsed['service'] = 'custom_tcp'
                    
            else:
                parsed['service'] = 'tcp_echo' if data_sent else 'tcp_listening'
                
        else:
            parsed['status'] = 'failed'
            parsed['details']['error'] = output if output else 'No response received'
            
    except Exception as e:
        parsed['status'] = 'error'
        parsed['details']['parse_error'] = str(e)
    
    return parsed

def execute_nmap_scan(host, port=None):
    try:
        if ':' in host:
            host = host.split(':')[0]
        
        if port:
            cmd = f"nmap -Pn -p {port} {host}"
        else:
            cmd = f"nmap -F -Pn {host}"
        
        print(f"🔍 Esecuzione nmap: {cmd}")
        
        env = os.environ.copy()
        result = subprocess.run(
            cmd, 
            shell=True, 
            capture_output=True, 
            text=True, 
            timeout=30,
            env=env
        )
        
        return {
            'success': result.returncode == 0,
            'host': host,
            'port': port,
            'output': result.stdout.strip(),
            'error': result.stderr.strip() if result.stderr else None,
            'timestamp': datetime.now().isoformat()
        }
            
    except Exception as e:
        return {
            'success': False,
            'host': host,
            'port': port,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

def parse_rnprobe_output(output):
    parsed = {
        'sent': 0,
        'received': 0,
        'packet_loss': 0.0,
        'round_trip_time': None,
        'hops': None,
        'valid_reply': False,
        'status': 'unknown'
    }
    
    try:
        lines = output.strip().split('\n')
        
        for line in lines:
            if 'Valid reply' in line:
                parsed['valid_reply'] = True
            
            if 'Round-trip time' in line.lower():
                match = re.search(r'(\d+\.\d+)\s*milliseconds', line)
                if match:
                    parsed['round_trip_time'] = float(match.group(1))
            
            if 'hop' in line.lower():
                match = re.search(r'(\d+)\s*hop', line)
                if match:
                    parsed['hops'] = int(match.group(1))
            
            if 'Sent' in line and 'received' in line and 'packet loss' in line:
                match = re.search(r'Sent\s*(\d+),\s*received\s*(\d+),\s*packet loss\s*(\d+\.\d+)%', line)
                if match:
                    parsed['sent'] = int(match.group(1))
                    parsed['received'] = int(match.group(2))
                    parsed['packet_loss'] = float(match.group(3))
        
        if parsed['valid_reply']:
            parsed['status'] = 'success'
        elif parsed['sent'] > 0:
            parsed['status'] = 'no_reply'
        else:
            parsed['status'] = 'failed'
            
    except Exception as e:
        print(f"⚠️  Errore parsing rnprobe output: {e}")
    
    return parsed

def parse_rnpath_output(output):
    parsed = {
        'hops': None,
        'via_node': None,
        'interface': None,
        'status': 'unknown',
        'path_found': False
    }
    
    try:
        if 'Path found' in output:
            parsed['path_found'] = True
            parsed['status'] = 'found'
            
            match = re.search(r'(\d+)\s*hops? away', output)
            if match:
                parsed['hops'] = int(match.group(1))
            
            match = re.search(r'via\s*<([a-f0-9]{32})>', output)
            if match:
                parsed['via_node'] = match.group(1)
            
            match = re.search(r'on\s*(.+?)(?:\s*$|\s*\[)', output)
            if match:
                parsed['interface'] = match.group(1).strip()
                
        elif 'No path' in output or 'not reachable' in output.lower():
            parsed['status'] = 'not_found'
            parsed['path_found'] = False
            
    except Exception as e:
        print(f"⚠️  Errore parsing rnpath output: {e}")
    
    return parsed

def execute_rnpath_drop_command(hash_value):
    try:
        hash_value = hash_value.strip()
        
        import re
        if not re.match(r'^[a-f0-9]{32}$', hash_value, re.IGNORECASE):
            return {
                'success': False,
                'handler_hash': hash_value,
                'error': f'Invalid hash format: {hash_value}',
                'timestamp': datetime.now().isoformat()
            }
        
        cmd = f"{RNPATH_PATH} -d {hash_value}"
        print(f"🗑️  Esecuzione rnpath -d (drop) con hash: {hash_value[:16]}...")
        
        env = os.environ.copy()
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=30, env=env
        )
        
        if result.returncode == 0:
            return {
                'success': True,
                'handler_hash': hash_value,
                'output': result.stdout.strip(),
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'success': False,
                'handler_hash': hash_value,
                'error': result.stderr.strip(),
                'output': result.stdout.strip(),
                'timestamp': datetime.now().isoformat()
            }
            
    except Exception as e:
        return {
            'success': False,
            'handler_hash': hash_value if 'hash_value' in locals() else 'unknown',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }

# ============ FUNZIONI NODI E GEOCODING ============

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def get_public_ip():
    try:
        import urllib.request
        with urllib.request.urlopen('https://api.ipify.org', timeout=5) as response:
            return response.read().decode('utf-8')
    except:
        return None

def run_rnstatus():
    try:
        print("🔄 Esecuzione rnstatus...")
        cmd = f"{RNSTATUS_PATH} -d -j"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            with open('nodes.json', 'w') as f:
                f.write(result.stdout)
            
            process_geolocation()
            
            enrich_nodes_with_hashes()
            
            return True
        else:
            print(f"❌ Errore: {result.stderr}")
            return False
    except Exception as e:
        print(f"❌ Errore: {e}")
        return False

def process_geolocation():
    try:
        nodes = []
        if os.path.exists('nodes.json'):
            with open('nodes.json', 'r') as f:
                nodes = json.load(f)
        
        updated_nodes = []
        
        local_node = dict(LOCAL_NODE_CONFIG)
        
        if not local_node.get('reachable_on') or local_node['reachable_on'] == 'auto':
            public_ip = get_public_ip()
            local_ip = get_local_ip()
            local_node['reachable_on'] = public_ip or local_ip
            print(f"📍 IP nodo locale: {local_node['reachable_on']}")
        
        identifiers = get_local_node_identifiers()
        
        local_node.update({
            'discovery_hash': identifiers['discovery_hash'],
            'transport_id': identifiers['transport_id'],
            'network_id': identifiers['network_id'],
            'transport': True,
            'last_heard': datetime.now().timestamp(),
            'heard_count': 1,
            'received': datetime.now().timestamp(),
            'stamp': identifiers['discovery_hash'][:64],
            'config_entry': f"[[{local_node['name']}]]\n  type = {local_node['type']}\n  enabled = yes\n  remote = {local_node['reachable_on']}\n  target_port = {local_node['port']}\n  transport_identity = {identifiers['transport_id']}",
            'discovered': datetime.now().timestamp(),
            'address': local_node['reachable_on'],
        })
        
        if identifiers.get('public_key'):
            local_node['public_key'] = identifiers['public_key']
        
        updated_nodes.append(local_node)
        
        for node in nodes:
            node_copy = dict(node)
            
            has_valid_coords = (node.get('latitude') is not None and 
                               node.get('longitude') is not None and
                               node.get('latitude') != 'null' and 
                               node.get('longitude') != 'null')
            
            if has_valid_coords:
                node_copy['latitude'] = node['latitude']
                node_copy['longitude'] = node['longitude']
                node_copy['geolocated'] = True
                node_copy['location_source'] = 'coordinates_only'
                node_copy['existing_coords'] = True
                
                print(f"📍 Nodo con coordinate configurate: {node.get('name', 'Unknown')}")
                
            else:
                coords = GEOCODE_LOCATION(
                    node.get('name', ''), 
                    node.get('reachable_on', '')
                )
                if coords:
                    node_copy['latitude'] = coords.get('lat')
                    node_copy['longitude'] = coords.get('lng')
                    node_copy['geolocated'] = True
                    node_copy['location_desc'] = coords.get('desc', '')
                    node_copy['location_source'] = coords.get('source', 'unknown')
                    node_copy['existing_coords'] = False
                else:
                    node_copy['geolocated'] = False
            
            is_duplicate = False
            if (node.get('reachable_on') == local_node['reachable_on'] and 
                node.get('port') == local_node.get('port')):
                is_duplicate = True
            elif node.get('name') == local_node['name']:
                is_duplicate = True
            elif node.get('transport_id') == identifiers['transport_id']:
                is_duplicate = True
            
            if is_duplicate:
                print(f"⚠️  Nodo locale già presente in rnstatus, saltato: {node.get('name')}")
                continue
            
            updated_nodes.append(node_copy)
        
        with open('nodes_geo.json', 'w') as f:
            json.dump(updated_nodes, f, indent=2)
        
        mapped = sum(1 for n in updated_nodes if n.get('geolocated'))
        print(f"📊 Nodi mappati: {mapped}/{len(updated_nodes)} (incluso nodo locale)")
        
    except Exception as e:
        print(f"❌ Errore geolocalizzazione: {e}")

def auto_refresh():
    while True:
        time.sleep(REFRESH_MINUTES * 60)
        print(f"\n⏰ Auto-refresh ({REFRESH_MINUTES} minuti)")
        run_rnstatus()

# ============ REQUEST HANDLER ============

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # ============================================
        # FILE STATICI
        # ============================================
        
        # CSS
        if self.path.endswith('.css'):
            try:
                if os.path.exists(self.path[1:]):
                    with open(self.path[1:], 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/css')
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    self.wfile.write(content)
                else:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/css')
                    self.end_headers()
                    self.wfile.write(b'/* Empty CSS */')
            except:
                self.send_response(200)
                self.send_header('Content-Type', 'text/css')
                self.end_headers()
                self.wfile.write(b'/* Empty CSS */')
            return
        
        # JS
        if self.path.endswith('.js'):
            try:
                if os.path.exists(self.path[1:]):
                    with open(self.path[1:], 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/javascript')
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    self.wfile.write(content)
                else:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/javascript')
                    self.end_headers()
                    self.wfile.write(b'// Empty JS')
            except:
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript')
                self.end_headers()
                self.wfile.write(b'// Empty JS')
            return
        
        # Favicon
        if self.path == '/favicon.ico':
            self.send_response(200)
            self.send_header('Content-Type', 'image/x-icon')
            self.end_headers()
            self.wfile.write(b'')
            return
        
        # ============================================
        # API ENDPOINTS
        # ============================================
        
        if self.path.startswith('/get_hash/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 4:
                    transport_id = parts[2]
                    handler = parts[3]
                    
                    handler_hash = get_node_handler_hash(transport_id, handler)
                    
                    if handler_hash:
                        result = {
                            'success': True,
                            'transport_id': transport_id,
                            'handler': handler,
                            'hash': handler_hash,
                            'timestamp': datetime.now().isoformat()
                        }
                    else:
                        result = {
                            'success': False,
                            'transport_id': transport_id,
                            'handler': handler,
                            'error': f'Impossibile ottenere hash per {handler}',
                            'timestamp': datetime.now().isoformat()
                        }
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /get_hash/<transport_id>/<handler>'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return
        
        if self.path.startswith('/rnpath_hash/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    hash_value = parts[2]
                    result = execute_rnpath_direct(hash_value)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /rnpath_hash/<hash>'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return
        
        if self.path.startswith('/rnprobe_hash/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    hash_value = parts[2]
                    result = execute_rnprobe_direct(hash_value)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /rnprobe_hash/<hash>'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return
        
        if self.path.startswith('/rnid/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 4:
                    transport_id = parts[2]
                    handler = parts[3]
                    result = execute_rnid_command(transport_id, handler)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /rnid/<transport_id>/<handler>'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return
        
        if self.path.startswith('/ping/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    address = parts[2]
                    result = execute_ping_command(address)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /ping/<address>'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return

        if self.path.startswith('/nmap/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    host = parts[2]
                    port = parts[3] if len(parts) >= 4 else None
                    result = execute_nmap_scan(host, port)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /nmap/<host>[/<port>]'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return
        
        if self.path.startswith('/netcat/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 4:
                    host = parts[2]
                    port = parts[3]
                    
                    data = None
                    timeout = 5
                    
                    if '?' in port:
                        port_parts = port.split('?')
                        port = port_parts[0]
                        if len(port_parts) > 1:
                            query = port_parts[1]
                            params = query.split('&')
                            for param in params:
                                if '=' in param:
                                    key, value = param.split('=')
                                    if key == 'data':
                                        data = value
                                    elif key == 'timeout':
                                        timeout = int(value)
                    
                    if data:
                        result = execute_netcat_test_with_data(host, port, data, timeout)
                    else:
                        result = execute_netcat_test(host, port, timeout)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /netcat/<host>/<port>[?data=<text>&timeout=<seconds>]'
                    }).encode())
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return
        
        if self.path.startswith('/rnpath_drop/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    hash_value = parts[2]
                    result = execute_rnpath_drop_command(hash_value)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'error': 'Formato URL non valido. Usa: /rnpath_drop/<hash>'
                    }).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Errore interno: {str(e)}'
                }).encode())
            return

        if self.path == '/rnid_handlers':
            handlers = [
                {
                    'name': 'rnstransport.probe',
                    'description': 'Transport layer probe service',
                    'category': 'transport'
                },
                {
                    'name': 'lxmf.propagation',
                    'description': 'LXMF message propagation',
                    'category': 'lxmf'
                },
                {
                    'name': 'lxmf.delivery',
                    'description': 'LXMF message delivery',
                    'category': 'lxmf'
                },
                {
                    'name': 'call.audio',
                    'description': 'Audio call service',
                    'category': 'call'
                },
                {
                    'name': 'nomadnetwork.node',
                    'description': 'Nomad Network node service',
                    'category': 'nomadnetwork'
                },
                {
                    'name': 'filetransfer',
                    'description': 'File transfer service',
                    'category': 'filetransfer'
                },
                {
                    'name': 'fsync',
                    'description': 'File synchronization',
                    'category': 'fsync'
                },
            ]
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'handlers': handlers}).encode())
            return
        
        if self.path == '/data':
            try:
                if os.path.exists('nodes_geo.json'):
                    with open('nodes_geo.json', 'r') as f:
                        data = json.load(f)
                elif os.path.exists('nodes.json'):
                    with open('nodes.json', 'r') as f:
                        data = json.load(f)
                else:
                    data = []
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())
            except:
                self.send_error(500, "Errore caricamento dati")
            return
        
        if self.path == '/refresh':
            success = run_rnstatus()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': success}).encode())
            return
        
        if self.path == '/localnode':
            local_node = dict(LOCAL_NODE_CONFIG)
            identifiers = get_local_node_identifiers()
            
            local_node.update({
                'discovery_hash': identifiers['discovery_hash'],
                'transport_id': identifiers['transport_id'],
                'network_id': identifiers['network_id'],
                'last_heard': datetime.now().timestamp(),
                'heard_count': 1,
            })
            
            if identifiers.get('public_key'):
                local_node['public_key'] = identifiers['public_key']
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(local_node).encode())
            return
        
        if self.path == '/robots.txt':
            try:
                if os.path.exists('robots.txt'):
                    with open('robots.txt', 'r') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(content.encode())
                else:
                    self.send_error(404, "robots.txt not found")
            except Exception as e:
                self.send_error(500, str(e))
            return

        if self.path == '/sitemap.xml':
            try:
                if os.path.exists('sitemap.xml'):
                    with open('sitemap.xml', 'r') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/xml')
                    self.end_headers()
                    self.wfile.write(content.encode())
                else:
                    self.send_error(404, "sitemap.xml not found")
            except Exception as e:
                self.send_error(500, str(e))
            return
        
        if self.path.startswith('/discover_handlers/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    transport_id = parts[2]
                    
                    # Lista di handler da scoprire
                    handlers_to_check = [
                        'rnstransport.probe',
                        'lxmf.propagation', 
                        'lxmf.delivery',
                        'call.audio',
                        'nomadnetwork.node'
                    ]
                    
                    discovered = []
                    for handler in handlers_to_check:
                        h = get_node_handler_hash(transport_id, handler)
                        if h:
                            discovered.append({
                                'name': handler,
                                'hash': h
                            })
                    
                    result = {
                        'success': True,
                        'transport_id': transport_id,
                        'handlers': discovered
                    }
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.end_headers()
            except Exception as e:
                self.send_response(500)
                self.end_headers()
            return

        # 2. Endpoint per risoluzione DNS
        if self.path.startswith('/dns/'):
            try:
                parts = self.path.split('/')
                if len(parts) >= 3:
                    hostname = parts[2]
                    
                    try:
                        ip = socket.gethostbyname(hostname)
                        result = {
                            'success': True,
                            'hostname': hostname,
                            'ip': ip
                        }
                    except socket.gaierror:
                        result = {
                            'success': False,
                            'hostname': hostname,
                            'error': 'DNS resolution failed'
                        }
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(400)
                    self.end_headers()
            except Exception as e:
                self.send_response(500)
                self.end_headers()
            return


        # ============================================
        # MAP.HTML
        # ============================================
        if self.path in ['/', '/index.html', '/map.html']:
            if os.path.exists('map.html'):
                with open('map.html', 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.end_headers()
                self.wfile.write(content)
            else:
                html_content = b'''
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Reticulum Network Map</title>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: Arial, sans-serif; margin: 40px; }
                        h1 { color: #3b82f6; }
                        .api-list { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
                        code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; }
                    </style>
                </head>
                <body>
                    <h1>Reticulum Network Map Server</h1>
                    <p>Server is running. API endpoints available:</p>
                    <div class="api-list">
                        <p><strong>GET</strong> <code>/data</code> - JSON data with all nodes</p>
                        <p><strong>GET</strong> <code>/refresh</code> - Manual refresh</p>
                        <p><strong>GET</strong> <code>/localnode</code> - Local node info</p>
                        <p><strong>GET</strong> <code>/rnid/&lt;transport_id&gt;/&lt;handler&gt;</code> - Get hash for specific handler</p>
                        <p><strong>GET</strong> <code>/rnpath_hash/&lt;hash&gt;</code> - Execute rnpath with hash</p>
                        <p><strong>GET</strong> <code>/rnprobe_hash/&lt;hash&gt;</code> - Execute rnprobe with hash</p>
                        <p><strong>GET</strong> <code>/ping/&lt;address&gt;</code> - Execute ping (2 packets, 2s interval)</p>
                        <p><strong>GET</strong> <code>/get_hash/&lt;transport_id&gt;/&lt;handler&gt;</code> - Get hash for handler (cached)</p>
                        <p><strong>GET</strong> <code>/netcat/&lt;host&gt;/&lt;port&gt;[?data=&lt;text&gt;&timeout=&lt;seconds&gt;]</code> - Test TCP connection with netcat</p>
                        <p><strong>GET</strong> <code>/nmap/&lt;host&gt;[/&lt;port&gt;]</code> - Execute nmap scan</p>
                        <p><strong>GET</strong> <code>/rnpath_drop/&lt;hash&gt;</code> - Drop/reset path with rnpath -d</p>
                    </div>
                    <p>Place a <code>map.html</code> file in this directory for the full map interface.</p>
                </body>
                </html>
                '''
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.end_headers()
                self.wfile.write(html_content)
            return
        
        # ============================================
        # ALTRI FILE - SUPER
        # ============================================
        super().do_GET()

# ============ CLASSE SERVER CON REUSE ADDRESS ============
class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

# ============ MAIN ============

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    def signal_handler(sig, frame):
        print("\n👋 Server fermato")
        sys.exit(0)
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    init_command_paths()
    load_hash_cache()
    
    print("🌐 Reticulum Network Map")
    print(f"📡 Porta: {PORT}")
    print(f"📍 Nodo locale: {LOCAL_NODE_CONFIG['name']}")
    print(f"🔄 Auto-refresh: {REFRESH_MINUTES} minuti")
    print(f"🔧 API disponibili:")
    print(f"   • /get_hash/<transport_id>/<handler> - Ottieni hash per handler")
    print(f"   • /rnid/<transport_id>/<handler> - Esegui rnid (ottieni hash)")
    print(f"   • /rnpath_hash/<hash> - Esegui rnpath con hash")
    print(f"   • /rnprobe_hash/<hash> - Esegui rnprobe con hash")
    print(f"   • /ping/<address> - Ping (2 pacchetti, 2s intervallo)")
    print(f"   • /netcat/<host>/<port> - Test TCP con netcat")
    print(f"   • /netcat/<host>/<port>?data=<text> - Test TCP con invio dati")
    print(f"   • /nmap/<host> - Scansione nmap")
    print(f"   • /rnpath_drop/<hash> - Droppa percorso con rnpath -d")
    print("=" * 40)
    
    print("\n🔄 Caricamento dati iniziali...")
    if not run_rnstatus():
        print("⚠️  Usando dati esistenti")
    
    thread = threading.Thread(target=auto_refresh, daemon=True)
    thread.start()
    
    try:
        server = ReuseTCPServer(("", PORT), RequestHandler)
        print(f"\n✅ Server pronto: http://localhost:{PORT}")
        print("📌 Il nodo locale è sempre incluso nella mappa")
        print("💾 Cache hash attiva")
        print("🔌 Netcat support attivo")
        print("🛑 Ctrl+C per fermare")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Server fermato")
    except Exception as e:
        print(f"\n❌ Errore: {e}")

if __name__ == "__main__":
    main()