"""Websocket commands for the Home Maintenance integration."""

import uuid
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.websocket_api import connection, messages
from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .store import HomeMaintenanceTask


@callback
def websocket_get_tasks(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Get all tasks."""
    store = hass.data[DOMAIN].get("store")
    entities = hass.data[DOMAIN].get("entities", {})
    tasks = store.get_all()
    
    # Enrich tasks with entity attributes (like next_due_odometer, current_odometer)
    for task in tasks:
        task_id = task["id"]
        entity = entities.get(task_id)
        if entity:
            # Get entity state and attributes
            entity_id = entity.entity_id
            state = hass.states.get(entity_id)
            if state:
                attrs = state.attributes
                # Add relevant attributes to task
                if "next_due_odometer" in attrs and attrs["next_due_odometer"] is not None:
                    task["next_due_odometer"] = attrs["next_due_odometer"]
                if "current_odometer" in attrs and attrs["current_odometer"] is not None:
                    task["current_odometer"] = attrs["current_odometer"]
                if "next_due" in attrs:
                    task["next_due"] = attrs["next_due"]
    
    connection.send_result(msg["id"], tasks)


@callback
def websocket_get_task(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Get single task."""
    store = hass.data[DOMAIN].get("store")
    entities = hass.data[DOMAIN].get("entities", {})
    task_id = msg["task_id"]
    result = store.get(task_id)
    
    # Enrich task with entity attributes
    entity = entities.get(task_id)
    if entity:
        entity_id = entity.entity_id
        state = hass.states.get(entity_id)
        if state:
            attrs = state.attributes
            if "next_due_odometer" in attrs and attrs["next_due_odometer"] is not None:
                result["next_due_odometer"] = attrs["next_due_odometer"]
            if "current_odometer" in attrs and attrs["current_odometer"] is not None:
                result["current_odometer"] = attrs["current_odometer"]
            if "next_due" in attrs:
                result["next_due"] = attrs["next_due"]
    
    connection.send_result(msg["id"], result)


@callback
def websocket_add_task(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Add a new task."""
    store = hass.data[DOMAIN].get("store")

    last_str = msg["last_performed"]
    if last_str:
        parsed = dt_util.parse_datetime(last_str)
        if parsed is None:
            connection.send_error(
                msg["id"], "invalid_date", f"Could not parse date: {last_str}"
            )
            return
        parsed_local = dt_util.as_local(parsed)
        last_performed = parsed_local.replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()
    else:
        last_performed = (
            dt_util.now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        )

    new_task = HomeMaintenanceTask(
        id=f"home_maintenance_{uuid.uuid4().hex}",
        title=msg["title"],
        interval_value=msg["interval_value"],
        interval_type=msg["interval_type"],
        last_performed=last_performed,
        tag_id=msg.get("tag_id"),
        icon=msg.get("icon"),
        last_odometer=msg.get("last_odometer"),
        odometer_entity=msg.get("odometer_entity"),
        category=msg.get("category"),
        item_name=msg.get("item_name"),
    )

    labels = msg.get("labels", [])
    new_id = store.add(new_task, labels)
    connection.send_result(msg["id"], {"success": True, "id": new_id})


@callback
def websocket_update_task(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Update a tasks values."""
    store = hass.data[DOMAIN].get("store")
    task_id = msg["task_id"]
    updates = msg.get("updates", {})

    last_str = updates["last_performed"]
    if last_str:
        parsed = dt_util.parse_datetime(last_str)
        if parsed is None:
            connection.send_error(
                msg["id"], "invalid_date", f"Could not parse date: {last_str}"
            )
            return
        parsed_local = dt_util.as_local(parsed)
        last_performed = parsed_local.replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()
    else:
        last_performed = (
            dt_util.now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        )
    updates["last_performed"] = last_performed

    store.update_task(task_id, updates)
    connection.send_result(msg["id"], {"success": True})


@callback
def websocket_complete_task(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Mark a task as completed."""
    store = hass.data[DOMAIN].get("store")
    task_id = msg["task_id"]
    performed_odometer = msg.get("performed_odometer")
    store.update_last_performed(task_id, performed_odometer=performed_odometer)
    connection.send_result(msg["id"], {"success": True})


@callback
def websocket_remove_task(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Remove a task."""
    store = hass.data[DOMAIN].get("store")
    task_id = msg["task_id"]
    store.delete(task_id)
    connection.send_result(msg["id"], {"success": True})


@callback
def websocket_get_config(
    hass: HomeAssistant, connection: connection.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Retrieve integration configuration."""
    entries = hass.config_entries.async_entries(DOMAIN)

    if not entries:
        connection.send_error(
            msg["id"], "not_found", "No config entry found for your_domain"
        )
        return

    entry = entries[0]

    connection.send_result(
        msg["id"],
        {
            "data": dict(entry.data),
            "options": dict(entry.options),
        },
    )


async def async_register_websockets(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(
        hass,
        "home_maintenance/get_tasks",
        websocket_get_tasks,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {vol.Required("type"): "home_maintenance/get_tasks"}
        ),
    )

    websocket_api.async_register_command(
        hass,
        "home_maintenance/get_task",
        websocket_get_task,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {
                vol.Required("type"): "home_maintenance/get_task",
                vol.Required("task_id"): str,
            }
        ),
    )

    websocket_api.async_register_command(
        hass,
        "home_maintenance/add_task",
        websocket_add_task,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {
                vol.Required("type"): "home_maintenance/add_task",
                vol.Required("title"): str,
                vol.Required("interval_value"): int,
                vol.Required("interval_type"): str,
                vol.Optional("last_performed"): str,
                vol.Optional("tag_id"): str,
                vol.Optional("icon"): str,
                vol.Optional("labels"): [str],
                vol.Optional("last_odometer"): vol.Any(float, int),
                vol.Optional("odometer_entity"): str,
                vol.Optional("category"): str,
                vol.Optional("item_name"): str,
            }
        ),
    )

    websocket_api.async_register_command(
        hass,
        "home_maintenance/update_task",
        websocket_update_task,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {
                vol.Required("type"): "home_maintenance/update_task",
                vol.Required("task_id"): str,
                vol.Required("updates"): dict,
            }
        ),
    )

    websocket_api.async_register_command(
        hass,
        "home_maintenance/complete_task",
        websocket_complete_task,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {
                vol.Required("type"): "home_maintenance/complete_task",
                vol.Required("task_id"): str,
                vol.Optional("performed_odometer"): vol.Any(float, int),
            }
        ),
    )

    websocket_api.async_register_command(
        hass,
        "home_maintenance/remove_task",
        websocket_remove_task,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {
                vol.Required("type"): "home_maintenance/remove_task",
                vol.Required("task_id"): str,
            }
        ),
    )

    websocket_api.async_register_command(
        hass,
        "home_maintenance/get_config",
        websocket_get_config,
        messages.BASE_COMMAND_MESSAGE_SCHEMA.extend(
            {
                vol.Required("type"): "home_maintenance/get_config",
            }
        ),
    )
