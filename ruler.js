// ============================================
// ruler.js - Strumenti di misurazione COMPLETI
// ============================================

let ruler = {
    active: false,
    points: [],
    markers: [],
    line: null,
    map: null,
    btn: null,
    notificationEl: null,
    notificationTimeout: null
};

let circleTool = {
    active: false,
    center: null,
    centerMarker: null,
    circle: null,
    radius: 0,
    map: null,
    btn: null
};

// ============================================
// === NOTIFICHE PERSISTENTI ===
// ============================================

function showPersistentNotification(msg, type = 'info', duration = 0) {
    const existing = document.getElementById('ruler-notification');
    if (existing) existing.remove();
    if (ruler.notificationTimeout) clearTimeout(ruler.notificationTimeout);
    
    const el = document.createElement('div');
    el.id = 'ruler-notification';
    const colors = {
        info: '#3b82f6',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444'
    };
    el.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 20px;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid ${colors[type] || colors.info};
        color: #e2e8f0;
        border-radius: 8px;
        font-size: 13px;
        z-index: 9999;
        max-width: 90%;
        text-align: center;
        font-family: monospace;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        backdrop-filter: blur(10px);
        pointer-events: none;
        transition: opacity 0.3s;
        font-weight: 500;
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    
    if (duration > 0) {
        ruler.notificationTimeout = setTimeout(() => {
            if (el.parentNode) {
                el.style.opacity = '0';
                setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
            }
        }, duration);
    }
    
    ruler.notificationEl = el;
}

function updatePersistentNotification(msg, type = 'info') {
    const el = document.getElementById('ruler-notification');
    if (el) {
        const colors = {
            info: '#3b82f6',
            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444'
        };
        el.textContent = msg;
        el.style.borderColor = colors[type] || colors.info;
    }
}

function clearPersistentNotification() {
    const el = document.getElementById('ruler-notification');
    if (el) {
        el.style.opacity = '0';
        setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
    }
    if (ruler.notificationTimeout) {
        clearTimeout(ruler.notificationTimeout);
        ruler.notificationTimeout = null;
    }
}

// ============================================
// === NOTIFICHE NORMALI ===
// ============================================

function showNotification(message, type = 'info') {
    const existing = document.getElementById('notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.id = 'notification';
    const colors = {
        info: '#3b82f6',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444'
    };
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 12px 16px;
        background: ${colors[type] || colors.info};
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

// ============================================
// === RIGHELLO ===
// ============================================

function initRuler(mapInstance, btnId) {
    ruler.map = mapInstance;
    ruler.btn = document.getElementById(btnId);
    
    if (ruler.btn) {
        ruler.btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (circleTool.active) {
                toggleCircleTool();
            }
            toggleRuler();
        });
    }
}

function toggleRuler() {
    ruler.active = !ruler.active;
    const btn = ruler.btn;
    
    if (ruler.active) {
        btn.style.borderColor = '#10b981';
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
        btn.innerHTML = '<i class="fas fa-ruler-combined" style="color: #10b981;"></i>';
        showPersistentNotification('📏 Clicca su mappa o nodo per misurare, doppio click per terminare', 'success', 0);
        ruler.map.on('click', onRulerClick);
        ruler.map.on('dblclick', finishRuler);
    } else {
        btn.style.borderColor = '#f59e0b';
        btn.style.background = 'var(--gray-800)';
        btn.innerHTML = '<i class="fas fa-ruler-combined"></i>';
        clearPersistentNotification();
        ruler.map.off('click', onRulerClick);
        ruler.map.off('dblclick', finishRuler);
        clearRuler();
    }
}

function onRulerClick(e) {
    if (e.originalEvent) {
        e.originalEvent.stopPropagation();
    }
    
    let latlng = e.latlng;
    let isMarker = false;
    let name = null;
    
    if (e.target && e.target.nodeData) {
        const data = e.target.nodeData;
        if (data.latitude && data.longitude) {
            latlng = L.latLng(data.latitude, data.longitude);
            isMarker = true;
            name = data.name || 'Unnamed Node';
            if (ruler.map) {
                ruler.map.closePopup();
            }
        }
    }
    
    addRulerPoint(latlng, isMarker, name);
}

