// Keyboard and mouse state with pointer lock, per-frame edges and double-tap detection.
import { KEYBINDS, type Action } from '../config/keybinds';

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly mouseDown = [false, false, false];
  private readonly mousePressed = [false, false, false];
  private readonly mouseReleased = [false, false, false];
  private lastForwardTap = -1;
  /** Set for one frame when W is tapped twice quickly. */
  doubleTapForward = false;
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Seconds since start, updated by the game loop. */
  now = 0;
  doubleTapWindow = 0.3;
  /** When false, game input is ignored (menus open). */
  enabled = true;
  private onLockChange: ((locked: boolean) => void) | null = null;
  /**
   * Without pointer lock (some embedded pages block it) the right button drags the camera.
   * A right click that doesn't drag still counts as a normal right click.
   */
  private rightPending = false;
  private dragLooking = false;
  private dragDistance = 0;
  /** Browsers can report one large jump right after the mouse is captured; it is ignored. */
  private skipNextMove = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseAll());
    element.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        if (this.skipNextMove) {
          this.skipNextMove = false;
          return;
        }
        // Drop implausible spikes (a known browser quirk with captured mice).
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      } else if (this.rightPending) {
        this.dragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (this.dragDistance > 6) this.dragLooking = true;
        if (this.dragLooking) {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
        }
      }
    });
    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.skipNextMove = this.locked;
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  setLockListener(fn: (locked: boolean) => void): void {
    this.onLockChange = fn;
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const p = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock unavailable (e.g. headless) */
    }
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Tab' || e.code === 'F3' || e.code === 'F5' || (e.code === 'Space' && e.target === document.body)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressed.add(e.code);
    if (KEYBINDS.forward.includes(e.code as never)) {
      if (this.now - this.lastForwardTap < this.doubleTapWindow) this.doubleTapForward = true;
      this.lastForwardTap = this.now;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.down.delete(e.code);
    this.released.add(e.code);
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button > 2) return;
    if (e.button === 2 && !this.locked) {
      this.rightPending = true;
      this.dragLooking = false;
      this.dragDistance = 0;
      return;
    }
    this.mouseDown[e.button] = true;
    this.mousePressed[e.button] = true;
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button > 2) return;
    if (e.button === 2 && this.rightPending) {
      // Released without dragging: a plain right click (place / use).
      if (!this.dragLooking) {
        this.mousePressed[2] = true;
        this.mouseReleased[2] = true;
      }
      this.rightPending = false;
      this.dragLooking = false;
      return;
    }
    if (this.mouseDown[e.button]) this.mouseReleased[e.button] = true;
    this.mouseDown[e.button] = false;
  }

  private releaseAll(): void {
    this.rightPending = false;
    this.dragLooking = false;
    for (const k of this.down) this.released.add(k);
    this.down.clear();
    for (let b = 0; b < 3; b++) {
      if (this.mouseDown[b]) this.mouseReleased[b] = true;
      this.mouseDown[b] = false;
    }
  }

  // --- Queries ---------------------------------------------------------------

  key(code: string): boolean {
    return this.down.has(code);
  }

  keyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  action(a: Action): boolean {
    if (!this.enabled) return false;
    for (const k of KEYBINDS[a]) if (this.down.has(k)) return true;
    return false;
  }

  actionPressed(a: Action): boolean {
    for (const k of KEYBINDS[a]) if (this.pressed.has(k)) return true;
    return false;
  }

  actionReleased(a: Action): boolean {
    for (const k of KEYBINDS[a]) if (this.released.has(k)) return true;
    return false;
  }

  mouse(button: number): boolean {
    return this.enabled && this.mouseDown[button];
  }

  mouseClicked(button: number): boolean {
    return this.enabled && this.mousePressed[button];
  }

  mouseUp(button: number): boolean {
    return this.mouseReleased[button];
  }

  /** Digit keys 1-9 pressed this frame, as slot index 0-8 (or -1). */
  hotbarPressed(): number {
    for (let i = 1; i <= 9; i++) if (this.pressed.has(`Digit${i}`) || this.pressed.has(`Numpad${i}`)) return i - 1;
    return -1;
  }

  /** Simulated input for automated tests and the debug console. */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }

  simulateMouse(button: number, isDown: boolean): void {
    if (isDown) {
      if (!this.mouseDown[button]) this.mousePressed[button] = true;
      this.mouseDown[button] = true;
    } else {
      if (this.mouseDown[button]) this.mouseReleased[button] = true;
      this.mouseDown[button] = false;
    }
  }

  /** Clears per-frame edges. Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    for (let b = 0; b < 3; b++) {
      this.mousePressed[b] = false;
      this.mouseReleased[b] = false;
    }
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.doubleTapForward = false;
  }
}
