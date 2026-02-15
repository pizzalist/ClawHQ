import * as PIXI from 'pixi.js';

// Isometric helpers
export const ISO_TILE_W = 80;
export const ISO_TILE_H = 40;
export const COLS = 16;
export const ROWS = 10;

/** Convert grid (col, row) to isometric pixel coords (center of tile) */
export function gridToIso(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (ISO_TILE_W / 2),
    y: (col + row) * (ISO_TILE_H / 2),
  };
}

export class Floor {
  container: PIXI.Container;

  constructor() {
    this.container = new PIXI.Container();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, y } = gridToIso(c, r);
        // Meeting room area: cols 12-15, rows 2-5
        const isMeetingRoom = c >= 12 && c <= 15 && r >= 2 && r <= 5;
        const shade = isMeetingRoom
          ? ((r + c) % 2 === 0 ? 0x1e2236 : 0x22263e)
          : ((r + c) % 2 === 0 ? 0x1a1b2e : 0x1e1f36);

        const tile = new PIXI.Graphics();
        tile.beginFill(shade);
        tile.moveTo(x, y - ISO_TILE_H / 2);
        tile.lineTo(x + ISO_TILE_W / 2, y);
        tile.lineTo(x, y + ISO_TILE_H / 2);
        tile.lineTo(x - ISO_TILE_W / 2, y);
        tile.closePath();
        tile.endFill();

        // Subtle grid line
        tile.lineStyle(1, 0x2a2b44, 0.25);
        tile.moveTo(x, y - ISO_TILE_H / 2);
        tile.lineTo(x + ISO_TILE_W / 2, y);
        tile.lineTo(x, y + ISO_TILE_H / 2);
        tile.lineTo(x - ISO_TILE_W / 2, y);
        tile.closePath();

        this.container.addChild(tile);
      }
    }
  }
}
