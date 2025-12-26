"""Support for Home Maintenance buttons."""

import logging
from datetime import datetime, timedelta

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from . import const

_LOGGER = logging.getLogger(__name__)

# Store pending confirmations: {task_id: timestamp}
_pending_confirmations: dict[str, datetime] = {}
# Store confirmed tasks temporarily to show confirmation icon
_confirmed_tasks: dict[str, datetime] = {}
# Store timers for auto-reset: {task_id: timer_handle}
_reset_timers: dict[str, object] = {}
CONFIRMATION_TIMEOUT = timedelta(seconds=5)  # Max time between first and second press
CONFIRMED_DISPLAY_TIME = timedelta(seconds=3)  # How long to show confirmed icon


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,  # noqa: ARG001
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Home Maintenance button platform."""
    if const.DOMAIN not in hass.data:
        hass.data[const.DOMAIN] = {}
    hass.data[const.DOMAIN]["add_button_entities"] = async_add_entities

    device_id = hass.data[const.DOMAIN].get("device_id")
    store = hass.data[const.DOMAIN].get("store")

    entities = []
    for task in store.get_all():
        entity = HomeMaintenanceButton(hass, task, device_id)
        entities.append(entity)
        hass.data[const.DOMAIN].setdefault("button_entities", {})
        hass.data[const.DOMAIN]["button_entities"][task["id"]] = entity

    async_add_entities(entities)


class HomeMaintenanceButton(ButtonEntity):
    """Representation of a Home Maintenance button."""

    def __init__(
        self,
        hass: HomeAssistant,
        task: dict,
        device_id: str,
        labels: list[str] | None = None,
    ) -> None:
        """Initialize the Home Maintenance button."""
        self.hass = hass
        self.task = task
        self._attr_name = f"{task['title']} - Confirm"
        self._attr_unique_id = f"{task['id']}_button"
        self._device_id = device_id
        self._labels = labels or []
        self._attr_device_class = "restart"

    @property
    def device_info(self) -> DeviceInfo | None:
        """Return device information for this button."""
        return DeviceInfo(
            identifiers={(const.DOMAIN, const.DEVICE_KEY)},
            name=const.NAME,
            model=const.NAME,
            sw_version=const.VERSION,
            manufacturer=const.MANUFACTURER,
        )

    @property
    def icon(self) -> str | None:
        """Return the icon for the button - changes based on confirmation state."""
        task_id = self.task["id"]
        now = dt_util.now()
        
        # Check if just confirmed (show confirmation icon briefly)
        if task_id in _confirmed_tasks:
            confirmed_time = _confirmed_tasks[task_id]
            if now - confirmed_time <= CONFIRMED_DISPLAY_TIME:
                return "mdi:check-circle"
            else:
                # Remove from confirmed list after display time
                del _confirmed_tasks[task_id]
        
        # Check if waiting for second press
        if task_id in _pending_confirmations:
            # First press done, waiting for second - show warning icon
            return "mdi:alert-circle"
        
        # Normal state - show check icon
        return "mdi:check-circle-outline"

    async def async_press(self) -> None:
        """Handle the button press with double confirmation (within 5 seconds)."""
        task_id = self.task["id"]
        task_title = self.task.get("title", "this task")
        now = dt_util.now()
        
        # Check if there's a pending first confirmation
        if task_id in _pending_confirmations:
            first_press_time = _pending_confirmations[task_id]
            # Check if second press is within timeout
            if now - first_press_time <= CONFIRMATION_TIMEOUT:
                # Second confirmation received within timeout - CONFIRM!
                del _pending_confirmations[task_id]
                # Cancel the reset timer since we got the second press
                if task_id in _reset_timers:
                    _reset_timers[task_id].cancel()
                    del _reset_timers[task_id]
                # Mark as confirmed to show confirmation icon
                _confirmed_tasks[task_id] = now
                
                # Update icon by triggering state update
                self.async_write_ha_state()
                
                # Update the task
                store = self.hass.data[const.DOMAIN].get("store")
                if store:
                    # Get current odometer if this is a km-based task
                    performed_odometer = None
                    if self.task.get("interval_type") in ("kilometers", "miles"):
                        odometer_entity = self.task.get("odometer_entity")
                        if odometer_entity:
                            try:
                                state = self.hass.states.get(odometer_entity)
                                if state and state.state not in ("unknown", "unavailable", None):
                                    performed_odometer = float(state.state)
                            except (ValueError, TypeError, AttributeError):
                                pass
                    
                    store.update_last_performed(task_id, performed_odometer=performed_odometer)
                    _LOGGER.info("Maintenance confirmed (double confirmation) for task: %s", task_title)
                    
                    # Schedule icon reset after display time
                    async def reset_icon():
                        await self.hass.async_add_executor_job(lambda: None)
                        await self.async_update_ha_state()
                    
                    # Use a timer to reset icon after display time
                    self.hass.loop.call_later(
                        CONFIRMED_DISPLAY_TIME.total_seconds(),
                        lambda: self.async_write_ha_state()
                    )
                else:
                    _LOGGER.error("Store not available for task: %s", task_title)
            else:
                # First confirmation expired, start over
                # Cancel any existing timer
                if task_id in _reset_timers:
                    _reset_timers[task_id].cancel()
                    del _reset_timers[task_id]
                _pending_confirmations[task_id] = now
                # Update icon by triggering state update
                self.async_write_ha_state()
                _LOGGER.info("First confirmation expired, restarting for task: %s", task_title)
                
                # Schedule automatic reset if second press doesn't come
                def reset_icon():
                    """Reset icon after timeout."""
                    if task_id in _pending_confirmations:
                        del _pending_confirmations[task_id]
                        if task_id in _reset_timers:
                            del _reset_timers[task_id]
                        # Update icon by triggering state update
                        if task_id in self.hass.data[const.DOMAIN].get("button_entities", {}):
                            self.hass.data[const.DOMAIN]["button_entities"][task_id].async_write_ha_state()
                        _LOGGER.info("Icon auto-reset after timeout for task: %s", task_title)
                
                # Schedule new timer
                timer = self.hass.loop.call_later(
                    CONFIRMATION_TIMEOUT.total_seconds(),
                    reset_icon
                )
                _reset_timers[task_id] = timer
        else:
            # First press - store timestamp
            _pending_confirmations[task_id] = now
            # Update icon by triggering state update
            self.async_write_ha_state()
            _LOGGER.info("First confirmation for task: %s", task_title)
            
            # Schedule automatic reset if second press doesn't come
            def reset_icon():
                """Reset icon after timeout."""
                if task_id in _pending_confirmations:
                    del _pending_confirmations[task_id]
                    if task_id in _reset_timers:
                        del _reset_timers[task_id]
                    # Update icon by triggering state update
                    if task_id in self.hass.data[const.DOMAIN].get("button_entities", {}):
                        self.hass.data[const.DOMAIN]["button_entities"][task_id].async_write_ha_state()
                    _LOGGER.info("Icon auto-reset after timeout for task: %s", task_title)
            
            # Cancel any existing timer for this task
            if task_id in _reset_timers:
                _reset_timers[task_id].cancel()
            
            # Schedule new timer
            timer = self.hass.loop.call_later(
                CONFIRMATION_TIMEOUT.total_seconds(),
                reset_icon
            )
            _reset_timers[task_id] = timer
        
        # Clean up expired confirmations (this is a backup, timers should handle it)
        expired = [
            tid for tid, timestamp in _pending_confirmations.items()
            if now - timestamp > CONFIRMATION_TIMEOUT
        ]
        for tid in expired:
            del _pending_confirmations[tid]
            # Cancel timer if exists
            if tid in _reset_timers:
                _reset_timers[tid].cancel()
                del _reset_timers[tid]
            # Update icon for expired confirmations
            if tid in self.hass.data[const.DOMAIN].get("button_entities", {}):
                self.hass.data[const.DOMAIN]["button_entities"][tid].async_write_ha_state()
        
        # Clean up expired confirmed tasks
        expired_confirmed = [
            tid for tid, timestamp in _confirmed_tasks.items()
            if now - timestamp > CONFIRMED_DISPLAY_TIME
        ]
        for tid in expired_confirmed:
            del _confirmed_tasks[tid]

    async def async_added_to_hass(self) -> None:
        """Run when entity is added to Home Assistant."""
        if self._labels:
            registry = er.async_get(self.hass)
            if registry.async_get(self.entity_id):
                registry.async_update_entity(self.entity_id, labels=set(self._labels))

