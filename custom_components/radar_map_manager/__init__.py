import logging
import os
import json
import voluptuous as vol
from datetime import timedelta

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.components.http import StaticPathConfig
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import discovery

from .coordinator import RadarCoordinator
from .processor import RadarProcessor
from .const import DOMAIN, CONF_RADARS

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema({
    DOMAIN: vol.Schema({
        vol.Optional(CONF_RADARS, default=[]): vol.All(cv.ensure_list, [cv.string]),
    })
}, extra=vol.ALLOW_EXTRA)

ADD_RADAR_SCHEMA = vol.Schema({
    vol.Required("radar_name"): cv.string,
    vol.Optional("map_group", default="default"): cv.string,
})
REMOVE_RADAR_SCHEMA = vol.Schema({vol.Required("radar_name"): cv.string})
UPDATE_ZONE_SCHEMA = vol.Schema({
    vol.Optional("radar_name"): vol.Any(cv.string, None),
    vol.Required("zone_type"): cv.string,
    vol.Required("points"): cv.match_all, 
    vol.Optional("delay"): vol.Coerce(float),
    vol.Optional("name"): cv.string,
    vol.Optional("map_group"): cv.string,
})
UPDATE_LAYOUT_SCHEMA = vol.Schema({
    vol.Required("radar_name"): cv.string,
    vol.Required("layout"): dict,
    vol.Optional("map_group"): cv.string,
})
UPDATE_GLOBAL_CONFIG_SCHEMA = vol.Schema({
    vol.Optional("update_interval"): vol.Coerce(float),
    vol.Optional("merge_distance"): vol.Coerce(float),
    vol.Optional("target_height"): vol.Coerce(float),
    vol.Optional("fused_color"): cv.string,
})

async def async_setup(hass: HomeAssistant, config: dict):
    hass.data.setdefault(DOMAIN, {})

    www_dir = hass.config.path("custom_components/radar_map_manager/www")
    if os.path.isdir(www_dir):
        await hass.http.async_register_static_paths([
            StaticPathConfig("/radar_map_manager", www_dir, cache_headers=False)
        ])

    coordinator = RadarCoordinator(hass)
    await coordinator.async_load()
    
    processor = RadarProcessor(hass, coordinator)

    hass.data[DOMAIN]["coordinator"] = coordinator
    hass.data[DOMAIN]["processor"] = processor
    hass.data[DOMAIN]["timer_remove"] = None

    for platform in ["sensor", "binary_sensor"]:
        hass.async_create_task(
            discovery.async_load_platform(hass, platform, DOMAIN, {}, config)
        )

    def start_processing_loop(interval_sec):
        if hass.data[DOMAIN]["timer_remove"]:
            hass.data[DOMAIN]["timer_remove"]()
            hass.data[DOMAIN]["timer_remove"] = None
            _LOGGER.debug("RMM: Stopped previous update timer.")

        safe_interval = max(0.1, float(interval_sec))
        
        _LOGGER.info(f"RMM: Starting processor loop with interval: {safe_interval}s")
        hass.data[DOMAIN]["timer_remove"] = async_track_time_interval(
            hass, 
            processor.update, 
            timedelta(seconds=safe_interval)
        )

    async def handle_add_radar(call: ServiceCall):
        radar_name = call.data["radar_name"]
        map_group = call.data.get("map_group", "default")
        await coordinator.async_add_radar(radar_name, map_group)
        await processor.update(force=True)

    async def handle_remove_radar(call: ServiceCall):
        radar_name = call.data["radar_name"]
        await coordinator.async_remove_radar(radar_name)
        await processor.update(force=True)

    async def handle_update_radar_zone(call: ServiceCall):
        radar_name = call.data.get("radar_name")
        zone_type = call.data["zone_type"]
        points = call.data["points"]
        delay = call.data.get("delay", 0)
        name = call.data.get("name", "New Zone")
        map_group = call.data.get("map_group")
        
        zone_data = {"points": points, "delay": delay, "name": name}
        await coordinator.async_update_zone(radar_name, zone_type, zone_data, map_group)
        await processor.update(force=True)

    async def handle_update_radar_layout(call: ServiceCall):
        radar_name = call.data["radar_name"]
        layout = call.data["layout"]
        map_group = call.data.get("map_group")
        await coordinator.async_update_layout(radar_name, layout, map_group)
        await processor.update(force=True)

    async def handle_generate_config(call: ServiceCall):
        await processor.update(force=True)

    async def handle_update_global_config(call: ServiceCall):
        await coordinator.async_update_global_config(call.data)
        if "update_interval" in call.data:
            start_processing_loop(float(call.data["update_interval"]))
        await processor.update(force=True)

    async def handle_import_config(call: ServiceCall):
        try:
            json_str = call.data["config_json"]
            new_data = json.loads(json_str)
            if "radars" not in new_data or "maps" not in new_data:
                raise ValueError("Invalid JSON format")
            
            coordinator.data = new_data
            await coordinator.async_save()
            saved_interval = new_data.get("global_config", {}).get("update_interval", 0.1)
            start_processing_loop(saved_interval)
            await processor.update(force=True)
        except Exception as e:
            _LOGGER.error(f"RMM: Import failed: {e}")

    hass.services.async_register(DOMAIN, "add_radar", handle_add_radar, schema=ADD_RADAR_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_radar", handle_remove_radar, schema=REMOVE_RADAR_SCHEMA)
    hass.services.async_register(DOMAIN, "update_radar_zone", handle_update_radar_zone, schema=UPDATE_ZONE_SCHEMA)
    hass.services.async_register(DOMAIN, "update_radar_layout", handle_update_radar_layout, schema=UPDATE_LAYOUT_SCHEMA)
    hass.services.async_register(DOMAIN, "generate_radar_config", handle_generate_config)
    hass.services.async_register(DOMAIN, "update_global_config", handle_update_global_config, schema=UPDATE_GLOBAL_CONFIG_SCHEMA)
    hass.services.async_register(DOMAIN, "import_config", handle_import_config)

    await processor.async_start()
    
    async def initial_startup(event):
        saved_config = coordinator.data.get("global_config", {})
        interval = float(saved_config.get("update_interval", 0.1))
        start_processing_loop(interval)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, initial_startup)

    return True