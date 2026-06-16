import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { geojson as fgbGeojson } from 'flatgeobuf';
import type { FeatureCollection } from 'geojson';
import type {
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
} from './types';
import type { DeepLinkConsumer } from '../utils/deep-link';
import type {
  GeoLibreFeatureCollection,
  GeoLibreNativeLayerRegistration,
} from '../geolibre/host-api';
import {
  D2SAuthError,
  D2SClient,
  DEFAULT_D2S_SERVER,
  DEFAULT_TITILER_URL,
  dataProductLayerName,
  isRasterDataType,
  vectorLayerName,
} from '../d2s/client';
import type {
  D2SDataProduct,
  D2SFlight,
  D2SProject,
  D2SVectorLayer,
} from '../d2s/types';

/**
 * Default options for the PluginControl.
 *
 * The host-capability callbacks default to safe behaviour so the control works
 * as a standalone MapLibre control. The GeoLibre wrapper (`src/geolibre.ts`)
 * binds them to the real host APIs when the plugin runs inside GeoLibre.
 */
const DEFAULT_OPTIONS: Required<PluginControlOptions> = {
  collapsed: true,
  position: 'top-left',
  title: 'Data to Science (D2S)',
  panelWidth: 320,
  className: '',
  pickFiles: () => Promise.resolve(null),
  registerNativeLayer: () => undefined,
  unregisterNativeLayer: () => undefined,
  fetchArrayBuffer: async (url: string) => (await fetch(url)).arrayBuffer(),
  fitBounds: () => undefined,
  serverUrl: DEFAULT_D2S_SERVER,
  titilerUrl: DEFAULT_TITILER_URL,
};

/**
 * Event handlers map type
 */
type EventHandlersMap = globalThis.Map<PluginControlEvent, Set<PluginControlEventHandler>>;

/**
 * A MapLibre GL control that browses a Data to Science (D2S) instance: log in,
 * pick a project and flight, then add raster data products (tiled via titiler)
 * and project vector layers (FlatGeobuf) to the map.
 *
 * @example
 * ```typescript
 * const control = new PluginControl({ serverUrl: 'https://ps2.d2s.org' });
 * map.addControl(control, 'top-right');
 * ```
 */
export class PluginControl implements IControl, DeepLinkConsumer {
  private _map?: MapLibreMap;
  private _mapContainer?: HTMLElement;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _status?: HTMLElement;
  private _options: Required<PluginControlOptions>;
  private _state: PluginState;
  private _eventHandlers: EventHandlersMap = new globalThis.Map();

  // D2S session + browse state
  private _client: D2SClient | null = null;
  private _projects: D2SProject[] = [];
  private _flights: D2SFlight[] = [];
  private _dataProducts: D2SDataProduct[] = [];
  private _vectorLayers: D2SVectorLayer[] = [];
  // Caches keyed by id, mirroring the QGIS plugin, to avoid refetching.
  private _flightsCache = new globalThis.Map<string, D2SFlight[]>();
  private _dataProductsCache = new globalThis.Map<string, D2SDataProduct[]>();
  private _vectorLayersCache = new globalThis.Map<string, D2SVectorLayer[]>();

  // Panel form/element references (created in _createPanel).
  private _serverInput?: HTMLInputElement;
  private _emailInput?: HTMLInputElement;
  private _passwordInput?: HTMLInputElement;
  private _loginButton?: HTMLButtonElement;
  private _browseSection?: HTMLElement;
  private _projectSelect?: HTMLSelectElement;
  private _flightSelect?: HTMLSelectElement;
  private _dataProductsList?: HTMLElement;
  private _dataProductsButton?: HTMLButtonElement;
  private _vectorSection?: HTMLElement;
  private _vectorList?: HTMLElement;
  private _vectorButton?: HTMLButtonElement;

  // Ids of native layers this control has registered with the host, so they can
  // be unregistered when the control is removed.
  private _registeredNativeLayerIds: string[] = [];

