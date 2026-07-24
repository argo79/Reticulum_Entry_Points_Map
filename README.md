# 🌐 Reticulum Entry Points Map Server

Server Python per visualizzare su mappa i nodi (discoverable) della rete Reticulum, con geolocalizzazione automatica e aggiornamento in tempo reale.

https://img.shields.io/badge/Network-Reticulum-blue
https://img.shields.io/badge/Python-3.6+-green

![Mappa Reticulum](img/REPMap.jpg)

✨ Funzionalità

    🗺️ Visualizzazione mappa interattiva dei nodi Reticulum (Entry points)

    📍 Geolocalizzazione automatica dei nodi (IP, WHOIS, nomi)

    🔄 Auto-refresh ogni 30 minuti

    🏠 Inclusione automatica del nodo locale (server)

    📊 API JSON per integrazioni

    ⚡ Server HTTP leggero e veloce

📋 Prerequisiti

    Python 3.6 o superiore

    Reticulum installato e configurato

    Connessione internet (per geolocalizzazione)

🚀 Installazione Rapida

1. Scarica i file
bash

git clone https://github.com/argo79/Reticulum_Entry_Points_Map/reticulum-map.git
cd reticulum-map

Oppure scarica manualmente:

    reticulum_map.py (server principale)

    locations.py (modulo di geolocalizzazione)

    map.html (pagina web opzionale)


2. Configura il tuo nodo (OPZIONALE)

Modifica le variabili in cima a reticulum_map.py:

python

LOCAL_NODE_CONFIG = {
    "name": "Il Tuo Nodo",           # Nome del tuo nodo
    "latitude": 45.605,              # Tua latitudine
    "longitude": 12.2435,            # Tua longitudine
    "reachable_on": "tuo.ip.pubblico", # Tuo IP pubblico
    "port": 4242,                    # Tua porta Reticulum
    # ... altre impostazioni
}


3. Lancia il server
bash

python3 reticulum_map.py


4. Accedi alla mappa
Apri il browser e vai su: "http://localhost:8484"

![Mappa Reticulum1](img/REPMap1.jpg)

⚙️ Configurazione
Parametri principali (in reticulum_map.py):
python

PORT = 8484                          # Porta del server web
REFRESH_MINUTES = 30                 # Auto-refresh in minuti
RNSTATUS_CMD = "rnstatus -d -j"      # Comando rnstatus

Geolocalizzazione

Il sistema usa 4 livelli di geolocalizzazione (priorità decrescente):

    Coordinate esplicite nel JSON di rnstatus

    API IP (ip-api.com) - più accurato

    WHOIS locale - analisi dominio/IP

    Nomi nodi - ricerca parole chiave


📡 Endpoint API

    http://localhost:8484/data - Dati JSON completi

    http://localhost:8484/refresh - Refresh manuale

    http://localhost:8484/localnode - Info nodo locale

![Mappa Reticulum2](img/REPMap2.jpg)


🗂️ Struttura file

reticulum-map/

├── reticulum_map.py      # Server principale

├── locations.py          # Modulo geolocalizzazione

├── map.html              # Pagina web (opzionale)

├── nodes.json            # Dati raw da rnstatus

├── nodes_geo.json        # Dati con coordinate

└── geo_cache.json        # Cache geolocalizzazione


🔧 Personalizzazione
Aggiungere nuove location

Modifica LOCATIONS in locations.py:
python

LOCATIONS = {
    'milan': {'lat': 45.4642, 'lng': 9.1900},
    'rome': {'lat': 41.9028, 'lng': 12.4964},
    # Aggiungi le tue città...
}

Modificare la pagina web

Crea un file map.html personalizzato o modifica quello esistente. Il server serve file statici dalla directory corrente.

![Mappa Reticulum3](img/REPMap3.jpg)

![Mappa Reticulum4](img/REPMap4.jpg)

🐛 Risoluzione problemi
"rnstatus non trovato"

Assicurati che Reticulum sia installato e nel PATH.


# Debian/Ubuntu
sudo apt install whois

# Arch
sudo pacman -S whois

# Fedora
sudo dnf install whois

Server non risponde

    Controlla che la porta 8484 non sia bloccata

    Verifica i permessi di esecuzione

    Controlla i log di errore nel terminale


📄 Aggiunta Entry point (BackboneInterface,I2PInterface,ecc)

Aggiungere le righe:

    discoverable = Yes
    discovery_name = Nome senza ""
    announce_interval = 240 # 4 ore
    discovery_stamp_value = 24
    # Optional location data
    latitude =  
    longitude = 
    height = 15

Risultato:
...
[Default Interface]]
    type = AutoInterface
    enabled = Yes

[[Backbone Listener]]
    type = BackboneInterface
    interface_enabled = True
    mode = gateway
    listen_on = 
    port = 4242
    discoverable = Yes
    discovery_name = RNS Backbone WORLD 
    announce_interval = 360   
    discovery_stamp_value = 24
    # Optional location data
    latitude = 0.123 
    longitude = 98.7654
    height = 12
...

Riavviare RNS.


📄 Licenza

MIT License - vedi LICENSE file

👨‍💻 Autore

Arg0net - lxmf.cb04d68b73c76647dc61a530089b7dce

🌟 Ringraziamenti

    Reticulum Network per l'infrastruttura

    ip-api.com per il servizio di geolocalizzazione gratuito

    Tutti i nodi della rete Reticulum

Nota: Questo software è fornito "così com'è". L'autore non è responsabile per eventuali imprecisioni nella geolocalizzazione o problemi di rete.








