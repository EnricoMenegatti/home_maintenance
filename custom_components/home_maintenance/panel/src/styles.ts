import { css } from 'lit';

export const commonStyle = css`
    :host {
        color: var(--primary-text-color);
        background: var(--lovelace-background, var(--primary-background-color));
    }

    .header {
        background-color: var(--app-header-background-color);
        color: var(--app-header-text-color, white);
        border-bottom: var(--app-header-border-bottom, none);
    }

    .toolbar {
        height: var(--header-height);
        display: flex;
        align-items: center;
        font-size: 20px;
        padding: 0 16px;
        font-weight: 400;
        box-sizing: border-box;
    }

    .main-title {
        margin: 0 0 0 24px;
        line-height: 20px;
        flex-grow: 1;
    }

    .version {
        font-size: 14px;
        font-weight: 500;
        color: rgba(var(--rgb-text-primary-color), 0.9);
    }

    .view {
        height: calc(100vh - 65px);
        display: flex;
        flex-direction: column;
        align-items: stretch;
        padding: 16px;
        box-sizing: border-box;
        gap: 16px;
        overflow-y: auto;
    }

    ha-card {
        display: block;
        margin: 0;
        flex: 1;
    }

    .card-new {
        width: 100%;
        max-width: 100%;
    }

    .card-current {
        width: 100%;
        max-width: 100%;
    }

    ha-expansion-panel {
        --input-fill-color: none;
    }

    .form-row {
        display: flex;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .form-field {
        margin: 8px 0;
    }

    ha-form {
        display: block;
    }

    ha-form ha-textfield,
    ha-form ha-select,
    ha-form ha-icon-picker,
    ha-form ha-entity-picker {
        width: 100%;
        margin: 8px 0;
    }

    .filler {
        flex-grow: 1;
    }

    .break {
        flex-basis: 100%;
        height: 0;
    }

    @media (max-width: 600px) {
        .form-row {
            flex-direction: column; /* Stack fields vertically */
        }

        .form-field {
            width: 100%; /* Full width */
        }

        ha-textfield,
        ha-select,
        ha-icon-picker {
            width: 100%;
            box-sizing: border-box;
        }
    }

    .task-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .task-item {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        gap: 1rem;
        padding: 0.5rem 0;
        border-bottom: 1px solid var(--divider-color);
    }

    .task-header {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .task-content {
        flex: 1;
    }

    .task-actions {
        display: flex;
        flex-direction: row;
        gap: 0.5rem;
    }

    .due-soon {
        color: var(--error-color, red);
        font-weight: bold;
    }

    .warning {
        --mdc-theme-primary: var(--error-color);
        color: var(--primary-text-color);
    }

    ha-dialog {
        --mdc-dialog-min-width: 600px;
    }

    @media (max-width: 600px) {
        ha-dialog {
        --mdc-dialog-min-width: auto;
        }
    }

    .form-container {
        padding: 16px;
    }

    .form-actions {
        margin-top: 24px;
        display: flex;
        justify-content: center;
    }

    .add-button {
        --mdc-theme-primary: var(--primary-color);
        min-width: 200px;
    }
`;

