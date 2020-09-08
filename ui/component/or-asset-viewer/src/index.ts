// Declare require method which we'll use for importing webpack resources (using ES6 imports will confuse typescript parser)
declare function require(name: string): any;

import {customElement, html, LitElement, property, PropertyValues, TemplateResult, unsafeCSS} from "lit-element";
import "@openremote/or-icon";
import "@openremote/or-input";
import "@openremote/or-attribute-input";
import "@openremote/or-attribute-history";
import "@openremote/or-chart";
import "@openremote/or-survey";
import "@openremote/or-survey-results";
import "@openremote/or-table";
import "@openremote/or-panel";
import "@openremote/or-mwc-components/dist/or-mwc-dialog";
import {DialogAction, OrMwcDialog} from "@openremote/or-mwc-components/dist/or-mwc-dialog";
import "@openremote/or-mwc-components/dist/or-mwc-list";
import {OrTranslate, translate} from "@openremote/or-translate";
import {InputType, OrInput, OrInputChangedEvent} from "@openremote/or-input";
import manager, {AssetModelUtil, subscribe, Util} from "@openremote/core";
import {OrTable} from "@openremote/or-table";
import {OrChartConfig, OrChartEvent} from "@openremote/or-chart";
import {HistoryConfig, OrAttributeHistory, OrAttributeHistoryEvent} from "@openremote/or-attribute-history";
import {
    Asset,
    AssetAttribute,
    AssetEvent,
    AssetType,
    Attribute,
    AttributeEvent,
    ClientRole,
    MetaItemType,
    SharedEvent
} from "@openremote/model";
import {panelStyles, style} from "./style";
import i18next from "i18next";
import {styleMap} from "lit-html/directives/style-map";
import {classMap} from "lit-html/directives/class-map";
import {GenericAxiosResponse} from "axios";
import {OrIcon} from "@openremote/or-icon";
import "./or-edit-asset-panel";
import {OrEditAssetChangedEvent} from "./or-edit-asset-panel";

export interface PanelConfig {
    type?: "info" | "history" | "group" | "survey" | "survey-results";
    title?: string;
    hide?: boolean;
    hideOnMobile?: boolean;
    panelStyles?: { [style: string]: string };
}

export interface InfoPanelItemConfig {
    label?: string;
    hideOnMobile?: boolean;
    readonly?: boolean;
    disabled?: boolean;
    disableButton?: boolean;
    disableHelperText?: boolean;
    inputTypeOverride?: InputType;
    priority?: number;
    styles?: { [style: string]: string };
}

export interface InfoPanelConfig extends PanelConfig {
    type: "info",
    attributes: {
        include?: string[];
        exclude?: string[];
        itemConfig?: {
            [name: string]: InfoPanelItemConfig;
        };
    },
    properties: {
        include?: string[];
        exclude?: string[];
        itemConfig?: {
            [name: string]: InfoPanelItemConfig;
        };
    }
}

export interface HistoryPanelConfig extends PanelConfig {
    type: "history",
    include?: string[];
    exclude?: string[];
}

export interface GroupPanelConfig extends PanelConfig {
    type: "group",
    childAssetTypes?: {
        [assetType: string]: {
            availableAttributes?: string[];
            selectedAttributes?: string[];
        }
    };
}

export type PanelConfigUnion = InfoPanelConfig | GroupPanelConfig | PanelConfig;
export type PanelViewProvider = (asset: Asset, attributes: Attribute[], panelName: string, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfigUnion) => TemplateResult | undefined;
export type PropertyViewProvider = (asset: Asset, property: string, value: any, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfigUnion) => TemplateResult | undefined;
export type AttributeViewProvider = (asset: Asset, attribute: Attribute, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfigUnion) => TemplateResult | undefined;

export interface AssetViewerConfig {
    panels?: {[name: string]: PanelConfigUnion};
    viewerStyles?: { [style: string]: string };
    propertyViewProvider?: PropertyViewProvider;
    attributeViewProvider?: AttributeViewProvider;
    panelViewProvider?: PanelViewProvider;
    historyConfig?: HistoryConfig;
    chartConfig?: OrChartConfig;
}

export interface ViewerConfig {
    default?: AssetViewerConfig;
    assetTypes?: { [assetType: string]: AssetViewerConfig };
    historyConfig?: HistoryConfig;
}

export const DEFAULT_ASSET_PROPERTIES = [
    "name",
    "createdOn",
    "type",
    "parentId",
    "accessPublicRead"
];

