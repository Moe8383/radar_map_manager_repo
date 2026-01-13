"""Radar Zone Manager Native Integration."""
import json
import os
import time
import logging
from homeassistant.core import HomeAssistant, ServiceCall, Event
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.components.http import StaticPathConfig

_LOGGER = logging.getLogger(__name__)

DOMAIN = "radar_zone_manager"
ENTITY_ID = "sensor.radar_zone_manager"
FILE_NAME = "radar_database.json"

# 定义前端文件的 URL 和 本地路径
WEB_URL = "/radar_zone_manager_static/radar-map-card.js"
LOCAL_PATH = "custom_components/radar_zone_manager/www/radar-map-card.js"

async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the integration."""
    
    # ------------------------------------------------------------------
    # 1. 静态文件映射
    # ------------------------------------------------------------------
    js_path = hass.config.path(LOCAL_PATH)
    
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            url_path=WEB_URL,
            path=js_path,
            cache_headers=False
        )
    ])

    # ------------------------------------------------------------------
    # 2. 自动注册 Lovelace 资源 (修复线程安全问题)
    # ------------------------------------------------------------------
    # [FIX] 增加 event 参数，让它成为一个标准的事件回调函数
    async def register_resource(event: Event):
        resources = hass.data.get("lovelace", {}).get("resources")
        if not resources: return
        
        if not resources.async_items():
            await resources.async_load()
            
        for resource in resources.async_items():
            if resource["url"] == WEB_URL:
                return

        _LOGGER.info("Registering Lovelace resource: %s", WEB_URL)
        await resources.async_create_item({
            "res_type": "module",
            "url": WEB_URL,
        })

    # [FIX] 直接传递 async 函数，不要用 lambda 包裹
    # HA 会自动在事件循环中调度它，不再报 threading 错误
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, register_resource)

    # ==================================================================
    # 核心业务逻辑
    # ==================================================================
    file_path = hass.config.path(FILE_NAME)

    def _io_read():
        if not os.path.exists(file_path): return {}
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                c = f.read().strip()
                return json.loads(c) if c else {}
        except: return {}

    def _io_write(data):
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            return True
        except: return False

    def _push_state(data, source="unknown"):
        ts = str(time.time())
        if not isinstance(data, dict): data = {}
        try:
            hass.states.async_set(ENTITY_ID, ts, {
                "data_json": json.dumps(data),
                "radar_count": len(data),
                "last_source": source,
                "friendly_name": "Radar Manager Native",
                "icon": "mdi:radar"
            })
        except Exception as e: _LOGGER.error(f"Push error: {e}")

    async def _get_best_data():
        mem_data = {}
        curr = hass.states.get(ENTITY_ID)
        if curr and "data_json" in curr.attributes:
            try: mem_data = json.loads(curr.attributes["data_json"])
            except: pass
        
        disk_data = await hass.async_add_executor_job(_io_read)
        if disk_data: return disk_data
        if mem_data: return mem_data
        return {}

    async def handle_update(call: ServiceCall):
        d = call.data
        data = await _get_best_data()
        if d.get("radar_name"):
            if d["radar_name"] not in data: data[d["radar_name"]] = {}
            data[d["radar_name"]][d["zone_type"]] = d["points"]
            _push_state(data, "update")
            await hass.async_add_executor_job(_io_write, data)

    async def handle_refresh(call):
        data = await hass.async_add_executor_job(_io_read)
        if not data:
            mem = await _get_best_data()
            if mem: data = mem
        _push_state(data, "refresh")

    async def handle_reset(call):
        dummy = {"rd_default": {"include_zones":[], "exclude_zones":[]}}
        await hass.async_add_executor_job(_io_write, dummy)
        _push_state(dummy, "hard_reset")

    hass.services.async_register(DOMAIN, "update_radar_zone", handle_update)
    hass.services.async_register(DOMAIN, "refresh_radar_data", handle_refresh)
    hass.services.async_register(DOMAIN, "hard_reset_radar", handle_reset)

    async def startup(_): await handle_refresh(None)
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, startup)

    return True