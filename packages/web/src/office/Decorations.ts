import * as PIXI from 'pixi.js';

/** Isometric potted plant */
export function createPlant(): PIXI.Container {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();

  // Pot
  g.beginFill(0x8b5e3c);
  g.moveTo(-10, 0);
  g.lineTo(10, 0);
  g.lineTo(8, 14);
  g.lineTo(-8, 14);
  g.closePath();
  g.endFill();
  // Pot rim
  g.beginFill(0xa06e4a);
  g.drawEllipse(0, 0, 11, 5);
  g.endFill();
  // Dirt
  g.beginFill(0x5a3e28);
  g.drawEllipse(0, 0, 9, 4);
  g.endFill();

  // Leaves
  const leaves = new PIXI.Graphics();
  leaves.beginFill(0x4ade80);
  leaves.drawEllipse(-6, -10, 6, 10);
  leaves.endFill();
  leaves.beginFill(0x22c55e);
  leaves.drawEllipse(5, -12, 7, 11);
  leaves.endFill();
  leaves.beginFill(0x16a34a);
  leaves.drawEllipse(0, -16, 5, 8);
  leaves.endFill();

  c.addChild(g, leaves);
  return c;
}

/** Isometric coffee machine */
export function createCoffeeMachine(): PIXI.Container {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();

  // Body
  g.beginFill(0x555555);
  g.drawRoundedRect(-12, -24, 24, 28, 3);
  g.endFill();
  // Front panel
  g.beginFill(0x444444);
  g.drawRect(-8, -18, 16, 14);
  g.endFill();
  // Button
  g.beginFill(0xe74c3c);
  g.drawCircle(0, -6, 3);
  g.endFill();
  // Base
  g.beginFill(0x666666);
  g.drawRoundedRect(-14, 4, 28, 6, 2);
  g.endFill();
  // Cup
  g.beginFill(0xeeeeee);
  g.drawRoundedRect(-5, -2, 10, 8, 2);
  g.endFill();

  // Label
  const label = new PIXI.Text('☕', { fontSize: 10 });
  label.anchor.set(0.5);
  label.position.set(0, -30);

  c.addChild(g, label);
  return c;
}

/** Isometric whiteboard */
export function createWhiteboard(): PIXI.Container {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();

  // Board frame
  g.beginFill(0x888888);
  g.drawRect(-30, -40, 60, 44);
  g.endFill();
  // White surface
  g.beginFill(0xf0f0f0);
  g.drawRect(-27, -37, 54, 38);
  g.endFill();
  // Some "writing" lines
  g.lineStyle(1, 0x3b82f6, 0.5);
  g.moveTo(-22, -30); g.lineTo(10, -30);
  g.moveTo(-22, -24); g.lineTo(18, -24);
  g.moveTo(-22, -18); g.lineTo(5, -18);
  g.lineStyle(1, 0xef4444, 0.4);
  g.moveTo(-22, -10); g.lineTo(15, -10);
  // Stand legs
  g.lineStyle(0);
  g.beginFill(0x666666);
  g.drawRect(-25, 4, 4, 16);
  g.drawRect(21, 4, 4, 16);
  g.endFill();

  c.addChild(g);
  return c;
}

/** Water cooler */
export function createWaterCooler(): PIXI.Container {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();

  // Bottle
  g.beginFill(0x93c5fd, 0.6);
  g.drawRoundedRect(-7, -30, 14, 20, 5);
  g.endFill();
  // Body
  g.beginFill(0xcccccc);
  g.drawRoundedRect(-10, -10, 20, 20, 3);
  g.endFill();
  // Tap
  g.beginFill(0x3b82f6);
  g.drawRect(8, -4, 4, 4);
  g.endFill();
  // Legs
  g.beginFill(0x999999);
  g.drawRect(-8, 10, 4, 8);
  g.drawRect(4, 10, 4, 8);
  g.endFill();

  c.addChild(g);
  return c;
}
