// Ground warning circles for big enemy attacks. Call draw() every frame the warning should show.
import * as THREE from 'three';

interface Ring {
  fill: THREE.Mesh;
  edge: THREE.Mesh;
  used: boolean;
}

export class Telegraphs {
  private readonly pool: Ring[] = [];
  private readonly group = new THREE.Group();
  private readonly fillMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: 0xff6070, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  private readonly fillGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly edgeGeo = new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2);

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 4;
    scene.add(this.group);
  }

  /** `progress` 0..1 grows the inner fill toward the edge. */
  draw(x: number, y: number, z: number, radius: number, progress: number): void {
    let r = this.pool.find((p) => !p.used);
    if (!r) {
      r = {
        fill: new THREE.Mesh(this.fillGeo, this.fillMat),
        edge: new THREE.Mesh(this.edgeGeo, this.edgeMat),
        used: false,
      };
      r.fill.renderOrder = 4;
      r.edge.renderOrder = 4;
      this.group.add(r.fill, r.edge);
      this.pool.push(r);
    }
    r.used = true;
    const p = Math.max(0.05, Math.min(1, progress));
    r.fill.position.set(x, y + 0.04, z);
    r.fill.scale.setScalar(radius * p);
    r.edge.position.set(x, y + 0.05, z);
    r.edge.scale.setScalar(radius);
    r.fill.visible = true;
    r.edge.visible = true;
  }

  /** Hides circles that weren't drawn this frame. Call once per frame after all draws. */
  endFrame(): void {
    for (const r of this.pool) {
      if (!r.used) {
        r.fill.visible = false;
        r.edge.visible = false;
      }
      r.used = false;
    }
  }
}
