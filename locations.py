import socket
import subprocess
import re
import json
import os
import urllib.request
import urllib.error
from datetime import datetime

# Database base di coordinate
LOCATIONS = {
    # Paesi
    'italy': {'lat': 41.8719, 'lng': 12.5674},
    'spain': {'lat': 40.4637, 'lng': -3.7492},
    'france': {'lat': 46.6034, 'lng': 1.8883},
    'germany': {'lat': 51.1657, 'lng': 10.4515},
    'uk': {'lat': 55.3781, 'lng': -3.4360},
    'us': {'lat': 37.0902, 'lng': -95.7129},
    'usa': {'lat': 37.0902, 'lng': -95.7129},
    'russia': {'lat': 61.5240, 'lng': 105.3188},
    'iceland': {'lat': 64.9631, 'lng': -19.0208},
    'sweden': {'lat': 60.1282, 'lng': 18.6435},
    'norway': {'lat': 60.4720, 'lng': 8.4689},
    'switzerland': {'lat': 46.8182, 'lng': 8.2275},
    'hungary': {'lat': 47.1625, 'lng': 19.5033},
    'netherlands': {'lat': 52.1326, 'lng': 5.2913},
    'belgium': {'lat': 50.8503, 'lng': 4.3517},
    'austria': {'lat': 47.5162, 'lng': 14.5501},
    'poland': {'lat': 51.9194, 'lng': 19.1451},
    'czech': {'lat': 49.8175, 'lng': 15.4730},
    'finland': {'lat': 61.9241, 'lng': 25.7482},
    'denmark': {'lat': 56.2639, 'lng': 9.5018},
    'australia': {'lat': -25.2744, 'lng': 133.7751},
    'canada': {'lat': 56.1304, 'lng': -106.3468},
    'japan': {'lat': 36.2048, 'lng': 138.2529},
    'china': {'lat': 35.8617, 'lng': 104.1954},
    'brazil': {'lat': -14.2350, 'lng': -51.9253},
    
    # Città e regioni
    'london': {'lat': 51.5074, 'lng': -0.1278},
    'paris': {'lat': 48.8566, 'lng': 2.3522},
    'berlin': {'lat': 52.5200, 'lng': 13.4050},
    'budapest': {'lat': 47.4979, 'lng': 19.0402},
    'moscow': {'lat': 55.7558, 'lng': 37.6173},
    'minneapolis': {'lat': 44.9778, 'lng': -93.2650},
    'stockholm': {'lat': 59.3293, 'lng': 18.0686},
    'gothenburg': {'lat': 57.7089, 'lng': 11.9746},
    'novosibirsk': {'lat': 55.008992, 'lng': 82.969019},
    'nsk': {'lat': 55.008992, 'lng': 82.969019},
    'bern': {'lat': 46.9480, 'lng': 7.4474},
    'rome': {'lat': 41.9028, 'lng': 12.4964},
    'madrid': {'lat': 40.4168, 'lng': -3.7038},
    'amsterdam': {'lat': 52.3676, 'lng': 4.9041},
    'brussels': {'lat': 50.8503, 'lng': 4.3517},
    'vienna': {'lat': 48.2082, 'lng': 16.3738},
    'prague': {'lat': 50.0755, 'lng': 14.4378},
    'warsaw': {'lat': 52.2297, 'lng': 21.0122},
    'oslo': {'lat': 59.9139, 'lng': 10.7522},
    'copenhagen': {'lat': 55.6761, 'lng': 12.5683},
    'helsinki': {'lat': 60.1699, 'lng': 24.9384},
    'reykjavik': {'lat': 64.1466, 'lng': -21.9426},
    'zurich': {'lat': 47.3769, 'lng': 8.5417},
    'milan': {'lat': 45.4642, 'lng': 9.1900},
    'barcelona': {'lat': 41.3851, 'lng': 2.1734},
    'new york': {'lat': 40.7128, 'lng': -74.0060},
    'los angeles': {'lat': 34.0522, 'lng': -118.2437},
    'chicago': {'lat': 41.8781, 'lng': -87.6298},
    'seattle': {'lat': 47.6062, 'lng': -122.3321},
    'san francisco': {'lat': 37.7749, 'lng': -122.4194},
    'toronto': {'lat': 43.6532, 'lng': -79.3832},
    'sydney': {'lat': -33.8688, 'lng': 151.2093},
    'tokyo': {'lat': 35.6762, 'lng': 139.6503},
    'singapore': {'lat': 1.3521, 'lng': 103.8198},
    
    # Regioni e aree specifiche
    'ruhr': {'lat': 51.4333, 'lng': 7.0667},  # Regione della Ruhr, Germania
    'bavaria': {'lat': 48.7904, 'lng': 11.4979},
    'saxony': {'lat': 51.0263, 'lng': 13.3640},
    'texas': {'lat': 31.9686, 'lng': -99.9018},
    'california': {'lat': 36.7783, 'lng': -119.4179},
    'florida': {'lat': 27.6648, 'lng': -81.5158},
    'scandinavia': {'lat': 62.0115, 'lng': 15.0120},
    'baltic': {'lat': 57.1300, 'lng': 24.1000},
    'alps': {'lat': 46.8876, 'lng': 10.0167},
}

