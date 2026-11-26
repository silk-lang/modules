// A hidden DOM copy of a Silk UI app's accessibility tree, laid over its canvas, so screen
// readers can read an app that draws everything on a canvas. ui-tree-window's `web_access`
// module sends each AccessKit update as JSON (`update`); clicks and focus moves a screen
// reader makes on the copy go back as actions (`take`).
//
// Each node becomes an element with its ARIA role, name and states, placed at its bounds so
// a screen reader's highlight and touch exploration line up with what is drawn. The elements
// are transparent and take no pointer input; the canvas still gets every click. Keyboard
// focus stays on the window host's hidden text area, which names the focused node through
// `aria-activedescendant`.

const ROLES = {
  Button: 'button', DefaultButton: 'button', Link: 'link', CheckBox: 'checkbox', RadioButton: 'radio',
  TextInput: 'textbox', MultilineTextInput: 'textbox', SearchInput: 'searchbox', Heading: 'heading',
  Paragraph: 'paragraph', List: 'list', ListItem: 'listitem', Image: 'img', Dialog: 'dialog',
  AlertDialog: 'alertdialog', Menu: 'menu', MenuBar: 'menubar', MenuItem: 'menuitem',
  MenuItemCheckBox: 'menuitemcheckbox', MenuItemRadio: 'menuitemradio', Tab: 'tab', TabList: 'tablist',
  TabPanel: 'tabpanel', Toolbar: 'toolbar', Navigation: 'navigation', Main: 'main', Form: 'form',
  Group: 'group', Slider: 'slider', Switch: 'switch', ListBox: 'listbox', ListBoxOption: 'option',
  Tooltip: 'tooltip', Alert: 'alert', Status: 'status', Log: 'log', Timer: 'timer',
  ProgressIndicator: 'progressbar', Meter: 'meter', Splitter: 'separator', ComboBox: 'combobox',
  EditableComboBox: 'combobox', SpinButton: 'spinbutton', Table: 'table', RowGroup: 'rowgroup', Row: 'row',
  Cell: 'cell', ColumnHeader: 'columnheader', RowHeader: 'rowheader', Grid: 'grid', GridCell: 'gridcell',
  Tree: 'tree', TreeGrid: 'treegrid', TreeItem: 'treeitem', RadioGroup: 'radiogroup', Region: 'region',
  Banner: 'banner', ContentInfo: 'contentinfo', Complementary: 'complementary', Search: 'search',
  Article: 'article', Figure: 'figure', Document: 'document', Application: 'application', Note: 'note',
  Feed: 'feed', Math: 'math', Term: 'term', Definition: 'definition', ScrollBar: 'scrollbar',
};
/** Roles whose toggled state is `aria-checked`; other roles (buttons) say `aria-pressed`. */
const CHECKED = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem']);
/** Roles whose numbers are a range: `aria-valuenow`, and the value as `aria-valuetext`. */
const RANGES = new Set(['slider', 'spinbutton', 'progressbar', 'meter', 'scrollbar', 'separator']);
/** AccessKit's action numbers (`Action.mask`), and the ones `web_access.request` reads back. */
const CAN_FOCUS = 1 << 1;
const ACTION = { CLICK: 0, FOCUS: 1 };

const ROOT_STYLE = 'position:absolute;overflow:hidden;pointer-events:none;color:transparent;contain:layout paint;' +
  'user-select:none;-webkit-user-select:none;margin:0;padding:0;border:0';
const NODE_STYLE = 'position:fixed;overflow:hidden;margin:0;padding:0;border:0;outline:none;white-space:pre;font-size:1px;line-height:1px';

/** Sets attribute `name` to `value`, or removes it for null, undefined and false. */
function set(element, name, value) {
  if (value === undefined || value === null || value === false) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
    return;
  }
  const text = value === true ? 'true' : String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

/** The ARIA spelling of an AccessKit enum value ("True", "Horizontal", "Polite"). */
const lower = value => (value ? value.toLowerCase() : undefined);

export class AccessMirror {
  /** `host` is the page's WindowHost: its windows' canvases and its keyboard text area. */
  constructor(host) {
    this.host = host;
    /** Window id to { root, elements: Map(node id to element), focus, requests, canvas }. */
    this.windows = new Map();
  }

