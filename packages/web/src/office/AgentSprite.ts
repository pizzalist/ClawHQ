import * as PIXI from 'pixi.js';
import type { Agent, AgentRole, AgentState } from '@ai-office/shared';
import { STATE_COLORS, OFFICE_CHARACTER_EMOJI } from '@ai-office/shared';

const ROLE_BODY_COLORS: Record<AgentRole, number> = {
  pm: 0x6366f1,
  developer: 0x3b82f6,
  reviewer: 0xf59e0b,
  designer: 0xec4899,
  devops: 0x10b981,
  qa: 0x8b5cf6,
};

type PixelMap = string[];
type Palette = Record<string, number>;

const PIXEL_SIZE = 2;
const SPRITE_ORIGIN_X = -16;
const SPRITE_ORIGIN_Y = -34;

const SPRITE_BASE_MAP: PixelMap = [
  '....hhhhhhhh....',
  '...hhhhhhhhhh...',
  '...hffffffffh...',
  '...hffffffffh...',
  '...hffffffffh...',
  '....nnnnnnnn....',
  '....tttttttt....',
  '...tttttttttt...',
  '..tttttttttttt..',
  '..tttttttttttt..',
  '..tttttttttttt..',
  '..tttttttttttt..',
  '..tttttttttttt..',
  '..tttttttttttt..',
  '...tttttttttt...',
  '....tttttttt....',
  '....aat..taa....',
  '....aattttaa....',
  '....aat..taa....',
  '....ll....ll....',
  '....ll....ll....',
  '....ll....ll....',
  '....ll....ll....',
  '...bbb....bbb...',
];

const ROLE_PALETTES: Record<AgentRole, Palette> = {
  pm: {
    h: 0xf5d54b,
    f: 0xffd8bd,
    n: 0xf2c7a7,
    t: 0xf08a2e,
    a: 0xdb7422,
    l: 0x2d3557,
    b: 0x161b2f,
    e: 0x2a2a2a,
    m: 0x1f2937,
    p: 0x3f3f46,
    r: 0x9f7aea,
    g: 0x2f855a,
  },
  developer: {
    h: 0x1f2937,
    f: 0xf4d2bc,
    n: 0xe9c0a6,
    t: 0x4a57a9,
    a: 0x5f3dc4,
    l: 0x1f2a44,
    b: 0x111827,
    e: 0x2a2a2a,
    m: 0x111827,
    p: 0x6b7280,
    r: 0x7e22ce,
    g: 0x2f855a,
  },
  reviewer: {
    h: 0xced4de,
    f: 0xf0cfb8,
    n: 0xe2bca3,
    t: 0x415e95,
    a: 0x2f4d7e,
    l: 0x243447,
    b: 0x1b2435,
    e: 0x1f2937,
    m: 0x2f3b4d,
    p: 0x9ca3af,
    r: 0x6b7280,
    g: 0x2f855a,
  },
  designer: {
    h: 0xf58ad0,
    f: 0xffd4c0,
    n: 0xedbea5,
    t: 0xc53048,
    a: 0x9b2c3d,
    l: 0x3a2b3f,
    b: 0x1f1724,
    e: 0x2a2a2a,
    m: 0x1f2937,
    p: 0xf472b6,
    r: 0x7f1d1d,
    g: 0x2f855a,
  },
  devops: {
    h: 0x18181b,
    f: 0xf0dfda,
    n: 0xe4d1cb,
    t: 0xd7d6dc,
    a: 0x6d3f88,
    l: 0x2d2a38,
    b: 0x18151f,
    e: 0x2a2a2a,
    m: 0x374151,
    p: 0x6b7280,
    r: 0x7c3aed,
    g: 0x2f855a,
  },
  qa: {
    h: 0xf4f6fb,
    f: 0xf6d7c0,
    n: 0xe9c1a8,
    t: 0xb63434,
    a: 0x2f855a,
    l: 0x3b2f2f,
    b: 0x1f1724,
    e: 0x2a2a2a,
    m: 0x1f2937,
    p: 0x9ca3af,
    r: 0x991b1b,
    g: 0x2f855a,
  },
};