# Cache per performance
GEO_CACHE_FILE = 'geo_cache.json'
geo_cache = {}

def load_geo_cache():
    """Carica cache da file"""
    global geo_cache
    if os.path.exists(GEO_CACHE_FILE):
        try:
            with open(GEO_CACHE_FILE, 'r') as f:
                geo_cache = json.load(f)
        except:
            geo_cache = {}
    else:
        geo_cache = {}

def save_geo_cache():
    """Salva cache su file"""
    try:
        with open(GEO_CACHE_FILE, 'w') as f:
            json.dump(geo_cache, f, indent=2)
    except:
        pass

def is_valid_ip(ip_str):
    """Verifica se è un IP valido (IPv4 o IPv6)"""
    try:
        socket.inet_pton(socket.AF_INET, ip_str)
        return True
    except socket.error:
        try:
            socket.inet_pton(socket.AF_INET6, ip_str)
            return True
        except socket.error:
            return False

def resolve_hostname_with_ping(hostname):
    """Risolve hostname usando ping (funziona meglio per alcuni host)"""
    try:
        # Rimuovi porta se presente
        if ':' in hostname:
            hostname = hostname.split(':')[0]
        
        # Prova prima con DNS standard
        try:
            return socket.gethostbyname(hostname)
        except:
            pass
        
        # Fallback: prova con ping (solo se il sistema lo supporta)
        import platform
        if platform.system() == "Windows":
            cmd = ['ping', '-n', '1', '-w', '2000', hostname]
        else:
            cmd = ['ping', '-c', '1', '-W', '2', hostname]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        
        if result.returncode == 0:
            # Estrai IP dall'output di ping
            lines = result.stdout.split('\n')
            for line in lines:
                # Cerca pattern IP nell'output
                match = re.search(r'(\d+\.\d+\.\d+\.\d+)', line)
                if match:
                    ip = match.group(1)
                    if is_valid_ip(ip):
                        return ip
        
        return None
    except:
        return None

def get_ip_from_address(address):
    """Estrae IP da un indirizzo (può essere hostname:porta)"""
    if not address:
        return None
    
    # Estrai hostname/IP (senza porta)
    if ':' in address:
        parts = address.split(':')
        host_part = parts[0]
    else:
        host_part = address
    
    # Se è già un IP, restituiscilo
    if is_valid_ip(host_part):
        return host_part
    
    # Altrimenti risolvi hostname
    return resolve_hostname_with_ping(host_part)

