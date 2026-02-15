import * as PIXI from 'pixi.js';
import type { Agent, AgentRole, AgentState } from '@ai-office/shared';
import { STATE_COLORS, ROLE_EMOJI } from '@ai-office/shared';

const ROLE_BODY_COLORS: Record<AgentRole, number> = {
  pm: 0x6366f1,
  developer: 0x3b82f6,
  reviewer: 0xf59e0b,
  designer: 0xec4899,
  devops: 0x10b981,
  qa: 0x8b5cf6,
};

const SKIN = 0xffd5b4;
const HAIR = 0x4a3728;

export class AgentSprite {
  id: string;
  container: PIXI.Container;
  private body: PIXI.Graphics;
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

    // Status indicator
    this.statusDot = new PIXI.Graphics();
    this.statusDot.position.set(16, -32);
    this.container.addChild(this.statusDot);

    // Role emoji
    this.emojiLabel = new PIXI.Text(ROLE_EMOJI[agent.role], { fontSize: 16 });
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

  private drawBody(role: AgentRole) {
    const color = ROLE_BODY_COLORS[role];
    const g = this.body;
    g.clear();

    // Shadow ellipse on ground
    g.beginFill(0x000000, 0.18);
    g.drawEllipse(0, 14, 14, 6);
    g.endFill();

    // Legs
    g.beginFill(0x2a2545);
    g.drawRoundedRect(-7, 6, 5, 12, 2);
    g.drawRoundedRect(2, 6, 5, 12, 2);
    g.endFill();

    // Body / torso
    g.beginFill(color);
    g.drawRoundedRect(-10, -8, 20, 18, 5);
    g.endFill();

    // Arms
    g.beginFill(color, 0.85);
    g.drawRoundedRect(-14, -5, 5, 14, 3);
    g.drawRoundedRect(9, -5, 5, 14, 3);
    g.endFill();

    // Neck
    g.beginFill(SKIN);
    g.drawRect(-3, -12, 6, 5);
    g.endFill();

    // Head
    g.beginFill(SKIN);
    g.drawCircle(0, -20, 10);
    g.endFill();

    // Hair
    g.beginFill(HAIR);
    g.drawEllipse(0, -25, 10, 5);
    g.endFill();

    // Eyes
    g.beginFill(0x222222);
    g.drawCircle(-4, -20, 1.5);
    g.drawCircle(4, -20, 1.5);
    g.endFill();
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
      }
    }

    if (this.state === 'working') {
      // Typing bob
      this.body.pivot.y = Math.sin(t * 4) * 0.5;
      if (this.targetX === undefined) this.body.position.y = Math.sin(t * 6) * 0.8;
    } else if (this.targetX === undefined) {
      // Idle breathing — gentle vertical bob
      this.body.position.y = Math.sin(t * 1.5) * 1.2;
    }

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
