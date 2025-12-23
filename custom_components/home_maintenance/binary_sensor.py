"""Support for Home Maintenance binary sensors."""

import logging
from datetime import datetime, timedelta

from dateutil.relativedelta import relativedelta
from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from . import const

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,  # noqa: ARG001
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Home Maintenance binary sensor platform."""
    if const.DOMAIN not in hass.data:
        hass.data[const.DOMAIN] = {}
    hass.data[const.DOMAIN]["add_entities"] = async_add_entities

    device_id = hass.data[const.DOMAIN].get("device_id")
    store = hass.data[const.DOMAIN].get("store")

    entities = []
    for task in store.get_all():
        entity = HomeMaintenanceSensor(hass, task, device_id)
        entities.append(entity)
        hass.data[const.DOMAIN]["entities"][task["id"]] = entity

    async_add_entities(entities)


class HomeMaintenanceSensor(BinarySensorEntity):
    """Representation of a Home Maintenance binary sensor."""

    def __init__(
        self,
        hass: HomeAssistant,
        task: dict,
        device_id: str,
        labels: list[str] | None = None,
    ) -> None:
        """Initialize the Home Maintenance sensor."""
        self.hass = hass
        self.task = task
        self._attr_name = task["title"]
        self._attr_unique_id = f"{task['id']}"
        self._device_id = device_id
        self._labels = labels or []
        self._update_state()

    @property
    def device_info(self) -> DeviceInfo | None:
        """Return device information for this sensor."""
        return DeviceInfo(
            identifiers={(const.DOMAIN, const.DEVICE_KEY)},
            name=const.NAME,
            model=const.NAME,
            sw_version=const.VERSION,
            manufacturer=const.MANUFACTURER,
        )

    @property
    def icon(self) -> str | None:
        """Return the icon for the task."""
        return self.task.get("icon", "mdi:calendar-check")

    def _calculate_next_due_date(
        self, last_performed: datetime, interval_value: int, interval_type: str
    ) -> datetime | None:
        """Calculate the next date based on last date and interval. Returns None for km-based intervals."""
        if interval_type in ("kilometers", "miles"):
            return None
        if interval_type == "days":
            return last_performed + timedelta(days=interval_value)
        if interval_type == "weeks":
            return last_performed + timedelta(weeks=interval_value)
        if interval_type == "months":
            return last_performed + relativedelta(months=interval_value)

        return last_performed

    def _calculate_next_due_odometer(
        self, last_odometer: float | None, interval_value: int, interval_type: str
    ) -> float | None:
        """Calculate the next odometer value based on last odometer and interval. Returns None for time-based intervals."""
        if interval_type not in ("kilometers", "miles"):
            return None
        if last_odometer is None:
            return None
        return last_odometer + interval_value

    def _get_current_odometer(self) -> float | None:
        """Get current odometer reading from entity if available."""
        odometer_entity = self.task.get("odometer_entity")
        if not odometer_entity:
            return None
        
        try:
            state = self.hass.states.get(odometer_entity)
            if state and state.state not in ("unknown", "unavailable", None):
                return float(state.state)
        except (ValueError, TypeError, AttributeError):
            pass
        return None

    def _update_state(self) -> None:
        """Get the latest state of the sensor."""
        interval_value = self.task["interval_value"]
        interval_type = self.task["interval_type"]
        is_km_based = interval_type in ("kilometers", "miles")
        
        # Initialize attributes
        self._attr_extra_state_attributes = {
            "interval_value": interval_value,
            "interval_type": interval_type,
        }
        
        if self.task.get("tag_id"):
            self._attr_extra_state_attributes["tag_id"] = self.task["tag_id"]
        
        # Handle km-based intervals
        if is_km_based:
            last_odometer = self.task.get("last_odometer")
            current_odometer = self._get_current_odometer()
            next_due_odometer = self._calculate_next_due_odometer(last_odometer, interval_value, interval_type)
            
            # Add odometer-related attributes
            self._attr_extra_state_attributes["last_odometer"] = last_odometer
            if current_odometer is not None:
                self._attr_extra_state_attributes["current_odometer"] = current_odometer
            if next_due_odometer is not None:
                self._attr_extra_state_attributes["next_due_odometer"] = next_due_odometer
            
            # Determine if task is due based on odometer
            if last_odometer is None or current_odometer is None:
                # Can't determine if due without odometer reading
                self._attr_is_on = False
                self._attr_extra_state_attributes["next_due"] = "unknown (odometer not available)"
            else:
                self._attr_is_on = current_odometer >= next_due_odometer
                self._attr_extra_state_attributes["next_due"] = f"{next_due_odometer:.0f} {interval_type}"
            
            # Still track last_performed date for reference
            self._attr_extra_state_attributes["last_performed"] = self.task.get("last_performed", "")
            
        # Handle time-based intervals
        else:
            last = dt_util.parse_datetime(self.task["last_performed"])
            if last is None:
                self._attr_is_on = True
                self._attr_extra_state_attributes["last_performed"] = self.task.get("last_performed", "")
                self._attr_extra_state_attributes["next_due"] = "unknown"
                return

            if last.tzinfo is None:
                last = dt_util.as_utc(last)

            due_date = self._calculate_next_due_date(last, interval_value, interval_type)
            if due_date is not None:
                due_date = due_date.replace(hour=0, minute=0, second=0, microsecond=0)
                self._attr_is_on = (
                    dt_util.now().replace(hour=0, minute=0, second=0, microsecond=0) >= due_date
                )
                self._attr_extra_state_attributes["next_due"] = due_date.isoformat()
            else:
                self._attr_is_on = False
                self._attr_extra_state_attributes["next_due"] = "unknown"
            
            self._attr_extra_state_attributes["last_performed"] = self.task["last_performed"]

    async def async_update(self) -> None:
        """Get the latest state of the sensor."""
        self._update_state()

    async def async_added_to_hass(self) -> None:
        """Run when entity is added to Home Assistant."""
        if self._labels:
            registry = er.async_get(self.hass)
            if registry.async_get(self.entity_id):
                registry.async_update_entity(self.entity_id, labels=set(self._labels))
