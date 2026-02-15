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
type Facing = 'left' | 'right' | 'up' | 'down';

const PIXEL_SIZE = 2;
const SPRITE_ORIGIN_X = -16;
const SPRITE_ORIGIN_Y = -34;
const WALK_SPEED = 2;

const SPRITE_UPPER_MAP: PixelMap = [
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
];

const LOWER_IDLE: Record<Facing, PixelMap> = {
  down: [
    '....aat..taa....',
    '....aattttaa....',
    '....aat..taa....',
    '....ll....ll....',
    '....ll....ll....',
    '....ll....ll....',
    '....ll....ll....',
    '...bbb....bbb...',
  ],
  up: [
    '....aattttaa....',
    '.....tttttt.....',
    '....tt....tt....',
    '....ll....ll....',
    '....ll....ll....',
    '....ll....ll....',
    '....ll....ll....',
    '...bbb....bbb...',
  ],
  left: [
    '...aaattt.......',
    '...aaattttt.....',
    '...aaattt.......',
    '...lll..lll.....',
    '...lll..lll.....',
    '...lll..lll.....',
    '...lll..lll.....',
    '..bbbb..bbb.....',
  ],
  right: [
    '.......tttaa... ',
    '.....tttttaaa... ',
    '.......tttaa... ',
    '.....lll..lll...',
    '.....lll..lll...',
    '.....lll..lll...',
    '.....lll..lll...',
    '.....bbb..bbbb..',
  ].map((row) => row.replace(/ /g, '.')),
};

