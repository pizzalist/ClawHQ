import * as PIXI from 'pixi.js';

/**
 * Isometric desk with 3D depth: top surface + front face + side face,
 * plus a monitor and chair.
 */
export class Desk {
  container: PIXI.Container;
  /** Seat position offset (where the agent sits relative to desk container) */
  seatOffset = { x: 0, y: 28 };

  constructor(public index: number) {
    this.container = new PIXI.Container();

    const W = 70; // half-width of desk top diamond
    const H = 35; // half-height
    const DEPTH = 12; // extrusion depth

    // --- Desk top surface ---
    const top = new PIXI.Graphics();
    top.beginFill(0x4a4070);
    top.moveTo(0, -H);
    top.lineTo(W, 0);
    top.lineTo(0, H);
    top.lineTo(-W, 0);
    top.closePath();
    top.endFill();

    // --- Front face (right side of diamond bottom) ---
    const front = new PIXI.Graphics();
    front.beginFill(0x332d55);
    front.moveTo(0, H);
    front.lineTo(W, 0);
    front.lineTo(W, DEPTH);
    front.lineTo(0, H + DEPTH);
    front.closePath();
    front.endFill();

    // --- Side face (left side of diamond bottom) ---
    const side = new PIXI.Graphics();
    side.beginFill(0x2a2545);
    side.moveTo(0, H);
    side.lineTo(-W, 0);
    side.lineTo(-W, DEPTH);
    side.lineTo(0, H + DEPTH);
    side.closePath();
    side.endFill();

    this.container.addChild(side, front, top);

    // --- Monitor (small iso box on desk) ---
    const mon = new PIXI.Graphics();
    // Screen face
    mon.beginFill(0x232440);
    mon.drawRect(-14, -30, 28, 20);
    mon.endFill();
    // Screen content glow
    mon.beginFill(0x3a3d6e);
    mon.drawRect(-11, -27, 22, 14);
    mon.endFill();
    // Stand
    mon.beginFill(0x4a4070);
    mon.drawRect(-3, -10, 6, 6);
    mon.endFill();
    mon.position.set(0, -8);
    this.container.addChild(mon);

    // --- Chair (isometric ellipse behind desk) ---
    const chair = new PIXI.Graphics();
    chair.beginFill(0x4a4070, 0.7);
    chair.drawEllipse(0, 0, 14, 8);
    chair.endFill();
    chair.beginFill(0x3a3060, 0.8);
    chair.drawEllipse(0, 0, 10, 6);
    chair.endFill();
    chair.position.set(this.seatOffset.x, this.seatOffset.y);
    this.container.addChild(chair);

    // Desk label
    const label = new PIXI.Text(`D${index + 1}`, {
      fontSize: 8,
      fill: 0x555577,
      fontFamily: 'monospace',
    });
    label.anchor.set(0.5);
    label.position.set(0, H + DEPTH + 8);
    this.container.addChild(label);
  }
}