  /** Starts a copy for window `id`. False when its canvas is not in the page. */
  attach(id) {
    if (this.windows.has(id)) return true;
    const canvas = this.host.windows?.get(id)?.canvas ?? document.getElementById(`silk-window-${id}`);
    if (!canvas?.parentNode) return false;
    const root = document.createElement('div');
    root.setAttribute('style', ROOT_STYLE);
    root.dataset.silkAccess = String(id);
    canvas.after(root);
    // The host hides its text area from screen readers; with a copy it stands for the focused node.
    this.host.input?.removeAttribute('aria-hidden');
    if (this.host.input) set(this.host.input, 'role', 'application');
    this.windows.set(id, { id, root, canvas, elements: new Map(), top: null, focus: null, requests: [] });
    return true;
  }

  /** Applies one JSON update to window `id`'s copy. */
  update(id, json) {
    const window = this.windows.get(id);
    if (!window) return;
    const update = JSON.parse(json);
    const { root, canvas, elements } = window;
    root.style.left = `${canvas.offsetLeft}px`;
    root.style.top = `${canvas.offsetTop}px`;
    root.style.width = `${canvas.clientWidth}px`;
    root.style.height = `${canvas.clientHeight}px`;
    // Text runs get no element: their text is their label's or text box's value.
    const nodes = update.nodes.filter(node => node.role !== 'TextRun');
    for (const node of nodes) if (!elements.has(node.id)) this.make(window, node.id);
    let moved = false;
    for (const node of nodes) {
      const element = elements.get(node.id);
      this.describe(element, node);
      moved = this.place(window, element, node) || moved;
    }
    if (update.root !== undefined && update.root !== window.top) {
      window.top = update.root;
      root.replaceChildren(...(elements.has(update.root) ? [elements.get(update.root)] : []));
      moved = true;
    }
    if (moved) this.prune(window);
    // Relations name elements by id, so they resolve once every node of the update exists.
    for (const node of nodes) {
      const element = elements.get(node.id);
      set(element, 'aria-labelledby', this.idsOf(id, node.labelledBy));
      set(element, 'aria-describedby', this.idsOf(id, node.describedBy));
      set(element, 'aria-controls', this.idsOf(id, node.controls));
      set(element, 'aria-activedescendant', this.idsOf(id, node.activeDescendant && [node.activeDescendant]));
    }
    window.focus = update.focus;
    this.showFocus(id);
  }

  /** Up to `limit` actions a screen reader asked for, each [action, node id as a BigInt]. */
  take(id, limit) {
    const window = this.windows.get(id);
    return window ? window.requests.splice(0, limit) : [];
  }

  make(window, nodeId) {
    const element = document.createElement('div');
    element.id = this.elementId(window, nodeId);
    element.setAttribute('style', NODE_STYLE);
    element.append(document.createTextNode(''));
    element.addEventListener('click', event => {
      event.stopPropagation();
      window.requests.push([ACTION.CLICK, BigInt(nodeId)]);
      this.wake(window);
    });
    element.addEventListener('focus', () => {
      // A screen reader moved focus here (keyboard focus never comes here on its own): the
      // app moves its own focus, and the keyboard goes back to the window host.
      window.requests.push([ACTION.FOCUS, BigInt(nodeId)]);
      this.host.focusInput?.(window.id);
      this.wake(window);
    });
    window.elements.set(nodeId, element);
    return element;
  }

  /** Has the app's loop serve the window soon, which takes the actions. */
  wake(window) {
    const record = this.host.windows?.get(window.id);
    if (record) this.host.frame(record);
  }

  elementId(window, nodeId) {
    return `silk-access-${window.id}-${nodeId}`;
  }

  idsOf(id, nodeIds) {
    const window = this.windows.get(id);
    const found = (nodeIds ?? []).filter(n => window.elements.has(n)).map(n => this.elementId(window, n));
    return found.length ? found.join(' ') : undefined;
  }

