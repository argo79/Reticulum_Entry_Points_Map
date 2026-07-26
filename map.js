// ============================================
// VARIABILI GLOBALI
// ============================================

let map = null;
let markers = [];
let allNodes = [];
let filteredNodes = [];
let currentFilter = 'all';
let searchQuery = '';
let currentSelectedNode = null;
let currentFoundHash = null;
let currentHandler = null;
let currentTransportId = null;
let clusterGroup = null;

// Cache per la risoluzione DNS
let dnsCache = {};

let clusteringEnabled = true;
let directMarkers = [];
let labelsEnabled = true;
const LABEL_ZOOM_THRESHOLD = 8;

// ============================================
// FUNZIONE PER CONVERTIRE PIXEL IN GRADI
// ============================================
function pixelToDegrees(pixels, zoom) {
    const pixelsPerDegree = 256 * Math.pow(2, zoom) / 360;
    return pixels / pixelsPerDegree;
}

// ============================================
// INIZIALIZZAZIONE MAPPA
// ============================================

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        fadeAnimation: true,
        zoomAnimation: true
    }).setView([20, 0], 2);
    
    map.createPane('labels');
    map.getPane('labels').style.zIndex = 650;
    map.getPane('labels').style.pointerEvents = 'none';
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap, © CartoDB',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // CONFIGURAZIONE CLUSTER
    clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 150,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: false,
        spiderfyDistanceMultiplier: 2.0,
        iconCreateFunction: createClusterIcon,
        disableClusteringAtZoom: 18,
        chunkedLoading: true,
        chunkInterval: 100,
        chunkDelay: 50,
        spiderfyMaxCount: 999
    });

    // CLICK SUL CLUSTER - APRE A VENTAGLIO
    clusterGroup.on('clustermouseclick', function(e) {
        const layer = e.layer;
        if (layer && layer.spiderfy) {
            const childCount = layer.getAllChildMarkers().length;
            
            e.originalEvent.stopPropagation();
            e.originalEvent.preventDefault();
            
            if (childCount > 1) {
                if (layer._spiderfied) {
                    layer.unspiderfy();
                } else {
                    layer.spiderfy();
                }
            }
        }
    });

    // CHIUDI TUTTI I CLUSTER CLICCANDO SULLA MAPPA
    map.on('click', function() {
        if (clusterGroup) {
            clusterGroup.eachLayer(function(layer) {
                if (layer._spiderfied) {
                    layer.unspiderfy();
                }
            });
        }
    });

    // EVENTO APERTURA VENTAGLIO - MOSTRA ETICHETTE
    clusterGroup.on('spiderfied', function(e) {
        const layer = e.layer;
        if (labelsEnabled) {
            showLabelsForSpider(layer);
        }
    });

    // EVENTO CHIUSURA VENTAGLIO - NASCONDI ETICHETTE
    clusterGroup.on('unspiderfied', function(e) {
        const layer = e.layer;
        hideLabelsForSpider(layer);
    });

    map.addLayer(clusterGroup);
    
    if (typeof initRuler === 'function') {
        initRuler(map, 'ruler-btn');
    }
    if (typeof initCircleTool === 'function') {
        initCircleTool(map, 'circle-btn');
    }
    
    loadData();
}

// ============================================
// MOSTRA ETICHETTE PER VENTAGLIO
// ============================================
function showLabelsForSpider(layer) {
    const childMarkers = layer.getAllChildMarkers();
    const zoom = map.getZoom();
    
    if (layer._labelLayer) {
        map.removeLayer(layer._labelLayer);
        layer._labelLayer = null;
    }
    
    const labelGroup = L.layerGroup();
    
    childMarkers.forEach((marker) => {
        const node = marker.nodeData;
        if (!node || !node.name) return;
        
        const pos = marker.getLatLng();
        const offsetDegrees = pixelToDegrees(30, zoom);
        const labelPos = L.latLng(
            pos.lat + offsetDegrees,
            pos.lng
        );
        
        const label = L.marker(labelPos, {
            icon: L.divIcon({
                html: `
                    <div style="
                        background: rgba(0,0,0,0.85);
                        color: white;
                        padding: 2px 10px;
                        border-radius: 4px;
                        font-size: ${zoom >= 14 ? 12 : zoom >= 11 ? 10 : 9}px;
                        font-weight: 600;
                        border: 1px solid rgba(255,255,255,0.15);
                        white-space: nowrap;
                        text-shadow: 0 0 10px rgba(0,0,0,0.9);
                        pointer-events: auto;
                        cursor: pointer;
                        transition: all 0.2s;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                        max-width: 200px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    "
                    onmouseover="this.style.transform='scale(1.08)';this.style.background='rgba(59,130,246,0.9)'"
                    onmouseout="this.style.transform='scale(1)';this.style.background='rgba(0,0,0,0.85)'">
                        ${node.name}
                    </div>
                `,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
                className: 'spider-label'
            })
        });
        
        label.on('click', function() {
            const idx = childMarkers.indexOf(marker);
            if (idx !== -1) {
                const nodeIdx = markers.indexOf(marker);
                if (nodeIdx !== -1) selectNode(nodeIdx);
            }
        });
        
        labelGroup.addLayer(label);
    });
    
    labelGroup.addTo(map.getPane('labels'));
    layer._labelLayer = labelGroup;
}

function hideLabelsForSpider(layer) {
    if (layer._labelLayer) {
        map.removeLayer(layer._labelLayer);
        layer._labelLayer = null;
    }
}

// ============================================
// CARICAMENTO DATI
// ============================================

async function loadData() {
    try {
        showLoading(true);
        const response = await fetch('/data');
        allNodes = await response.json();
        
        console.log('Nodi ricevuti:', allNodes.length);
        console.log('Nodi geolocalizzati:', allNodes.filter(n => n.geolocated).length);
        console.log('Nodi con coordinate valide:', allNodes.filter(n => 
            n.geolocated && n.latitude && n.longitude && n.latitude !== 0 && n.longitude !== 0
        ).length);
        
        allNodes.forEach(node => node._visible = true);
        
        updateStats();
        applyFilters();
        
        showNotification('Data loaded successfully', 'success');
        
    } catch (error) {
        console.error('Error loading data:', error);
        showNotification('Failed to load data', 'error');
        document.getElementById('nodes-list').innerHTML = `
            <div style="color: #f87171; text-align: center; padding: 3rem;">
                <i class="fas fa-exclamation-triangle fa-2x"></i>
                <p style="margin-top: 1rem;">Error loading data</p>
            </div>
        `;
    } finally {
        showLoading(false);
    }
}

// ============================================
// STATISTICHE
// ============================================

function updateStats() {
    const total = allNodes.length;
    const mapped = allNodes.filter(n => n.geolocated).length;
    const online = allNodes.filter(n => n.status === 'available').length;
    const filtered = filteredNodes.length;
    
    document.getElementById('total-nodes').textContent = total;
    document.getElementById('mapped-nodes').textContent = mapped;
    document.getElementById('online-nodes').textContent = online;
    document.getElementById('filtered-nodes').textContent = filtered;
}

// ============================================
// CLUSTER ICON
// ============================================