export function getIncludedProperties(config?: InfoPanelConfig): string[] {
    const includedProperties = config && config.properties && config.properties.include ? config.properties.include : DEFAULT_ASSET_PROPERTIES;
    const excludedProperties =  config && config.properties && config.properties.exclude ? config.properties.exclude : [];

    return includedProperties.filter((prop) => !excludedProperties || excludedProperties.indexOf(prop) < 0);
}

export function getIncludedAttributes(attributes: Attribute[], config?: InfoPanelConfig): Attribute[] {
    const includedAttributes = config && config.attributes && config.attributes.include ? config.attributes.include : undefined;
    const excludedAttributes = config && config.attributes && config.attributes.exclude ? config.attributes.exclude : [];
    return attributes.filter((attr) =>
        (!includedAttributes || includedAttributes.indexOf(attr.name!) >= 0)
        && (!excludedAttributes || excludedAttributes.indexOf(attr.name!) < 0));
}

class EventHandler {
    _callbacks: Function[];

    constructor() {
        this._callbacks = [];
    }

    startCallbacks() {
        return new Promise((resolve, reject) => {
            if (this._callbacks && this._callbacks.length > 0) {
                this._callbacks.forEach(cb => cb());
            }
            resolve();
        })

    }

    addCallback(callback: Function) {
        this._callbacks.push(callback);
    }
}

export class OrAssetViewerComputeGridEvent extends CustomEvent<void> {

    public static readonly NAME = "or-asset-viewer-compute-grid-event";

    constructor() {
        super(OrAssetViewerComputeGridEvent.NAME, {
            bubbles: true,
            composed: true
        });
    }
}

export type SaveResult = {
    asset: Asset,
    statusCode: number
};

export class OrAssetViewerSaveResultEvent extends CustomEvent<SaveResult> {

    public static readonly NAME = "or-asset-viewer-save-result-event";

    constructor(saveResult:SaveResult) {
        super(OrAssetViewerComputeGridEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: saveResult
        });
    }
}

declare global {
    export interface HTMLElementEventMap {
        [OrAssetViewerComputeGridEvent.NAME]: OrAssetViewerComputeGridEvent;
        [OrAssetViewerSaveResultEvent.NAME]: OrAssetViewerSaveResultEvent;
    }
}

const onRenderComplete = new EventHandler();

export function getPanel(name: string, panelConfig: PanelConfig, content: TemplateResult | undefined) {

    if (!content) {
        return;
    }

    return html`
        <div class=${classMap({panel: true, mobileHidden: panelConfig.hideOnMobile === true})} id="${name}-panel" style="${panelConfig && panelConfig.panelStyles ? styleMap(panelConfig.panelStyles) : ""}">
            <div class="panel-content-wrapper">
                <div class="panel-title">
                    <or-translate value="${panelConfig.title ? panelConfig.title : name}"></or-translate>
                </div>
                <div class="panel-content">
                    ${content}
                </div>
            </div>
        </div>
    `;
}

