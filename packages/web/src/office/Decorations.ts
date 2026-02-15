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

/** Meeting table (large round table) */
export function createMeetingTable(): PIXI.Container {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();

  // Table shadow
  g.beginFill(0x000000, 0.2);
  g.drawEllipse(0, 6, 40, 20);
  g.endFill();

  // Table top (large oval)
  g.beginFill(0x5a4080);
  g.drawEllipse(0, -4, 38, 18);
  g.endFill();

  // Table surface highlight
  g.beginFill(0x6a50a0, 0.5);
  g.drawEllipse(0, -6, 32, 14);
  g.endFill();

  // Front face
  g.beginFill(0x3a2d55);
  g.moveTo(-38, -4);
  g.lineTo(-38, 6);
  g.lineTo(0, 18);
  g.lineTo(38, 6);
  g.lineTo(38, -4);
  g.lineTo(0, 14);
  g.closePath();
  g.endFill();

  // Label
  const label = new PIXI.Text('🏛️', { fontSize: 14 });
  label.anchor.set(0.5);
  label.position.set(0, -20);

  c.addChild(g, label);
  return c;
}

/** Glass-walled meeting room */
export function createMeetingRoom(): PIXI.Container {
  const c = new PIXI.Container();
  const TILE = 80;
  const HALF = 40;
  const roomW = TILE * 4; // 4 tiles wide
  const roomH = TILE * 3; // 3 tiles tall

  // Semi-transparent walls
  const walls = new PIXI.Graphics();

  // Back wall (top-right)
  walls.beginFill(0x2a2b44, 0.4);
  walls.moveTo(0, -roomH / 2);
  walls.lineTo(roomW / 2, -roomH / 2 + HALF);
  walls.lineTo(roomW / 2, -roomH / 2 + HALF + 8);
  walls.lineTo(0, -roomH / 2 + 8);
  walls.closePath();
  walls.endFill();

  // Back wall (top-left)
  walls.beginFill(0x2a2b44, 0.4);
  walls.moveTo(0, -roomH / 2);
  walls.lineTo(-roomW / 2, -roomH / 2 + HALF);
  walls.lineTo(-roomW / 2, -roomH / 2 + HALF + 8);
  walls.lineTo(0, -roomH / 2 + 8);
  walls.closePath();
  walls.endFill();

  // Right wall
  walls.beginFill(0x2a2b44, 0.35);
  walls.moveTo(roomW / 2, -roomH / 2 + HALF);
  walls.lineTo(roomW / 2, roomH / 2 - HALF);
  walls.lineTo(roomW / 2, roomH / 2 - HALF + 8);
  walls.lineTo(roomW / 2, -roomH / 2 + HALF + 8);
  walls.closePath();
  walls.endFill();

  // Glass effect lines
  const glass = new PIXI.Graphics();
  glass.lineStyle(1, 0x60a5fa, 0.25);
  // Horizontal lines on back walls
  for (let i = 1; i <= 3; i++) {
    const yOff = i * 2;
    glass.moveTo(-roomW / 2 + 10, -roomH / 2 + HALF + yOff);
    glass.lineTo(roomW / 2 - 10, -roomH / 2 + yOff);
  }
  // Vertical dividers
  glass.lineStyle(1, 0x60a5fa, 0.15);
  glass.moveTo(0, -roomH / 2);
  glass.lineTo(0, -roomH / 2 + 8);

  // Left wall with door opening
  const leftWall = new PIXI.Graphics();
  leftWall.beginFill(0x2a2b44, 0.35);
  // Top portion of left wall
  leftWall.moveTo(-roomW / 2, -roomH / 2 + HALF);
  leftWall.lineTo(-roomW / 2, -roomH / 2 + HALF + 30);
  leftWall.lineTo(-roomW / 2 + 4, -roomH / 2 + HALF + 30);
  leftWall.lineTo(-roomW / 2 + 4, -roomH / 2 + HALF);
  leftWall.closePath();
  leftWall.endFill();
  // Bottom portion (below door)
  leftWall.beginFill(0x2a2b44, 0.35);
  leftWall.moveTo(-roomW / 2, roomH / 2 - HALF - 10);
  leftWall.lineTo(-roomW / 2, roomH / 2 - HALF + 8);
  leftWall.lineTo(-roomW / 2 + 4, roomH / 2 - HALF + 8);
  leftWall.lineTo(-roomW / 2 + 4, roomH / 2 - HALF - 10);
  leftWall.closePath();
  leftWall.endFill();

  // Interior meeting table
  const table = new PIXI.Graphics();
  table.beginFill(0x000000, 0.15);
  table.drawEllipse(0, 6, 36, 18);
  table.endFill();
  table.beginFill(0x5a4080);
  table.drawEllipse(0, -2, 34, 16);
  table.endFill();
  table.beginFill(0x6a50a0, 0.5);
  table.drawEllipse(0, -4, 28, 12);
  table.endFill();

  // Floor highlight (room area)
  const floor = new PIXI.Graphics();
  floor.beginFill(0x1e2236, 0.3);
  floor.moveTo(0, -roomH / 2);
  floor.lineTo(roomW / 2, -roomH / 2 + HALF);
  floor.lineTo(0, roomH / 2 - HALF + 8);
  floor.lineTo(-roomW / 2, -roomH / 2 + HALF);
  floor.closePath();
  floor.endFill();

  // Label
  const label = new PIXI.Text('🏛️ Meeting Room', {
    fontSize: 11,
    fill: 0x9ca3af,
    fontFamily: 'monospace',
  });
  label.anchor.set(0.5);
  label.position.set(0, -roomH / 2 - 12);

  c.addChild(floor, walls, glass, leftWall, table, label);
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