function createClusterIcon(cluster) {
    const childMarkers = cluster.getAllChildMarkers();
    const totalNodes = childMarkers.length;
    
    if (totalNodes === 1) {
        const marker = childMarkers[0];
        return createMarkerIcon(marker.nodeData);
    }
    
    const typeCount = {};
    let minHops = Infinity;
    
    childMarkers.forEach(marker => {
        const node = marker.nodeData;
        if (node) {
            const type = node.type || 'Other';
            typeCount[type] = (typeCount[type] || 0) + 1;
            if (node.hops !== undefined && node.hops !== null && node.hops < minHops) {
                minHops = node.hops;
            }
        }
    });
    
    let dominantType = 'Other';
    let maxCount = 0;
    for (const [type, count] of Object.entries(typeCount)) {
        if (count > maxCount) {
            maxCount = count;
            dominantType = type;
        }
    }
    
    let color = '#6b7280';
    if (dominantType.includes('Backbone')) color = '#3b82f6';
    else if (dominantType.includes('TCPServer')) color = '#10b981';
    else if (dominantType.includes('RNode')) color = '#f59e0b';
    else if (dominantType.includes('I2P')) color = '#8b5cf6';
    
    const size = Math.min(30 + totalNodes * 4, 60);
    
    return L.divIcon({
        html: `
            <div style="
                width: ${size}px;
                height: ${size}px;
                border-radius: 50%;
                background: ${color};
                border: 3px solid white;
                box-shadow: 0 3px 15px rgba(0,0,0,0.5);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: ${totalNodes > 9 ? '11px' : '14px'};
                text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
                cursor: pointer;
                position: relative;
                transition: transform 0.2s;
            "
            onmouseover="this.style.transform='scale(1.1)'"
            onmouseout="this.style.transform='scale(1)'">
                <div style="line-height: 1;">${totalNodes}</div>
                <div style="font-size: 8px; opacity: 0.8; line-height: 1;">hops ${minHops === Infinity ? '?' : minHops}</div>
            </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
        className: 'cluster-marker'
    });
}

// ============================================
// CREAZIONE MARKER
// ============================================

function createMarkerIcon(node) {
    const size = 36;
    const hops = node.hops || 0;
    
    let color = '#6b7280';
    
    if (node.status !== 'available') {
        color = '#ef4444';
    } else if (node.type && node.type.includes('Backbone')) {
        color = '#3b82f6';
    } else if (node.type && node.type.includes('TCPServer')) {
        color = '#10b981';
    } else if (node.type && node.type.includes('RNode')) {
        color = '#f59e0b';
    } else if (node.type && node.type.includes('I2P')) {
        color = '#8b5cf6';
    }
    
    const html = `
        <div style="
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: ${color};
            border: 3px solid white;
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            color: white;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.7);
            cursor: pointer;
            transition: transform 0.2s;
        "
        onmouseover="this.style.transform='scale(1.15)'"
        onmouseout="this.style.transform='scale(1)'">
            ${hops}
        </div>
    `;
    
    return L.divIcon({
        html: html,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
        className: 'custom-marker'
    });
}

// ============================================
// AGGIORNAMENTO MAPPA
// ============================================

function updateMap() {
    if (clusterGroup) {
        clusterGroup.clearLayers();
    }
    
    directMarkers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    directMarkers = [];
    
    map.eachLayer(function(layer) {
        if (layer instanceof L.Marker) {
            map.removeLayer(layer);
        }
    });
    
    const groups = {};
    filteredNodes.forEach(node => {
        if (node.geolocated && node.latitude && node.longitude) {
            const lat = Math.round(node.latitude * 100) / 100;
            const lng = Math.round(node.longitude * 100) / 100;
            const key = `${lat},${lng}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(node);
        }
    });
    
    const markersToAdd = [];
    markers = [];
    const zoom = map.getZoom();
    
    filteredNodes.forEach((node, index) => {
        if (node.geolocated && node.latitude && node.longitude) {
            const baseLat = Math.round(node.latitude * 100) / 100;
            const baseLng = Math.round(node.longitude * 100) / 100;
            const key = `${baseLat},${baseLng}`;
            const groupNodes = groups[key] || [node];
            const groupIndex = groupNodes.indexOf(node);
            const totalInGroup = groupNodes.length;
            
            let markerLat = baseLat;
            let markerLng = baseLng;
            
            if (totalInGroup > 1) {
                const basePixel = 80;
                const zoomFactor = Math.pow(1.5, (zoom - 10));
                const nodeFactor = 1 + Math.log10(totalInGroup);
                const offsetPixel = basePixel * zoomFactor * nodeFactor;
                const offsetDegrees = pixelToDegrees(offsetPixel, zoom);
                
                const angle = (groupIndex / totalInGroup) * 2 * Math.PI;
                markerLat = baseLat + Math.sin(angle) * offsetDegrees;
                markerLng = baseLng + Math.cos(angle) * offsetDegrees;
            }
            
            const marker = L.marker([markerLat, markerLng], {
                icon: createMarkerIcon(node)
            });
            
            marker.nodeData = node;
            marker.index = index;
            
            marker.bindPopup(createPopupContent(node), {
                maxWidth: 500,
                className: 'custom-popup'
            });
            
            marker.on('click', function(e) {
                if (typeof ruler !== 'undefined' && ruler.active) {
                    e.originalEvent.stopPropagation();
                    e.originalEvent.preventDefault();
                    if (map) map.closePopup();
                    const latlng = L.latLng(node.latitude, node.longitude);
                    if (window.addRulerPointFromNode) {
                        window.addRulerPointFromNode(latlng, node.name || 'Unnamed Node');
                    }
                    return;
                }
                
                if (typeof circleTool !== 'undefined' && circleTool.active && !circleTool.center) {
                    e.originalEvent.stopPropagation();
                    e.originalEvent.preventDefault();
                    if (map) map.closePopup();
                    const latlng = L.latLng(node.latitude, node.longitude);
                    if (window.startCircleFromNode) {
                        window.startCircleFromNode(latlng, node.name || 'Unnamed Node');
                    }
                    return;
                }
                
                selectNode(index);
            });
            
            markersToAdd.push(marker);
            markers[index] = marker;
        }
    });
    
    if (clusteringEnabled) {
        if (clusterGroup && markersToAdd.length > 0) {
            clusterGroup.addLayers(markersToAdd);
        }
    } else {
        directMarkers = markersToAdd;
        markersToAdd.forEach(marker => {
            map.addLayer(marker);
        });
    }
}

// ============================================
// SELEZIONE NODO
// ============================================