export function getPanelContent(panelName: string, asset: Asset, attributes: Attribute[], hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfig): TemplateResult | undefined {

    // See if config has a custom way for rendering this panel
    if (viewerConfig.panelViewProvider) {
        const template = viewerConfig.panelViewProvider(asset, attributes, panelName, hostElement, viewerConfig, panelConfig);
        if (template) {
            return template;
        }
    }

    if (panelConfig.type === "info") {

        // This type of panel shows attributes and/or properties of the asset
        const infoConfig = panelConfig as InfoPanelConfig;
        const includedProperties = getIncludedProperties(infoConfig);
        const includedAttributes = getIncludedAttributes(attributes, infoConfig);

        if (includedProperties.length === 0 && includedAttributes.length === 0) {
            return undefined;
        }

        const items: {item: string | Attribute, itemConfig: InfoPanelItemConfig}[] = [];

        includedProperties.forEach((prop) => {
            const itemConfig = infoConfig.properties && infoConfig.properties.itemConfig ? infoConfig.properties.itemConfig[prop] : {};
            if (itemConfig.label === undefined) {
                itemConfig.label = i18next.t(prop);
            }
            itemConfig.priority = itemConfig.priority || 0;
            items.push({
                item: prop,
                itemConfig: itemConfig
            });
        });

        includedAttributes.forEach((attribute) => {
            const itemConfig = infoConfig.attributes && infoConfig.attributes.itemConfig && infoConfig.attributes.itemConfig[attribute.name!] ? infoConfig.attributes.itemConfig[attribute.name!] : {};
            if (itemConfig.label === undefined) {
                const descriptors = AssetModelUtil.getAttributeAndValueDescriptors(asset.type!, attribute);
                itemConfig.label = Util.getAttributeLabel(attribute, descriptors[0], descriptors[1], true);
            }
            itemConfig.priority = itemConfig.priority || 0;
            items.push({
                item: attribute,
                itemConfig: itemConfig
            });
        });

        const labelSort = Util.sortByString((item: {item: string | Attribute, itemConfig: InfoPanelItemConfig}) => item.itemConfig.label!.toUpperCase());

        items.sort((a, b) => {
            const priorityA = a.itemConfig.priority!;
            const priorityB = b.itemConfig.priority!;

            if (priorityA < priorityB) {
                return 1;
            }

            if (priorityA > priorityB) {
                return -1;
            }

            return labelSort(a,b);
        });

        return html`
            ${items.map((item) => {
                if (typeof item.item === "string") {
                    // This is a property                    
                    return getField(item.item, item.itemConfig, getPropertyTemplate(asset, item.item, hostElement, viewerConfig, panelConfig, item.itemConfig));
                } else {
                    // This is an attribute
                    return getField(item.item.name!, item.itemConfig, getAttributeTemplate(asset, item.item, hostElement, viewerConfig, panelConfig, item.itemConfig));
                }
        })}`;
    }

    if (panelConfig && panelConfig.type === "survey") {
        return html`      
            <or-survey id="survey" .surveyId="${asset.id}"></or-survey>
        `;
    }

    if (panelConfig && panelConfig.type === "survey-results") {
        return html`     
            <or-survey-results id="survey-results" .survey="${asset}"></or-survey-results>
        `;
    }

    if (panelConfig && panelConfig.type === "history") {
        // Special handling for history panel which shows an attribute selector and a graph/data table of historical values
        const historyConfig = panelConfig as HistoryPanelConfig;
        const includedAttributes = historyConfig.include ? historyConfig.include : undefined;
        const excludedAttributes = historyConfig.exclude ? historyConfig.exclude : [];
        const historyAttrs = attributes.filter((attr) =>
            (!includedAttributes || includedAttributes.indexOf(attr.name!) >= 0)
            && (!excludedAttributes || excludedAttributes.indexOf(attr.name!) < 0)
            && !!Util.getFirstMetaItem(attr, MetaItemType.STORE_DATA_POINTS.urn!));

        if (historyAttrs.length === 0) {
            return undefined;
        }

        const attributeChanged = (attributeName: string) => {
            if (hostElement.shadowRoot) {
                const attributeHistory = hostElement.shadowRoot.getElementById("attribute-history") as OrAttributeHistory;

                if (attributeHistory) {

                    let attribute: AssetAttribute | undefined;

                    if (attributeName) {
                        attribute = Util.getAssetAttribute(asset, attributeName);
                    }

                    attributeHistory.attribute = attribute;
                }
            }
        };

        const options = historyAttrs.map((attr) => {
            const descriptors = AssetModelUtil.getAttributeAndValueDescriptors(asset.type, attr);
            const label = Util.getAttributeLabel(attr, descriptors[0], descriptors[1], true);
            return [attr.name, label];
        });
        const attrName: string = historyAttrs[0].name!;
        onRenderComplete.addCallback(() => attributeChanged(attrName));
        return html`
            <style>
               or-attribute-history{
                    min-height: 70px;
                    width: 100%;
               }
                #history-controls {
                    flex: 0;
                    margin-bottom: 10px;
                    position: absolute;
                }
                
                #history-attribute-picker {
                    flex: 0;
                    width: 200px;
                }
                
                or-attribute-history {
                    --or-attribute-history-controls-margin: 0 0 20px 204px;  
                }
                
                @media screen and (max-width: 2028px) {
                  #history-controls {
                        position: unset;
                        margin: 0 0 10px 0;
                  }
                  
                  or-attribute-history {
                        --or-attribute-history-controls-margin: 10px 0 0 0;  
                        --or-attribute-history-controls-margin-children: 0 20px 20px 0;
                  }
                }
            </style>
            <div id="history-controls">
                <or-input id="history-attribute-picker" .checkAssetWrite="${false}" .value="${historyAttrs[0].name}" .label="${i18next.t("attribute")}" @or-input-changed="${(evt: OrInputChangedEvent) => attributeChanged(evt.detail.value)}" .type="${InputType.SELECT}" .options="${options}"></or-input>
            </div>        
            <or-attribute-history id="attribute-history" .config="${viewerConfig.historyConfig}" .assetType="${asset.type}"></or-attribute-history>
        `;
    }

    if (panelConfig && panelConfig.type === "group") {

        if (asset.type !== "urn:openremote:asset:group") {
            return;
        }

        // Get child asset type attribute value
        const childAssetTypeAttribute = Util.getAssetAttribute(asset, "childAssetType");
        const groupConfig = panelConfig as GroupPanelConfig;

        if (!childAssetTypeAttribute || typeof childAssetTypeAttribute.value !== "string") {
            return;
        }
        const childAssetType = childAssetTypeAttribute.value as string;
        let childAssets: Asset[] = [];

        // Determine available and selected attributes for the child asset type
        let availableAttributes: string[] = [];
        let selectedAttributes: string[] = [];
        const newlySelectedAttributes: string[] = []; // Updated when the dialog is open

        if (groupConfig.childAssetTypes && groupConfig.childAssetTypes[childAssetType]) {
            availableAttributes = groupConfig.childAssetTypes[childAssetType].availableAttributes ? groupConfig.childAssetTypes[childAssetType].availableAttributes! : [];
            selectedAttributes = groupConfig.childAssetTypes[childAssetType].selectedAttributes ? groupConfig.childAssetTypes[childAssetType].selectedAttributes! : [];
        }

        // Get available and selected attributes from asset descriptor if not defined in config
        if (availableAttributes.length === 0) {
            const descriptor = AssetModelUtil.getAssetDescriptor(childAssetType);
            if (descriptor && descriptor.attributeDescriptors) {
                availableAttributes = descriptor.attributeDescriptors.map((desc) => desc.attributeName!);
            }
        }
        if ((!selectedAttributes || selectedAttributes.length === 0) && availableAttributes) {
            selectedAttributes = [...availableAttributes];
        }

        const attributePickerModalActions: DialogAction[] = [
            {
                actionName: "ok",
                default: true,
                content: html`<or-input class="button" .type="${InputType.BUTTON}" .label="${i18next.t("ok")}"></or-input>`,
                action: () => {
                    selectedAttributes.length = 0;
                    selectedAttributes.push(...newlySelectedAttributes);
                    updateTable();
                }
            },
            {
                actionName: "cancel",
                content: html`<or-input class="button" .type="${InputType.BUTTON}" .label="${i18next.t("cancel")}"></or-input>`,
                action: () => {
                    // Nothing to do here
                }
            },
        ];

        const attributePickerModalOpen = () => {
            const dialog: OrMwcDialog = hostElement.shadowRoot!.getElementById(panelName + "-attribute-modal") as OrMwcDialog;

            if (dialog) {
                newlySelectedAttributes.length = 0;
                newlySelectedAttributes.push(...selectedAttributes);
                // Update content which will cause a re-render
                dialog.dialogContent = html`
                        <div style="display:grid">
                            ${availableAttributes.sort().map((attribute) =>
                    html`<div style="grid-column: 1 / -1;">
                                        <or-input .type="${InputType.CHECKBOX}" .label="${i18next.t(attribute)}" .value="${!!newlySelectedAttributes.find((selected) => selected === attribute)}"
                                            @or-input-changed="${(evt: OrInputChangedEvent) => evt.detail.value ? newlySelectedAttributes.push(attribute) : newlySelectedAttributes.splice(newlySelectedAttributes.findIndex((s) => s === attribute), 1)}"></or-input>
                                    </div>`)}
                        </div>
                    `;
                dialog.open();
            }
        };

        // Function to update the table and message when assets or config changes
        const updateTable = () => {

            const loadingMsg: OrTranslate = hostElement.shadowRoot!.getElementById(panelName + "-attribute-table-msg") as OrTranslate;
            const attributeTable: OrTable = hostElement.shadowRoot!.getElementById(panelName + "-attribute-table") as OrTable;
            const addRemoveButton: OrIcon = hostElement.shadowRoot!.getElementById(panelName + "-add-remove-columns") as OrIcon;

            if (!loadingMsg || !attributeTable || !addRemoveButton) {
                return;
            }

            if (selectedAttributes.length === 0 || !childAssets || childAssets.length === 0) {
                loadingMsg.value = "noChildAssets";
                loadingMsg.hidden = false;
                attributeTable.hidden = true;
                addRemoveButton.classList.remove("active");
                return;
            }

            // Update table properties which will cause a re-render
            addRemoveButton.classList.add("active");
            loadingMsg.hidden = true;
            attributeTable.hidden = false;
            const headers = [...selectedAttributes].sort();
            attributeTable.headers = headers.map((attrName) => {
                const attributeDescriptor = AssetModelUtil.getAttributeDescriptor(attrName, childAssetType);
                return Util.getAttributeLabel(undefined, attributeDescriptor, undefined, false);
            });
            attributeTable.headers.unshift(i18next.t("groupAssetName"));
            attributeTable.rows = childAssets.map((childAsset) => {
                // todo: it's only processing including selected headers here...
                // move this to the columnFilter option of the table
                const arr = headers.map((attributeName) => {
                    return childAsset.attributes![attributeName] ? childAsset.attributes![attributeName].value! as string : "";
                });
                arr.unshift(childAsset.name!);
                return arr;
            });
            window.setTimeout(() => OrAssetViewer.generateGrid(hostElement.shadowRoot), 0);
        };

        // Load child assets async then update the table
        getAssetChildren(asset.id!, asset.attributes!.childAssetType.value).then((assetChildren) => {
            childAssets = assetChildren;
            updateTable();
        });

        // Define the DOM content for this panel
        return html`
                <style>
                    .asset-group-add-remove-button {
                        position: absolute;
                        top: 20px;
                        right: var(--internal-or-asset-viewer-panel-padding);
                        opacity: 0.5;
                    }
                    .asset-group-add-remove-button.active {
                        cursor: pointer;
                        opacity: 1;
                    }
                </style>
                <or-icon class="asset-group-add-remove-button" .id="${panelName}-add-remove-columns" icon="pencil" @click="${() => attributePickerModalOpen()}"></or-icon>
                <or-table hidden .id="${panelName}-attribute-table" .options="{stickyFirstColumn:true}"></or-table>
                <span><or-translate id="${panelName}-attribute-table-msg" value="loading"></or-translate></span>
                <or-mwc-dialog id="${panelName}-attribute-modal" dialogTitle="addRemoveAttributes" .dialogActions="${attributePickerModalActions}"></or-mwc-dialog>
            `;
    }

    return undefined;
}

