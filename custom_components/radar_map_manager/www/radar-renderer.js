export class RadarRenderer {
    constructor(math, root) {
        this.math = math;
        this.root = root;
    }

    _create(tag, attrs = {}, style = {}) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        for (const [k, v] of Object.entries(style)) el.style[k] = v;
        return el;
    }

    calculateStandardCoord(cfg, xRaw, yRaw) {
        return this.math.calculate(cfg, { x: xRaw, y: yRaw, z: 0 });
    }

    getRadarConfig(state, rName, hass) {
        const getVal = (key, def) => {
            let val = def;
            if (state.editMode === 'layout' && rName === state.radar && state.layoutChanges && state.layoutChanges[key] !== undefined) {
                val = state.layoutChanges[key];
            } else {
                const radarData = (state.data && state.data[rName]) || {};
                const layout = radarData.layout || {};
                if (layout[key] !== undefined) val = layout[key];
            }
            if (key === 'mirror_x' || key === 'enable_3d' || key === 'ceiling_mount') return !!val;
            if (typeof val === 'string') val = parseFloat(val);
            if (typeof val !== 'number' || isNaN(val)) return def;
            return val;
        };

        return {
            origin_x: getVal('origin_x', 50),
            origin_y: getVal('origin_y', 50),
            scale_x: getVal('scale_x', 5),
            scale_y: getVal('scale_y', 5),
            rotation: getVal('rotation', 0),
            mirror_x: getVal('mirror_x', false),
            mount_height: getVal('mount_height', 1.5),
            enable_correction: getVal('enable_3d', false),
            ceiling_mount: getVal('ceiling_mount', false),
            target_height: 1.2
        };
    }

    _getAllRadars(state, config, hass) {
        const rawList = config.radars || [];
        const nameSet = new Set();
        rawList.forEach(r => nameSet.add((typeof r === 'object') ? r.name : r));
        if (state && state.data) {
            Object.keys(state.data).forEach(k => {
                if (!['global_zones', 'global_config', '[object Object]', 'rd_default'].includes(k)) nameSet.add(k);
            });
        }
        return Array.from(nameSet).map(name => ({ name }));
    }

    _isPointInPoly(x, y, poly) {
        const pts = Array.isArray(poly) ? poly : (poly.points || []);
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i][0], yi = pts[i][1];
            const xj = pts[j][0], yj = pts[j][1];
            
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    draw(state, config, hass) {
        const svg = this.root.getElementById('svg-canvas');
        const dotsLayer = this.root.getElementById('dots-layer');
        if (!svg || !dotsLayer || !hass || !hass.states) return;

        while (svg.firstChild) svg.removeChild(svg.firstChild);
        dotsLayer.innerHTML = ''; 

        const allRadars = this._getAllRadars(state, config, hass);

        this.drawZones(state, config, svg);
        this.drawDrawingGuides(state, svg);

        if (state.editing && state.editMode === 'layout') {
            this.drawRadarAvatars(state, config, svg, hass, allRadars, state.aspectRatio);
        }

        this.drawTargets(state, config, hass, allRadars);
    }

    drawDrawingGuides(state, svg) {
        const isDrawing = state.isAddingNew || (state.editing && state.points && state.points.length > 0);
        
        if (!isDrawing || !state.mousePos) return;

        const { x, y } = state.mousePos;
        const guideStyle = {
            stroke: '#FFD700',
            strokeWidth: '0.2',
            strokeDasharray: '2,2',
            strokeOpacity: '0.6',
            pointerEvents: 'none'
        };

        svg.appendChild(this._create('line', { x1: 0, y1: y, x2: 100, y2: y }, guideStyle));
        svg.appendChild(this._create('line', { x1: x, y1: 0, x2: x, y2: 100 }, guideStyle));
    }

    drawRadarAvatars(state, config, svg, hass, radarList, aspectRatio) {
        const currentRadar = state.radar;
        const baseSize = parseFloat(config.label_size) || 3.5;
        const avatarFontSize = Math.max(1.5, baseSize * 0.7);

        radarList.forEach(rObj => {
            const rName = rObj.name;
            const isCurrent = (rName === currentRadar);
            const opacity = isCurrent ? (state.fov_edit_mode ? 0.2 : 1.0) : 0.4;
            const strokeColor = isCurrent ? '#FFD700' : '#666';
            const ptrEvents = state.fov_edit_mode ? 'none' : 'all'; 

            const cfg = this.getRadarConfig(state, rName, hass);
            const ox = cfg.origin_x; 
            const oy = cfg.origin_y; 
            
            const group = this._create('g', { 'data-id': rName, 'data-radar': rName, class: 'radar-group' });
            
            group.appendChild(this._create('circle', {
                cx: ox, cy: oy, r: 1.5, class: 'radar-handle-body', 'data-id': rName, 'data-radar': rName
            }, { fill: strokeColor, stroke: 'white', strokeWidth: '0.5', opacity: opacity, pointerEvents: ptrEvents, cursor: 'move' }));
            
            if (isCurrent) {
                const handlePos = this.calculateStandardCoord({ ...cfg, mirror_x: false, enable_correction: false }, 0, 4000); 
                const hx = handlePos.left; const hy = handlePos.top;

                let pathD = "";
                
                if (cfg.ceiling_mount) {
                    for (let i = 0; i <= 36; i++) {
                        const angDeg = i * 10;
                        const angRad = angDeg * Math.PI / 180;
                        const pScreen = this.calculateStandardCoord({ ...cfg, enable_correction: false }, 4000 * Math.sin(angRad), 4000 * Math.cos(angRad));
                        if (i === 0) pathD += `M ${pScreen.left} ${pScreen.top}`;
                        else pathD += ` L ${pScreen.left} ${pScreen.top}`;
                    }
                    pathD += " Z";
                } else {
                    pathD = `M ${ox} ${oy}`;
                    const fovWidthDeg = 120; const startAngle = -fovWidthDeg / 2;
                    for (let i = 0; i <= 10; i++) {
                        const angDeg = startAngle + (i / 10) * fovWidthDeg;
                        const angRad = angDeg * Math.PI / 180;
                        const pScreen = this.calculateStandardCoord({ ...cfg, enable_correction: false }, 4000 * Math.sin(angRad), 4000 * Math.cos(angRad));
                        pathD += ` L ${pScreen.left} ${pScreen.top}`;
                    }
                    pathD += ` Z`;
                }

                group.appendChild(this._create('path', { d: pathD }, { fill: 'cyan', fillOpacity: '0.15', stroke: 'cyan', strokeWidth: '0.5', strokeDasharray: '2,1', pointerEvents: 'none' }));
                
                group.appendChild(this._create('line', { x1: ox, y1: oy, x2: hx, y2: hy }, { stroke: strokeColor, strokeWidth: '0.8', strokeDasharray: '4,2', opacity: opacity, pointerEvents: 'none' }));
                
                group.appendChild(this._create('circle', { cx: hx, cy: hy, r: 1.2, class: 'radar-handle-rot', 'data-id': rName, 'data-radar': rName }, { fill: 'cyan', stroke: 'white', strokeWidth: '0.5', opacity: opacity, pointerEvents: ptrEvents, cursor: 'alias' }));
                
                const txt = this._create('text', { x: hx, y: hy - 2 }, { fontSize: `${avatarFontSize}px`, fill: 'cyan', textAnchor: 'middle', fontWeight: 'bold', pointerEvents: 'none', textShadow: '1px 1px 1px black', opacity: opacity });
                txt.textContent = `${Math.round(cfg.rotation)}°`;
                group.appendChild(txt);
                
                group.appendChild(this._create('line', { x1: 0, y1: oy, x2: 100, y2: oy }, { stroke: 'rgba(255, 255, 0, 0.3)', strokeWidth: '0.2', pointerEvents: 'none' }));
                group.appendChild(this._create('line', { x1: ox, y1: 0, x2: ox, y2: 100 }, { stroke: 'rgba(255, 255, 0, 0.3)', strokeWidth: '0.2', pointerEvents: 'none' }));
            } else {
                const name = this._create('text', { x: ox, y: oy + 3 }, { fontSize: `${avatarFontSize * 0.8}px`, fill: '#ccc', textAnchor: 'middle', pointerEvents: 'none', textShadow: '1px 1px 1px black' });
                name.textContent = rName;
                group.appendChild(name);
            }
            svg.appendChild(group);
        });
    }

    _calculateArea(points) {
        if (!points || points.length < 3) return 0;
        let area = 0;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
        return Math.abs(area / 2);
    }

    drawZones(state, config, svg) {
        if (!state.editing) return;
        if (state.editMode === 'settings') return;
        
        const isLayout = state.editMode === 'layout';
        const baseR = config.handle_radius || 4; 
        const zoneStroke = config.zone_stroke || 0.8; 
        const showLabels = config.show_labels !== false; 
        const handleStroke = config.handle_stroke || 1; 
        const labelSize = parseFloat(config.label_size) || 3.5;
        
        const TYPE_COLORS = { 'monitor_zones': '#FFD700', 'include_zones': '#00FF00', 'exclude_zones': '#FF0000' };

        const createPoly = (obj, typeKey, pIdx, rName) => {
            const group = this._create('g', { 'data-type': typeKey, 'data-index': pIdx, 'data-radar': rName || '' });
            const pts = Array.isArray(obj) ? obj : obj.points;
            if (!pts || pts.length === 0) return null;
            const ptsStr = pts.map(p => p.join(',')).join(' ');
            
            let isSelZone = false;
            if (isLayout) {
                if (typeKey === 'monitor_zones' && rName === state.radar && state.selectedIndex === pIdx) isSelZone = true;
            } else {
                if (typeKey === state.type && state.selectedIndex === pIdx) isSelZone = true;
            }

            const color = TYPE_COLORS[typeKey] || 'white';
            let strokeColor = color; let strokeWidth = zoneStroke; let fillOpacity = 0.2; let ptrEvents = 'all'; let strokeOpacity = 1.0; 
            let cursorStyle = 'pointer';

            if (isLayout) {
                if (typeKey !== 'monitor_zones') return null; 
                if (rName === state.radar) {
                    if (!state.fov_edit_mode) { ptrEvents = 'none'; fillOpacity = 0.2; strokeWidth = zoneStroke * 0.8; cursorStyle = 'default'; } 
                    else { ptrEvents = 'all'; fillOpacity = 0.4; strokeColor = '#FFD700'; }
                    if (isSelZone) { strokeColor = '#00FFFF'; strokeWidth = zoneStroke * 2; fillOpacity = 0.6; }
                } else {
                    ptrEvents = 'none'; fillOpacity = 0.05; strokeOpacity = 0.2; strokeWidth = zoneStroke * 0.5; 
                }
            } else {
                if (typeKey === 'monitor_zones') return null; 
                if (typeKey === state.type) {
                    fillOpacity = 0.3; ptrEvents = 'all'; 
                    if (isSelZone) { strokeColor = '#00FFFF'; strokeWidth = zoneStroke * 2; fillOpacity = 0.5; }
                } else {
                    fillOpacity = 0.05; strokeColor = '#555'; ptrEvents = 'none';
                }
            }

            group.appendChild(this._create('polygon', { 
                points: ptsStr, class: 'zone-poly', 'data-type': typeKey, 'data-index': pIdx, 'data-radar': rName || ''
            }, { fill: color, fillOpacity: fillOpacity, stroke: strokeColor, strokeWidth: strokeWidth, strokeOpacity: strokeOpacity, pointerEvents: ptrEvents, cursor: cursorStyle }));

            if (showLabels && obj.name && (isSelZone || state.fov_edit_mode || !isLayout)) {
                const center = this.math.getCentroid(pts);
                const txt = this._create('text', { x: center[0], y: center[1], class: 'zone-label' }, { fontSize: `${labelSize}px`, fill: 'white', textAnchor: 'middle', pointerEvents: 'none', textShadow: '1px 1px 2px black', opacity: 1 });
                txt.textContent = obj.name;
                group.appendChild(txt);
            }
            
            if (isSelZone) {
                pts.forEach((p, iIdx) => {
                    const isDrag = state.dragState?.isDragging && state.dragState.polyIndex === pIdx && state.dragState.pointIndex === iIdx;
                    const isSelPt = (state.selectedPointIndex === iIdx);
                    const r = (isDrag || isSelPt) ? (baseR * 1.5) : baseR;
                    let fill = "rgba(255,255,255,0.4)"; let stroke = "none"; let strokeW = 0;
                    if (isDrag) { fill = color; stroke = "white"; strokeW = handleStroke; }
                    else if (isSelPt) { fill = "cyan"; stroke = "white"; strokeW = handleStroke; }
                    
                    group.appendChild(this._create('circle', { 
                        cx: p[0], cy: p[1], r: r, class: 'zone-handle', 'data-type': typeKey, 'data-index': pIdx, 'data-point-index': iIdx, 'data-radar': rName || ''
                    }, { fill: fill, stroke: stroke, strokeWidth: strokeW, pointerEvents: 'all', cursor: 'move' }));
                });
            }
            return group;
        };

        let drawTasks = [];
        if (state.data) {
            Object.keys(state.data).forEach(rName => {
                if (['global_zones', 'global_config', '[object Object]', 'rd_default'].includes(rName)) return; 
                if(state.data[rName] && Array.isArray(state.data[rName]['monitor_zones'])) {
                    state.data[rName]['monitor_zones'].forEach((p, i) => drawTasks.push({ obj: p, type: 'monitor_zones', idx: i, rName: rName, area: this._calculateArea(Array.isArray(p)?p:p.points) }));
                }
            });
        }
        
        const globalZones = (state.data && state.data.global_zones) || {};
        ['include_zones', 'exclude_zones'].forEach(tKey => {
            const list = globalZones[tKey];
            if (Array.isArray(list)) {
                list.forEach((p, i) => drawTasks.push({ obj: p, type: tKey, idx: i, rName: 'global', area: this._calculateArea(Array.isArray(p)?p:p.points) })); 
            }
        });

        drawTasks.sort((a, b) => b.area - a.area);
        drawTasks.forEach(task => { const el = createPoly(task.obj, task.type, task.idx, task.rName); if (el) svg.appendChild(el); });
        
        if (state.points.length > 0) {
            let activeType = state.type; if (state.fov_edit_mode) activeType = 'monitor_zones';
            const color = TYPE_COLORS[activeType] || 'white';
            state.points.forEach(p => svg.appendChild(this._create('circle', { cx: p[0], cy: p[1], r: baseR }, { fill: 'white', fillOpacity: 0.5, pointerEvents: 'none' })));
            const ptsStr = state.points.map(p => p.join(',')).join(' ');
            if (state.points.length >= 3) svg.appendChild(this._create('polygon', { points: ptsStr }, { fill: color, fillOpacity: 0.2, stroke: color, strokeWidth: zoneStroke, strokeDasharray: "4,2", pointerEvents: 'none' }));
            else svg.appendChild(this._create('polyline', { points: ptsStr }, { fill: 'none', stroke: color, strokeWidth: zoneStroke, pointerEvents: 'none' }));
        }
    }
    
    drawTargets(state, config, hass, radarList) {
        const layer = this.root.getElementById('dots-layer');
        if (!layer) return; 

        if (state.calibration && state.calibration.active && state.calibration.map) {
            const tx = state.calibration.map.x; const ty = state.calibration.map.y;
            const dot = document.createElement('div'); 
            dot.className = 'dot'; dot.style.width = '12px'; dot.style.height = '12px'; 
            dot.style.background = 'red'; dot.style.border = '2px solid white'; dot.style.boxShadow = '0 0 10px red'; 
            dot.style.left = tx + '%'; dot.style.top = ty + '%'; dot.style.zIndex = '100'; dot.innerText = '+';
            layer.appendChild(dot);
            return;
        }

        const targetRadius = config.target_radius || 8;
        const showLabels = config.show_labels !== false;
        
        const mapGroup = state.mapGroup || "default";
        const safeId = mapGroup.toLowerCase().replace(/ /g, "_");
        const fusionEnt = hass.states[`sensor.rmm_${safeId}_master`];
        const hasFusionData = fusionEnt && fusionEnt.attributes.targets && fusionEnt.attributes.targets.length > 0;
        
        const globalConfig = (state.data && state.data.global_config) || {};
        const fusedColor = config.fused_color || globalConfig.fused_color || '#FFD700';

        const globalZones = (state.data && state.data.global_zones) || {};
        const excludeZones = globalZones.exclude_zones || [];

        if (state.editMode === 'zone' || state.editMode === 'settings' || !state.editing) {
            if (hasFusionData) {
                fusionEnt.attributes.targets.forEach(t => {
                    if (excludeZones.some(z => this._isPointInPoly(t.x, t.y, z))) {
                        return; 
                    }

                    const dot = document.createElement('div');
                    dot.className = 'dot';
                    dot.style.width = `${targetRadius * 2}px`; 
                    dot.style.height = `${targetRadius * 2}px`;
                    
                    dot.style.background = fusedColor;
                    dot.style.border = '2px solid white'; 
                    dot.style.boxShadow = `0 0 8px ${fusedColor}`; 
                    
                    dot.style.color = 'white'; 
                    const strokeW = Math.max(0.5, targetRadius * 0.08); 
                    dot.style.webkitTextStroke = `${strokeW}px black`;
                    dot.style.paintOrder = "stroke fill"; 
                    dot.style.textShadow = 'none'; 
                    
                    dot.style.fontWeight = '900'; 
                    const fontSize = Math.max(9, targetRadius * 1.3); 
                    dot.style.fontSize = `${fontSize}px`;
                    
                    dot.style.transition = 'left 0.2s linear, top 0.2s linear';
                    dot.style.left = t.x + '%'; 
                    dot.style.top = t.y + '%'; 
                    const label = t.id ? t.id.replace('target_', '') : '';
                    dot.innerText = label;
                    if (showLabels) dot.title = `Fused ID: ${t.id}\nSources: ${t.sources}`;
                    layer.appendChild(dot);
                });
            }
            return; 
        }

        const defColors = ['#00FF00', '#FF0000', '#00FFFF'];
        const userColors = config.target_colors || [];
        const targetsToDraw = radarList || this._getAllRadars(state, config, hass);
        
        targetsToDraw.forEach(rObj => {
            const rName = rObj.name;
            const cfg = this.getRadarConfig(state, rName, hass);
            for (let i = 1; i <= 3; i++) {
                this.processTarget(hass, rName, i, cfg, targetRadius, showLabels, userColors, defColors, null, layer);
            }
        });
    }

    processTarget(hass, rName, i, cfg, radius, showLbl, uCols, dCols, unitOverride, layer) {
        const lowerName = rName.toLowerCase();
        let xs = hass.states[`sensor.${lowerName}_target_${i}_x`];
        let ys = hass.states[`sensor.${lowerName}_target_${i}_y`];
        let zs = hass.states[`sensor.${lowerName}_target_${i}_z`];
        let is1D = false; 
        
        if (!ys || ys.state === 'unavailable') {
            const possibleDistEntities = [`sensor.${lowerName}_distance`, `sensor.${lowerName}_target_${i}_distance`];
            for (const entId of possibleDistEntities) {
                const ent = hass.states[entId];
                if (ent && ent.state !== 'unavailable') {
                    if (entId.includes(`target_${i}`) || i === 1) { ys = ent; xs = null; is1D = true; break; }
                }
            }
        }

        if (ys && ys.state !== 'unavailable') {
            let yVal = parseFloat(ys.state);
            let unit = unitOverride || ys.attributes.unit_of_measurement;
            let xVal = 0; let zVal = 0;
            if (xs && xs.state !== 'unavailable') xVal = parseFloat(xs.state);
            if (zs && zs.state !== 'unavailable') zVal = parseFloat(zs.state);
            if (isNaN(yVal)) return false;

            if (!unit) { 
                if (Math.abs(yVal) < 50) unit = 'm'; 
                else unit = 'mm'; 
            }
            if (unit === 'cm') { xVal*=10; yVal*=10; zVal*=10; } 
            else if (unit === 'm') { xVal*=1000; yVal*=1000; zVal*=1000; }

            if (Math.abs(yVal) > 10) {
                this.renderDot(layer, i, xVal, yVal, zVal, cfg, radius, showLbl, uCols, dCols, is1D);
                return true;
            }
        }
        return false;
    }

    renderDot(layer, idx, xVal, yVal, zVal, cfg, r, showLbl, uCols, dCols, is1D) {
        const ground = this.math.calculate(cfg, { x: xVal, y: yVal, z: zVal });
        
        const shadow = document.createElement('div'); 
        shadow.className = 'base-shadow'; 
        shadow.style.width = `${r}px`; 
        shadow.style.height = `${r / 2}px`;
        shadow.style.left = ground.left + '%'; 
        shadow.style.top = ground.top + '%';
        shadow.style.transition = 'left 0.2s linear, top 0.2s linear'; 
        layer.appendChild(shadow);
        
        const dot = document.createElement('div'); 
        dot.className = 'dot'; 
        dot.style.width = `${r * 2}px`; 
        dot.style.height = `${r * 2}px`;
        
        const colorIdx = (typeof idx === 'number') ? ((idx > 9) ? (idx % dCols.length) : (idx - 1)) : 0;
        const col = uCols[colorIdx] || dCols[colorIdx % dCols.length] || 'white';
        
        dot.style.background = col; 
        dot.style.color = 'black'; 
        dot.style.textShadow = '0 0 1px white';
        const fontSize = Math.max(8, r * 1.1); 
        dot.style.fontSize = `${fontSize}px`;
        dot.style.transition = 'left 0.2s linear, top 0.2s linear';
        
        if (showLbl) dot.innerText = is1D ? "D" : ((idx > 9) ? "D" : idx);
        
        dot.style.left = ground.left + '%'; 
        dot.style.top = ground.top + '%';
        layer.appendChild(dot);
    }
}