function addRulerPoint(latlng, isMarker = false, name = null) {
    const exists = ruler.points.some(p => 
        Math.abs(p.lat - latlng.lat) < 0.00001 && 
        Math.abs(p.lng - latlng.lng) < 0.00001
    );
    if (exists) {
        showPersistentNotification('⚠️ Questo punto è già stato aggiunto', 'warning', 2000);
        return;
    }
    
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            html: '<div style="background: #f59e0b; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(245,158,11,0.5);"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        })
    }).addTo(ruler.map);
    
    ruler.markers.push(marker);
    ruler.points.push(latlng);
    updateRulerLine();
    
    if (ruler.points.length > 1) {
        const total = calcRulerDistance();
        const last = ruler.points[ruler.points.length - 1];
        const prev = ruler.points[ruler.points.length - 2];
        const segment = last.distanceTo(prev);
        const segKm = (segment/1000).toFixed(2);
        const totKm = (total/1000).toFixed(2);
        const label = isMarker ? `📍 ${name} ` : '';
        updatePersistentNotification(`📏 ${label}Segmento: ${segKm} km | Totale: ${totKm} km (${ruler.points.length-1} segmenti)`, 'info');
    } else {
        const label = isMarker ? `📍 ${name} ` : '';
        updatePersistentNotification(`${label}Punto 1 - Clicca per il secondo punto`, 'info');
    }
}

function updateRulerLine() {
    if (ruler.line) {
        ruler.map.removeLayer(ruler.line);
        ruler.line = null;
    }
    if (ruler.points.length > 1) {
        ruler.line = L.polyline(ruler.points, {
            color: '#f59e0b',
            weight: 3,
            dashArray: '8, 8',
            opacity: 0.8
        }).addTo(ruler.map);
    }
}

function calcRulerDistance() {
    let total = 0;
    for (let i = 1; i < ruler.points.length; i++) {
        total += ruler.points[i].distanceTo(ruler.points[i-1]);
    }
    return total;
}

function finishRuler() {
    if (ruler.points.length < 2) {
        updatePersistentNotification('⚠️ Servono almeno 2 punti per misurare', 'warning');
        return;
    }
    const total = calcRulerDistance();
    updatePersistentNotification(`✅ Misurazione: ${(total/1000).toFixed(2)} km (${ruler.points.length-1} segmenti)`, 'success');
}

function clearRuler() {
    if (ruler.line) {
        ruler.map.removeLayer(ruler.line);
        ruler.line = null;
    }
    ruler.markers.forEach(m => ruler.map.removeLayer(m));
    ruler.markers = [];
    ruler.points = [];
}

// ============================================
// === FUNZIONI GLOBALI PER MARKER ===
// ============================================

window.addRulerPointFromNode = function(latlng, name) {
    if (!ruler.active) return;
    
    if (ruler.map) {
        ruler.map.closePopup();
    }
    
    const exists = ruler.points.some(p => 
        Math.abs(p.lat - latlng.lat) < 0.00001 && 
        Math.abs(p.lng - latlng.lng) < 0.00001
    );
    if (exists) {
        showPersistentNotification('⚠️ Questo punto è già stato aggiunto', 'warning', 2000);
        return;
    }
    
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            html: '<div style="background: #f59e0b; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(245,158,11,0.5);"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        })
    }).addTo(ruler.map);
    
    ruler.markers.push(marker);
    ruler.points.push(latlng);
    updateRulerLine();
    
    if (ruler.points.length > 1) {
        const total = calcRulerDistance();
        const last = ruler.points[ruler.points.length - 1];
        const prev = ruler.points[ruler.points.length - 2];
        const segment = last.distanceTo(prev);
        const segKm = (segment/1000).toFixed(2);
        const totKm = (total/1000).toFixed(2);
        updatePersistentNotification(`📏 Nodo: ${name} | Segmento: ${segKm} km | Totale: ${totKm} km`, 'info');
    } else {
        updatePersistentNotification(`📍 Nodo: ${name} - Clicca per il secondo punto`, 'info');
    }
};

// ============================================
// === CIRCONFERENZA ===
// ============================================

function initCircleTool(mapInstance, btnId) {
    circleTool.map = mapInstance;
    circleTool.btn = document.getElementById(btnId);
    
    if (circleTool.btn) {
        circleTool.btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (ruler.active) {
                toggleRuler();
            }
            toggleCircleTool();
        });
    }
}