const ROLE_ACCESSORY_IDLE: Record<AgentRole, PixelMap> = {
  pm: ['.....r..........'],
  developer: ['............r...'],
  reviewer: ['....pppppppp....'],
  designer: ['.............p..'],
  devops: ['....rrrrrrrr....'],
  qa: ['...g..........g.'],
};

const ROLE_ACCESSORY_WORK: Record<AgentRole, PixelMap> = {
  pm: ['......r.........'],
  developer: ['...........r....'],
  reviewer: ['....pppppppp....'],
  designer: ['............p...'],
  devops: ['....rrrrrrrr....'],
  qa: ['....g........g..'],
};

export class AgentSprite {
  id: string;
  container: PIXI.Container;
  private body: PIXI.Graphics;
  private accessory: PIXI.Graphics;
  private statusDot: PIXI.Graphics;
  private nameLabel: PIXI.Text;
  private emojiLabel: PIXI.Text;
  private selectionRing: PIXI.Graphics;
  private state: AgentState = 'idle';
  private role: AgentRole;
  private animPhase = Math.random() * Math.PI * 2; // desync animations
  private tickerFn: () => void;
  private targetX: number | undefined;
  private targetY: number | undefined;

  constructor(agent: Agent) {
    this.id = agent.id;
    this.role = agent.role;
    this.container = new PIXI.Container();

    // Selection glow ring (drawn below everything)
    this.selectionRing = new PIXI.Graphics();
    this.selectionRing.visible = false;
    this.container.addChild(this.selectionRing);

    // Body
    this.body = new PIXI.Graphics();
    this.drawBody(agent.role);
    this.container.addChild(this.body);

    this.accessory = new PIXI.Graphics();
    this.drawAccessory('idle');
    this.container.addChild(this.accessory);

    // Status indicator
    this.statusDot = new PIXI.Graphics();
    this.statusDot.position.set(16, -32);
    this.container.addChild(this.statusDot);

    // Role emoji
    this.emojiLabel = new PIXI.Text(OFFICE_CHARACTER_EMOJI[agent.role], { fontSize: 16 });
    this.emojiLabel.anchor.set(0.5);
    this.emojiLabel.position.set(0, -44);
    this.container.addChild(this.emojiLabel);

    // Name
    this.nameLabel = new PIXI.Text(agent.name, {
      fontSize: 10,
      fill: 0xccccdd,
      fontFamily: 'monospace',
    });
    this.nameLabel.anchor.set(0.5);
    this.nameLabel.position.set(0, 24);
    this.container.addChild(this.nameLabel);

    // Animate
    this.tickerFn = () => this.animate();
    PIXI.Ticker.shared.add(this.tickerFn);

    this.update(agent);
  }

  private drawPixelMap(g: PIXI.Graphics, map: PixelMap, palette: Palette, startRow = 0) {
    for (let y = 0; y < map.length; y++) {
      const row = map[y];
      for (let x = 0; x < row.length; x++) {
        const key = row[x];
        if (key === '.') continue;
        const color = palette[key];
        if (color === undefined) continue;
        g.beginFill(color);
        g.drawRect(
          SPRITE_ORIGIN_X + x * PIXEL_SIZE,
          SPRITE_ORIGIN_Y + (startRow + y) * PIXEL_SIZE,
          PIXEL_SIZE,
          PIXEL_SIZE,
        );
        g.endFill();
      }
    }
  }

