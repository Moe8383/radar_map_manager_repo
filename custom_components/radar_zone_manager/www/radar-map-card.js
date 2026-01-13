/**
 * RADAR MAP CARD V54
 * 拖拽修复 + 外观定制版
 */
class RadarEngineV54 {
  constructor() {
    this.defaults = { origin_x: 50, origin_y: 50, scale_x: 5, scale_y: 5, scale_z: 0, angle: 0, flip: 1, target_count: 3 };
  }
  calculate(c, r) {
    if (Math.abs(r.y) < 1 && Math.abs(r.x) < 1) return { active: false };
    const rad = (c.angle * Math.PI) / 180;
    const x = r.x * c.flip, y = r.y;
    const rx = x * Math.cos(rad) + y * Math.sin(rad);
    const ry = -x * Math.sin(rad) + y * Math.cos(rad);
    return { 
        active: true, 
        left: (c.origin_x + (rx/1000)*c.scale_x).toFixed(1), 
        top: (c.origin_y - (ry/1000)*c.scale_y - (r.z/1000)*c.scale_z).toFixed(1) 
    };
  }
  isPointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let x = point.x, y = point.y, inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      let xi = polygon[i][0], yi = polygon[i][1], xj = polygon[j][0], yj = polygon[j][1];
      let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
}

