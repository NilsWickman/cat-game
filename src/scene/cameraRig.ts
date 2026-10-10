import * as THREE from "three";

const CENTER = new THREE.Vector3(0, 0.9, 0);

/** Orbits the diorama from its open side. Zoom is a multiplier on the distance that fits the room. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private az = Math.PI / 4;
  private el = 0.62;
  private zoom = 1;
  private target = CENTER.clone();
  private cur = { az: this.az, el: this.el, zoom: 1, target: CENTER.clone() };
  private fitDist = 20;

  resize(width: number, height: number) {
    const cam = this.camera;
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    const vt = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const ht = vt * cam.aspect;
    // In portrait the room's side corners crop slightly so the cats are bigger; pinch out to see all.
    this.fitDist = Math.max(4.3 / ht, 4.4 / vt);
  }

  rotate(dx: number, dy: number) {
    this.az = THREE.MathUtils.clamp(this.az - dx * 0.008, -0.15, Math.PI / 2 + 0.15);
    this.el = THREE.MathUtils.clamp(this.el + dy * 0.005, 0.25, 1.2);
  }

  /** factor < 1 zooms in. Zooming in drifts the focus toward the given floor point. */
  zoomAt(factor: number, focus: THREE.Vector3 | null) {
    const old = this.zoom;
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.4, 1.35);
    if (this.zoom < old && focus) {
      this.target.lerp(new THREE.Vector3(focus.x, CENTER.y, focus.z), 1 - this.zoom / old);
    } else if (this.zoom > old) {
      const k = Math.min(1, (this.zoom - old) / Math.max(0.01, 1 - old));
      this.target.lerp(CENTER, k);
    }
    this.target.x = THREE.MathUtils.clamp(this.target.x, -3, 3);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -3, 3);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    const c = this.cur;
    c.az += (this.az - c.az) * k;
    c.el += (this.el - c.el) * k;
    c.zoom += (this.zoom - c.zoom) * k;
    c.target.lerp(this.target, k);
    const d = this.fitDist * c.zoom;
    this.camera.position.set(
      c.target.x + Math.sin(c.az) * Math.cos(c.el) * d,
      c.target.y + Math.sin(c.el) * d,
      c.target.z + Math.cos(c.az) * Math.cos(c.el) * d,
    );
    this.camera.lookAt(c.target);
  }
}