export function getAttributeTemplate(asset: Asset, attribute: AssetAttribute, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfig, itemConfig: InfoPanelItemConfig) {
    if (viewerConfig.attributeViewProvider) {
        const result = viewerConfig.attributeViewProvider(asset, attribute, hostElement, viewerConfig, panelConfig);
        if (result) {
            return result;
        }
    }

    let attrLabel: string | undefined;
    let attrDisabled: boolean | undefined;
    let attrReadonly: boolean | undefined;
    let attrDisableButton: boolean | undefined;
    let attrInputType: InputType | undefined;
    let attrDisableHelper: boolean | undefined;

    if (itemConfig) {
        attrLabel = itemConfig.label;
        attrDisabled = itemConfig.disabled;
        attrReadonly = itemConfig.readonly;
        attrDisableButton = itemConfig.disableButton;
        attrDisableHelper = itemConfig.disableHelperText;
        attrInputType = itemConfig.inputTypeOverride;
    }

    return html`
        <or-attribute-input dense .assetType="${asset!.type}" .attribute="${attribute}" .disabled="${attrDisabled}" .label="${attrLabel}" .readonly="${attrReadonly}" .disableButton="${attrDisableButton}" .inputType="${attrInputType}" .hasHelperText="${!attrDisableHelper}"></or-attribute-input>
    `;
}

