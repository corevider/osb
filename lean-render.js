// Reuse the client's hidden-tab render path: world publications and their ACKs
// keep flowing at its background cadence. Loading may still draw until ready.
// Keep the GPU device alive so rendering can resume without reloading the game.
const RenderControl = {
  suspended: false, previous: null, getter: null, mask: null,
  set(enabled) {
    const suspend = !enabled;
    if (suspend === this.suspended) return true;
    let mask = null;
    try {
      if (suspend) {
        const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState');
        const getter = () => 'hidden';
        // Cover the retained frame without touching the game's canvas or GPU.
        // Outside the panel so minimising/hiding OSB keeps the game black.
        mask = el('div');
        mask.setAttribute('aria-hidden', 'true');
        mask.style.cssText = 'position:fixed!important;inset:0!important;background:#000!important;z-index:2147483645!important;pointer-events:auto!important;';
        document.documentElement.append(mask);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: getter });
        this.previous = previous; this.getter = getter; this.mask = mask;
      } else {
        // Do not overwrite a later hook installed by another script.
        if (Object.getOwnPropertyDescriptor(document, 'visibilityState')?.get === this.getter) {
          if (this.previous) Object.defineProperty(document, 'visibilityState', this.previous);
          else delete document.visibilityState;
        }
        this.mask?.remove(); this.mask = null;
        this.previous = null; this.getter = null;
      }
      this.suspended = suspend;
      this.refresh();
      return true;
    } catch {
      mask?.remove();
      UI.toast('Render toggle unavailable in this browser.', 'warn');
      return false;
    }
  },
  button() {
    this.control = UI.button('No Render', () => this.set(this.suspended));
    this.control.className = 'render-toggle';
    this.refresh();
    return this.control;
  },
  refresh() {
    if (!this.control) return;
    this.control.textContent = this.suspended ? 'Render' : 'No Render';
    this.control.setAttribute('aria-label', this.suspended ? 'Resume game rendering' : 'Suspend game rendering');
    this.control.setAttribute('aria-pressed', String(this.suspended));
    this.control.title = this.suspended ? 'Resume game rendering' : 'Suspend game rendering (the bot keeps running)';
  },
};