class RadarMapCardNative extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.engine = new RadarEngineV54();
    this.state = { 
        editing: false, 
        radar: null, 
        type: 'include_zones', 
        points: [], 
        data: {}, 
        ts: 0 
    };
    
    this.dragState = {
        isDragging: false,
        polyIndex: -1, 
        pointIndex: -1
    };

    this.isCreated = false;
    this.retryTimer = null;
    this.retryCount = 0;
  }

  setConfig(config) {
    this.config = config;
    if (this.isCreated) return;
    this.renderDOM();
    this.isCreated = true;
    this.startHeartbeat();
  }
  
  connectedCallback() { this.startHeartbeat(); }
  disconnectedCallback() { if (this.retryTimer) clearInterval(this.retryTimer); }

  startHeartbeat() {
      if (this.retryTimer) clearInterval(this.retryTimer);
      this.retryCount = 0;
      this.retryTimer = setInterval(() => this.checkConnection(), 3000);
  }

  checkConnection() {
      if (!this._hass) return;
      const ent = this._hass.states['sensor.radar_zone_manager'];
      if (ent && ent.attributes.data_json) return;
      this.retryCount++;
      this._hass.callService('radar_zone_manager', 'refresh_radar_data');
      const txt = this.shadowRoot.getElementById('stat-txt');
      if (txt && this.state.editing) {
          txt.innerText = `Connecting (${this.retryCount})...`;
          txt.style.color = "yellow";
      }
  }

  updateStatusText() {
      const txt = this.shadowRoot.getElementById('stat-txt');
      if (!txt) return;
      const ent = this._hass ? this._hass.states['sensor.radar_zone_manager'] : null;
      const count = Object.keys(this.state.data).length;
      if (ent && ent.attributes.data_json) {
          if (count > 0) { txt.innerText = `Ready: ${count} radars`; txt.style.color = "lime"; }
          else { txt.innerText = "Ready (Empty)"; txt.style.color = "#aaa"; }
      } else {
          txt.innerText = "Waiting Link..."; txt.style.color = "orange";
      }
  }

  renderDOM() {
    this.shadowRoot.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; pointer-events: none; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
      #dots-layer { position: absolute; top:0; left:0; width:100%; height:100%; z-index:10; }
      /* 雷达目标点样式 */
      .dot { position: absolute; border-radius:50%; transform:translate(-50%,-50%); box-shadow:0 0 4px white; display: flex; justify-content: center; align-items: center; font-family: Arial; font-size: 10px; font-weight: bold; color: white; text-shadow: 0 0 2px black; transition: left 0.1s linear, top 0.1s linear; }
      
      #edit-ui { display:none; position:absolute; top:0; left:0; width:100%; height:100%; z-index:100; }
      #edit-ui.show { display:block; }
      
      #click-layer { position:absolute; top:0; left:0; width:100%; height:100%; z-index:101; cursor:crosshair; pointer-events: auto; }
      
      #svg-canvas { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:102; }
      
      /* [修复] 控制手柄样式：pointer-events: none 让点击穿透给 click-layer */
      .handle { 
          pointer-events: none; 
          fill: rgba(255, 255, 255, 0.4); /* 半透明填充 */
          stroke: rgba(255, 255, 255, 0.9); /* 较亮的描边 */
          stroke-width: 0.5px; 
          transition: r 0.2s; 
      }
      .handle.dragging { 
          fill: rgba(0, 255, 0, 0.6); 
          stroke: lime;
      }

      #panel { position: absolute; bottom: 10px; left: 10px; right: 10px; background: rgba(0,0,0,0.95); border: 2px solid lime; padding: 10px; border-radius: 8px; color: white; display: flex; flex-direction: column; gap: 8px; z-index: 9999; pointer-events: auto; user-select: none; }
      .row { display: flex; justify-content: space-between; align-items: center; }
      select { background: #333; color: white; border: 1px solid #666; padding: 5px; flex: 1; margin-left:10px; pointer-events: auto; }
      button { background: #444; color: white; border: 1px solid #888; padding: 5px 10px; cursor: pointer; pointer-events: auto; }
      #status-box { font-size: 10px; color: #aaa; margin-top: 5px; border-top: 1px solid #444; padding-top:5px; display: flex; justify-content: space-between; align-items: center; }
      #btn-reset { background: #ff0000; color: white; border:none; padding:3px 8px; cursor:pointer; font-size:9px; }
    </style>
    <div id="root">
        <div id="dots-layer"></div>
        <div id="edit-ui">
            <svg id="svg-canvas" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
            <div id="click-layer"></div>
            <div id="panel">
                <div class="row"><b style="color:lime">Radar V54 (Fix)</b><button id="btn-move">⇅</button></div>
                <div class="row"><label>RADAR</label><select id="sel-radar"></select></div>
                <div class="row"><label>TYPE</label><select id="sel-type"><option value="include_zones">🟢 Whitelist</option><option value="exclude_zones">🔴 Blacklist</option></select></div>
                <div class="row" style="justify-content:flex-start; gap:8px;"><button id="btn-undo">Undo Last</button><button id="btn-clear">Clear Type</button><button id="btn-save" style="background:lime; color:black; font-weight:bold;">SAVE NEW</button></div>
                <div id="status-box"><span id="stat-txt">Init...</span><button id="btn-reset">RESET DB</button></div>
            </div>
        </div>
    </div>`;
    this.bindEvents();
  }

  getMousePos(e, rect) {
      return [
          parseFloat((((e.clientX - rect.left) / rect.width) * 100).toFixed(1)),
          parseFloat((((e.clientY - rect.top) / rect.height) * 100).toFixed(1))
      ];
  }

  bindEvents() {
    const root = this.shadowRoot;
    const panel = root.getElementById('panel');
    const clickLayer = root.getElementById('click-layer');
    const stop = (e) => e.stopPropagation();
    ['click','mousedown','touchstart','pointerdown'].forEach(evt => panel.addEventListener(evt, stop));

    let isTop = false;
    root.getElementById('btn-move').onclick = () => { isTop = !isTop; panel.style.top = isTop ? '10px' : 'auto'; panel.style.bottom = isTop ? 'auto' : '10px'; };
    
    // ---------------------------------------------------------
    // 交互逻辑
    // ---------------------------------------------------------
    clickLayer.onpointerdown = (e) => {
        const rect = root.getElementById('root').getBoundingClientRect();
        const [mx, my] = this.getMousePos(e, rect);
        
        const radarData = this.state.data[this.state.radar] || {};
        const polygons = radarData[this.state.type] || [];
        
        let hitFound = false;
        
        // 判断点击位置是否靠近某个点
        // 判定阈值设为 2.5% 左右，适配手指操作
        const hitThreshold = 2.5; 

        for (let i = 0; i < polygons.length; i++) {
            for (let j = 0; j < polygons[i].length; j++) {
                const [px, py] = polygons[i][j];
                // 距离判断
                if (Math.abs(px - mx) < hitThreshold && Math.abs(py - my) < hitThreshold) {
                    this.dragState = { isDragging: true, polyIndex: i, pointIndex: j };
                    clickLayer.setPointerCapture(e.pointerId);
                    hitFound = true;
                    this.draw(); 
                    break;
                }
            }
            if (hitFound) break;
        }

        if (!hitFound) {
            this.state.points.push([mx, my]);
            this.draw();
        }
    };

    clickLayer.onpointermove = (e) => {
        if (this.dragState.isDragging) {
            const rect = root.getElementById('root').getBoundingClientRect();
            const [mx, my] = this.getMousePos(e, rect);
            const radarData = this.state.data[this.state.radar];
            if (radarData && radarData[this.state.type]) {
                radarData[this.state.type][this.dragState.polyIndex][this.dragState.pointIndex] = [mx, my];
                this.draw(); 
            }
        }
    };

    clickLayer.onpointerup = (e) => {
        if (this.dragState.isDragging) {
            this.dragState.isDragging = false;
            clickLayer.releasePointerCapture(e.pointerId);
            this.draw();
            this.saveToBackend(); 
        }
    };

    const selRadar = root.getElementById('sel-radar');
    selRadar.onchange = (e) => { this.state.radar = e.target.value; this.state.points=[]; this.draw(); };
    root.getElementById('sel-type').onchange = (e) => { this.state.type = e.target.value; this.state.points=[]; this.draw(); };
    
    root.getElementById('btn-undo').onclick = () => { this.state.points.pop(); this.draw(); };
    
    root.getElementById('btn-reset').onclick = () => {
        if(confirm("DANGER: WIPE ALL DATA?")) {
            this._hass.callService('radar_zone_manager', 'hard_reset_radar');
            this.state.data = {}; this.state.points = []; this.draw(); this.updateStatusText();
            setTimeout(() => this.checkConnection(), 1000);
        }
    };

    root.getElementById('btn-clear').onclick = () => {
        if(confirm(`Clear ALL ${this.state.type} for ${this.state.radar}?`)) {
            if(this.state.data[this.state.radar]) {
                this.state.data[this.state.radar][this.state.type] = [];
                this.saveToBackend();
            }
            this.state.points=[]; 
            this.draw();
        }
    };

    root.getElementById('btn-save').onclick = () => {
        if (this.state.points.length < 3) return;
        if (!this.state.data[this.state.radar]) this.state.data[this.state.radar] = {};
        if (!this.state.data[this.state.radar][this.state.type]) this.state.data[this.state.radar][this.state.type] = [];
        this.state.data[this.state.radar][this.state.type].push(this.state.points);
        this.state.points = [];
        this.saveToBackend();
        this.draw();
    };
  }

  saveToBackend() {
      const finalData = this.state.data[this.state.radar][this.state.type];
      this._hass.callService('radar_zone_manager', 'update_radar_zone', {
          radar_name: this.state.radar,
          zone_type: this.state.type,
          points: finalData 
      });
      const txt = this.shadowRoot.getElementById('stat-txt');
      if(txt) { txt.innerText = "Synced"; txt.style.color = "lime"; }
  }

  draw() {
    const svg = this.shadowRoot.getElementById('svg-canvas');
    let html = '';
    const rData = this.state.data[this.state.radar] || {};
    
    // --- 读取自定义 dot_size 参数，默认 4px ---
    const dotSize = this.config.dot_size || 4;

    const drawPoly = (pts, col, dash, polyIndex) => {
        const ptsStr = pts.map(p=>p.join(',')).join(' ');
        let el = `<polygon points="${ptsStr}" style="fill:${dash?'none':`rgba(${col==='lime'?'0,255,0':'255,0,0'},0.2)`}; stroke:${col}; stroke-width:0.5; stroke-dasharray:${dash?'2,2':0}" />`;
        
        const isCurrentType = (this.state.type === 'include_zones' && col === 'lime') || (this.state.type === 'exclude_zones' && col === 'red');
        
        if (isCurrentType) {
            pts.forEach((p, pointIndex) => {
                const isDraggingThis = this.dragState.isDragging && this.dragState.polyIndex === polyIndex && this.dragState.pointIndex === pointIndex;
                // 使用 dotSize 变量设置半径 r
                el += `<circle cx="${p[0]}" cy="${p[1]}" r="${isDraggingThis ? dotSize+2 : dotSize}" class="handle ${isDraggingThis?'dragging':''}" />`;
            });
        }
        return el;
    };
    
    const refT = this.state.type==='include_zones'?'exclude_zones':'include_zones';
    if(rData[refT]) rData[refT].forEach((p, idx) => html += drawPoly(p, refT==='include_zones'?'lime':'red', true, idx));
    if(rData[this.state.type]) rData[this.state.type].forEach((p, idx) => html += drawPoly(p, this.state.type==='include_zones'?'lime':'red', false, idx));
    
    if(this.state.points.length > 0) {
        html += `<polyline points="${this.state.points.map(p=>p.join(',')).join(' ')}" style="fill:none; stroke:magenta; stroke-width:1;" />` + 
                this.state.points.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="${dotSize}" fill="white" fill-opacity="0.5" stroke="white" stroke-width="1" />`).join('');
    }
    
    svg.innerHTML = html;
    
    const layer = this.shadowRoot.getElementById('dots-layer');
    layer.innerHTML = '';
    const targetSize = this.config.target_size || 16;
    const showNumber = this.config.show_number !== false;

    this.config.radars.forEach(r => {
        const d = this.state.data[r.name] || {};
        const getP = (k, def) => { const s = this._hass.states[`input_number.${r.name}_${k}`]; return s?parseFloat(s.state):(r[k]||def); };
        const cfg = { origin_x: getP('origin_x',50), origin_y: getP('origin_y',50), scale_x: getP('scale_x',5), scale_y: getP('scale_y',5), scale_z: getP('scale_z',0), angle: getP('angle',0), flip: getP('flip',1) };
        const count = r.target_count || 3;
        for(let i=1; i<=count; i++) {
             const xs = this._hass.states[`sensor.${r.name}_target_${i}_x`];
             const ys = this._hass.states[`sensor.${r.name}_target_${i}_y`];
             let raw = null;
             if (xs && ys && xs.state!=='unavailable') raw = {x:parseFloat(xs.state), y:parseFloat(ys.state), z:0};
             else if (i === 1) {
                 const dist = this._hass.states[`sensor.${r.name}_distance`];
                 if (dist && !isNaN(dist.state)) {
                     let val = parseFloat(dist.state);
                     const u = (dist.attributes.unit_of_measurement||'').toLowerCase().trim();
                     if (u === 'm') val *= 1000; else if (u === 'cm') val *= 10; else if (!u && val < 20) val *= 1000; 
                     raw = {x: 0, y: val, z: 0};
                 }
             }
             if (raw) {
                 const res = this.engine.calculate(cfg, raw);
                 if (res.active) {
                     let show = true;
                     const pt = {x:parseFloat(res.left), y:parseFloat(res.top)};
                     if (d.include_zones && d.include_zones.length > 0) { let inZ=false; d.include_zones.forEach(z=>{if(this.engine.isPointInPolygon(pt,z))inZ=true}); if(!inZ) show=false; }
                     if (d.exclude_zones && d.exclude_zones.length > 0) { d.exclude_zones.forEach(z=>{if(this.engine.isPointInPolygon(pt,z))show=false}); }
                     if (show) {
                         const dot = document.createElement('div'); dot.className = 'dot'; 
                         dot.style.width = `${targetSize}px`; dot.style.height = `${targetSize}px`;
                         if(showNumber) dot.innerText = i;
                         dot.style.background = ['lime','red','cyan'][i-1]||'white'; dot.style.left = res.left+'%'; dot.style.top = res.top+'%';
                         layer.appendChild(dot);
                     }
                 }
             }
        }
    });
  }

  set hass(hass) {
    this._hass = hass;
    if(!this.isCreated) return;
    const editEnt = this.config.editor_entity || 'input_boolean.radar_edit_mode';
    const isEdit = hass.states[editEnt]?.state === 'on';
    
    if (isEdit !== this.state.editing) {
        this.state.editing = isEdit;
        const ui = this.shadowRoot.getElementById('edit-ui');
        if (isEdit) {
            ui.classList.add('show');
            const sel = this.shadowRoot.getElementById('sel-radar');
            sel.innerHTML = '';
            const keys = new Set(this.config.radars.map(r=>r.name));
            Object.keys(this.state.data).forEach(k => keys.add(k));
            keys.forEach(k => sel.add(new Option(k, k)));
            if (sel.options.length > 0) {
                if (!this.state.radar || !keys.has(this.state.radar)) this.state.radar = sel.options[0].value;
                sel.value = this.state.radar;
                this.draw();
            }
            this.updateStatusText();
            this.checkConnection();
        } else { ui.classList.remove('show'); this.state.points = []; }
    }
    const ent = hass.states['sensor.radar_zone_manager'];
    if (ent && ent.attributes.data_json && ent.attributes.last_updated !== this.state.ts) {
        this.state.ts = ent.attributes.last_updated;
        try {
            const remote = JSON.parse(ent.attributes.data_json);
            if (!this.dragState.isDragging && Object.keys(remote).length >= 0) {
                this.state.data = remote;
                if(this.state.editing) { this.draw(); this.updateStatusText(); }
            }
        } catch(e) {}
    }
    if (this.state.editing) return;
    this.draw(); 
  }
}
customElements.define('radar-map-card', RadarMapCardNative);