export function getPropertyTemplate(asset: Asset, property: string, hostElement: LitElement, viewerConfig: AssetViewerConfig | undefined, panelConfig: PanelConfig | undefined, itemConfig: InfoPanelItemConfig) {
    let value = (asset as { [index: string]: any })[property];

    if (viewerConfig && viewerConfig.propertyViewProvider && panelConfig) {
        const result = viewerConfig.propertyViewProvider(asset, property, value, hostElement, viewerConfig, panelConfig);
        if (result) {
            return result;
        }
    }

    let type = InputType.TEXT;

    switch (property) {
        case "parentId":
            // Display the path instead
            value = (asset as { [index: string]: any })["path"];
            if (!value || !(Array.isArray(value))) {
                return;
            }

            // Populate value when we get the response
            const ancestors = [...value];
            ancestors.splice(0,1);
            value = "";
            if (ancestors.length > 0) {
                getAssetNames(ancestors).then(
                    (names) => {
                        if (hostElement && hostElement.shadowRoot) {
                            const pathField = hostElement.shadowRoot.getElementById("property-parentId") as OrInput;
                            if (pathField) {
                                pathField.value = names.reverse().join(" > ");
                            }
                        }
                    }
                );
                value = i18next.t("loading");
            }
            break;
        case "createdOn":
            type = InputType.DATETIME;
            break;
        case "accessPublicRead":
            type = InputType.CHECKBOX;
            break;
    }

    return html`<or-input id="property-${property}" .type="${type}" dense .value="${value}" .readonly="${itemConfig.readonly !== undefined ? itemConfig.readonly : true}" .label="${itemConfig.label}"></or-input>`;
}