  private drawBody(role: AgentRole) {
    const g = this.body;
    g.clear();

    // Pixel-style shadow on ground
    g.beginFill(0x000000, 0.2);
    g.drawRect(-12, 13, 24, 2);
    g.drawRect(-8, 15, 16, 2);
    g.endFill();

    const palette = ROLE_PALETTES[role];
    this.drawPixelMap(g, SPRITE_BASE_MAP, palette);

    // Eyes/mask details shared by roles (retro 2px accents)
    if (role !== 'reviewer') {
      g.beginFill(palette.e);
      g.drawRect(SPRITE_ORIGIN_X + 6 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 3 * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      g.drawRect(SPRITE_ORIGIN_X + 9 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 3 * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      g.endFill();
    } else {
      // Kakashi-like masked face look
      g.beginFill(palette.m);
      g.drawRect(SPRITE_ORIGIN_X + 5 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 4 * PIXEL_SIZE, 6 * PIXEL_SIZE, 2 * PIXEL_SIZE);
      g.endFill();
    }
  }

  private drawAccessory(kind: 'idle' | 'working') {
    this.accessory.clear();
    const palette = ROLE_PALETTES[this.role];
    const accessory = kind === 'working' ? ROLE_ACCESSORY_WORK[this.role] : ROLE_ACCESSORY_IDLE[this.role];
    this.drawPixelMap(this.accessory, accessory, palette, 0);
  }

  private drawSelectionRing(visible: boolean) {
    const g = this.selectionRing;
    g.clear();
    if (!visible) { g.visible = false; return; }
    g.visible = true;
    const color = ROLE_BODY_COLORS[this.role];
    // Glowing ellipse
    g.lineStyle(2, color, 0.6);
    g.drawEllipse(0, 14, 20, 10);
    g.lineStyle(3, color, 0.25);
    g.drawEllipse(0, 14, 24, 12);
  }

  private animate() {
    const t = Date.now() / 1000 + this.animPhase;

    // Smooth walking toward target
    if (this.targetX !== undefined && this.targetY !== undefined) {
      const dx = this.targetX - this.container.position.x;
      const dy = this.targetY - this.container.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) {
        this.container.position.set(this.targetX, this.targetY);
        this.targetX = undefined;
        this.targetY = undefined;
      } else {
        const speed = 2; // px per frame
        const ratio = speed / dist;
        this.container.position.x += dx * ratio;
        this.container.position.y += dy * ratio;
        // Walking bob
        this.body.position.y = Math.sin(t * 8) * 2;
        this.accessory.position.y = this.body.position.y;
      }
    }

    if (this.state === 'working') {
      // Typing bob
      this.body.pivot.y = Math.sin(t * 4) * 0.5;
      if (this.targetX === undefined) this.body.position.y = Math.sin(t * 6) * 0.8;
      this.drawAccessory('working');
    } else if (this.targetX === undefined) {
      // Idle breathing — gentle vertical bob
      this.body.position.y = Math.sin(t * 1.5) * 1.2;
      this.drawAccessory(Math.sin(t * 2.2) > 0 ? 'idle' : 'working');
    }

    this.accessory.position.y = this.body.position.y;

    // Selection ring pulse
    if (this.selectionRing.visible) {
      this.selectionRing.alpha = 0.6 + 0.4 * Math.sin(t * 3);
    }
  }

  update(agent: Agent) {
    this.state = agent.state;
    const stateColor = parseInt(STATE_COLORS[agent.state].replace('#', ''), 16);
    this.statusDot.clear();
    this.statusDot.beginFill(stateColor);
    this.statusDot.drawCircle(0, 0, 4);
    this.statusDot.endFill();

    if (agent.state === 'working') {
      this.statusDot.alpha = 0.5 + 0.5 * Math.sin(Date.now() / 300);
    } else {
      this.statusDot.alpha = 1;
    }
  }

  setSelected(selected: boolean) {
    this.drawSelectionRing(selected);
    this.nameLabel.style.fill = selected ? 0xffffff : 0xccccdd;
  }

  moveTo(x: number, y: number) {
    // If not yet placed, teleport; otherwise animate
    if (this.container.position.x === 0 && this.container.position.y === 0) {
      this.container.position.set(x, y);
    } else {
      this.targetX = x;
      this.targetY = y;
    }
  }

  destroy() {
    PIXI.Ticker.shared.remove(this.tickerFn);
    this.container.destroy({ children: true });
  }
}
