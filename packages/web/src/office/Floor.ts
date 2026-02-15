import * as PIXI from 'pixi.js';

// Isometric helpers
export const ISO_TILE_W = 80;
export const ISO_TILE_H = 40;
export const COLS = 10;
export const ROWS = 8;

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
        const shade = (r + c) % 2 === 0 ? 0x1a1b2e : 0x1e1f36;

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