function toggleCircleTool() {
    circleTool.active = !circleTool.active;
    const btn = circleTool.btn;
    
    if (circleTool.active) {
        btn.style.borderColor = '#8b5cf6';
        btn.style.background = 'rgba(139, 92, 246, 0.2)';
        btn.innerHTML = '<i class="fas fa-circle" style="color: #8b5cf6;"></i>';
        showPersistentNotification('⭕ Clicca su mappa o nodo per il centro, poi trascina per il raggio', 'info', 0);
        circleTool.map.on('click', onCircleClick);
    } else {
        btn.style.borderColor = '#f59e0b';
        btn.style.background = 'var(--gray-800)';
        btn.innerHTML = '<i class="fas fa-circle"></i>';
        clearPersistentNotification();
        circleTool.map.off('click', onCircleClick);
        circleTool.map.off('mousemove', dragCircle);
        circleTool.map.off('click', finishCircle);
        clearCircle();
    }
}

function onCircleClick(e) {
    if (e.originalEvent) {
        e.originalEvent.stopPropagation();
    }
    
    if (circleTool.center) {
        clearCircle();
        showPersistentNotification('🔄 Centro resettato, clicca per un nuovo centro', 'info', 2000);
        return;
    }
    
    let latlng = e.latlng;
    let isMarker = false;
    let name = null;
    
    if (e.target && e.target.nodeData) {
        const data = e.target.nodeData;
        if (data.latitude && data.longitude) {
            latlng = L.latLng(data.latitude, data.longitude);
            isMarker = true;
            name = data.name || 'Unnamed Node';
            if (circleTool.map) {
                circleTool.map.closePopup();
            }
        }
    }
    
    startCircle(latlng, isMarker, name);
}