const LOWER_WALK: Record<Facing, PixelMap[]> = {
  down: [
    [
      '....aat..taa....',
      '....aattttaa....',
      '....aat..taa....',
      '...lll....ll....',
      '...lll....ll....',
      '...lll....ll....',
      '...lll....ll....',
      '..bbbb....bbb...',
    ],
    [
      '....aattttaa....',
      '....aattttaa....',
      '....aattttaa....',
      '....ll....lll...',
      '....ll....lll...',
      '....ll....lll...',
      '....ll....lll...',
      '...bbb....bbbb..',
    ],
    [
      '....taa..taa....',
      '....aattttaa....',
      '....taa..taa....',
      '....ll....ll....',
      '....ll....ll....',
      '....ll....ll....',
      '....ll....ll....',
      '...bbb....bbb...',
    ],
    [
      '....tta..aat....',
      '....aattttaa....',
      '....tta..aat....',
      '....lll....ll...',
      '....lll....ll...',
      '....lll....ll...',
      '....lll....ll...',
      '..bbbb....bbb...',
    ],
  ],
  up: [
    [
      '....tt....tt....',
      '....tt....tt....',
      '....tt....tt....',
      '...lll....ll....',
      '...lll....ll....',
      '...lll....ll....',
      '...lll....ll....',
      '..bbbb....bbb...',
    ],
    [
      '....tt....tt....',
      '....tt....tt....',
      '....tt....tt....',
      '....ll....lll...',
      '....ll....lll...',
      '....ll....lll...',
      '....ll....lll...',
      '...bbb....bbbb..',
    ],
    [
      '....tt....tt....',
      '....tt....tt....',
      '....tt....tt....',
      '....ll....ll....',
      '....ll....ll....',
      '....ll....ll....',
      '....ll....ll....',
      '...bbb....bbb...',
    ],
    [
      '....tt....tt....',
      '....tt....tt....',
      '....tt....tt....',
      '....lll....ll...',
      '....lll....ll...',
      '....lll....ll...',
      '....lll....ll...',
      '..bbbb....bbb...',
    ],
  ],
  left: [LOWER_IDLE.left, LOWER_IDLE.left, LOWER_IDLE.left, LOWER_IDLE.left],
  right: [LOWER_IDLE.right, LOWER_IDLE.right, LOWER_IDLE.right, LOWER_IDLE.right],
};

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
  private effects: PIXI.Graphics;
  private statusDot: PIXI.Graphics;
  private nameLabel: PIXI.Text;
  private emojiLabel: PIXI.Text;
  private selectionRing: PIXI.Graphics;
  private state: AgentState = 'idle';
  private role: AgentRole;
  private animPhase = Math.random() * Math.PI * 2;
  private tickerFn: () => void;
  private targetX: number | undefined;
  private targetY: number | undefined;
  private facing: Facing = 'down';
  private walkFrame = 0;
  private lastBodyKey = '';
  private lastAccessoryKind: 'idle' | 'working' | null = null;

  constructor(agent: Agent) {
    this.id = agent.id;
    this.role = agent.role;
    this.container = new PIXI.Container();

    this.selectionRing = new PIXI.Graphics();
    this.selectionRing.visible = false;
    this.container.addChild(this.selectionRing);

    this.effects = new PIXI.Graphics();
    this.container.addChild(this.effects);

    this.body = new PIXI.Graphics();
    this.container.addChild(this.body);

    this.accessory = new PIXI.Graphics();
    this.container.addChild(this.accessory);

    this.statusDot = new PIXI.Graphics();
    this.statusDot.position.set(16, -32);
    this.container.addChild(this.statusDot);

    this.emojiLabel = new PIXI.Text(OFFICE_CHARACTER_EMOJI[agent.role], { fontSize: 16 });
    this.emojiLabel.anchor.set(0.5);
    this.emojiLabel.position.set(0, -44);
    this.container.addChild(this.emojiLabel);

    this.nameLabel = new PIXI.Text(agent.name, {
      fontSize: 10,
      fill: 0xccccdd,
      fontFamily: 'monospace',
    });
    this.nameLabel.anchor.set(0.5);
    this.nameLabel.position.set(0, 24);
    this.container.addChild(this.nameLabel);

    this.tickerFn = () => this.animate();
    PIXI.Ticker.shared.add(this.tickerFn);

    this.redrawBody(false);
    this.drawAccessory('idle');
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

  private redrawBody(isMoving: boolean) {
    const key = `${this.facing}:${this.walkFrame}:${isMoving ? 1 : 0}`;
    if (key === this.lastBodyKey) return;
    this.lastBodyKey = key;

    const g = this.body;
    g.clear();

    g.beginFill(0x000000, 0.2);
    g.drawRect(-12, 13, 24, 2);
    g.drawRect(-8, 15, 16, 2);
    g.endFill();

    const palette = ROLE_PALETTES[this.role];
    this.drawPixelMap(g, SPRITE_UPPER_MAP, palette);

    const lower = isMoving ? LOWER_WALK[this.facing][this.walkFrame % 4] : LOWER_IDLE[this.facing];
    this.drawPixelMap(g, lower, palette, 16);

    if (this.role !== 'reviewer') {
      g.beginFill(palette.e);
      if (this.facing === 'left') {
        g.drawRect(SPRITE_ORIGIN_X + 5 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 3 * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      } else if (this.facing === 'right') {
        g.drawRect(SPRITE_ORIGIN_X + 10 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 3 * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      } else {
        g.drawRect(SPRITE_ORIGIN_X + 6 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 3 * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
        g.drawRect(SPRITE_ORIGIN_X + 9 * PIXEL_SIZE, SPRITE_ORIGIN_Y + 3 * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      }
      g.endFill();
    } else {
      g.beginFill(palette.m);
      const lineY = this.facing === 'up' ? 3 : 4;
      g.drawRect(SPRITE_ORIGIN_X + 5 * PIXEL_SIZE, SPRITE_ORIGIN_Y + lineY * PIXEL_SIZE, 6 * PIXEL_SIZE, 2 * PIXEL_SIZE);
      g.endFill();
    }
  }

  private drawAccessory(kind: 'idle' | 'working') {
    if (this.lastAccessoryKind === kind) return;
    this.lastAccessoryKind = kind;
    this.accessory.clear();
    const palette = ROLE_PALETTES[this.role];
    const accessory = kind === 'working' ? ROLE_ACCESSORY_WORK[this.role] : ROLE_ACCESSORY_IDLE[this.role];
    this.drawPixelMap(this.accessory, accessory, palette, 0);
  }

  private drawSelectionRing(visible: boolean) {
    const g = this.selectionRing;
    g.clear();
    if (!visible) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const color = ROLE_BODY_COLORS[this.role];
    g.lineStyle(2, color, 0.6);
    g.drawEllipse(0, 14, 20, 10);
    g.lineStyle(3, color, 0.25);
    g.drawEllipse(0, 14, 24, 12);
  }

  private updateFacing(dx: number, dy: number) {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.facing = dx >= 0 ? 'right' : 'left';
    } else {
      this.facing = dy >= 0 ? 'down' : 'up';
    }
  }

  private drawRoleEffects(t: number, isMoving: boolean) {
    const e = this.effects;
    e.clear();

    switch (this.role) {
      case 'pm': {
        const pulse = 0.45 + 0.2 * Math.sin(t * 4);
        e.lineStyle(2, 0xf59e0b, pulse);
        e.drawEllipse(0, 1, 13 + Math.sin(t * 3), 6 + Math.cos(t * 3) * 0.6);
        e.lineStyle(1, 0xfb923c, 0.5);
        e.drawEllipse(0, -6, 9 + Math.sin(t * 2.4), 4);
        break;
      }
      case 'developer': {
        e.lineStyle(1.5, 0x60a5fa, 0.55);
        const x = Math.sin(t * 8) * 4;
        e.moveTo(-8 + x, -10);
        e.lineTo(-3 + x, -15);
        e.lineTo(0 + x, -11);
        e.moveTo(3 - x, -8);
        e.lineTo(7 - x, -13);
        e.lineTo(10 - x, -9);
        e.lineStyle(1, 0xa855f7, 0.4);
        e.drawCircle(-8, -3, 1.2);
        e.drawCircle(8, -5, 1.2);
        break;
      }
      case 'reviewer': {
        const scanY = -28 + ((Math.sin(t * 5) + 1) / 2) * 9;
        e.lineStyle(1.5, 0xcbd5e1, 0.6);
        e.moveTo(-9, scanY);
        e.lineTo(9, scanY);
        e.lineStyle(1, 0xe2e8f0, 0.3);
        e.drawRect(-10, scanY - 1, 20, 2);
        break;
      }
      case 'designer': {
        e.beginFill(0xf9a8d4, 0.55);
        for (let i = 0; i < 4; i++) {
          const px = Math.sin(t * 1.6 + i * 1.7) * (8 + i);
          const py = -8 + Math.cos(t * 2 + i) * (4 + i * 0.8);
          e.drawCircle(px, py, i % 2 === 0 ? 1.2 : 1.6);
        }
        e.endFill();
        break;
      }
      case 'devops': {
        e.beginFill(0x7c3aed, 0.2);
        e.drawEllipse(-7 + Math.sin(t * 1.5) * 2, -6, 6, 4);
        e.drawEllipse(7 + Math.cos(t * 1.3) * 2, -2, 6, 4);
        e.endFill();
        e.lineStyle(1, 0x6d28d9, 0.45);
        e.drawEllipse(0, 6, 11, 3 + Math.sin(t * 3));
        break;
      }
      case 'qa': {
        e.lineStyle(1.2, 0x22c55e, 0.6);
        e.drawRoundedRect(-8, -14, 16, 7, 2);
        e.beginFill(0x86efac, 0.35);
        e.drawCircle(-6 + Math.sin(t * 4) * 2, 0 + (isMoving ? Math.sin(t * 8) * 2 : 0), 1.4);
        e.drawCircle(6 + Math.cos(t * 4.5) * 2, 2 + (isMoving ? Math.cos(t * 7) * 2 : 0), 1.2);
        e.endFill();
        break;
      }
    }
  }

  private animate() {
    const t = Date.now() / 1000 + this.animPhase;
    let isMoving = false;

    if (this.targetX !== undefined && this.targetY !== undefined) {
      const dx = this.targetX - this.container.position.x;
      const dy = this.targetY - this.container.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        this.container.position.set(this.targetX, this.targetY);
        this.targetX = undefined;
        this.targetY = undefined;
      } else {
        const ratio = WALK_SPEED / dist;
        this.container.position.x += dx * ratio;
        this.container.position.y += dy * ratio;
        this.updateFacing(dx, dy);
        this.walkFrame = Math.floor((t * 10) % 4);
        isMoving = true;
      }
    }

    this.redrawBody(isMoving);

    if (isMoving) {
      this.body.position.y = Math.sin(t * 10) * 1.7;
      this.accessory.position.y = this.body.position.y;
      this.accessory.alpha = 1;
      this.drawAccessory('working');
    } else if (this.state === 'working') {
      this.body.position.y = Math.sin(t * 5) * 0.9;
      this.accessory.position.y = this.body.position.y;
      this.accessory.alpha = 1;
      this.drawAccessory('working');
    } else {
      const breathing = Math.sin(t * 1.7) * 1.1;
      this.body.position.y = breathing;
      this.accessory.position.y = breathing;
      this.accessory.alpha = 0.75 + 0.25 * (Math.sin(t * 2.8) > 0 ? 1 : 0.65);
      this.drawAccessory(Math.sin(t * 2.8) > 0 ? 'idle' : 'working');
    }

    this.drawRoleEffects(t, isMoving);
    this.effects.position.y = this.body.position.y;

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