  // Panel positioning handlers
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Creates a new PluginControl instance.
   *
   * @param options - Configuration options for the control
   */
  constructor(options?: Partial<PluginControlOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      data: { serverUrl: this._options.serverUrl },
    };
  }

  /**
   * Called when the control is added to the map.
   * Implements the IControl interface.
   *
   * @param map - The MapLibre GL map instance
   * @returns The control's container element
   */
  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    this._container = this._createContainer();
    this._panel = this._createPanel();

    // Append panel to map container for independent positioning (avoids overlap with other controls)
    this._mapContainer.appendChild(this._panel);

    // Setup event listeners for panel positioning and click-outside
    this._setupEventListeners();

    // Set initial panel state
    if (!this._state.collapsed) {
      this._panel.classList.add('expanded');
      // Update position after control is added to DOM
      requestAnimationFrame(() => {
        this._updatePanelPosition();
      });
    }

    return this._container;
  }

  /**
   * Called when the control is removed from the map.
   * Implements the IControl interface.
   */
  onRemove(): void {
    // Remove event listeners
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._mapResizeHandler && this._map) {
      this._map.off('resize', this._mapResizeHandler);
      this._mapResizeHandler = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener('click', this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }

    // Hand any native layers this control registered back to the host.
    this._clearNativeLayers();

    // Remove panel from map container
    this._panel?.parentNode?.removeChild(this._panel);

    // Remove button container from control stack
    this._container?.parentNode?.removeChild(this._container);

    this._map = undefined;
    this._mapContainer = undefined;
    this._container = undefined;
    this._panel = undefined;
    this._status = undefined;
    this._eventHandlers.clear();
  }

  /**
   * Gets the current state of the control.
   *
   * @returns The current plugin state
   */
  getState(): PluginState {
    return { ...this._state };
  }

  /**
   * Updates the control state.
   *
   * @param newState - Partial state to merge with current state
   */
  setState(newState: Partial<PluginState>): void {
    this._state = { ...this._state, ...newState };
    // Reflect a restored server URL into the input if the panel is mounted.
    const serverUrl = this._state.data?.serverUrl;
    if (this._serverInput && typeof serverUrl === 'string') {
      this._serverInput.value = serverUrl;
    }
    this._emit('statechange');
  }

  /**
   * Toggles the collapsed state of the control panel.
   */
  toggle(): void {
    this._state.collapsed = !this._state.collapsed;

    if (this._panel) {
      if (this._state.collapsed) {
        this._panel.classList.remove('expanded');
        this._emit('collapse');
      } else {
        this._panel.classList.add('expanded');
        this._updatePanelPosition();
        this._emit('expand');
      }
    }

    this._emit('statechange');
  }

  /**
   * Expands the control panel.
   */
  expand(): void {
    if (this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Collapses the control panel.
   */
  collapse(): void {
    if (!this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Registers an event handler.
   *
   * @param event - The event type to listen for
   * @param handler - The callback function
   */
  on(event: PluginControlEvent, handler: PluginControlEventHandler): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Removes an event handler.
   *
   * @param event - The event type
   * @param handler - The callback function to remove
   */
  off(event: PluginControlEvent, handler: PluginControlEventHandler): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Gets the map instance.
   *
   * @returns The MapLibre GL map instance or undefined if not added to a map
   */
  getMap(): MapLibreMap | undefined {
    return this._map;
  }

  /**
   * Gets the control container element.
   *
   * @returns The container element or undefined if not added to a map
   */
  getContainer(): HTMLElement | undefined {
    return this._container;
  }

  /**
   * Preset the D2S server URL (satisfies {@link DeepLinkConsumer}). The GeoLibre
   * wrapper routes a `?d2s-server=<url>` URL parameter here.
   *
   * @param value - The D2S server URL
   */
  setServerUrl(value: string): void {
    this.setState({ data: { ...this._state.data, serverUrl: value } });
    if (this._serverInput) {
      this._serverInput.value = value;
    }
  }

  // ----- D2S workflow -----

  /** Log in to the D2S instance using the values in the auth form. */
  private async _handleLogin(): Promise<void> {
    const server = this._serverInput?.value.trim() || DEFAULT_D2S_SERVER;
    const email = this._emailInput?.value.trim() ?? '';
    const password = this._passwordInput?.value ?? '';

    if (!email || !password) {
      this._setStatus('Enter your email and password.');
      return;
    }

    this.setState({ data: { ...this._state.data, serverUrl: server } });
    this._client = new D2SClient(server, this._options.titilerUrl);

    this._setBusy(true);
    this._setStatus('Signing in...');
    try {
      await this._client.login(email, password);
      // Clear the password field once the session cookie is established.
      if (this._passwordInput) this._passwordInput.value = '';
      this._setStatus('Loading projects...');
      await this._loadProjects();
      this._showBrowseSection(true);
      this._setStatus('Ready');
    } catch (error) {
      this._client = null;
      this._showBrowseSection(false);
      this._setStatus(this._errorMessage(error, 'Login failed.'));
    } finally {
      this._setBusy(false);
    }
  }

  /** Fetch projects and populate the project select. */
  private async _loadProjects(): Promise<void> {
    if (!this._client) return;
    this._projects = await this._client.getProjects();
    this._populateSelect(
      this._projectSelect,
      this._projects.map((p) => p.title || '(untitled project)'),
      'Select a project...',
    );
    // Reset downstream selections/lists.
    this._flights = [];
    this._dataProducts = [];
    this._vectorLayers = [];
    this._populateSelect(this._flightSelect, [], 'Select a flight...');
    this._renderDataProducts();
    this._renderVectorLayers();
  }

  /** Handle project selection: load its flights and vector layers. */
  private async _onProjectChange(): Promise<void> {
    const project = this._selectedProject();
    if (!this._client || !project) return;

    this._setBusy(true);
    this._setStatus('Loading flights...');
    try {
      await Promise.all([
        this._loadFlights(project),
        this._loadVectorLayers(project),
      ]);
      this._setStatus('Ready');
    } catch (error) {
      this._setStatus(this._errorMessage(error, 'Failed to load project.'));
    } finally {
      this._setBusy(false);
    }
  }

  /** Fetch (or read cached) flights for a project. */
  private async _loadFlights(project: D2SProject): Promise<void> {
    if (!this._client) return;
    let flights = this._flightsCache.get(project.id);
    if (!flights) {
      flights = await this._client.getFlights(project.id);
      this._flightsCache.set(project.id, flights);
    }
    this._flights = flights;
    this._populateSelect(
      this._flightSelect,
      flights.map((f) => f.name || `Flight ${f.acquisition_date ?? ''}`.trim()),
      'Select a flight...',
    );
    this._dataProducts = [];
    this._renderDataProducts();
  }

  /** Handle flight selection: load its data products. */
  private async _onFlightChange(): Promise<void> {
    const project = this._selectedProject();
    const flight = this._selectedFlight();
    if (!this._client || !project || !flight) return;

    this._setBusy(true);
    this._setStatus('Loading data products...');
    try {
      let products = this._dataProductsCache.get(flight.id);
      if (!products) {
        products = await this._client.getDataProducts(project.id, flight.id);
        this._dataProductsCache.set(flight.id, products);
      }
      // Keep only raster products (drop point clouds, panoramas, 3DGS).
      this._dataProducts = products
        .filter((p) => isRasterDataType(p.data_type))
        .sort((a, b) => a.data_type.localeCompare(b.data_type));
      this._renderDataProducts();
      this._setStatus(
        this._dataProducts.length > 0 ? 'Ready' : 'No raster data products found.',
      );
    } catch (error) {
      this._setStatus(this._errorMessage(error, 'Failed to load data products.'));
    } finally {
      this._setBusy(false);
    }
  }

  /** Fetch (or read cached) vector layers for a project. */
  private async _loadVectorLayers(project: D2SProject): Promise<void> {
    if (!this._client) return;
    let layers = this._vectorLayersCache.get(project.id);
    if (!layers) {
      layers = await this._client.getVectorLayers(project.id);
      this._vectorLayersCache.set(project.id, layers);
    }
    this._vectorLayers = layers;
    this._renderVectorLayers();
  }

  /** Add the checked raster data products to the map via titiler tiles. */
  private async _addSelectedRasters(): Promise<void> {
    const project = this._selectedProject();
    const flight = this._selectedFlight();
    if (!this._client || !flight) return;

    const selected = this._checkedIndices(this._dataProductsList).map(
      (i) => this._dataProducts[i],
    );
    if (selected.length === 0) {
      this._setStatus('No data products selected.');
      return;
    }

    this._setBusy(true);
    let added = 0;
    let lastBounds: [number, number, number, number] | undefined;
    for (const product of selected) {
      try {
        this._setStatus(`Adding ${product.data_type}...`);
        const source = await this._client.getRasterTileSource(product);
        const id = `d2s-raster-${product.id}`;
        const name = dataProductLayerName(flight, product.data_type);
        this._registerNativeLayer({
          id,
          name,
          type: 'raster',
          source: {
            type: 'raster',
            tiles: source.tiles,
            tileSize: 256,
            ...(source.bounds ? { bounds: source.bounds } : {}),
            ...(source.minzoom != null ? { minzoom: source.minzoom } : {}),
            ...(source.maxzoom != null ? { maxzoom: source.maxzoom } : {}),
          },
          sourceId: `${id}-source`,
          nativeLayerIds: [`${id}-layer`],
          opacity: 1,
          metadata: {
            d2sProjectId: project?.id,
            d2sFlightId: flight.id,
            d2sDataProductId: product.id,
            dataType: product.data_type,
          },
        });
        lastBounds = source.bounds ?? lastBounds;
        added += 1;
      } catch (error) {
        this._setStatus(
          this._errorMessage(error, `Failed to add ${product.data_type}.`),
        );
      }
    }

    if (lastBounds) this._options.fitBounds(lastBounds);
    this._setBusy(false);
    this._setStatus(
      added > 0 ? `Added ${added} layer${added > 1 ? 's' : ''} to map.` : 'No layers added.',
    );
  }

  /** Add the checked vector map layers to the map (FlatGeobuf -> GeoJSON). */
  private async _addSelectedVectors(): Promise<void> {
    const project = this._selectedProject();
    if (!this._client || !project) return;

    const selected = this._checkedIndices(this._vectorList).map(
      (i) => this._vectorLayers[i],
    );
    if (selected.length === 0) {
      this._setStatus('No vector layers selected.');
      return;
    }

    this._setBusy(true);
    let added = 0;
    let lastBounds: [number, number, number, number] | undefined;
    for (const layer of selected) {
      try {
        this._setStatus(`Adding ${layer.layer_name}...`);
        const url = this._client.fgbUrlFor(project.id, layer.layer_id);
        const featureCollection = await this._loadFgb(url);
        const id = `d2s-vector-${layer.layer_id}`;
        this._registerNativeLayer({
          id,
          name: vectorLayerName(project.title, layer.layer_name),
          type: 'geojson',
          geojson: featureCollection as unknown as GeoLibreFeatureCollection,
          sourceId: `${id}-source`,
          nativeLayerIds: [`${id}-layer`],
          opacity: 1,
          style: {
            fillColor: '#2f7ed8',
            strokeColor: '#1f5fa8',
            strokeWidth: 1,
            fillOpacity: 0.3,
            circleRadius: 5,
          },
          metadata: { d2sProjectId: project.id, d2sLayerId: layer.layer_id },
        });
        const bounds = geojsonBounds(featureCollection);
        lastBounds = bounds ?? lastBounds;
        added += 1;
      } catch (error) {
        this._setStatus(
          this._errorMessage(error, `Failed to add ${layer.layer_name}.`),
        );
      }
    }

    if (lastBounds) this._options.fitBounds(lastBounds);
    this._setBusy(false);
    this._setStatus(
      added > 0
        ? `Added ${added} vector layer${added > 1 ? 's' : ''} to map.`
        : 'No layers added.',
    );
  }

  /** Fetch a FlatGeobuf file and deserialize it to a GeoJSON FeatureCollection. */
  private async _loadFgb(url: string): Promise<FeatureCollection> {
    const buffer = await this._options.fetchArrayBuffer(url);
    return fgbGeojson.deserialize(new Uint8Array(buffer)) as FeatureCollection;
  }

  // ----- Native layer bookkeeping -----

  /**
   * Register a native layer with the host, tracking its id so it can be removed
   * when the control is torn down. No-ops outside GeoLibre.
   *
   * @param layer - The native layer registration payload
   */
  private _registerNativeLayer(layer: GeoLibreNativeLayerRegistration): void {
    try {
      this._options.registerNativeLayer(layer);
      if (!this._registeredNativeLayerIds.includes(layer.id)) {
        this._registeredNativeLayerIds.push(layer.id);
      }
    } catch {
      this._setStatus('Failed to register layer with the host.');
    }
  }

  /**
   * Unregister every native layer this control registered with the host.
   */
  private _clearNativeLayers(): void {
    // Reset bookkeeping up front so internal state stays consistent even if a
    // host callback throws partway through teardown.
    const ids = [...this._registeredNativeLayerIds];
    this._registeredNativeLayerIds = [];
    for (const id of ids) {
      try {
        this._options.unregisterNativeLayer(id);
      } catch {
        // Keep clearing the remaining ids.
      }
    }
  }

  // ----- UI helpers -----

  private _selectedProject(): D2SProject | undefined {
    const index = this._projectSelect?.selectedIndex ?? 0;
    // Index 0 is the placeholder option.
    return index > 0 ? this._projects[index - 1] : undefined;
  }

  private _selectedFlight(): D2SFlight | undefined {
    const index = this._flightSelect?.selectedIndex ?? 0;
    return index > 0 ? this._flights[index - 1] : undefined;
  }

  /** Indices of checked items within a check-list container. */
  private _checkedIndices(container?: HTMLElement): number[] {
    if (!container) return [];
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const indices: number[] = [];
    checkboxes.forEach((checkbox, index) => {
      if (checkbox.checked) indices.push(index);
    });
    return indices;
  }

  /** Populate a select with a placeholder followed by the given option labels. */
  private _populateSelect(
    select: HTMLSelectElement | undefined,
    labels: string[],
    placeholder: string,
  ): void {
    if (!select) return;
    select.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);
    labels.forEach((label, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = label;
      select.appendChild(option);
    });
    select.disabled = labels.length === 0;
  }

  /** Render the data products check-list and toggle the add button. */
  private _renderDataProducts(): void {
    this._renderCheckList(
      this._dataProductsList,
      this._dataProducts.map((p) => p.data_type),
    );
    if (this._dataProductsButton) {
      this._dataProductsButton.disabled = this._dataProducts.length === 0;
    }
  }

  /** Render the vector layers check-list, hiding the section when empty. */
  private _renderVectorLayers(): void {
    const hasLayers = this._vectorLayers.length > 0;
    if (this._vectorSection) {
      this._vectorSection.style.display = hasLayers ? '' : 'none';
    }
    this._renderCheckList(
      this._vectorList,
      this._vectorLayers.map((l) => l.layer_name || 'Unnamed layer'),
    );
    if (this._vectorButton) this._vectorButton.disabled = !hasLayers;
  }

  /** Render labelled checkboxes into a list container. */
  private _renderCheckList(container: HTMLElement | undefined, labels: string[]): void {
    if (!container) return;
    container.innerHTML = '';
    if (labels.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'plugin-control-placeholder';
      empty.textContent = 'Nothing to show yet.';
      container.appendChild(empty);
      return;
    }
    for (const label of labels) {
      const row = document.createElement('label');
      row.className = 'd2s-check-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const text = document.createElement('span');
      text.textContent = label;
      row.appendChild(checkbox);
      row.appendChild(text);
      container.appendChild(row);
    }
  }

  /** Show or hide the post-login browse section. */
  private _showBrowseSection(visible: boolean): void {
    if (this._browseSection) {
      this._browseSection.style.display = visible ? '' : 'none';
    }
    if (!visible && this._vectorSection) {
      this._vectorSection.style.display = 'none';
    }
  }

  /** Enable/disable form controls while a request is in flight. */
  private _setBusy(busy: boolean): void {
    const controls: (HTMLButtonElement | HTMLSelectElement | undefined)[] = [
      this._loginButton,
      this._projectSelect,
      this._flightSelect,
      this._dataProductsButton,
      this._vectorButton,
    ];
    for (const control of controls) {
      if (control) control.disabled = busy;
    }
  }

  /** Extract a human-readable message from a thrown error. */
  private _errorMessage(error: unknown, fallback: string): string {
    if (error instanceof D2SAuthError) return error.message;
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  /**
   * Update the status line in the panel, if it is mounted.
   *
   * @param message - The status text to display
   */
  private _setStatus(message: string): void {
    if (this._status) {
      this._status.textContent = message;
    }
  }

  /**
   * Emits an event to all registered handlers.
   *
   * @param event - The event type to emit
   */
  private _emit(event: PluginControlEvent): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      const eventData = { type: event, state: this.getState() };
      handlers.forEach((handler) => handler(eventData));
    }
  }

  /**
   * Creates the main container element for the control.
   * Contains a toggle button (29x29) matching navigation control size.
   *
   * @returns The container element
   */
  private _createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group plugin-control${
      this._options.className ? ` ${this._options.className}` : ''
    }`;

    // Create toggle button (29x29 to match navigation control)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'plugin-control-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', this._options.title);
    // A drone/aerial-survey glyph, drawn with currentColor so it follows the theme.
    toggleBtn.innerHTML = `
      <span class="plugin-control-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <circle cx="5" cy="5" r="2"/>
          <circle cx="19" cy="5" r="2"/>
          <circle cx="5" cy="19" r="2"/>
          <circle cx="19" cy="19" r="2"/>
          <line x1="7" y1="7" x2="10" y2="10"/>
          <line x1="17" y1="7" x2="14" y2="10"/>
          <line x1="7" y1="17" x2="10" y2="14"/>
          <line x1="17" y1="17" x2="14" y2="14"/>
        </svg>
      </span>
    `;
    toggleBtn.addEventListener('click', () => this.toggle());

    container.appendChild(toggleBtn);

    return container;
  }

  /**
   * Creates the panel element with the D2S browse UI.
   *
   * @returns The panel element
   */
  private _createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'plugin-control-panel';
    panel.style.width = `${this._options.panelWidth}px`;

    // Header with title and close button
    const header = document.createElement('div');
    header.className = 'plugin-control-header';

    const title = document.createElement('span');
    title.className = 'plugin-control-title';
    title.textContent = this._options.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugin-control-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.collapse());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'plugin-control-content';

    content.appendChild(this._createAuthSection());
    content.appendChild(this._createBrowseSection());

    const status = document.createElement('div');
    status.className = 'plugin-control-status';
    this._status = status;
    content.appendChild(status);

    panel.appendChild(header);
    panel.appendChild(content);

    return panel;
  }

  /** Build the authentication section (server, email, password, login). */
  private _createAuthSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'd2s-section';

    this._serverInput = this._createInput(
      section,
      'Server',
      'url',
      this._state.data?.serverUrl?.toString() ?? this._options.serverUrl,
    );
    this._emailInput = this._createInput(section, 'Email', 'email');
    this._passwordInput = this._createInput(section, 'Password', 'password');
    // Submit the form on Enter from the password field.
    this._passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this._handleLogin();
    });

    const loginButton = document.createElement('button');
    loginButton.type = 'button';
    loginButton.className = 'plugin-control-button d2s-full-width';
    loginButton.textContent = 'Log in';
    loginButton.addEventListener('click', () => void this._handleLogin());
    section.appendChild(loginButton);
    this._loginButton = loginButton;

    return section;
  }

  /** Build the post-login browse section (project, flight, layer lists). */
  private _createBrowseSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'd2s-section';
    section.style.display = 'none';
    this._browseSection = section;

    const divider = document.createElement('div');
    divider.className = 'plugin-control-divider';
    section.appendChild(divider);

    // Project select
    this._projectSelect = this._createSelect(section, 'Project');
    this._projectSelect.addEventListener('change', () => void this._onProjectChange());

    // Flight select
    this._flightSelect = this._createSelect(section, 'Flight');
    this._flightSelect.addEventListener('change', () => void this._onFlightChange());

    // Data products list + add button
    const dataProductsLabel = document.createElement('label');
    dataProductsLabel.className = 'plugin-control-label';
    dataProductsLabel.textContent = 'Data products';
    section.appendChild(dataProductsLabel);

    this._dataProductsList = document.createElement('div');
    this._dataProductsList.className = 'd2s-check-list';
    section.appendChild(this._dataProductsList);

    this._dataProductsButton = this._createAddButton(section, 'Add selected to map');
    this._dataProductsButton.addEventListener('click', () => void this._addSelectedRasters());

    // Vector layers (hidden until a project has any)
    const vectorSection = document.createElement('div');
    vectorSection.className = 'd2s-subsection';
    vectorSection.style.display = 'none';
    this._vectorSection = vectorSection;

    const vectorLabel = document.createElement('label');
    vectorLabel.className = 'plugin-control-label';
    vectorLabel.textContent = 'Map layers';
    vectorSection.appendChild(vectorLabel);

    this._vectorList = document.createElement('div');
    this._vectorList.className = 'd2s-check-list';
    vectorSection.appendChild(this._vectorList);

    this._vectorButton = this._createAddButton(vectorSection, 'Add selected to map');
    this._vectorButton.addEventListener('click', () => void this._addSelectedVectors());

    section.appendChild(vectorSection);

    this._renderDataProducts();
    this._renderVectorLayers();

    return section;
  }

  /** Create a labelled text input and append it to a parent. */
  private _createInput(
    parent: HTMLElement,
    label: string,
    type: string,
    value = '',
  ): HTMLInputElement {
    const group = document.createElement('div');
    group.className = 'plugin-control-group';

    const labelEl = document.createElement('label');
    labelEl.className = 'plugin-control-label';
    labelEl.textContent = label;

    const input = document.createElement('input');
    input.type = type;
    input.className = 'plugin-control-input';
    input.value = value;
    if (type === 'email') input.autocomplete = 'username';
    if (type === 'password') input.autocomplete = 'current-password';

    group.appendChild(labelEl);
    group.appendChild(input);
    parent.appendChild(group);
    return input;
  }

  /** Create a labelled select and append it to a parent. */
  private _createSelect(parent: HTMLElement, label: string): HTMLSelectElement {
    const group = document.createElement('div');
    group.className = 'plugin-control-group';

    const labelEl = document.createElement('label');
    labelEl.className = 'plugin-control-label';
    labelEl.textContent = label;

    const select = document.createElement('select');
    select.className = 'plugin-control-input';
    select.disabled = true;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `Select a ${label.toLowerCase()}...`;
    select.appendChild(placeholder);

    group.appendChild(labelEl);
    group.appendChild(select);
    parent.appendChild(group);
    return select;
  }

  /** Create a disabled-by-default full-width "add" button. */
  private _createAddButton(parent: HTMLElement, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plugin-control-button d2s-full-width';
    button.textContent = text;
    button.disabled = true;
    parent.appendChild(button);
    return button;
  }

  /**
   * Setup event listeners for panel positioning and click-outside behavior.
   */
  private _setupEventListeners(): void {
    // Click outside to close (check both container and panel since they're now separate)
    this._clickOutsideHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        this._container &&
        this._panel &&
        !this._container.contains(target) &&
        !this._panel.contains(target)
      ) {
        this.collapse();
      }
    };
    document.addEventListener('click', this._clickOutsideHandler);

    // Update panel position on window resize
    this._resizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    // Update panel position on map resize (e.g., sidebar toggle)
    this._mapResizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    this._map?.on('resize', this._mapResizeHandler);
  }

  /**
   * Detect which corner the control is positioned in.
   *
   * @returns The position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
   */
  private _getControlPosition(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const parent = this._container?.parentElement;
    if (!parent) return 'top-right'; // Default

    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';

    return 'top-right'; // Default
  }

  /**
   * Update the panel position based on button location and control corner.
   * Positions the panel next to the button, expanding in the appropriate direction.
   */
  private _updatePanelPosition(): void {
    if (!this._container || !this._panel || !this._mapContainer) return;

    // Get the toggle button (first child of container)
    const button = this._container.querySelector('.plugin-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this._mapContainer.getBoundingClientRect();
    const position = this._getControlPosition();

    // Move the CSS resize grip to the bottom-left for right-anchored corners so
    // it tracks the cursor (the right edge is the fixed anchor there).
    const rightAnchored = position === 'top-right' || position === 'bottom-right';
    this._panel.classList.toggle('resize-left', rightAnchored);

    // Calculate button position relative to map container
    const buttonTop = buttonRect.top - mapRect.top;
    const buttonBottom = mapRect.bottom - buttonRect.bottom;
    const buttonLeft = buttonRect.left - mapRect.left;
    const buttonRight = mapRect.right - buttonRect.right;

    const panelGap = 5; // Gap between button and panel

    // Reset all positioning
    this._panel.style.top = '';
    this._panel.style.bottom = '';
    this._panel.style.left = '';
    this._panel.style.right = '';

    switch (position) {
      case 'top-left':
        // Panel expands down and to the right
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case 'top-right':
        // Panel expands down and to the left
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;

      case 'bottom-left':
        // Panel expands up and to the right
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case 'bottom-right':
        // Panel expands up and to the left
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }
  }
}

/**
 * Compute `[west, south, east, north]` bounds from a GeoJSON FeatureCollection,
 * or null when it carries no coordinates. Used to fit the map after adding a
 * vector layer.
 */
export function geojsonBounds(
  fc: FeatureCollection,
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const [x, y] = coords as number[];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    if (Array.isArray(coords)) {
      for (const child of coords) visit(child);
    }
  };

  for (const feature of fc.features) {
    const geometry = feature.geometry;
    if (geometry && 'coordinates' in geometry) {
      visit((geometry as { coordinates: unknown }).coordinates);
    }
  }

  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}