  describe(element, node) {
    const role = ROLES[node.role];
    set(element, 'role', role);
    const text = node.role === 'Label' || role === 'textbox' || role === 'searchbox' ? node.value ?? '' : '';
    if (element.firstChild.data !== text) element.firstChild.data = text;
    set(element, 'aria-label', node.role === 'Label' ? undefined : node.label);
    set(element, 'aria-multiline', node.role === 'MultilineTextInput');
    set(element, 'aria-description', node.description);
    set(element, 'aria-placeholder', node.placeholder);
    set(element, 'aria-roledescription', node.roleDescription);
    set(element, 'aria-hidden', node.hidden);
    set(element, 'aria-disabled', node.disabled);
    set(element, 'aria-readonly', node.readOnly);
    set(element, 'aria-required', node.required);
    set(element, 'aria-busy', node.busy);
    set(element, 'aria-modal', node.modal);
    set(element, 'aria-multiselectable', node.multiselectable);
    set(element, 'aria-atomic', node.atomic);
    set(element, 'aria-live', lower(node.live));
    set(element, 'aria-invalid', lower(node.invalid));
    set(element, 'aria-orientation', lower(node.orientation));
    set(element, 'aria-expanded', node.expanded === undefined ? undefined : String(node.expanded));
    set(element, 'aria-selected', node.selected === undefined ? undefined : String(node.selected));
    set(element, 'aria-level', node.level);
    set(element, 'aria-posinset', node.posInSet);
    set(element, 'aria-setsize', node.setSize);
    const toggled = lower(node.toggled);
    set(element, 'aria-checked', CHECKED.has(role) ? toggled : undefined);
    set(element, 'aria-pressed', CHECKED.has(role) ? undefined : toggled);
    const range = RANGES.has(role);
    set(element, 'aria-valuemin', range ? node.min : undefined);
    set(element, 'aria-valuemax', range ? node.max : undefined);
    set(element, 'aria-valuenow', range ? node.now : undefined);
    set(element, 'aria-valuetext', range ? node.value : undefined);
    set(element, 'tabindex', node.actions & CAN_FOCUS ? '-1' : undefined);
  }

  /** Puts `element` at the node's bounds and its children in order. True when children changed. */
  place(window, element, node) {
    const style = element.style;
    const [x0, y0, x1, y1] = node.bounds ?? [0, 0, 0, 0];
    const left = `${x0}px`, top = `${y0}px`, width = `${Math.max(x1 - x0, 0)}px`, height = `${Math.max(y1 - y0, 0)}px`;
    if (style.left !== left) style.left = left;
    if (style.top !== top) style.top = top;
    if (style.width !== width) style.width = width;
    if (style.height !== height) style.height = height;
    const children = (node.children ?? []).map(child => window.elements.get(child)).filter(Boolean);
    const current = [...element.children];
    if (current.length === children.length && current.every((c, i) => c === children[i])) return false;
    element.replaceChildren(element.firstChild, ...children);
    return true;
  }

  /** Forgets the elements no longer in the tree. */
  prune(window) {
    for (const [nodeId, element] of window.elements) {
      if (!window.root.contains(element)) window.elements.delete(nodeId);
    }
  }

  /**
   * Points the window host's text area, which keeps the keyboard, at the focused node while
   * this window has the keyboard: `aria-activedescendant` names it, as a combo box names its
   * current option. The area takes a text box's name when the node is one (typing goes there
   * anyway), and is an application otherwise, so a screen reader announces the node and not
   * an empty edit field.
   */
  showFocus(id) {
    const window = this.windows.get(id);
    const input = this.host.input;
    if (!window || !input || this.host.focused !== id) return;
    const element = window.focus === undefined ? null : window.elements.get(window.focus);
    const shown = element && element !== window.elements.get(window.top) ? element : null;
    const role = shown?.getAttribute('role');
    const typing = role === 'textbox' || role === 'searchbox';
    set(input, 'role', typing ? undefined : 'application');
    set(input, 'aria-activedescendant', shown && !typing ? shown.id : undefined);
    set(input, 'aria-label', typing ? shown.getAttribute('aria-label') ?? undefined : undefined);
    set(input, 'aria-description', typing ? shown.getAttribute('aria-description') ?? undefined : undefined);
  }

  /**
   * The `silk_browser` imports of `web_access`: `access_attach(window)`, `access_update(window,
   * json, length)` and `access_take(window, into, capacity)`, which writes pairs of u64 words
   * (action, node id) and answers how many pairs. `memory()` gives the module's memory.
   */
  imports(memory, enabled = true) {
    const decoder = new TextDecoder();
    return {
      access_attach: window => (enabled && this.attach(window) ? 1 : 0),
      access_update: (window, pointer, length) =>
        this.update(window, decoder.decode(new Uint8Array(memory().buffer, pointer, length))),
      access_take: (window, into, capacity) => {
        const taken = this.take(window, capacity);
        const words = new BigUint64Array(memory().buffer, into, taken.length * 2);
        taken.forEach(([action, node], i) => { words[2 * i] = BigInt(action); words[2 * i + 1] = node; });
        return taken.length;
      },
    };
  }
}