def get_whois_info(ip):
    """Ottiene informazioni WHOIS per un IP"""
    try:
        # Esegui comando whois
        result = subprocess.run(
            ['whois', ip],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            output = result.stdout.lower()
            
            info = {
                'country': None,
                'city': None,
                'state': None,
                'org': None,
            }
            
            # Cerca paese
            patterns = [
                r'country:\s*(\w{2})',
                r'countrycode:\s*(\w{2})',
                r'registrant country:\s*(\w{2})',
            ]
            
            for pattern in patterns:
                match = re.search(pattern, output, re.IGNORECASE)
                if match:
                    info['country'] = match.group(1).upper()
                    break
            
            # Cerca città
            city_match = re.search(r'city:\s*(.+)', output, re.IGNORECASE)
            if city_match:
                info['city'] = city_match.group(1).strip()
            
            # Cerca stato/provincia
            state_match = re.search(r'stateprov:\s*(.+)', output, re.IGNORECASE)
            if state_match:
                info['state'] = state_match.group(1).strip()
            
            # Cerca organizzazione
            org_patterns = [
                r'orgname:\s*(.+)',
                r'org-name:\s*(.+)',
                r'organization:\s*(.+)',
                r'descr:\s*(.+)',
            ]
            
            for pattern in org_patterns:
                match = re.search(pattern, output, re.IGNORECASE)
                if match:
                    info['org'] = match.group(1).strip()
                    break
            
            return info
        
    except FileNotFoundError:
        print("⚠️  whois non installato. Installa con: sudo apt install whois")
    except Exception as e:
        print(f"⚠️  Errore whois per {ip}: {e}")
    
    return None

def get_ipapi_location(ip):
    """Usa ip-api.com per geolocalizzazione (API gratuita)"""
    try:
        url = f"http://ip-api.com/json/{ip}"
        request = urllib.request.Request(url, headers={
            'User-Agent': 'Reticulum-Network-Map/1.0'
        })
        
        with urllib.request.urlopen(request, timeout=5) as response:
            data = json.loads(response.read().decode())
            
            if data.get('status') == 'success':
                return {
                    'lat': data.get('lat'),
                    'lng': data.get('lon'),
                    'desc': f"{data.get('city', '')}, {data.get('country', '')}",
                    'source': 'ip-api.com',
                    'city': data.get('city'),
                    'country': data.get('country'),
                    'country_code': data.get('countryCode'),
                }
    except Exception as e:
        print(f"⚠️  Errore ip-api per {ip}: {e}")
    
    return None

def estimate_coordinates_from_info(info):
    """Stima coordinate basandosi su informazioni WHOIS"""
    if not info:
        return None
    
    # Mappa paesi a coordinate
    country_coords = {
        'US': {'lat': 39.8283, 'lng': -98.5795},
        'CA': {'lat': 56.1304, 'lng': -106.3468},
        'GB': {'lat': 55.3781, 'lng': -3.4360},
        'UK': {'lat': 55.3781, 'lng': -3.4360},
        'DE': {'lat': 51.1657, 'lng': 10.4515},
        'FR': {'lat': 46.6034, 'lng': 1.8883},
        'ES': {'lat': 40.4637, 'lng': -3.7492},
        'IT': {'lat': 41.8719, 'lng': 12.5674},
        'NL': {'lat': 52.1326, 'lng': 5.2913},
        'SE': {'lat': 60.1282, 'lng': 18.6435},
        'NO': {'lat': 60.4720, 'lng': 8.4689},
        'FI': {'lat': 61.9241, 'lng': 25.7482},
        'DK': {'lat': 56.2639, 'lng': 9.5018},
        'IS': {'lat': 64.9631, 'lng': -19.0208},
        'CH': {'lat': 46.8182, 'lng': 8.2275},
        'AT': {'lat': 47.5162, 'lng': 14.5501},
        'BE': {'lat': 50.8503, 'lng': 4.3517},
        'PL': {'lat': 51.9194, 'lng': 19.1451},
        'CZ': {'lat': 49.8175, 'lng': 15.4730},
        'HU': {'lat': 47.1625, 'lng': 19.5033},
        'RU': {'lat': 61.5240, 'lng': 105.3188},
        'UA': {'lat': 48.3794, 'lng': 31.1656},
        'AU': {'lat': -25.2744, 'lng': 133.7751},
        'NZ': {'lat': -40.9006, 'lng': 174.8860},
        'JP': {'lat': 36.2048, 'lng': 138.2529},
        'CN': {'lat': 35.8617, 'lng': 104.1954},
        'KR': {'lat': 35.9078, 'lng': 127.7669},
        'IN': {'lat': 20.5937, 'lng': 78.9629},
        'BR': {'lat': -14.2350, 'lng': -51.9253},
        'AR': {'lat': -38.4161, 'lng': -63.6167},
        'MX': {'lat': 23.6345, 'lng': -102.5528},
        'ZA': {'lat': -30.5595, 'lng': 22.9375},
    }
    
    # Cerca città specifica
    if info.get('city'):
        city_lower = info['city'].lower()
        # Cerca città nel database LOCATIONS
        for city_name, coords in LOCATIONS.items():
            if city_name in city_lower:
                return {
                    'lat': coords['lat'],
                    'lng': coords['lng'],
                    'desc': f"WHOIS city: {info['city']}",
                    'source': 'whois_city'
                }
    
    # Cerca per paese
    if info.get('country') and info['country'] in country_coords:
        coords = country_coords[info['country']]
        return {
            'lat': coords['lat'],
            'lng': coords['lng'],
            'desc': f"WHOIS country: {info['country']}",
            'source': 'whois_country'
        }
    
    # Cerca per organizzazione (cloud providers)
    if info.get('org'):
        org_lower = info['org'].lower()
        cloud_providers = {
            'amazon': {'lat': 47.7511, 'lng': -120.7401},
            'aws': {'lat': 47.7511, 'lng': -120.7401},
            'google': {'lat': 37.4220, 'lng': -122.0841},
            'microsoft': {'lat': 47.7511, 'lng': -120.7401},
            'azure': {'lat': 47.7511, 'lng': -120.7401},
            'digitalocean': {'lat': 40.7128, 'lng': -74.0060},
            'linode': {'lat': 40.7128, 'lng': -74.0060},
            'vultr': {'lat': 32.7767, 'lng': -96.7970},
            'hetzner': {'lat': 50.1109, 'lng': 8.6821},
            'ovh': {'lat': 50.6292, 'lng': 3.0573},
            'oracle': {'lat': 37.7749, 'lng': -122.4194},
        }
        
        for provider, coords in cloud_providers.items():
            if provider in org_lower:
                return {
                    'lat': coords['lat'],
                    'lng': coords['lng'],
                    'desc': f"Cloud provider: {provider}",
                    'source': 'whois_org'
                }
    
    return None

def geocode_from_tld(domain):
    """Geolocalizza basandosi sul TLD del dominio"""
    tld_map = {
        '.it': {'lat': 41.8719, 'lng': 12.5674, 'desc': 'Italy'},
        '.de': {'lat': 51.1657, 'lng': 10.4515, 'desc': 'Germany'},
        '.fr': {'lat': 46.6034, 'lng': 1.8883, 'desc': 'France'},
        '.es': {'lat': 40.4637, 'lng': -3.7492, 'desc': 'Spain'},
        '.uk': {'lat': 55.3781, 'lng': -3.4360, 'desc': 'United Kingdom'},
        '.co.uk': {'lat': 55.3781, 'lng': -3.4360, 'desc': 'United Kingdom'},
        '.se': {'lat': 60.1282, 'lng': 18.6435, 'desc': 'Sweden'},
        '.no': {'lat': 60.4720, 'lng': 8.4689, 'desc': 'Norway'},
        '.fi': {'lat': 61.9241, 'lng': 25.7482, 'desc': 'Finland'},
        '.dk': {'lat': 56.2639, 'lng': 9.5018, 'desc': 'Denmark'},
        '.is': {'lat': 64.9631, 'lng': -19.0208, 'desc': 'Iceland'},
        '.ch': {'lat': 46.8182, 'lng': 8.2275, 'desc': 'Switzerland'},
        '.nl': {'lat': 52.1326, 'lng': 5.2913, 'desc': 'Netherlands'},
        '.be': {'lat': 50.8503, 'lng': 4.3517, 'desc': 'Belgium'},
        '.pl': {'lat': 51.9194, 'lng': 19.1451, 'desc': 'Poland'},
        '.cz': {'lat': 49.8175, 'lng': 15.4730, 'desc': 'Czech Republic'},
        '.hu': {'lat': 47.1625, 'lng': 19.5033, 'desc': 'Hungary'},
        '.ro': {'lat': 45.9432, 'lng': 24.9668, 'desc': 'Romania'},
        '.ru': {'lat': 61.5240, 'lng': 105.3188, 'desc': 'Russia'},
        '.ua': {'lat': 48.3794, 'lng': 31.1656, 'desc': 'Ukraine'},
        '.au': {'lat': -25.2744, 'lng': 133.7751, 'desc': 'Australia'},
        '.nz': {'lat': -40.9006, 'lng': 174.8860, 'desc': 'New Zealand'},
        '.jp': {'lat': 36.2048, 'lng': 138.2529, 'desc': 'Japan'},
        '.cn': {'lat': 35.8617, 'lng': 104.1954, 'desc': 'China'},
        '.kr': {'lat': 35.9078, 'lng': 127.7669, 'desc': 'South Korea'},
        '.in': {'lat': 20.5937, 'lng': 78.9629, 'desc': 'India'},
        '.br': {'lat': -14.2350, 'lng': -51.9253, 'desc': 'Brazil'},
        '.ar': {'lat': -38.4161, 'lng': -63.6167, 'desc': 'Argentina'},
        '.mx': {'lat': 23.6345, 'lng': -102.5528, 'desc': 'Mexico'},
        '.za': {'lat': -30.5595, 'lng': 22.9375, 'desc': 'South Africa'},
    }
    
    for tld, data in tld_map.items():
        if domain.endswith(tld):
            return {
                'lat': data['lat'],
                'lng': data['lng'],
                'desc': f"TLD: {data['desc']}",
                'source': 'tld'
            }
    
    return None

def validate_and_correct_coordinates(coords, node_name, location_desc):
    """
    Controlla e corregge coordinate incoerenti basandosi sul nome del nodo.
    Ritorna coordinate corrette (o originali se OK).
    """
    if not coords or 'lat' not in coords or 'lng' not in coords:
        return coords
    
    lat = coords['lat']
    lng = coords['lng']
    original_lng = lng
    
    # Flag per segnalare correzioni
    corrected = False
    
    # 1. CONTROLLO LONGITUDINE: Deve essere tra -180 e 180
    if lng > 180 or lng < -180:
        print(f"⚠️  Longitudine fuori range: {lng}")
        # Normalizza a range valido
        while lng > 180:
            lng -= 360
        while lng < -180:
            lng += 360
        corrected = True
        print(f"   → Correzione automatica a: {lng}")
    
    # 2. CONTROLLO COERENZA: Nome suggerisce emisfero diverso?
    name_lower = (node_name or '').lower()
    desc_lower = (location_desc or '').lower()
    
    # Lista di location note con emisferi specifici
    western_hemisphere_keywords = [
        # Americhe
        'usa', 'us', 'united states', 'america', 'north america',
        'canada', 'mexico', 'brazil', 'argentina', 'chile',
        'minneapolis', 'chicago', 'new york', 'los angeles', 'san francisco',
        'seattle', 'toronto', 'texas', 'california', 'florida',
        'washington', 'oregon', 'colorado', 'arizona', 'nevada','iceland', 'reykjavik', 'islanda',
        # Coordinate note (West = longitudine negativa)
        'west coast', 'west us', 'western us',
    ]
    
    eastern_hemisphere_keywords = [
        # Europa, Asia, Africa, Oceania
        'europe', 'european', 'eu', 'euro', 'africa', 'asia',
        'australia', 'oceania', 'new zealand', 'zealand',
        'italy', 'spain', 'france', 'germany', 'uk', 'england',
        'russia', 'china', 'japan', 'india', 'korea',
        'london', 'paris', 'berlin', 'rome', 'madrid',
        'budapest', 'moscow', 'stockholm', 'oslo',
        # Coordinate note (East = longitudine positiva)
        'east coast', 'eastern europe', 'eastern us',
    ]
    
    # Controlla se il nome suggerisce emisfero OVEST (longitudine negativa)
    is_western = any(keyword in name_lower or keyword in desc_lower 
                     for keyword in western_hemisphere_keywords)
    
    # Controlla se il nome suggerisce emisfero EST (longitudine positiva)
    is_eastern = any(keyword in name_lower or keyword in desc_lower 
                     for keyword in eastern_hemisphere_keywords)
    
    # 3. CORREZIONE SPECIFICA: "Minneapolis" in nome ma longitudine positiva
    if ('minneapolis' in name_lower or 'minneapolis' in desc_lower) and lng > 0:
        # Minneapolis, MN ha longitudine ~-93.4
        print(f"⚠️  Minneapolis rilevata ma longitudine positiva: {lng}")
        lng = -abs(lng)  # Forza negativa
        corrected = True
        print(f"   → Correzione Minneapolis a: {lng}")
    
    # 4. CORREZIONE GENERICA: Se nome suggerisce OVEST ma longitudine positiva
    elif is_western and lng > 0:
        print(f"⚠️  Nodo sembra occidentale ma longitudine positiva: {lng}")
        # Probabile errore di segno, inverte
        lng = -lng
        corrected = True
        print(f"   → Inversione segno a: {lng}")
    
    # 5. CORREZIONE GENERICA: Se nome suggerisce EST ma longitudine negativa
    elif is_eastern and lng < 0:
        print(f"⚠️  Nodo sembra orientale ma longitudine negativa: {lng}")
        # Probabile errore di segno, inverte
        lng = abs(lng)
        corrected = True
        print(f"   → Inversione segno a: {lng}")
    
    # 6. CONTROLLO POSIZIONE REALISTICA: Latitudine fuori range?
    if lat > 90 or lat < -90:
        print(f"⚠️  Latitudine impossibile: {lat}")
        lat = max(-90, min(90, lat))  # Clip a range valido
        corrected = True
        print(f"   → Correzione a: {lat}")
    
    # 7. LOG DELLE CORREZIONI
    if corrected:
        print(f"📝 Coordinate corrette per '{node_name}':")
        print(f"   Originali: {coords['lat']:.6f}, {original_lng:.6f}")
        print(f"   Corrette:  {lat:.6f}, {lng:.6f}")
        
        # Aggiorna descrizione per segnalare correzione
        if 'desc' in coords:
            coords['desc'] = f"{coords['desc']} [CORRECTED: {original_lng:.2f}→{lng:.2f}]"
        coords['corrected'] = True
        coords['original_lng'] = original_lng
    
    # Aggiorna coordinate
    coords['lat'] = lat
    coords['lng'] = lng
    
    return coords

def GEOCODE_LOCATION(node_name, reachable_on):
    """
    Geolocalizza un nodo basandosi sul nome o indirizzo.
    """
    if not node_name and not reachable_on:
        return None
    
    # Carica cache
    load_geo_cache()
    
    # Crea chiave cache
    cache_key = f"{node_name}|{reachable_on}"
    
    # Controlla cache (valida per 30 giorni)
    if cache_key in geo_cache:
        cache_data = geo_cache[cache_key]
        if 'timestamp' in cache_data:
            try:
                cache_time = datetime.fromisoformat(cache_data['timestamp'])
                if (datetime.now() - cache_time).days < 30:
                    print(f"📦 Cache hit: {node_name}")
                    return {
                        'lat': cache_data['lat'],
                        'lng': cache_data['lng'],
                        'desc': cache_data.get('desc', ''),
                        'source': cache_data.get('source', 'cache')
                    }
            except:
                pass
    
    print(f"📍 Geocoding: {node_name} ({reachable_on})")
    result = None
    
    # **PRIORITÀ 1: METODI BASATI SU IP/DOMINIO (più accurati)**
    
    if reachable_on:
        # Estrai hostname/IP
        ip = get_ip_from_address(reachable_on)
        
        if ip:
            print(f"🔍 Resolved IP: {ip}")
            
            # METODO 1: API online (ip-api.com) - più accurata
            result = get_ipapi_location(ip)
            
            # METODO 2: WHOIS locale (fallback)
            if not result:
                whois_info = get_whois_info(ip)
                if whois_info:
                    result = estimate_coordinates_from_info(whois_info)
            
            if result:
                result['source'] = result.get('source', 'whois')
                print(f"✅ IP geolocated: {result.get('desc', '')}")
        
        # METODO 3: TLD del dominio (se abbiamo un dominio ma non IP)
        if not result and '.' in reachable_on:
            domain = reachable_on.split(':')[0] if ':' in reachable_on else reachable_on
            result = geocode_from_tld(domain)
            if result:
                print(f"✅ TLD match: {result['desc']}")
    
    # **PRIORITÀ 2: Cerca nel reachable_on (hostname)**
    if not result and reachable_on and '.' in reachable_on:
        domain = reachable_on.split(':')[0] if ':' in reachable_on else reachable_on
        parts = domain.split('.')
        if len(parts) > 1:
            middle = parts[-2].lower()  # "derps" in "rns.derps.me"
            for location, coords in LOCATIONS.items():
                if location in middle:
                    result = {
                        'lat': coords['lat'],
                        'lng': coords['lng'],
                        'desc': f"From hostname: {location.title()}",
                        'source': 'hostname_match'
                    }
                    print(f"✅ Hostname match: {location}")
                    break
    
    # **PRIORITÀ 3: ULTIMA RISORSA - cerca nel nome del nodo**
    if not result and node_name:
        name_lower = node_name.lower()
        
        # Cerca corrispondenze nel nome (solo come fallback)
        for location, coords in LOCATIONS.items():
            if location in name_lower:
                result = {
                    'lat': coords['lat'],
                    'lng': coords['lng'],
                    'desc': f"From node name: {location.title()}",
                    'source': 'name_match_low_confidence'
                }
                print(f"⚠️  Name match (low confidence): {location}")
                break
    
    # Se ancora non trovato, restituisci None
    if not result:
        print(f"❌ No geolocation found for: {node_name}")
    else:
        # APPLICA VALIDAZIONE E CORREZIONE
        result = validate_and_correct_coordinates(
            result,
            node_name,
            result.get('desc', '')
        )
    
    # Salva in cache solo se trovato
    if result:
        geo_cache[cache_key] = {
            'lat': result['lat'],
            'lng': result['lng'],
            'desc': result.get('desc', ''),
            'source': result.get('source', 'unknown'),
            'timestamp': datetime.now().isoformat(),
            'corrected': result.get('corrected', False)
        }
        save_geo_cache()
    
    return result

# Test della funzione
if __name__ == "__main__":
    print("🧪 Test geolocalizzazione avanzata...\n")
    
    test_cases = [
        ("RNS Spain - Derpy Cloud", "rns.derps.me:34242"),
        ("Beleth", "rns.beleth.net:4242"),
        ("Arg0net RNS Italy", "93.40.0.250:4242"),
        ("0rbit Iceland", "93.95.227.8:49952"),
        ("Triplebit_Minneapolis_B-IPv4", "23.188.56.190:9050"),
        ("RNS Budapest(HU)", "vjs.hu:5858"),
        ("Bern IPv4", "45.59.114.96:7822"),
        ("Test Cloud Server", "104.21.86.29:443"),
        ("Google DNS Test", "8.8.8.8:53"),
        ("Rhein Ruhr Reticulum I2P-GW", "some.i2p.address"),
    ]
    
    for name, addr in test_cases:
        print(f"\n🔍 Testing: {name} ({addr})")
        result = GEOCODE_LOCATION(name, addr)
        if result:
            print(f"✅ → {result['lat']:.4f}, {result['lng']:.4f}")
            print(f"   Source: {result.get('source', 'unknown')}")
            print(f"   Desc: {result.get('desc', '')}")
            if result.get('corrected'):
                print(f"   ⚠️  Coordinate corrette!")
        else:
            print(f"❌ → Non geolocalizzato")
    
    print("\n" + "="*50)
    print("✅ Geolocation module ready")