function selectNode(index) {
    const node = filteredNodes[index];
    if (!node) {
        showNotification('Node not found', 'error');
        return;
    }
    
    document.querySelectorAll('.node-card').forEach(card => {
        card.classList.remove('active');
    });
    
    const card = document.getElementById(`list-node-${index}`);
    if (card) {
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    currentSelectedNode = node;
    
    // CERCA IL MARKER
    let foundMarker = null;
    
    for (let i = 0; i < markers.length; i++) {
        if (markers[i] && markers[i].nodeData === node) {
            foundMarker = markers[i];
            break;
        }
    }
    
    if (!foundMarker) {
        for (let i = 0; i < directMarkers.length; i++) {
            if (directMarkers[i] && directMarkers[i].nodeData === node) {
                foundMarker = directMarkers[i];
                break;
            }
        }
    }
    
    if (!foundMarker && clusterGroup) {
        clusterGroup.eachLayer(function(layer) {
            if (layer instanceof L.Marker && layer.nodeData === node) {
                foundMarker = layer;
            } else if (layer.getAllChildMarkers) {
                const childMarkers = layer.getAllChildMarkers();
                for (let i = 0; i < childMarkers.length; i++) {
                    if (childMarkers[i].nodeData === node) {
                        foundMarker = childMarkers[i];
                        break;
                    }
                }
            }
        });
    }
    
    if (foundMarker) {
        let parent = foundMarker._parent;
        if (parent && parent instanceof L.MarkerCluster && !parent._spiderfied) {
            parent.spiderfy();
            setTimeout(function() {
                foundMarker.openPopup();
                map.panTo(foundMarker.getLatLng());
            }, 300);
        } else {
            foundMarker.openPopup();
            map.panTo(foundMarker.getLatLng());
        }
    } else if (node.geolocated && node.latitude && node.longitude) {
        map.panTo([node.latitude, node.longitude]);
    } else {
        showUnmappedNodeInfo(node);
    }
}


// ============================================
// FILTRI
// ============================================

function applyFilters() {
    searchQuery = document.getElementById('search-input').value.toLowerCase();
    
    filteredNodes = allNodes.filter(node => {
        let passesFilter = true;
        switch (currentFilter) {
            case 'online':
                passesFilter = node.status === 'available';
                break;
            case 'backbone':
                passesFilter = node.type && node.type.includes('Backbone');
                break;
            case 'tcpserver':
                passesFilter = node.type && node.type.includes('TCPServer');
                break;
            case 'rnode':
                passesFilter = node.type && node.type.includes('RNode');
                break;
            case 'i2p':
                passesFilter = node.type && node.type.includes('I2P');
                break;
            case 'mapped':
                passesFilter = node.geolocated;
                break;
            case 'unmapped':
                passesFilter = !node.geolocated;
                break;
            default:
                passesFilter = true;
        }
        
        if (!passesFilter) return false;
        
        if (searchQuery) {
            const matches = (
                (node.name && node.name.toLowerCase().includes(searchQuery)) ||
                (node.type && node.type.toLowerCase().includes(searchQuery)) ||
                (node.reachable_on && node.reachable_on.toLowerCase().includes(searchQuery)) ||
                (node.transport_id && node.transport_id.toLowerCase().includes(searchQuery))
            );
            return matches;
        }
        
        return true;
    });
    
    updateMap();
    updateNodeList();
    updateStats();
}

function setFilter(filter) {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    currentFilter = filter;
    applyFilters();
}

// ============================================
// TOGGLE CLUSTERING
// ============================================

function toggleClustering() {
    clusteringEnabled = !clusteringEnabled;
    
    const btn = document.getElementById('toggle-cluster-btn');
    
    if (clusteringEnabled) {
        directMarkers.forEach(marker => {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        });
        directMarkers = [];
        
        if (clusterGroup) {
            rebuildClusters();
        }
        
        btn.style.borderColor = 'var(--primary)';
        btn.style.background = 'var(--gray-800)';
        btn.innerHTML = '<i class="fas fa-object-group"></i>';
        showNotification('Clustering attivato', 'success');
        
    } else {
        if (clusterGroup) {
            const allMarkers = [];
            clusterGroup.eachLayer(function(layer) {
                if (layer instanceof L.Marker) {
                    allMarkers.push(layer);
                } else if (layer.getAllChildMarkers) {
                    const childMarkers = layer.getAllChildMarkers();
                    childMarkers.forEach(m => allMarkers.push(m));
                }
            });
            
            clusterGroup.clearLayers();
            
            allMarkers.forEach(marker => {
                if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
                map.addLayer(marker);
                directMarkers.push(marker);
            });
        }
        
        btn.style.borderColor = '#f59e0b';
        btn.style.background = 'rgba(245, 158, 11, 0.2)';
        btn.innerHTML = '<i class="fas fa-object-ungroup"></i>';
        showNotification('Clustering disattivato - tutti i marker visibili', 'warning');
    }
}

function rebuildClusters() {
    if (!clusterGroup) return;
    
    clusterGroup.clearLayers();
    
    const markersToAdd = [];
    markers = [];
    const zoom = map.getZoom();
    
    const groups = {};
    filteredNodes.forEach(node => {
        if (node.geolocated && node.latitude && node.longitude) {
            const lat = Math.round(node.latitude * 100) / 100;
            const lng = Math.round(node.longitude * 100) / 100;
            const key = `${lat},${lng}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(node);
        }
    });
    
    filteredNodes.forEach((node, index) => {
        if (node.geolocated && node.latitude && node.longitude) {
            const baseLat = Math.round(node.latitude * 100) / 100;
            const baseLng = Math.round(node.longitude * 100) / 100;
            const key = `${baseLat},${baseLng}`;
            const groupNodes = groups[key] || [node];
            const groupIndex = groupNodes.indexOf(node);
            const totalInGroup = groupNodes.length;
            
            let markerLat = baseLat;
            let markerLng = baseLng;
            
            if (totalInGroup > 1) {
                const basePixel = 80;
                const zoomFactor = Math.pow(1.5, (zoom - 10));
                const nodeFactor = 1 + Math.log10(totalInGroup);
                const offsetPixel = basePixel * zoomFactor * nodeFactor;
                const offsetDegrees = pixelToDegrees(offsetPixel, zoom);
                
                const angle = (groupIndex / totalInGroup) * 2 * Math.PI;
                markerLat = baseLat + Math.sin(angle) * offsetDegrees;
                markerLng = baseLng + Math.cos(angle) * offsetDegrees;
            }
            
            const marker = L.marker([markerLat, markerLng], {
                icon: createMarkerIcon(node)
            });
            
            marker.nodeData = node;
            marker.index = index;
            
            marker.bindPopup(createPopupContent(node), {
                maxWidth: 500,
                className: 'custom-popup'
            });
            
            marker.on('click', function(e) {
                if (typeof ruler !== 'undefined' && ruler.active) {
                    e.originalEvent.stopPropagation();
                    e.originalEvent.preventDefault();
                    if (map) map.closePopup();
                    const latlng = L.latLng(node.latitude, node.longitude);
                    if (window.addRulerPointFromNode) {
                        window.addRulerPointFromNode(latlng, node.name || 'Unnamed Node');
                    }
                    return;
                }
                
                if (typeof circleTool !== 'undefined' && circleTool.active && !circleTool.center) {
                    e.originalEvent.stopPropagation();
                    e.originalEvent.preventDefault();
                    if (map) map.closePopup();
                    const latlng = L.latLng(node.latitude, node.longitude);
                    if (window.startCircleFromNode) {
                        window.startCircleFromNode(latlng, node.name || 'Unnamed Node');
                    }
                    return;
                }
                
                selectNode(index);
            });
            
            markersToAdd.push(marker);
            markers[index] = marker;
        }
    });
    
    if (markersToAdd.length > 0) {
        clusterGroup.addLayers(markersToAdd);
    }
}

// ============================================
// TOGGLE ETICHETTE
// ============================================
function toggleLabels() {
    labelsEnabled = !labelsEnabled;
    
    const btn = document.getElementById('toggle-labels-btn');
    
    if (labelsEnabled) {
        btn.style.borderColor = '#10b981';
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
        btn.innerHTML = '<i class="fas fa-tag" style="color:#10b981;"></i>';
        
        clusterGroup.eachLayer(function(layer) {
            if (layer._spiderfied) {
                showLabelsForSpider(layer);
            }
        });
        
        showNotification('Etichette attivate', 'success');
    } else {
        btn.style.borderColor = 'var(--gray-600)';
        btn.style.background = 'transparent';
        btn.innerHTML = '<i class="fas fa-tag" style="color:var(--gray-500);"></i>';
        
        clusterGroup.eachLayer(function(layer) {
            if (layer._spiderfied) {
                hideLabelsForSpider(layer);
            }
        });
        
        showNotification('Etichette disattivate', 'warning');
    }
}

// ============================================
// LISTA NODI
// ============================================

function updateNodeList() {
    const container = document.getElementById('nodes-list');
    
    if (filteredNodes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--gray-500);">
                <i class="fas fa-search fa-2x"></i>
                <p style="margin-top: 1rem;">No nodes found matching your criteria</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    filteredNodes.forEach((node, index) => {
        const isOnline = node.status === 'available';
        const isMapped = node.geolocated;
        
        html += `
            <div class="node-card" onclick="selectNode(${index})" id="list-node-${index}">
                <div class="node-header">
                    <div class="node-name">
                        ${node.name || 'Unnamed Node'}
                        ${!isMapped ? '<span style="color: #f59e0b; margin-left: 0.5rem;"><i class="fas fa-map-marker-alt-slash"></i></span>' : ''}
                    </div>
                    <div class="node-badges">
                        <span class="badge badge-hops">
                            <i class="fas fa-route"></i> ${node.hops || 0}
                        </span>
                        <span class="badge ${isOnline ? 'badge-online' : 'badge-offline'}">
                            ${isOnline ? 'Online' : 'Offline'}
                        </span>
                        ${!isMapped ? '<span class="badge badge-unmapped">Unmapped</span>' : ''}
                    </div>
                </div>
                
                <div class="node-details">
                    <div class="detail-item">
                        <div class="detail-label">Type</div>
                        <div class="detail-value">${node.type || 'N/A'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Address</div>
                        <div class="detail-value">${node.reachable_on || 'N/A'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Stamp value</div>
                        <div class="detail-value">${node.value || 0}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Location</div>
                        <div class="detail-value">${isMapped ? '📍 Mapped' : '❌ Unmapped'}</div>
                    </div>
                </div>
                
                ${node.transport_id ? `
                <div class="transport-id">
                    <i class="fas fa-fingerprint"></i> ${node.transport_id.substring(0, 32)}...
                    ${isOnline ? '<span style="color: #10b981;"><i class="fas fa-terminal"></i></span>' : ''}
                </div>
                ` : ''}
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ============================================
// FUNZIONI DI RETE
// ============================================

function showUnmappedNodeInfo(node) {
    const isOnline = node.status === 'available';
    const lastHeard = node.last_heard ? formatTimestamp(node.last_heard) : 'Never';
    const transportId = node.transport_id;
    
    let infoHTML = `
        <div class="popup-section">
            <div class="section-title">
                <i class="fas fa-info-circle"></i> Basic Information
            </div>
            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">Type</div>
                    <div class="info-value">${node.type || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Stamp value</div>
                    <div class="info-value">${node.value || 0}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Height</div>
                    <div class="info-value">${node.height || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Last Heard</div>
                    <div class="info-value">${lastHeard}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Heard Count</div>
                    <div class="info-value">${node.heard_count || 0}</div>
                </div>
            </div>
        </div>
        
        <div class="popup-section">
            <div class="section-title">
                <i class="fas fa-network-wired"></i> Network Information
            </div>
            <div class="info-grid">
                ${transportId ? `
                <div class="info-item full-width">
                    <div class="info-label">Transport ID</div>
                    <div class="info-value">${transportId}</div>
                </div>
                ` : ''}
                <div class="info-item full-width">
                    <div class="info-label">Network ID</div>
                    <div class="info-value">${node.network_id || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Address</div>
                    <div class="info-value">${node.reachable_on || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Port</div>
                    <div class="info-value">${node.port || 'N/A'}</div>
                </div>
            </div>
        </div>
    `;
    
    const content = `
        <div class="custom-popup">
            <div class="popup-header">
                <div class="popup-title">${node.name || 'Unnamed Node'}</div>
                <div class="popup-status">
                    <span class="status-badge" style="background: ${isOnline ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; 
                          color: ${isOnline ? '#10b981' : '#ef4444'}">
                        <i class="fas fa-circle"></i> ${isOnline ? 'Online' : 'Offline'}
                    </span>
                    <span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">
                        <i class="fas fa-map-marker-alt-slash"></i> Not Mapped
                    </span>
                    <span class="status-badge" style="background: rgba(139, 92, 246, 0.2); color: #8b5cf6;">
                        <i class="fas fa-route"></i> Hops: ${node.hops || 0}
                    </span>
                </div>
            </div>
            
            <div class="popup-content">
                ${transportId ? createRnidButtonsSection(transportId, node) : ''}
                
                ${infoHTML}
                
                <div style="font-size: 0.7rem; color: var(--gray-400); margin-top: 1rem; text-align: center;">
                    Updated: ${new Date().toLocaleTimeString()}
                </div>
            </div>
        </div>
    `;
    
    map.closePopup();
    
    L.popup({
        maxWidth: 500,
        className: 'custom-popup'
    })
    .setLatLng(map.getCenter())
    .setContent(content)
    .openOn(map);
}

// ============================================
// FORMATTAZIONE
// ============================================

function formatTimestamp(timestamp) {
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) return `${diffDays} days ago`;
    if (diffHours > 0) return `${diffHours} hours ago`;
    if (diffMins > 0) return `${diffMins} minutes ago`;
    return 'Just now';
}

// ============================================
// NOTIFICHE
// ============================================

function showNotification(message, type = 'info') {
    const existing = document.getElementById('notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.id = 'notification';
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 12px 16px;
        background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        font-weight: 500;
        animation: slideIn 0.3s ease;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    notification.innerHTML = `
        <i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
        ${message}
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }
    }, 3000);
}

function showLoading(isLoading) {
    if (isLoading) {
        document.getElementById('nodes-list').innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--gray-500);">
                <i class="fas fa-spinner fa-spin fa-2x"></i>
                <p style="margin-top: 1rem;">Loading...</p>
            </div>
        `;
    }
}

// ============================================
// CONTROLLI MAPPA
// ============================================

function refreshData() {
    loadData();
    showNotification('Data refreshed', 'success');
}

function fitAllMarkers() {
    if (clusterGroup) {
        const markers = clusterGroup.getLayers();
        if (markers.length > 0) {
            const group = L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
        } else {
            map.setView([20, 0], 2);
        }
    }
}

function toggleLegend() {
    const legend = document.getElementById('legend');
    legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
}

// ============================================
// POPUP CONTENT
// ============================================

function createPopupContent(node) {
    const isOnline = node.status === 'available';
    const isMapped = node.geolocated;
    const lastHeard = node.last_heard ? formatTimestamp(node.last_heard) : 'Never';
    const transportId = node.transport_id;
    
    let rnidButtonsHTML = '';
    if (transportId && isOnline) {
        rnidButtonsHTML = createRnidButtonsSection(transportId, node);
    }
    
    const configEntryHTML = getConfigEntryHTML(node);
    const handlerHashesHTML = getHandlerHashesHTML(node);
    
    return `
        <div class="custom-popup">
            <div class="popup-header">
                <div class="popup-title">${node.name || 'Unnamed Node'}</div>
                <div class="popup-status">
                    <span class="status-badge" style="background: ${isOnline ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; 
                          color: ${isOnline ? '#10b981' : '#ef4444'}">
                        <i class="fas fa-circle"></i> ${isOnline ? 'Online' : 'Offline'}
                    </span>
                    <span class="status-badge" style="background: ${isMapped ? 'rgba(59, 130, 246, 0.2)' : 'rgba(107, 114, 128, 0.2)'}; 
                          color: ${isMapped ? '#3b82f6' : '#6b7280'}">
                        <i class="fas fa-map-marker-alt"></i> ${isMapped ? 'Mapped' : 'Not Mapped'}
                    </span>
                    <span class="status-badge" style="background: rgba(139, 92, 246, 0.2); color: #8b5cf6;">
                        <i class="fas fa-route"></i> Hops: ${node.hops || 0}
                    </span>
                </div>
            </div>
            
            <div class="popup-content">
                ${transportId ? createRnidButtonsSection(transportId, node) : ''}
                
                ${handlerHashesHTML}
                
                <div class="popup-section">
                    <div class="section-title">
                        <i class="fas fa-info-circle"></i> Basic Information
                    </div>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">Type</div>
                            <div class="info-value">${node.type || 'N/A'}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Stamp value</div>
                            <div class="info-value">${node.value || 0}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Height</div>
                            <div class="info-value">${node.height || 'N/A'}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Last Heard</div>
                            <div class="info-value">${lastHeard}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Heard Count</div>
                            <div class="info-value">${node.heard_count || 0}</div>
                        </div>
                    </div>
                </div>
                
                <div class="popup-section">
                    <div class="section-title">
                        <i class="fas fa-network-wired"></i> Network Information
                    </div>
                    <div class="info-grid">
                        ${transportId ? `
                        <div class="info-item full-width">
                            <div class="info-label">Transport ID</div>
                            <div class="info-value">${transportId}</div>
                        </div>
                        ` : ''}
                        <div class="info-item full-width">
                            <div class="info-label">Network ID</div>
                            <div class="info-value">${node.network_id || 'N/A'}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Address</div>
                            <div class="info-value">${node.reachable_on || 'N/A'}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Port</div>
                            <div class="info-value">${node.port || 'N/A'}</div>
                        </div>
                    </div>
                </div>
                
                ${isMapped && node.latitude && node.longitude ? `
                <div class="popup-section">
                    <div class="section-title">
                        <i class="fas fa-map-marker-alt"></i> Location Information
                    </div>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">Latitude</div>
                            <div class="info-value">${node.latitude ? node.latitude.toFixed(6) : 'N/A'}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Longitude</div>
                            <div class="info-value">${node.longitude ? node.longitude.toFixed(6) : 'N/A'}</div>
                        </div>
                    </div>
                </div>
                ` : ''}
                
                ${configEntryHTML}
                
                <div class="timestamp">
                    Updated: ${new Date().toLocaleTimeString()}
                </div>
            </div>
        </div>
    `;
}

// ============================================
// HANDLER HASHES
// ============================================

function getHandlerHashesHTML(node) {
    if (!node.handler_hashes || Object.keys(node.handler_hashes).length === 0) {
        return '';
    }
    
    let html = `
        <div class="popup-section">
            <div class="section-title">
                <i class="fas fa-fingerprint"></i> Known Hashes
            </div>
            <div style="background: rgba(59, 130, 246, 0.05); border-radius: 8px; padding: 1rem; max-height: 200px; overflow-y: auto;">
    `;
    
    const handlerNames = {
        'rnstransport.probe': 'Probe Hash',
        'lxmf.propagation': 'LXMF Propagation',
        'lxmf.delivery': 'LXMF Delivery', 
        'call.audio': 'Call Audio',
        'nomadnetwork.node': 'Nomad Network',
        'filetransfer': 'File Transfer',
        'fsync': 'File Sync',
        'telemetry': 'Telemetry',
        'monitoring': 'Monitoring'
    };
    
    Object.entries(node.handler_hashes).forEach(([handler, hash]) => {
        const displayName = handlerNames[handler] || handler;
        const shortHash = hash.length > 24 ? hash.substring(0, 24) + '...' : hash;
        
        html += `
            <div style="margin-bottom: 0.75rem; padding: 0.75rem; background: rgba(0,0,0,0.2); border-radius: 6px; border-left: 3px solid var(--primary);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                    <div style="font-size: 0.85rem; font-weight: 600; color: var(--gray-100);">${displayName}</div>
                    <div style="font-size: 0.7rem; color: var(--gray-400);">${handler}</div>
                </div>
                <div style="font-family: 'Monaco', 'Consolas', monospace; font-size: 0.75rem; color: #93c5fd; word-break: break-all;">
                    ${hash}
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap;">
                    <button onclick="copyToClipboard('${hash.replace(/'/g, "\\'").replace(/"/g, '\\"')}')" 
                            style="padding: 0.25rem 0.5rem; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fas fa-copy" style="font-size: 0.6rem;"></i>
                        Copy
                    </button>
                    <button onclick="executeRnpathForHash('${hash}', '${handler}')" 
                            style="padding: 0.25rem 0.5rem; background: var(--warning); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fas fa-route" style="font-size: 0.6rem;"></i>
                        rnpath
                    </button>
                    ${handler === 'rnstransport.probe' ? `
                    <button onclick="executeRnprobeForHash('${hash}')" 
                            style="padding: 0.25rem 0.5rem; background: var(--success); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fas fa-bolt" style="font-size: 0.6rem;"></i>
                        rnprobe
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    return html;
}

// ============================================
// CONFIG ENTRY
// ============================================

function getConfigEntryHTML(node) {
    if (node.config_entry) {
        return `
            <div class="popup-section">
                <div class="section-title">
                    <i class="fas fa-code"></i> Configuration Entry
                </div>
                <div style="
                    background: rgba(59, 130, 246, 0.05);
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    border-radius: 8px;
                    padding: 1rem;
                    font-family: 'Monaco', 'Consolas', monospace;
                    font-size: 11px;
                    line-height: 1.4;
                    color: #93c5fd;
                    white-space: pre-wrap;
                    word-break: break-all;
                    overflow-x: auto;
                    margin-bottom: 1rem;
                ">
                    ${node.config_entry}
                </div>
                <div style="
                    display: flex;
                    gap: 0.5rem;
                    margin-top: 0.5rem;
                ">
                    <button onclick="copyConfigToClipboard('${node.config_entry.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n')}')" 
                            style="
                                padding: 0.5rem 1rem;
                                background: var(--primary);
                                color: white;
                                border: none;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 0.8rem;
                                display: flex;
                                align-items: center;
                                gap: 0.5rem;
                            ">
                        <i class="fas fa-copy"></i>
                        Copy to Clipboard
                    </button>
                </div>
            </div>
        `;
    }
    return '';
}

// ============================================
// RNID BUTTONS
// ============================================

function createRnidButtonsSection(transportId, nodeInfo = null) {
    const address = nodeInfo?.reachable_on || '';
    const port = nodeInfo?.port || '';
    
    let pingButtonHTML = '';
    let nmapButtonHTML = '';
    let netcatButtonHTML = '';

    if (address) {
        let host = address;
        
        if (host.includes(':')) {
            const parts = host.split(':');
            if (parts.length <= 2) {
                host = parts[0];
            }
        }
        
        const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        const isIPv6 = host.includes(':');
        const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
        const isHostname = !isIPv4 && !isIPv6 && !isLocalhost && host.length > 0;
        
        if (isIPv4 || isHostname) {
            const displayHost = host.length > 12 ? host.substring(0, 10) + '...' : host;
            
            pingButtonHTML = `
                <button class="rnid-btn ping" 
                        onclick="executePingCommand('${host}')"
                        title="ICMP Ping ${host}">
                    <i class="fas fa-network-wired"></i>
                    Ping ${displayHost}
                </button>
            `;
            
            if (port && port !== 'N/A' && port !== '0') {
                const displayPort = parseInt(port) > 9999 ? `${Math.floor(port/1000)}k` : port;
                
                nmapButtonHTML = `
                    <button class="rnid-btn" style="border-color: #8b5cf6; color: #8b5cf6;"
                            onclick="executeNmapCommand('${host}', ${port})"
                            title="NMAP scan port ${port}">
                        <i class="fas fa-search"></i>
                        NMAP Port ${displayPort}
                    </button>
                `;
                
                netcatButtonHTML = `
                    <button class="rnid-btn" style="border-color: #10b981; color: #10b981;"
                            onclick="executeNetcatCommand('${host}', ${port})"
                            title="Test TCP connection with nc ${host} ${port}">
                        <i class="fas fa-plug"></i>
                        nc ${displayHost} ${displayPort}
                    </button>
                `;
            }
        }
    }
    
    return `
        <div class="popup-section">
            <div class="section-title">
                <i class="fas fa-terminal"></i> Node Commands
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
                <button class="rnid-btn probe" 
                        onclick="executeRnprobeCommand('${transportId}')"
                        title="rnprobe (test connectivity)">
                    <i class="fas fa-bolt"></i>
                    rnprobe
                </button>
                <button class="rnid-btn path" 
                        onclick="executeRnpathCommand('${transportId}')"
                        title="rnpath (find network path to node)">
                    <i class="fas fa-route"></i>
                    rnpath
                </button>
                <button class="rnid-btn" style="border-color: var(--danger); color: var(--danger);"
                        onclick="executeRnpathDropCommand('${transportId}')"
                        title="rnpath -d (drop/reset path for this node)">
                    <i class="fas fa-trash-alt"></i>
                    rnpath -d
                </button>
                ${pingButtonHTML}
                ${nmapButtonHTML}
                ${netcatButtonHTML}
            </div>
            
            <div style="margin-bottom: 1rem;">
                <div class="section-title" style="font-size: 0.9rem; margin-bottom: 0.5rem;">
                    <i class="fas fa-search"></i> Find Destination Hashes
                </div>
                <div class="rnid-buttons">
                    <button class="rnid-btn probe" 
                            onclick="executeRnidCommand('${transportId}', 'rnstransport.probe')"
                            title="Get probe hash for rnprobe/rnpath">
                        <i class="fas fa-bolt"></i>
                        Get Probe Hash
                    </button>
                    <button class="rnid-btn lxmf" 
                            onclick="executeRnidCommand('${transportId}', 'lxmf.propagation')"
                            title="Get LXMF propagation destination hash">
                        <i class="fas fa-envelope"></i>
                        LXMF Prop Hash
                    </button>
                    <button class="rnid-btn lxmf" 
                            onclick="executeRnidCommand('${transportId}', 'lxmf.delivery')"
                            title="Get LXMF delivery destination hash">
                        <i class="fas fa-inbox"></i>
                        LXMF Deliver Hash
                    </button>
                    <button class="rnid-btn call" 
                            onclick="executeRnidCommand('${transportId}', 'call.audio')"
                            title="Get call audio destination hash">
                        <i class="fas fa-phone"></i>
                        Call Audio Hash
                    </button>
                    <button class="rnid-btn nomad" 
                            onclick="executeRnidCommand('${transportId}', 'nomadnetwork.node')"
                            title="Get Nomad Network node hash">
                        <i class="fas fa-network-wired"></i>
                        Nomad Node Hash
                    </button>
                    <button class="rnid-btn" style="border-color: var(--purple); color: var(--purple);"
                            onclick="discoverAllHandlers('${transportId}')"
                            title="Discover all available handlers for this node">
                        <i class="fas fa-search-plus"></i>
                        Discover All
                    </button>
                </div>
            </div>
            
            <div style="font-size: 0.7rem; color: var(--gray-400); margin-top: 0.5rem; text-align: center;">
                Transport ID: ${transportId.substring(0, 32)}<br>
                <small>Note: Each hash is different and used for different services</small>
            </div>
        </div>
    `;
}

// ============================================
// FUNZIONI COPIA
// ============================================

function copyToClipboard(text) {
    const cleanText = text
        .replace(/\\n/g, '\n')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .trim();
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(cleanText).then(() => {
            showNotification('Copied to clipboard', 'success');
        }).catch(() => {
            fallbackCopyTextToClipboard(cleanText);
        });
    } else {
        fallbackCopyTextToClipboard(cleanText);
    }
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showNotification('Copied to clipboard', 'success');
    } catch (err) {
        showNotification('Failed to copy', 'error');
    }
    
    document.body.removeChild(textArea);
}

function copyConfigToClipboard(escapedConfig) {
    const config = escapedConfig
        .replace(/\\n/g, '\n')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');
    copyToClipboard(config);
}

function copyHashFromDisplay() {
    const hashDisplay = document.getElementById('hash-display');
    if (hashDisplay && hashDisplay.textContent) {
        const hash = hashDisplay.textContent.trim();
        copyToClipboard(hash);
    } else {
        showNotification('No hash to copy', 'error');
    }
}

// ============================================
// FUNZIONI MODAL
// ============================================

function showModal(identifier, handler) {
    const modal = document.getElementById('rnid-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalIdentifier = document.getElementById('modal-identifier');
    const modalHandler = document.getElementById('modal-handler');
    const modalTime = document.getElementById('modal-time');
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    const hashSection = document.getElementById('hash-found-section');
    
    modalTitle.innerHTML = `<i class="fas fa-terminal"></i> ${handler}`;
    modalIdentifier.textContent = identifier;
    modalHandler.textContent = handler;
    modalTime.textContent = new Date().toLocaleString();
    
    modalLoading.style.display = 'block';
    modalOutput.style.display = 'none';
    modalError.style.display = 'none';
    hashSection.style.display = 'none';
    
    currentFoundHash = null;
    
    modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('rnid-modal');
    modal.style.display = 'none';
    currentFoundHash = null;
    currentHandler = null;
    currentTransportId = null;
}

function showHashFound(hash, handler = null) {
    const hashSection = document.getElementById('hash-found-section');
    const hashDisplay = document.getElementById('hash-display');
    
    const cleanHash = hash.trim();
    hashDisplay.textContent = cleanHash;
    hashDisplay.dataset.hash = cleanHash;
    currentFoundHash = cleanHash;
    
    if (handler) {
        const title = document.querySelector('#hash-found-section .section-title');
        if (title) {
            title.innerHTML = `<i class="fas fa-fingerprint"></i> ${getHashType(handler)} Found`;
        }
    }
    
    hashSection.style.display = 'block';
}

function showModalError(result) {
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    
    modalLoading.style.display = 'none';
    modalOutput.style.display = 'none';
    
    let errorText = `❌ COMMAND FAILED\n\n`;
    
    if (result.error) {
        errorText += `Error: ${result.error}\n\n`;
    }
    
    if (result.output) {
        errorText += `Output:\n${result.output}\n\n`;
    }
    
    if (result.suggestion) {
        errorText += `Suggestion: ${result.suggestion}\n\n`;
    }
    
    if (result.command === 'rnpath' || result.error?.includes('probe')) {
        errorText += `Important: rnpath needs a PROBE HASH, not just any hash.\n`;
        errorText += `• For transport IDs: Use "rnpath" button (it gets probe hash automatically)\n`;
        errorText += `• For other hashes: Try "Get Probe Hash" button first\n`;
        errorText += `• Probe hash is specific for rnprobe/rnpath commands\n`;
    }
    
    modalError.textContent = errorText;
    modalError.style.display = 'block';
}

function showModalOutput(result, foundHash = null, handler = null) {
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    
    modalLoading.style.display = 'none';
    modalError.style.display = 'none';
    
    let outputHTML = `# ${handler || 'Command'}\n`;
    outputHTML += `${'='.repeat(60)}\n`;
    outputHTML += `Transport ID: ${result.transport_id || currentTransportId || 'N/A'}\n`;
    
    if (foundHash) {
        outputHTML += `Hash: ${foundHash}\n`;
        outputHTML += `Hash Type: ${getHashType(handler)}\n`;
    } else if (result.hash) {
        outputHTML += `Hash: ${result.hash}\n`;
        outputHTML += `Hash Type: ${getHashType(handler)}\n`;
    }
    
    outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
    outputHTML += `${'-'.repeat(60)}\n\n`;
    
    if (result.output) {
        outputHTML += `${result.output}\n\n`;
    }
    
    if (result.from_cache !== undefined) {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `Source: ${result.from_cache ? 'Cache' : 'Fresh rnid command'}\n`;
    }
    
    if (foundHash || result.hash) {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `✅ HASH OBTAINED\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `Hash: ${foundHash || result.hash}\n`;
        outputHTML += `Type: ${getHashType(handler)}\n`;
        outputHTML += `Use: ${getHashUsage(handler)}\n`;
        outputHTML += `${'-'.repeat(60)}`;
    }
    
    modalOutput.textContent = outputHTML;
    modalOutput.style.display = 'block';
}

function getHashType(handler) {
    switch(handler) {
        case 'rnstransport.probe': return 'Probe Hash';
        case 'lxmf.propagation': return 'LXMF Propagation Hash';
        case 'lxmf.delivery': return 'LXMF Delivery Hash';
        case 'call.audio': return 'Call Audio Hash';
        case 'nomadnetwork.node': return 'Nomad Node Hash';
        default: return 'Destination Hash';
    }
}

function getHashUsage(handler) {
    switch(handler) {
        case 'rnstransport.probe': 
            return 'Use with rnprobe or rnpath commands';
        case 'lxmf.propagation':
        case 'lxmf.delivery':
        case 'call.audio':
        case 'nomadnetwork.node':
            return 'Use with rnpath to find network path';
        default: 
            return 'Unknown usage';
    }
}

// ============================================
// COMANDI EXECUTE
// ============================================

async function executeRnidCommand(transportId, handler) {
    showModal(transportId, `rnid: ${handler}`);
    currentTransportId = transportId;
    currentHandler = handler;
    
    try {
        const response = await fetch(`/get_hash/${transportId}/${handler}`);
        const result = await response.json();
        
        if (result.success && result.hash) {
            currentFoundHash = result.hash;
            showHashFound(result.hash);
            
            let message = '';
            switch(handler) {
                case 'rnstransport.probe':
                    message = 'Found probe hash (for rnprobe/rnpath)';
                    break;
                case 'lxmf.propagation':
                    message = 'Found LXMF propagation destination hash';
                    break;
                case 'lxmf.delivery':
                    message = 'Found LXMF delivery destination hash';
                    break;
                case 'call.audio':
                    message = 'Found call audio destination hash';
                    break;
                case 'nomadnetwork.node':
                    message = 'Found Nomad Network node hash';
                    break;
                default:
                    message = 'Found hash';
            }
            showNotification(`${message}: ${result.hash.substring(0, 16)}...`, 'success');
            
            showModalOutput(result, result.hash, handler);
            
        } else {
            showModalError(result);
            showNotification(`Failed to get hash for ${handler}`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnid command:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            handler: handler,
            transport_id: transportId
        });
        showNotification('Failed to execute rnid command', 'error');
    }
}

async function executeRnpathCommand(transportId) {
    showModal(transportId, 'rnpath (using probe hash)');
    
    try {
        const hashResponse = await fetch(`/get_hash/${transportId}/rnstransport.probe`);
        const hashResult = await hashResponse.json();
        
        if (!hashResult.success || !hashResult.hash) {
            showModalError({
                error: 'Cannot get probe hash',
                suggestion: 'Try using "Get Probe Hash" button first'
            });
            showNotification('Failed to get probe hash', 'error');
            return;
        }
        
        const probeHash = hashResult.hash;
        currentFoundHash = probeHash;
        currentHandler = 'rnstransport.probe';
        
        const response = await fetch(`/rnpath_hash/${probeHash}`);
        const result = await response.json();
        
        if (result.success) {
            showRnpathOutput(result, probeHash, transportId, 'probe');
            showNotification(`rnpath command successful`, 'success');
        } else {
            showModalError(result);
            showNotification(`rnpath command failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnpath command:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: 'rnpath',
            transport_id: transportId,
            suggestion: 'Ensure backend is working'
        });
        showNotification('Failed to execute rnpath command', 'error');
    }
}

async function executeRnprobeCommand(transportId) {
    showModal(transportId, 'rnprobe');
    
    try {
        const hashResponse = await fetch(`/get_hash/${transportId}/rnstransport.probe`);
        const hashResult = await hashResponse.json();
        
        if (!hashResult.success || !hashResult.hash) {
            showModalError({
                error: 'Cannot get probe hash',
                suggestion: 'Try using "Get Probe Hash" button first'
            });
            showNotification('Failed to get probe hash', 'error');
            return;
        }
        
        const probeHash = hashResult.hash;
        currentFoundHash = probeHash;
        currentHandler = 'rnstransport.probe';
        
        const response = await fetch(`/rnprobe_hash/${probeHash}`);
        const result = await response.json();
        
        if (result.success) {
            showRnprobeOutput(result, probeHash, transportId);
            showNotification(`rnprobe command successful`, 'success');
        } else {
            showModalError(result);
            showNotification(`rnprobe command failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnprobe command:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: 'rnprobe',
            transport_id: transportId
        });
        showNotification('Failed to execute rnprobe command', 'error');
    }
}

async function executeRnpathDropCommand(transportId) {
    showModal(transportId, 'rnpath -d (drop path)');
    
    try {
        const hashResponse = await fetch(`/get_hash/${transportId}/rnstransport.probe`);
        const hashResult = await hashResponse.json();
        
        if (!hashResult.success || !hashResult.hash) {
            showModalError({
                error: 'Cannot get probe hash',
                suggestion: 'Try using "Get Probe Hash" button first'
            });
            showNotification('Failed to get probe hash', 'error');
            return;
        }
        
        const probeHash = hashResult.hash;
        
        const response = await fetch(`/rnpath_drop/${probeHash}`);
        const result = await response.json();
        
        if (result.success) {
            const modalOutput = document.getElementById('modal-output');
            const modalLoading = document.getElementById('modal-loading');
            const modalError = document.getElementById('modal-error');
            
            modalLoading.style.display = 'none';
            modalError.style.display = 'none';
            
            let outputHTML = `# rnpath -d (drop path)\n`;
            outputHTML += `${'='.repeat(60)}\n`;
            outputHTML += `Transport ID: ${transportId}\n`;
            outputHTML += `Probe Hash: ${probeHash}\n`;
            outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
            outputHTML += `${'-'.repeat(60)}\n\n`;
            outputHTML += `${result.output || 'Path dropped/reset'}\n\n`;
            outputHTML += `${'='.repeat(60)}`;
            
            modalOutput.textContent = outputHTML;
            modalOutput.style.display = 'block';
            showNotification(`Path dropped/reset for node`, 'warning');
            
        } else {
            showModalError(result);
            showNotification(`rnpath -d command failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnpath -d:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: 'rnpath -d',
            transport_id: transportId
        });
        showNotification('Failed to execute rnpath -d', 'error');
    }
}

async function executeRnpathForFoundHash() {
    if (!currentFoundHash || !currentTransportId) {
        showNotification('No hash found to execute rnpath', 'error');
        return;
    }
    
    const cleanHash = currentFoundHash.trim().replace(/\s+/g, '');
    
    if (!/^[a-f0-9]{32}$/i.test(cleanHash)) {
        showModalError({
            error: `Invalid hash format: ${cleanHash}`,
            suggestion: 'Hash must be exactly 32 hexadecimal characters'
        });
        showNotification('Invalid hash format', 'error');
        return;
    }
    
    showModal(cleanHash, `rnpath for ${currentHandler || 'found hash'}`);
    
    try {
        const response = await fetch(`/rnpath_hash/${cleanHash}`);
        const result = await response.json();
        
        if (result.success) {
            showRnpathOutput(result, cleanHash, currentTransportId, currentHandler || 'hash');
            showNotification(`rnpath executed successfully`, 'success');
        } else {
            showModalError(result);
            showNotification(`rnpath command failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnpath:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            handler: currentHandler,
            transport_id: currentTransportId,
            hash: cleanHash
        });
        showNotification('Failed to execute rnpath', 'error');
    }
}

async function executeRnpathForHash(hash, handler) {
    showModal(hash, `rnpath for ${handler}`);
    
    try {
        const response = await fetch(`/rnpath_hash/${hash}`);
        const result = await response.json();
        
        if (result.success) {
            showRnpathOutput(result, hash, null, handler);
            showNotification(`rnpath for ${handler} executed`, 'success');
        } else {
            showModalError(result);
            showNotification(`rnpath command failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnpath:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            handler: handler,
            hash: hash
        });
        showNotification('Failed to execute rnpath', 'error');
    }
}

async function executeRnprobeForHash(hash) {
    showModal(hash, 'rnprobe');
    
    try {
        const response = await fetch(`/rnprobe_hash/${hash}`);
        const result = await response.json();
        
        if (result.success) {
            showRnprobeOutput(result, hash, null);
            showNotification(`rnprobe executed successfully`, 'success');
        } else {
            showModalError(result);
            showNotification(`rnprobe command failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing rnprobe:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: 'rnprobe',
            hash: hash
        });
        showNotification('Failed to execute rnprobe', 'error');
    }
}

async function executeNmapCommand(host, port) {
    showModal(host, `nmap port ${port}`);
    
    try {
        const response = await fetch(`/nmap/${host}/${port}`);
        const result = await response.json();
        
        if (result.success) {
            const modalOutput = document.getElementById('modal-output');
            const modalLoading = document.getElementById('modal-loading');
            const modalError = document.getElementById('modal-error');
            
            modalLoading.style.display = 'none';
            modalError.style.display = 'none';
            
            let outputHTML = `# nmap port scan\n`;
            outputHTML += `${'='.repeat(60)}\n`;
            outputHTML += `Host: ${host}\n`;
            outputHTML += `Port: ${port}\n`;
            outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
            outputHTML += `${'-'.repeat(60)}\n\n`;
            
            if (result.output) {
                outputHTML += `${result.output}\n\n`;
            }
            
            if (result.error) {
                outputHTML += `Error: ${result.error}\n\n`;
            }
            
            modalOutput.textContent = outputHTML;
            modalOutput.style.display = 'block';
            showNotification(`NMAP scan completed`, 'success');
            
        } else {
            showModalError(result);
            showNotification(`NMAP scan failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing nmap:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: 'nmap',
            host: host,
            port: port
        });
        showNotification('Failed to execute nmap', 'error');
    }
}

async function executeNetcatCommand(host, port) {
    showModal(host, `nc ${host} ${port}`);
    
    try {
        const response = await fetch(`/netcat/${host}/${port}?timeout=2`);
        const result = await response.json();
        
        if (result.success || result.output) {
            showNetcatOutput(result, host, port);
            showNotification(`Netcat test for ${host}:${port} completed`, 'info');
        } else {
            showModalError(result);
            showNotification(`Netcat test failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing netcat:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: `nc ${host} ${port}`,
            host: host,
            port: port
        });
        showNotification('Failed to execute netcat', 'error');
    }
}

async function executePingCommand(host) {
    showModal(host, 'ping');
    
    try {
        const cleanHost = host.replace(/[^a-zA-Z0-9.:-]/g, '');
        
        const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(cleanHost);
        const isIPv6 = cleanHost.includes(':');
        
        let target = cleanHost;
        
        if (!isIPv4 && !isIPv6) {
            showNotification(`Resolving ${cleanHost}...`, 'info');
            const resolvedIP = await resolveHostname(cleanHost);
            
            if (resolvedIP !== cleanHost) {
                showNotification(`Resolved ${cleanHost} to ${resolvedIP}`, 'success');
                target = resolvedIP;
            }
        }
        
        const response = await fetch(`/ping/${target}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success || result.output) {
            showPingOutput(result, target, cleanHost);
            showNotification(`Ping completed for ${target}`, 'info');
        } else {
            showModalError(result);
            showNotification(`Ping failed`, 'error');
        }
        
    } catch (error) {
        console.error('Error executing ping:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            command: 'ping',
            host: host
        });
        showNotification('Failed to execute ping', 'error');
    }
}

async function discoverAllHandlers(transportId) {
    showModal(transportId, 'discover all handlers');
    
    try {
        const response = await fetch(`/discover_handlers/${transportId}`);
        const result = await response.json();
        
        if (result.success) {
            const modalOutput = document.getElementById('modal-output');
            const modalLoading = document.getElementById('modal-loading');
            const modalError = document.getElementById('modal-error');
            
            modalLoading.style.display = 'none';
            modalError.style.display = 'none';
            
            let outputHTML = `# Discovered Handlers\n`;
            outputHTML += `${'='.repeat(60)}\n`;
            outputHTML += `Transport ID: ${transportId}\n`;
            outputHTML += `Total Found: ${result.handlers?.length || 0}\n`;
            outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
            outputHTML += `${'-'.repeat(60)}\n\n`;
            
            if (result.handlers && result.handlers.length > 0) {
                outputHTML += `Available handlers:\n`;
                outputHTML += `${'-'.repeat(40)}\n`;
                
                result.handlers.forEach(handler => {
                    outputHTML += `• ${handler.name || handler}\n`;
                    if (handler.hash) {
                        outputHTML += `  Hash: ${handler.hash.substring(0, 32)}...\n`;
                    }
                });
            } else {
                outputHTML += `No handlers found for this node.\n`;
                outputHTML += `The node may be offline or not responding.\n`;
            }
            
            modalOutput.textContent = outputHTML;
            modalOutput.style.display = 'block';
            showNotification(`Discovered ${result.handlers?.length || 0} handlers`, 'success');
            
        } else {
            showModalError(result);
            showNotification('Failed to discover handlers', 'error');
        }
        
    } catch (error) {
        console.error('Error discovering handlers:', error);
        showModalError({
            error: 'Network error: ' + error.message,
            transport_id: transportId
        });
        showNotification('Failed to discover handlers', 'error');
    }
}

async function resolveHostname(hostname) {
    if (dnsCache[hostname] && Date.now() - dnsCache[hostname].timestamp < 300000) {
        return dnsCache[hostname].ip;
    }
    
    try {
        const response = await fetch(`/dns/${hostname}`);
        const result = await response.json();
        
        if (result.success && result.ip) {
            dnsCache[hostname] = {
                ip: result.ip,
                timestamp: Date.now()
            };
            return result.ip;
        }
        return hostname;
    } catch (error) {
        console.error('DNS resolution error:', error);
        return hostname;
    }
}

// ============================================
// OUTPUT FUNCTIONS
// ============================================

function showNetcatOutput(result, host, port) {
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    
    modalLoading.style.display = 'none';
    modalError.style.display = 'none';
    
    const output = result.output || '';
    const error = result.error || '';
    
    let outputHTML = `# nc -W 2 ${host} ${port}\n`;
    outputHTML += `${'='.repeat(60)}\n`;
    outputHTML += `Host: ${host}\n`;
    outputHTML += `Port: ${port}\n`;
    outputHTML += `Timeout: 2 packets\n`;
    outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
    outputHTML += `${'-'.repeat(60)}\n\n`;
    
    if (output && output !== 'No data received') {
        outputHTML += `RAW HEX OUTPUT:\n`;
        outputHTML += `${'~'.repeat(40)}\n`;
        outputHTML += `${output}\n`;
        outputHTML += `${'~'.repeat(40)}\n\n`;
    } else {
        outputHTML += `No data received\n\n`;
    }
    
    if (error) {
        outputHTML += `Error:\n${error}\n\n`;
    }
    
    if (result.success) {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `✅ CONNECTION SUCCESSFUL\n`;
        if (result.bytes_length) {
            outputHTML += `Received ${result.bytes_length} bytes\n`;
        }
    } else {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `❌ CONNECTION FAILED\n`;
    }
    
    outputHTML += `${'='.repeat(60)}`;
    
    modalOutput.textContent = outputHTML;
    modalOutput.style.display = 'block';
}

function showPingOutput(result, target, originalHost = null) {
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    
    modalLoading.style.display = 'none';
    modalError.style.display = 'none';
    
    const parsed = result.parsed_result || {};
    const output = result.output || '';
    
    let outputHTML = `# ping\n${'-'.repeat(50)}\n`;
    
    if (originalHost && originalHost !== target) {
        outputHTML += `Hostname: ${originalHost}\n`;
        outputHTML += `Resolved IP: ${target}\n`;
    } else {
        outputHTML += `Target: ${target}\n`;
    }
    
    outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
    outputHTML += `${'-'.repeat(50)}\n\n`;
    
    if (output.trim()) {
        outputHTML += `${output}\n\n`;
    }
    
    if (parsed.reachable !== undefined) {
        if (parsed.reachable) {
            outputHTML += `${'-'.repeat(50)}\n`;
            outputHTML += `✅ HOST IS REACHABLE\n`;
            
            if (parsed.packets_transmitted !== undefined) {
                outputHTML += `Packets: ${parsed.packets_transmitted} sent, ${parsed.packets_received || 0} received\n`;
                outputHTML += `Loss: ${parsed.packet_loss !== undefined ? parsed.packet_loss.toFixed(1) : '0'}%\n`;
            }
            
            if (parsed.round_trip_min && parsed.round_trip_avg && parsed.round_trip_max) {
                outputHTML += `RTT: ${parsed.round_trip_min}/${parsed.round_trip_avg}/${parsed.round_trip_max} ms\n`;
            } else if (parsed.round_trip_avg) {
                outputHTML += `RTT: ${parsed.round_trip_avg} ms (avg)\n`;
            }
            
        } else {
            outputHTML += `${'-'.repeat(50)}\n`;
            outputHTML += `❌ HOST UNREACHABLE\n`;
        }
        
        outputHTML += `${'-'.repeat(50)}`;
    } else if (output.trim()) {
        outputHTML += `${'-'.repeat(50)}\n`;
        outputHTML += `⚠️ RAW OUTPUT (not fully parsed)\n`;
        outputHTML += `${'-'.repeat(50)}`;
    } else {
        outputHTML += `${'-'.repeat(50)}\n`;
        outputHTML += `⚠️ NO OUTPUT RECEIVED\n`;
        outputHTML += `${'-'.repeat(50)}`;
    }
    
    modalOutput.textContent = outputHTML;
    modalOutput.style.display = 'block';
}

function showRnprobeOutput(result, probeHash, transportId = null) {
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    
    modalLoading.style.display = 'none';
    modalError.style.display = 'none';
    
    const parsed = result.parsed_result || {};
    const cleanOutput = (result.output || '').replace(/[⢄⢂⡁]/g, '').trim();
    
    let outputHTML = `# rnprobe\n${'='.repeat(60)}\n`;
    
    if (transportId) {
        outputHTML += `Transport ID: ${transportId}\n`;
    }
    
    if (probeHash) {
        outputHTML += `Probe Hash: ${probeHash}\n`;
    }
    
    outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
    outputHTML += `${'-'.repeat(60)}\n\n`;
    outputHTML += `${cleanOutput}\n\n`;
    
    if (parsed.status === 'success') {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `✅ PROBE SUCCESSFUL\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        
        if (parsed.round_trip_time !== undefined && parsed.round_trip_time !== null) {
            outputHTML += `Round-trip time: ${parsed.round_trip_time.toFixed(2)} ms\n`;
        }
        if (parsed.hops !== undefined && parsed.hops !== null) {
            outputHTML += `Hops: ${parsed.hops}\n`;
        }
        if (parsed.packet_loss !== undefined && parsed.packet_loss !== null) {
            outputHTML += `Packet loss: ${parsed.packet_loss.toFixed(1)}%\n`;
        }
        if (parsed.sent !== undefined && parsed.received !== undefined) {
            outputHTML += `Packets: ${parsed.sent} sent, ${parsed.received} received\n`;
        }
        
    } else if (parsed.status === 'no_reply') {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `❌ NO REPLY RECEIVED\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `Node may be offline or unreachable.\n`;
    } else if (parsed.status === 'failed') {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `❌ PROBE FAILED\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `Unable to complete the probe.\n`;
    } else {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `⚠️ UNKNOWN STATUS\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `Could not determine probe result.\n`;
    }
    
    outputHTML += `${'='.repeat(60)}`;
    
    modalOutput.textContent = outputHTML;
    modalOutput.style.display = 'block';
}

function showRnpathOutput(result, hash, transportId = null, hashType = null) {
    const modalLoading = document.getElementById('modal-loading');
    const modalOutput = document.getElementById('modal-output');
    const modalError = document.getElementById('modal-error');
    
    modalLoading.style.display = 'none';
    modalError.style.display = 'none';
    
    const parsed = result.parsed_result || {};
    const output = result.output || 'No output';
    
    let outputHTML = `# rnpath\n${'='.repeat(60)}\n`;
    
    if (transportId) {
        outputHTML += `Transport ID: ${transportId}\n`;
    }
    
    if (hash) {
        outputHTML += `Hash Used: ${hash}\n`;
        if (hashType) {
            outputHTML += `Hash Type: ${hashType}\n`;
        }
    }
    
    outputHTML += `Time: ${new Date().toLocaleTimeString()}\n`;
    outputHTML += `${'-'.repeat(60)}\n\n`;
    outputHTML += `${output}\n\n`;
    
    if (parsed.path_found) {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `✅ PATH FOUND\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        
        if (parsed.hops !== undefined) outputHTML += `Hops: ${parsed.hops}\n`;
        if (parsed.via_node) outputHTML += `Via node: ${parsed.via_node}\n`;
        if (parsed.interface) outputHTML += `Interface: ${parsed.interface}\n`;
        if (parsed.rtt !== undefined) outputHTML += `RTT: ${parsed.rtt} ms\n`;
        
    } else if (parsed.status === 'not_found') {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `❌ NO PATH FOUND\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `Possible reasons:\n`;
        outputHTML += `• Node may be offline\n`;
        outputHTML += `• Network path not established\n`;
        outputHTML += `• Firewall blocking\n`;
        outputHTML += `• Wrong hash type (need probe hash)\n`;
        
    } else if (output.toLowerCase().includes('not found') || output.toLowerCase().includes('no path')) {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `❌ PATH NOT FOUND\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `The node appears to be unreachable.\n`;
        if (hashType && hashType !== 'Probe Hash') {
            outputHTML += `Note: Using ${hashType} instead of Probe Hash\n`;
            outputHTML += `Try getting the Probe Hash first.\n`;
        }
    } else if (output.includes('Impossibile ottenere hash probe')) {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `❌ NEED PROBE HASH\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `rnpath requires a PROBE HASH.\n`;
        outputHTML += `Steps:\n`;
        outputHTML += `1. Click "Get Probe Hash" button\n`;
        outputHTML += `2. Copy the probe hash\n`;
        outputHTML += `3. Use it with rnpath\n`;
    } else {
        outputHTML += `${'-'.repeat(60)}\n`;
        outputHTML += `⚠️ RAW OUTPUT\n`;
        outputHTML += `${'-'.repeat(30)}\n`;
        outputHTML += `${'='.repeat(60)}`;
    }
    
    modalOutput.textContent = outputHTML;
    modalOutput.style.display = 'block';
}

// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', initMap);

document.getElementById('rnid-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeModal();
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
    }
});