function startCircle(latlng, isMarker = false, name = null) {
    circleTool.center = latlng;
    
    circleTool.centerMarker = L.marker(latlng, {
        icon: L.divIcon({
            html: '<div style="background: #8b5cf6; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 20px rgba(139,92,246,0.8);"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        })
    }).addTo(circleTool.map);
    
    const label = isMarker ? `📍 ${name} ` : '';
    showPersistentNotification(`🎯 ${label}Centro: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)} - Trascina per il raggio, clicca per confermare`, 'info');
    
    circleTool.map.on('mousemove', dragCircle);
    circleTool.map.on('click', finishCircle);
    circleTool.map.off('click', onCircleClick);
}

function dragCircle(e) {
    if (!circleTool.center) return;
    
    const latlng = e.latlng;
    const radius = circleTool.center.distanceTo(latlng);
    
    if (circleTool.circle) {
        circleTool.map.removeLayer(circleTool.circle);
        circleTool.circle = null;
    }
    
    circleTool.circle = L.circle(circleTool.center, {
        radius: radius,
        color: '#8b5cf6',
        weight: 2,
        fillColor: '#8b5cf6',
        fillOpacity: 0.15,
        dashArray: '5, 5'
    }).addTo(circleTool.map);
    
    const km = (radius / 1000).toFixed(2);
    const mi = (radius / 1609.34).toFixed(2);
    const areaSqKm = (Math.PI * radius * radius / 1000000).toFixed(2);
    updatePersistentNotification(`⭕ Raggio: ${km} km (${mi} mi) | Area: ${areaSqKm} km² - Clicca per confermare`, 'info');
}

function finishCircle(e) {
    if (!circleTool.center) return;
    
    if (e && e.originalEvent) {
        e.originalEvent.stopPropagation();
    }
    
    let latlng = e.latlng;
    const radius = circleTool.center.distanceTo(latlng);
    
    if (radius < 10) {
        updatePersistentNotification('⚠️ Raggio troppo piccolo (minimo 10m)', 'warning');
        return;
    }
    
    if (circleTool.circle) {
        circleTool.circle.setStyle({
            color: '#10b981',
            weight: 3,
            fillOpacity: 0.2,
            dashArray: null
        });
    }
    
    const km = (radius / 1000).toFixed(2);
    const areaSqKm = (Math.PI * radius * radius / 1000000).toFixed(2);
    updatePersistentNotification(`✅ Cerchio confermato: raggio ${km} km | Area: ${areaSqKm} km²`, 'success');
    
    circleTool.map.off('mousemove', dragCircle);
    circleTool.map.off('click', finishCircle);
    circleTool.map.on('click', onCircleClick);
    
    circleTool.center = null;
    circleTool.centerMarker = null;
}

function clearCircle() {
    if (circleTool.circle) {
        circleTool.map.removeLayer(circleTool.circle);
        circleTool.circle = null;
    }
    if (circleTool.centerMarker) {
        circleTool.map.removeLayer(circleTool.centerMarker);
        circleTool.centerMarker = null;
    }
    circleTool.center = null;
    circleTool.map.off('mousemove', dragCircle);
    circleTool.map.off('click', finishCircle);
    circleTool.map.off('click', onCircleClick);
}

window.startCircleFromNode = function(latlng, name) {
    if (!circleTool.active) return;
    if (circleTool.center) {
        clearCircle();
        showPersistentNotification('🔄 Centro resettato', 'info', 1500);
        return;
    }
    
    if (circleTool.map) {
        circleTool.map.closePopup();
    }
    
    circleTool.center = latlng;
    
    circleTool.centerMarker = L.marker(latlng, {
        icon: L.divIcon({
            html: '<div style="background: #8b5cf6; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 20px rgba(139,92,246,0.8);"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        })
    }).addTo(circleTool.map);
    
    showPersistentNotification(`🎯 Centro sul nodo: ${name} - Trascina per il raggio`, 'info');
    
    circleTool.map.on('mousemove', dragCircle);
    circleTool.map.on('click', finishCircle);
    circleTool.map.off('click', onCircleClick);
};

// ============================================
// === ETICHETTE NODI (ORIGINALI) ===
// ============================================

let nodeLabels = [];
let labelsEnabled = true;
const LABEL_ZOOM_THRESHOLD = 8;

window.initLabels = function(mapInstance) {
    window._labelMap = mapInstance;
    console.log('✅ initLabels chiamato');
};

window.toggleLabels = function() {
    labelsEnabled = !labelsEnabled;
    const btn = document.getElementById('toggle-labels-btn');
    
    if (labelsEnabled) {
        btn.style.borderColor = '#10b981';
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
        btn.innerHTML = '<i class="fas fa-tag" style="color: #10b981;"></i>';
        showNotification('Etichette attivate', 'success');
        const zoom = window._labelMap ? window._labelMap.getZoom() : 10;
        updateNodeLabels(zoom >= LABEL_ZOOM_THRESHOLD);
    } else {
        btn.style.borderColor = '#f59e0b';
        btn.style.background = 'var(--gray-800)';
        btn.innerHTML = '<i class="fas fa-tag"></i>';
        showNotification('Etichette disattivate', 'info');
        updateNodeLabels(false);
    }
};

function createNodeLabel(node) {
    if (!node.geolocated || !node.latitude || !node.longitude) return null;
    if (!node.name || node.name === 'Unnamed Node') return null;
    
    const div = document.createElement('div');
    div.textContent = node.name;
    div.style.cssText = `
        background: rgba(0, 0, 0, 0.75);
        color: #e2e8f0;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        font-family: 'Consolas', monospace;
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        pointer-events: none;
        user-select: none;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0,0,0,0.5);
        transition: opacity 0.3s ease;
        opacity: 0.9;
        letter-spacing: 0.3px;
        backdrop-filter: blur(4px);
    `;
    
    const label = L.marker([node.latitude, node.longitude], {
        icon: L.divIcon({
            html: div,
            className: 'node-label-marker',
            iconSize: [div.offsetWidth || 100, 20],
            iconAnchor: [50, -10]
        }),
        interactive: false,
        keyboard: false
    });
    
    setTimeout(() => {
        const labelEl = label.getElement();
        if (labelEl) {
            const width = labelEl.offsetWidth || 100;
            label.setIcon(L.divIcon({
                html: div,
                className: 'node-label-marker',
                iconSize: [width, 20],
                iconAnchor: [width/2, -10]
            }));
        }
    }, 100);
    
    return label;
}

function updateNodeLabels(visible) {
    const map = window._labelMap;
    if (!map) return;
    
    nodeLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    nodeLabels = [];
    
    if (!visible) return;
    
    const visibleMarkers = [];
    
    map.eachLayer(function(layer) {
        if (layer instanceof L.Marker && layer.nodeData) {
            const latlng = layer.getLatLng();
            visibleMarkers.push({
                node: layer.nodeData,
                latlng: latlng,
                name: layer.nodeData.name || 'Unnamed Node'
            });
        }
    });
    
    if (visibleMarkers.length === 0) return;
    
    visibleMarkers.forEach(item => {
        const node = item.node;
        const latlng = item.latlng;
        
        if (!node.geolocated || !node.latitude || !node.longitude) return;
        if (!node.name || node.name === 'Unnamed Node') return;
        
        const label = createNodeLabelAtPosition(node, latlng);
        if (label) {
            label.addTo(map);
            nodeLabels.push(label);
        }
    });
}

function createNodeLabelAtPosition(node, position) {
    if (!node.name || node.name === 'Unnamed Node') return null;
    
    const div = document.createElement('div');
    div.textContent = node.name;
    div.style.cssText = `
        background: rgba(0, 0, 0, 0.8);
        color: #e2e8f0;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        font-family: 'Consolas', monospace;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        pointer-events: none;
        user-select: none;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0,0,0,0.5);
        transition: opacity 0.3s ease;
        opacity: 0.95;
        letter-spacing: 0.3px;
        backdrop-filter: blur(4px);
        z-index: 9999;
        position: relative;
    `;
    
    const arrow = document.createElement('div');
    arrow.style.cssText = `
        position: absolute;
        bottom: -8px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 8px solid rgba(0, 0, 0, 0.8);
        z-index: 9998;
    `;
    div.appendChild(arrow);
    
    const label = L.marker(position, {
        icon: L.divIcon({
            html: div,
            className: 'node-label-marker',
            iconSize: [div.offsetWidth || 100, 28],
            iconAnchor: [50, -15]
        }),
        interactive: false,
        keyboard: false,
        pane: 'labels'
    });
    
    setTimeout(() => {
        const labelEl = label.getElement();
        if (labelEl) {
            const width = labelEl.offsetWidth || 100;
            label.setIcon(L.divIcon({
                html: div,
                className: 'node-label-marker',
                iconSize: [width, 28],
                iconAnchor: [width/2, -15]
            }));
        }
    }, 100);
    
    return label;
}

window.updateNodeLabelsForMarkers = function(markers) {
    const map = window._labelMap;
    if (!map) return;
    if (!markers || markers.length === 0) return;
    
    nodeLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    nodeLabels = [];
    
    const visibleNodeHashes = new Set();
    const nodeDataList = [];
    
    markers.forEach(marker => {
        if (marker.nodeData) {
            const key = marker.nodeData.transport_id || marker.nodeData.name;
            visibleNodeHashes.add(key);
            nodeDataList.push(marker.nodeData);
        }
    });
    
    if (nodeDataList.length === 0) return;
    
    nodeDataList.forEach(node => {
        if (!node.geolocated || !node.latitude || !node.longitude) return;
        if (!node.name || node.name === 'Unnamed Node') return;
        
        const label = createNodeLabel(node);
        if (label) {
            label.addTo(map);
            nodeLabels.push(label);
        }
    });
};

// ============================================
// === ETICHETTE PER VENTAGLI (NUOVE) ===
// ============================================

let spiderLabelLayers = [];

/**
 * Mostra le etichette per i nodi in un ventaglio aperto
 */
function showSpiderLabels(layer, markers, map) {
    if (!markers || markers.length === 0) return;
    if (!labelsEnabled) return;
    
    const zoom = map.getZoom();
    
    // Rimuovi etichette vecchie per questo layer
    if (layer._labelLayer) {
        map.removeLayer(layer._labelLayer);
        layer._labelLayer = null;
    }
    
    const labelGroup = L.layerGroup();
    
    markers.forEach((marker) => {
        const node = marker.nodeData;
        if (!node || !node.name) return;
        
        const pos = marker.getLatLng();
        const pixelsPerDegree = 256 * Math.pow(2, zoom) / 360;
        const offsetDegrees = 30 / pixelsPerDegree;
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
            const nodeData = marker.nodeData;
            if (nodeData && window.selectNode && window.filteredNodes) {
                const filteredIdx = window.filteredNodes.indexOf(nodeData);
                if (filteredIdx !== -1) {
                    window.selectNode(filteredIdx);
                }
            }
        });
        
        labelGroup.addLayer(label);
    });
    
    labelGroup.addTo(map.getPane('labels'));
    layer._labelLayer = labelGroup;
    spiderLabelLayers.push(labelGroup);
}

/**
 * Nasconde le etichette per un ventaglio chiuso
 */
function hideSpiderLabels(layer, map) {
    if (layer._labelLayer) {
        map.removeLayer(layer._labelLayer);
        layer._labelLayer = null;
    }
}

// ============================================
// === ESPORTA FUNZIONI ===
// ============================================

window.initRuler = initRuler;
window.toggleRuler = toggleRuler;
window.initCircleTool = initCircleTool;
window.toggleCircleTool = toggleCircleTool;
window.initLabels = initLabels;
window.toggleLabels = toggleLabels;
window.updateNodeLabels = updateNodeLabels;
window.updateNodeLabelsForMarkers = updateNodeLabelsForMarkers;
window.showSpiderLabels = showSpiderLabels;
window.hideSpiderLabels = hideSpiderLabels;

console.log('✅ ruler.js caricato completamente');