export function getField(name: string, itemConfig?: InfoPanelItemConfig, content?: TemplateResult): TemplateResult {
    if (!content) {
        return html``;
    }

    return html`
            <div id="field-${name}" style="${itemConfig && itemConfig.styles ? styleMap(itemConfig.styles) : ""}" class=${classMap({field: true, mobileHidden: !!itemConfig && !!itemConfig.hideOnMobile})}>
                ${content}
            </div>
        `;
}

async function getAssetNames(ids: string[]): Promise<string[]> {
    const response = await manager.rest.api.AssetResource.queryAssets({
        select: {
            excludePath: true,
            excludeParentInfo: true,
            excludeAttributes: true
        },
        ids: ids
    });

    if (response.status !== 200 || !response.data || response.data.length !== ids.length) {
        return ids;
    }

    return ids.map((id) => response.data.find((asset) => asset.id === id)!.name!);
}

async function getAssetChildren(id: string, childAssetType: string): Promise<Asset[]> {
    let response: GenericAxiosResponse<Asset[]>;

    try {
        response = await manager.rest.api.AssetResource.queryAssets({
            select: {
                excludePath: true,
                excludeParentInfo: true
            },
            parents: [
                {
                    id: id
                }
            ]
        });
    } catch (e) {
        console.log("Failed to get child assets: " + e);
        return [];
    }

    if (response.status !== 200 || !response.data) {
        return [];
    }

    return response.data.filter((asset) => asset.type === childAssetType);
}

// TODO: Add webpack/rollup to build so consumers aren't forced to use the same tooling
const tableStyle = require("!!raw-loader!@material/data-table/dist/mdc.data-table.css");

@customElement("or-asset-viewer")
export class OrAssetViewer extends subscribe(manager)(translate(i18next)(LitElement)) {

    public static DEFAULT_VIEWER_CONFIG: AssetViewerConfig = {
        viewerStyles: {

        },
        panels: {
            group: {
                type: "group",
                title: "underlyingAssets"
            },
            info: {
                type: "info",
                hideOnMobile: true,
                properties: {
                    include:[]
                },
                attributes: {
                    include: ["userNotes", "manufacturer", "model"]
                }
            },
            location: {
                type: "info",
                properties: {
                    include:[]
                },
                attributes: {
                    include: ["location"],
                    itemConfig: {
                        location: {
                            label: "",
                            readonly: true
                        }
                    }
                }
            },
            attributes: {
                type: "info",
                properties: {
                    include:[]
                },
                attributes: {
                    exclude: ["location", "userNotes", "manufacturer", "model", "status"]
                }
            },
            history: {
                type: "history"
            }
        }
    };

    static get styles() {
        return [
            unsafeCSS(tableStyle),
            panelStyles,
            style
        ];
    }

    @property({type: Object, reflect: false})
    public asset?: Asset;

    @property({type: String})
    public assetId?: string;

    @property({type: Object})
    public config?: ViewerConfig;

    @property({type: Boolean})
    public editMode?: boolean;

    @property({type: Boolean})
    public readonly?: boolean;

    @property()
    protected _loading: boolean = false;

    protected _assetModified = false;
    protected _viewerConfig?: AssetViewerConfig;
    protected _attributes?: Attribute[];
    protected resizeHandler = () => OrAssetViewer.generateGrid(this.shadowRoot);

