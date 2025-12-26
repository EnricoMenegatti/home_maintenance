import {
    mdiCheckCircleOutline,
    mdiDelete,
    mdiPencil,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { HomeAssistant } from "custom-card-helpers";
import { formatDateNumeric } from "custom-card-helpers";

import { localize } from '../localize/localize';
import { VERSION } from "./const";
import { loadConfigDashboard } from "./helpers";
import { commonStyle } from './styles'
import { EntityRegistryEntry, IntegrationConfig, IntervalType, INTERVAL_TYPES, getIntervalTypeLabels, Label, Task, Tag } from './types';
import { completeTask, getConfig, loadLabelRegistry, loadRegistryEntries, loadTags, loadTask, loadTasks, removeTask, saveTask, updateTask } from './data/websockets';

interface TaskFormData {
    title: string;
    interval_value: number | "";
    interval_type: string;
    last_performed: string;
    icon: string;
    label: string[];
    tag: string;
    last_odometer: number | "";
    odometer_entity: string;
    category: string;
    item_name: string;
}

export class HomeMaintenancePanel extends LitElement {
    @property() hass?: HomeAssistant;
    @property() narrow!: boolean;

    @state() private tags: Tag[] | null = null;
    @state() private tasks: Task[] = [];
    @state() private config: IntegrationConfig | null = null;
    @state() private registry: EntityRegistryEntry[] = [];
    @state() private labelRegistry: Label[] = [];

    // New Task form state
    @state() private _formData: TaskFormData = {
        title: "",
        interval_value: "",
        interval_type: "days",
        last_performed: "",
        icon: "",
        label: [],
        tag: "",
        last_odometer: "",
        odometer_entity: "",
        category: "",
        item_name: "",
    };
    private _advancedOpen: boolean = false;

    // Edit dialog state
    @state() private _editingTaskId: string | null = null;
    @state() private _editFormData: TaskFormData = {
        title: "",
        interval_value: "",
        interval_type: "days",
        last_performed: "",
        icon: "",
        label: [],
        tag: "",
        last_odometer: "",
        odometer_entity: "",
        category: "",
        item_name: "",
    };

    private get _columns() {
        return {
            icon: {
                title: "",
                moveable: false,
                showNarrow: false,
                label: "icon",
                type: "icon",
                template: (task: Task) =>
                    task.icon ? html`<ha-icon .icon=${task.icon}></ha-icon>` : nothing,
            },
            tagIcon: {
                title: "",
                moveable: false,
                showNarrow: false,
                label: "tag",
                type: "icon",
                template: (task: any) =>
                    task.tagIcon ? html`<ha-icon .icon=${task.tagIcon}></ha-icon>` : nothing,
            },
            title: {
                title: 'Title',
                main: true,
                showNarrow: true,
                sortable: true,
                filterable: true,
                grows: true,
                extraTemplate: (task: Task) => {
                    const entity = this.registry.find((entry) => entry.unique_id === task.id);
                    if (!entity) return nothing;

                    const labels = this.labelRegistry.filter((lr) => entity.labels.includes(lr.label_id));

                    return labels.length
                        ? html`<ha-data-table-labels .labels=${labels}></ha-data-table-labels>`
                        : nothing;
                },
            },
            category_item: {
                title: 'Category / Item',
                showNarrow: false,
                sortable: true,
                filterable: true,
                minWidth: "150px",
                maxWidth: "200px",
                template: (task: Task) => {
                    const parts: string[] = [];
                    if (task.category) parts.push(task.category);
                    if (task.item_name) parts.push(task.item_name);
                    return parts.length > 0 ? parts.join(' - ') : '-';
                }
            },
            interval_days: {
                title: 'Interval',
                showNarrow: false,
                sortable: true,
                minWidth: "100px",
                maxWidth: "150px",
                template: (task: Task) => {
                    const type = task.interval_type;
                    const isSingular = task.interval_value === 1;
                    let labelKey: string = type;
                    if (isSingular && (type === "days" || type === "weeks" || type === "months")) {
                        labelKey = type.slice(0, -1);
                    } else if (isSingular && type === "kilometers") {
                        labelKey = "kilometer";
                    } else if (isSingular && type === "miles") {
                        labelKey = "mile";
                    }
                    return `${task.interval_value} ${localize(`intervals.${labelKey}`, this.hass!.language)}`;
                }
            },
            last_performed: {
                title: 'Last Performed',
                showNarrow: false,
                sortable: true,
                minWidth: "150px",
                maxWidth: "200px",
                template: (task: any) => {
                    const isKmBased = task.interval_type === "kilometers" || task.interval_type === "miles";
                    
                    // If km-based, show only odometer reading
                    if (isKmBased && task.last_odometer != null) {
                        return `${task.last_odometer.toLocaleString()} ${task.interval_type === "kilometers" ? "km" : "mi"}`;
                    }
                    
                    // Otherwise show date (and odometer if available)
                    const parts: string[] = [];
                    if (task.last_performed && task.last_performed !== 'Never') {
                        const date = new Date(this.computeISODate(task.last_performed));
                        parts.push(formatDateNumeric(date, this.hass!.locale));
                    }
                    if (task.last_odometer != null && !isKmBased) {
                        parts.push(`${task.last_odometer.toLocaleString()} ${task.interval_type === "kilometers" ? "km" : "mi"}`);
                    }
                    return parts.length > 0 ? parts.join(' / ') : "-";
                }
            },
            next_due: {
                title: localize('panel.cards.current.next', this.hass!.language),
                showNarrow: true,
                sortable: true,
                direction: "asc",
                minWidth: "120px",
                maxWidth: "150px",
                template: (task: any) => {
                    if (task.next_due_type === "odometer") {
                        const isDue = task.is_due || false;
                        return html`
                            <span style=${isDue ? "color: var(--error-color, red); font-weight: bold;" : ""}>
                                ${task.next_due_odometer?.toLocaleString() || "—"} ${task.interval_type === "kilometers" ? "km" : "mi"}
                            </span>`;
                    } else {
                        const next = new Date(task.next_due);
                        const now = new Date();
                        const isDue = next <= now;
                        return html`
                            <span style=${isDue ? "color: var(--error-color, red); font-weight: bold;" : ""}>
                                ${formatDateNumeric(next, this.hass!.locale)}
                            </span>` || "—";
                    }
                },
            },
            edit: {
                title: "",
                minWidth: "64px",
                maxWidth: "64px",
                sortable: false,
                groupable: false,
                showNarrow: true,
                moveable: false,
                hideable: false,
                type: "overflow",
                template: (task: Task) => html`
                <ha-icon-button
                    @click=${() => this._handleOpenEditDialogClick(task.id)}
                    .label="Edit"
                    title="Edit Task"
                    .path=${mdiPencil}
                ></ha-icon-button>
              `,
            },
            complete: {
                title: "",
                minWidth: "64px",
                maxWidth: "64px",
                sortable: false,
                groupable: false,
                showNarrow: true,
                moveable: false,
                hideable: false,
                type: "overflow",
                template: (task: Task) => html`
                <ha-icon-button
                    @click=${() => this._handleCompleteTaskClick(task.id)}
                    .label="Complete"
                    title="Mark Task Complete"
                    .path=${mdiCheckCircleOutline}
                ></ha-icon-button>
              `,
            },
            delete: {
                title: "",
                minWidth: "64px",
                maxWidth: "64px",
                sortable: false,
                groupable: false,
                showNarrow: true,
                moveable: false,
                hideable: false,
                type: "overflow",
                template: (task: Task) => html`
                <ha-icon-button
                    @click=${() => this._handleRemoveTaskClick(task.id)}
                    .label="Delete"
                    title="Delete Task"
                    .path=${mdiDelete}
                ></ha-icon-button>
              `,
            },
        }
    };

    private get _columnsToDisplay() {
        return Object.fromEntries(
            Object.entries(this._columns).filter(([_, col]) =>
                this.narrow ? col.showNarrow !== false : true
            )
        );
    }

    private get _rows() {
        return this.tasks.map((task: Task) => {
            const isKmBased = task.interval_type === "kilometers" || task.interval_type === "miles";
            
            let next_due: Date | null = null;
            let next_due_odometer: number | null = null;
            let next_due_type: "date" | "odometer" = "date";
            let is_due = false;

            if (isKmBased) {
                // For km-based tasks, calculate next due odometer
                if (task.last_odometer != null) {
                    next_due_odometer = task.last_odometer + task.interval_value;
                    // Try to get current odometer from entity if available
                    if (task.odometer_entity) {
                        const odometerState = this.hass?.states[task.odometer_entity];
                        if (odometerState && odometerState.state !== "unknown" && odometerState.state !== "unavailable") {
                            try {
                                const currentOdometer = parseFloat(odometerState.state);
                                if (!isNaN(currentOdometer)) {
                                    is_due = currentOdometer >= next_due_odometer;
                                }
                            } catch (e) {
                                // Ignore errors
                            }
                        }
                    }
                    next_due_type = "odometer";
                }
            } else {
                // For time-based tasks, calculate next due date
                if (task.last_performed) {
                    const [datePart] = task.last_performed.split("T");
                    const [year, month, day] = datePart.split("-").map(Number);
                    next_due = new Date(year, month - 1, day);

                    switch (task.interval_type) {
                        case "days":
                            next_due.setDate(next_due.getDate() + task.interval_value);
                            break;
                        case "weeks":
                            next_due.setDate(next_due.getDate() + task.interval_value * 7);
                            break;
                        case "months":
                            next_due.setMonth(next_due.getMonth() + task.interval_value);
                            break;
                    }
                    const now = new Date();
                    is_due = next_due <= now;
                }
            }

            return {
                icon: task.icon,
                id: task.id,
                title: task.title,
                interval_value: task.interval_value,
                interval_type: task.interval_type,
                last_performed: task.last_performed ?? 'Never',
                last_odometer: task.last_odometer,
                interval_days: (() => {
                    switch (task.interval_type) {
                        case "days":
                            return task.interval_value;
                        case "weeks":
                            return task.interval_value * 7;
                        case "months":
                            return task.interval_value * 30;
                        default:
                            return Number.MAX_SAFE_INTEGER;
                    }
                })(),
                next_due: next_due || new Date(),
                next_due_type,
                next_due_odometer,
                is_due,
                category: task.category,
                item_name: task.item_name,
                tagIcon: (() => task.tag_id && task.tag_id.trim() !== "" ? "mdi:tag" : undefined)(),
            };
        });
    }

    private get _basicSchema() {
        return [
            { name: "title", required: true, selector: { text: {} }, },
            { name: "category", selector: { select: { options: [{ value: "home", label: "Home" }, { value: "car", label: "Car" }, { value: "motorcycle", label: "Motorcycle" }], mode: "dropdown" } }, },
            { name: "item_name", selector: { text: {} }, },
            { name: "interval_value", required: true, selector: { number: { min: 1, mode: "box" } }, },
            {
                name: "interval_type",
                required: true,
                selector: {
                    select: {
                        options: INTERVAL_TYPES.map((type) => ({
                            value: type,
                            label: getIntervalTypeLabels(this.hass!.language)[type],
                        })),
                        mode: "dropdown"
                    },
                },
            },
        ]
    };

    private get _advancedSchema() {
        return [
            { name: "last_performed", selector: { date: {} }, },
            { name: "last_odometer", selector: { number: { min: 0, step: 1, mode: "box", unit_of_measurement: "km" } }, },
            { name: "odometer_entity", selector: { entity: {} }, },
            { name: "icon", selector: { icon: {} }, },
            { name: "label", selector: { label: { multiple: true } }, },
            { name: "tag", selector: { entity: { filter: { domain: "tag" } } }, },
        ]
    };

    private get _editSchema() {
        return [
            { name: "interval_value", required: true, selector: { number: { min: 1, mode: "box" } }, },
            {
                name: "interval_type",
                required: true,
                selector: {
                    select: {
                        options: INTERVAL_TYPES.map((type) => ({
                            value: type,
                            label: getIntervalTypeLabels(this.hass!.language)[type],
                        })),
                        mode: "dropdown"
                    },
                },
            },
            { type: "constant", name: localize('panel.dialog.edit_task.sections.optional', this.hass!.language), disabled: true },
            { name: "category", selector: { select: { options: [{ value: "home", label: "Home" }, { value: "car", label: "Car" }, { value: "motorcycle", label: "Motorcycle" }], mode: "dropdown" } }, },
            { name: "item_name", selector: { text: {} }, },
            { name: "last_performed", selector: { date: {} }, },
            { name: "last_odometer", selector: { number: { min: 0, step: 1, mode: "box", unit_of_measurement: "km" } }, },
            { name: "odometer_entity", selector: { entity: {} }, },
            { name: "icon", selector: { icon: {} }, },
            { name: "label", selector: { label: { multiple: true } }, },
            { name: "tag", selector: { entity: { filter: { domain: "tag" } } }, },
        ]
    };

    private _computeLabel = (schema: { name: string }): string => {
        try {
            return localize(`panel.cards.new.fields.${schema.name}.heading`, this.hass!.language) ?? schema.name;
        } catch {
            return schema.name;
        }
    }

    private _computeHelper = (schema: { name: string }): string => {
        try {
            return localize(`panel.cards.new.fields.${schema.name}.helper`, this.hass!.language) ?? "";
        } catch {
            return "";
        }
    }

    private _computeEditLabel = (schema: { name: string }): string => {
        try {
            return localize(`panel.dialog.edit_task.fields.${schema.name}.heading`, this.hass!.language) ?? schema.name;
        } catch {
            return schema.name;
        }
    }

    private _computeEditHelper = (schema: { name: string }): string => {
        try {
            return localize(`panel.dialog.edit_task.fields.${schema.name}.helper`, this.hass!.language) ?? "";
        } catch {
            return "";
        }
    }

    private _getIconByCategory(category: string | null | undefined, explicitIcon: string | null | undefined): string {
        // If explicit icon is provided, use it
        if (explicitIcon?.trim()) {
            return explicitIcon.trim();
        }
        // Otherwise, use category-based icon
        switch (category?.trim()?.toLowerCase()) {
            case "car":
                return "mdi:car-wrench";
            case "motorcycle":
                return "mdi:motorbike";
            case "home":
                return "mdi:home";
            default:
                return "mdi:wrench-clock";
        }
    }

    private async loadData() {
        await loadConfigDashboard();
        this.tags = await loadTags(this.hass!);
        this.tasks = await loadTasks(this.hass!);
        this.config = await getConfig(this.hass!);
        this.registry = await loadRegistryEntries(this.hass!);
        this.labelRegistry = await loadLabelRegistry(this.hass!);
    }

    private async resetForm() {
        this._formData = {
            title: "",
            interval_value: "",
            interval_type: "days",
            last_performed: "",
            icon: "",
            label: [],
            tag: "",
            last_odometer: "",
            odometer_entity: "",
            category: "",
            item_name: "",
        };

        this.tasks = await loadTasks(this.hass!);
    }

    private async resetEditForm() {
        this._editFormData = {
            title: "",
            interval_value: "",
            interval_type: "days",
            last_performed: "",
            icon: "",
            label: [],
            tag: "",
            last_odometer: "",
            odometer_entity: "",
            category: "",
            item_name: "",
        };
    }

    private computeISODate(dateStr: string): string {
        let isoDateStr: string;

        if (dateStr) {
            // Only take the YYYY-MM-DD part to avoid time zone issues
            const [yearStr, monthStr, dayStr] = dateStr.split("T")[0].split("-");
            const year = Number(yearStr);
            const month = Number(monthStr);
            const day = Number(dayStr);

            if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                const parsedDate = new Date(year, month - 1, day);
                parsedDate.setHours(0, 0, 0, 0);
                isoDateStr = parsedDate.toISOString();
            } else {
                alert("Invalid date entered.");
                const fallback = new Date();
                fallback.setHours(0, 0, 0, 0);
                isoDateStr = fallback.toISOString();
            }
        } else {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isoDateStr = today.toISOString();
        }

        return isoDateStr;
    }

    connectedCallback() {
        super.connectedCallback();
        this.loadData();
    }

    render() {
        if (!this.hass) return html``;

        if (!this.tasks || !this.tags) {
            return html`<p>${localize('common.loading', this.hass.language)}</p>`;
        }

        return html`
            <div class="header">
                <div class="toolbar">
                    <ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>
                    <div class="main-title">
                        ${this.config?.options.sidebar_title}
                    </div>
                    <div class="version">
                        v${VERSION}
                    </div>
                </div>
            </div>

            <div class="view">
                <ha-card
                    header="${localize('panel.cards.current.title', this.hass.language)}"
                    class="card-current"
                >
                    <div class="card-content">${this.renderTasks()}</div>
                </ha-card>

                <ha-card
                    header="${localize('panel.cards.new.title', this.hass.language)}"
                    class="card-new"
                >
                    <div class="card-content">${this.renderForm()}</div>
                </ha-card>
            </div>

            ${this.renderEditDialog()}
        `;
    }

    renderForm() {
        if (!this.hass) return html``;

        return html`
            <div class="form-container">
                <ha-form
                    .hass=${this.hass}
                    .schema=${this._basicSchema}
                    .computeLabel=${this._computeLabel.bind(this)}
                    .computeHelper=${this._computeHelper.bind(this)}
                    .data=${this._formData}
                    @value-changed=${(e: CustomEvent) => this._handleFormValueChanged(e)}
                ></ha-form>

                <ha-expansion-panel
                    header="${localize('panel.cards.new.sections.optional', this.hass.language)}"
                    .opened=${this._advancedOpen}
                    @opened-changed=${(e: CustomEvent) => (this._advancedOpen = e.detail.value)}
                >
                    <ha-form
                        .hass=${this.hass}
                        .data=${this._formData}
                        .schema=${this._advancedSchema}
                        .computeLabel=${this._computeLabel.bind(this)}
                        .computeHelper=${this._computeHelper.bind(this)}
                        @value-changed=${(e: CustomEvent) => this._handleFormValueChanged(e)}
                    ></ha-form>
                </ha-expansion-panel>

                <div class="form-actions">
                    <mwc-button 
                        raised 
                        @click=${this._handleAddTaskClick}
                        class="add-button"
                    >
                        ${localize('panel.cards.new.actions.add_task', this.hass.language)}
                    </mwc-button>
                </div>
            </div>
        `;
    }

    renderTasks() {
        if (!this.hass) return html``;

        if (!this.tasks || this.tasks.length === 0) {
            return html`<span>${localize('common.no_tasks', this.hass!.language)}</span>`;
        }

        return html`
            <div class="table-wrapper">
                <ha-data-table
                    .hass=${this.hass}
                    .columns=${this._columnsToDisplay}
                    .data=${this._rows}
                    .narrow=${this.narrow}
                    auto-height
                    id="tasks-table"
                    class="tasks-table"
                    clickable
                >
                </ha-data-table>
            </div>
        `;
    }

    renderEditDialog() {
        if (!this.hass) return html``;

        if (!this._editingTaskId) return html``;

        return html`
            <ha-dialog
                open
                heading="${localize('panel.dialog.edit_task.title', this.hass.language)}: ${this._editFormData.title}"
                @closed=${this._handleDialogClosed}
            >
                <ha-form
                    .hass=${this.hass}
                    .schema=${this._editSchema}
                    .computeLabel=${this._computeEditLabel.bind(this)}
                    .computeHelper=${this._computeEditHelper.bind(this)}
                    .data=${this._editFormData}
                    @value-changed=${(e: CustomEvent) => this._handleEditFormValueChanged(e)}
                ></ha-form>

                <mwc-button slot="secondaryAction" @click=${() => (this._editingTaskId = null)}>
                    ${localize('panel.dialog.edit_task.actions.cancel', this.hass.language)}
                </mwc-button>
                <mwc-button slot="primaryAction" @click=${this._handleSaveEditClick}>
                    ${localize('panel.dialog.edit_task.actions.save', this.hass.language)}
                </mwc-button>
            </ha-dialog>
        `;
    }

    private async _handleAddTaskClick() {
        const { title, interval_value, interval_type, last_performed, tag, icon, label, last_odometer, odometer_entity, category, item_name } = this._formData;

        if (!title?.trim() || !interval_value || !interval_type) {
            const msg = localize("panel.cards.new.alerts.required", this.hass!.language);
            alert(msg);
            return;
        }

        const payload: Record<string, any> = {
            title: title.trim(),
            interval_value,
            interval_type,
            last_performed: this.computeISODate(last_performed),
            tag_id: tag?.trim() || undefined,
            icon: this._getIconByCategory(category, icon),
            labels: label ?? [],
        };

        // Add optional fields
        if (category?.trim()) {
            payload.category = category.trim();
        }
        if (item_name?.trim()) {
            payload.item_name = item_name.trim();
        }
        if (last_odometer !== "" && last_odometer != null) {
            payload.last_odometer = Number(last_odometer);
        }
        if (odometer_entity?.trim()) {
            payload.odometer_entity = odometer_entity.trim();
        }

        try {
            await saveTask(this.hass!, payload);
            await this.resetForm();
        } catch (error) {
            console.error("Failed to add task:", error);
            const msg = localize('panel.cards.new.alerts.error', this.hass!.language)
            alert(msg);
        }
    };

    private async _handleCompleteTaskClick(id: string) {
        const msg = localize('panel.cards.current.confirm_complete', this.hass!.language);
        if (!confirm(msg)) return;
        try {
            await completeTask(this.hass!, id);
            await this.loadData();
        } catch (e) {
            console.error("Failed to complete task:", e);
        }
    }

    private async _handleOpenEditDialogClick(id: string) {
        try {
            const task: Task = await loadTask(this.hass!, id);
            this._editingTaskId = task.id;
            let labels: Label[] = [];
            const entity = this.registry.find((entry) => entry.unique_id === task.id);
            if (entity)
                labels = this.labelRegistry.filter((lr) => entity.labels.includes(lr.label_id));

            this._editFormData = {
                title: task.title,
                interval_value: task.interval_value,
                interval_type: task.interval_type,
                last_performed: task.last_performed ?? "",
                icon: task.icon ?? "",
                label: labels.map((l) => l.label_id),
                tag: task.tag_id ?? "",
                last_odometer: task.last_odometer ?? "",
                odometer_entity: task.odometer_entity ?? "",
                category: task.category ?? "",
                item_name: task.item_name ?? "",
            };

            await this.updateComplete;
        } catch (e) {
            console.error("Failed to fetch task for edit:", e);
        }
    }

    private async _handleSaveEditClick() {
        if (!this._editingTaskId) return;

        const lastPerformedISO = this.computeISODate(this._editFormData.last_performed);
        if (!lastPerformedISO) return;

        const updates: Record<string, any> = {
            title: this._editFormData.title.trim(),
            interval_value: Number(this._editFormData.interval_value),
            interval_type: this._editFormData.interval_type,
            last_performed: lastPerformedISO,
            icon: this._getIconByCategory(this._editFormData.category, this._editFormData.icon),
            labels: this._editFormData.label,
        };

        if (this._editFormData.tag && this._editFormData.tag.trim() !== "") {
            updates.tag_id = this._editFormData.tag.trim();
        } else {
            updates.tag_id = null;
        }

        // Add optional fields
        if (this._editFormData.category?.trim()) {
            updates.category = this._editFormData.category.trim();
        } else {
            updates.category = null;
        }
        if (this._editFormData.item_name?.trim()) {
            updates.item_name = this._editFormData.item_name.trim();
        } else {
            updates.item_name = null;
        }
        if (this._editFormData.last_odometer !== "" && this._editFormData.last_odometer != null) {
            updates.last_odometer = Number(this._editFormData.last_odometer);
        } else {
            updates.last_odometer = null;
        }
        if (this._editFormData.odometer_entity?.trim()) {
            updates.odometer_entity = this._editFormData.odometer_entity.trim();
        } else {
            updates.odometer_entity = null;
        }

        const payload = {
            task_id: this._editingTaskId,
            updates,
        };

        try {
            await updateTask(this.hass!, payload);
            this._editingTaskId = null;
            await this.resetEditForm();
            await this.loadData();
        } catch (e) {
            console.error("Failed to update task:", e);
        }
    }

    private async _handleRemoveTaskClick(id: string) {
        const msg = localize('panel.cards.current.confirm_remove', this.hass!.language)
        if (!confirm(msg)) return;
        try {
            await removeTask(this.hass!, id);
            await this.loadData();
        } catch (e) {
            console.error("Failed to remove task:", e);
        }
    }

    private _handleDialogClosed(e: CustomEvent) {
        const action = e.detail?.action;
        if (action === "close" || action === "cancel") {
            this._editingTaskId = null;
        }
    }

    private _handleFormValueChanged(ev: CustomEvent) {
        this._formData = { ...this._formData, ...ev.detail.value };
    }

    private _handleEditFormValueChanged(ev: CustomEvent) {
        this._editFormData = { ...this._editFormData, ...ev.detail.value };
    }

    static styles = commonStyle;
}

customElements.define("home-maintenance-panel", HomeMaintenancePanel);

