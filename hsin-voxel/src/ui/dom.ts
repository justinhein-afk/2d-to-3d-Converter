// Tiny DOM helpers.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  parent?: HTMLElement | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// Per-frame HUD writers: they skip the DOM when the value is unchanged, so an idle HUD costs
// no style or layout work. Only use them for elements that are always written through them.
const lastWrites = new WeakMap<Element, Map<string, string>>();

function changed(e: Element, key: string, value: string): boolean {
  let m = lastWrites.get(e);
  if (!m) lastWrites.set(e, (m = new Map()));
  if (m.get(key) === value) return false;
  m.set(key, value);
  return true;
}

export function setText(e: Element, text: string): void {
  if (changed(e, '#text', text)) e.textContent = text;
}

/** `prop` is the CSS (kebab-case) property name. */
export function setStyle(e: HTMLElement | SVGElement, prop: string, value: string): void {
  if (changed(e, prop, value)) e.style.setProperty(prop, value);
}

export function setAttr(e: Element, name: string, value: string): void {
  if (changed(e, `@${name}`, value)) e.setAttribute(name, value);
}