    constructor() {
        super();
        this.addEventListener(OrAssetViewerComputeGridEvent.NAME, () => OrAssetViewer.generateGrid(this.shadowRoot));
        this.addEventListener(OrChartEvent.NAME, () => OrAssetViewer.generateGrid(this.shadowRoot));
        this.addEventListener(OrAttributeHistoryEvent.NAME, () => OrAssetViewer.generateGrid(this.shadowRoot));
        this.addEventListener(OrEditAssetChangedEvent.NAME, () => this._onAssetModified());
    }

    public isModified() {
        return this.editMode && this._assetModified;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener("resize", this.resizeHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("resize", this.resizeHandler);
    }

    shouldUpdate(changedProperties: PropertyValues): boolean {

        if (this._isReadonly()) {
            this.editMode = false;
        }

        if (changedProperties.has("asset")) {
            this._viewerConfig = undefined;
            this._attributes = undefined;

            if (this.asset) {
                this._viewerConfig = this._getPanelConfig(this.asset);
                this._attributes = Util.getAssetAttributes(this.asset);
                this._assetModified = false;
            }
        }

        return super.shouldUpdate(changedProperties);
    }

    protected render(): TemplateResult | void {

        if (this._loading) {
            return html`
                <div class="msg"><or-translate value="loading"></or-translate></div>
            `;
        }

        if (!this.asset && !this.assetId) {
            return html`
                <div class="msg"><or-translate value="noAssetSelected"></or-translate></div>
            `;
        }

        if (!this.asset) {
            return html`
                <div><or-translate value="notFound"></or-translate></div>
            `;
        }

        if (!this._attributes || !this._viewerConfig) {
            return html``;
        }

        const descriptor = AssetModelUtil.getAssetDescriptor(this.asset!.type!);
        const editMode = !!this.editMode;

        let content: TemplateResult | string = ``;

        if (editMode) {
            content = html`
                <or-edit-asset-panel .asset="${this.asset}" .attrs="${this._attributes}"></or-edit-asset-panel>
            `;
        } else {
            if (this._viewerConfig.panels) {
                content = html`${Object.entries(this._viewerConfig.panels).map(([name, panelConfig]) => {

                    if (panelConfig.hide) {
                        return ``;
                    }

                    return getPanel(name, panelConfig, getPanelContent(name, this.asset!, this._attributes!, this, this._viewerConfig!, panelConfig)) || ``;
                })}`;
            }
        }

        return html`
            <div id="wrapper">
                <div id="asset-header">
                    <a class="back-navigation" @click="${() => window.history.back()}">
                        <or-icon icon="chevron-left"></or-icon>
                    </a>
                    <div id="title">
                        <or-icon title="${descriptor && descriptor.type ? descriptor.type : "unset"}" style="--or-icon-fill: ${descriptor && descriptor.color ? "#" + descriptor.color : "unset"}" icon="${descriptor && descriptor.icon ? descriptor.icon : AssetType.THING.icon}"></or-icon>
                        ${editMode ? html`<or-input id="name-input" .type="${InputType.TEXT}" min="1" max="1023" required outlined .label="${i18next.t("name")}" .value="${this.asset.name}" @or-input-changed="${(e: OrInputChangedEvent) => {this.asset!.name = e.detail.value; this._onAssetModified();}}"></or-input>` : html`<span>${this.asset.name}</span>`}
                    </div>
                    <div id="created-time" class="mobileHidden"><or-translate value="createdOnWithDate" .options="${{ date: new Date(this.asset!.createdOn!) } as i18next.TOptions<i18next.InitOptions>}"></or-translate></div>
                    ${editMode ? html`<or-input id="save-btn" .disabled="${!this.isModified()}" raised .type="${InputType.BUTTON}" .label="${i18next.t("save")}" @or-input-changed="${() => this._saveAsset()}"></or-input>` : ``}
                </div>
                <div id="container" style="${this._viewerConfig.viewerStyles ? styleMap(this._viewerConfig.viewerStyles) : ""}">
                    ${content}
                </div>
            </div>
        `;
    }

    protected updated(_changedProperties: PropertyValues) {
        super.updated(_changedProperties);

        if (_changedProperties.has("assetId")) {
            this.asset = undefined;
            if (this.assetId) {
                this._loading = true;
                super.assetIds = [this.assetId];
            } else {
                this._loading = false;
                super.assetIds = undefined;
            }
        } else if (_changedProperties.has("editMode") && !this.editMode) {
            this._reloadAsset();
        }

        this.onCompleted().then(() => {
            onRenderComplete.startCallbacks().then(() => {
                OrAssetViewer.generateGrid(this.shadowRoot);
            });
        });
    }

    protected _reloadAsset() {
        this.asset = undefined;
        this._assetModified = false;
        if (this.assetId) {
            this._loading = true;
            super._refreshEventSubscriptions();
        }
    }

    protected _isReadonly() {
        return this.readonly || !manager.hasRole(ClientRole.WRITE_ASSETS);
    }

    async onCompleted() {
        await this.updateComplete;
    }

    protected async _saveAsset() {
        if (!this.asset) {
            return;
        }
        const response = await manager.rest.api.AssetResource.update(this.asset.id!, this.asset);
        this.dispatchEvent(new OrAssetViewerSaveResultEvent({
            asset: this.asset,
            statusCode: response.status
        }));

        if (response.status === 204) {
            this._reloadAsset();
        }
    }

    protected _onAssetModified() {
        this._assetModified = true;
        this.requestUpdate();
    }

    public static generateGrid(shadowRoot: ShadowRoot | null) {
        if (shadowRoot) {
            const grid = shadowRoot.querySelector('#container');
            if (grid) {
                const rowHeight = parseInt(window.getComputedStyle(grid).getPropertyValue('grid-auto-rows'), 10);
                const rowGap = parseInt(window.getComputedStyle(grid).getPropertyValue('grid-row-gap'), 10);
                const items = shadowRoot.querySelectorAll('.panel');
                if (items) {
                    items.forEach((item) => {
                        const content = item.querySelector('.panel-content-wrapper');
                        if (content) {
                            const rowSpan = Math.ceil((content.getBoundingClientRect().height + rowGap) / (rowHeight + rowGap));
                            (item as HTMLElement).style.gridRowEnd = "span " + rowSpan;
                        }
                    });
                }
            }
        }
    }

    // TODO: Add debounce in here to minimise render calls
    _onEvent(event: SharedEvent) {
        if (event.eventType === "asset") {
            const asset = (event as AssetEvent).asset!;
            if (asset.id !== this.assetId) {
                return;
            }
            this.asset = asset;
            this._loading = false;
            return;
        }

        if (event.eventType === "attribute") {
            const attributeEvent = event as AttributeEvent;
            if (attributeEvent.attributeState!.attributeRef!.entityId !== this.assetId) {
                return;
            }
            const attrName = attributeEvent.attributeState!.attributeRef!.attributeName!;

            if (this.asset && this.asset.attributes && this.asset.attributes.hasOwnProperty(attrName)) {
                if (attributeEvent.attributeState!.deleted) {
                    delete this.asset.attributes[attrName];
                    this.asset = {...this.asset};
                }
            }
        }
    }

    protected _getPanelConfig(asset: Asset): AssetViewerConfig {
        const config = {...OrAssetViewer.DEFAULT_VIEWER_CONFIG};

        if (this.config) {

            config.viewerStyles = {...config.viewerStyles};
            config.panels = {...config.panels};
            const assetConfig = this.config.assetTypes && this.config.assetTypes.hasOwnProperty(asset.type!) ? this.config.assetTypes[asset.type!] : this.config.default;

            if (assetConfig) {

                if (assetConfig.viewerStyles) {
                    Object.assign(config.viewerStyles, assetConfig.viewerStyles);
                }

                if (assetConfig.panels) {
                    Object.entries(assetConfig.panels).forEach(([name, assetPanelConfig]) => {
                        if (config.panels!.hasOwnProperty(name)) {
                            const panelStyles = {...config.panels![name].panelStyles};
                            config.panels![name] = Object.assign(config.panels![name], {...assetPanelConfig});
                            config.panels![name].panelStyles = Object.assign(panelStyles, assetPanelConfig.panelStyles);
                        } else {
                            config.panels![name] = {...assetPanelConfig};
                        }
                    });
                }

                config.attributeViewProvider = assetConfig.attributeViewProvider || (this.config.default ? this.config.default.attributeViewProvider : undefined);
                config.panelViewProvider = assetConfig.panelViewProvider || (this.config.default ? this.config.default.panelViewProvider : undefined);
                config.propertyViewProvider = assetConfig.propertyViewProvider || (this.config.default ? this.config.default.propertyViewProvider : undefined);
                config.historyConfig = assetConfig.historyConfig || this.config.historyConfig;
            }
        }
        return config;
    }
}
