import * as PIXI from 'pixi.js';
import type { Agent } from '@ai-office/shared';
import { Floor, gridToIso } from './Floor';
import { Desk } from './Desk';
import { AgentSprite } from './AgentSprite';
import { createPlant, createCoffeeMachine, createWhiteboard, createWaterCooler, createMeetingTable } from './Decorations';

/** Desk grid positions (col, row) on the isometric grid */
const DESK_POSITIONS: [number, number][] = [
  [2, 2], [4, 2], [6, 2], [8, 2],
  [2, 5], [4, 5], [6, 5], [8, 5],
];

/** Grid position for the meeting area */
const MEETING_POS: [number, number] = [5, 7];

/** Seat offsets around the meeting table (relative to table center) */
const MEETING_SEATS: { x: number; y: number }[] = [
  { x: -30, y: -10 }, { x: 30, y: -10 },
  { x: -30, y: 15 }, { x: 30, y: 15 },
  { x: 0, y: -18 }, { x: 0, y: 22 },
];

export class OfficeScene {
  private app: PIXI.Application;
  private floor: Floor;
  private desks: Desk[] = [];
  private agentSprites: Map<string, AgentSprite> = new Map();
  private container: PIXI.Container;
  private onSelectAgent?: (id: string) => void;
  private meetingParticipants: Set<string> = new Set();
  private meetingTablePos: { x: number; y: number };

  constructor(element: HTMLElement, onSelectAgent?: (id: string) => void) {
    this.onSelectAgent = onSelectAgent;
    this.app = new PIXI.Application({
      resizeTo: element,
      backgroundColor: 0x0f0f1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    element.appendChild(this.app.view as HTMLCanvasElement);

    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.app.stage.addChild(this.container);

    // Floor
    this.floor = new Floor();
    this.floor.container.zIndex = 0;
    this.container.addChild(this.floor.container);

    // Decorations (placed by grid position, converted to iso)
    this.addDecorations();

    // Desks
    for (let i = 0; i < DESK_POSITIONS.length; i++) {
      const [c, r] = DESK_POSITIONS[i];
      const { x, y } = gridToIso(c, r);
      const desk = new Desk(i);
      desk.container.position.set(x, y);
      desk.container.zIndex = y + 1;
      this.container.addChild(desk.container);
      this.desks.push(desk);
    }

    this.centerView();
    this.app.renderer.on('resize', () => this.centerView());
  }

  private addDecorations() {
    const decorations: { create: () => PIXI.Container; col: number; row: number }[] = [
      { create: createPlant, col: 0, row: 0 },
      { create: createPlant, col: 9, row: 0 },
      { create: createPlant, col: 0, row: 7 },
      { create: createPlant, col: 9, row: 7 },
      { create: createCoffeeMachine, col: 9, row: 3 },
      { create: createWaterCooler, col: 9, row: 4 },
      { create: createWhiteboard, col: 0, row: 3 },
      { create: createPlant, col: 5, row: 0 },
    ];

    for (const d of decorations) {
      const { x, y } = gridToIso(d.col, d.row);
      const obj = d.create();
      obj.position.set(x, y);
      (obj as any).zIndex = y + 2;
      this.container.addChild(obj);
    }
  }

  private centerView() {
    const w = this.app.renderer.width / (window.devicePixelRatio || 1);
    const h = this.app.renderer.height / (window.devicePixelRatio || 1);
    // Approximate bounding box of the iso grid
    const gridCenterX = 0; // iso grid is roughly symmetric around x=0
    const gridCenterY = 160; // vertical center of an 8-row grid
    this.container.position.set(
      w / 2 - gridCenterX,
      h / 2 - gridCenterY + 20,
    );
  }

  setSelectedAgent(id: string | null) {
    for (const [agentId, sprite] of this.agentSprites) {
      sprite.setSelected(agentId === id);
    }
  }

  /** Ensure we have at least `count` desks, adding new ones dynamically */
  private ensureDesks(count: number) {
    while (this.desks.length < count) {
      const i = this.desks.length;
      // Extend the grid: continue the 2-row pattern (rows 2,5,8,11,...) with cols cycling 2,4,6,8
      const row = 2 + Math.floor(i / 4) * 3;
      const col = 2 + (i % 4) * 2;
      const { x, y } = gridToIso(col, row);
      const desk = new Desk(i);
      desk.container.position.set(x, y);
      desk.container.zIndex = y + 1;
      this.container.addChild(desk.container);
      this.desks.push(desk);
    }
  }

  updateAgents(agents: Agent[]) {
    const seen = new Set<string>();

    // Ensure enough desks for all agents
    this.ensureDesks(agents.length);

    for (const agent of agents) {
      seen.add(agent.id);
      let sprite = this.agentSprites.get(agent.id);
      if (!sprite) {
        sprite = new AgentSprite(agent);
        sprite.container.eventMode = 'static';
        sprite.container.cursor = 'pointer';
        sprite.container.on('pointertap', () => this.onSelectAgent?.(agent.id));
        this.agentSprites.set(agent.id, sprite);
        this.container.addChild(sprite.container);
      }
      sprite.update(agent);

      // Position at desk — use deskIndex modulo available desks
      const deskIdx = agent.deskIndex % this.desks.length;
      const desk = this.desks[deskIdx];
      if (desk) {
        const sx = desk.container.x + desk.seatOffset.x;
        const sy = desk.container.y + desk.seatOffset.y;
        sprite.moveTo(sx, sy);
        sprite.container.zIndex = sy + 5;
      }
    }

    // Remove departed agents
    for (const [id, sprite] of this.agentSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.container.removeChild(sprite.container);
        this.agentSprites.delete(id);
      }
    }
  }

  destroy() {
    for (const [, sprite] of this.agentSprites) {
      sprite.destroy();
    }
    this.app.destroy(true, { children: true });
  }
}
