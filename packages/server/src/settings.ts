import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentModel, AgentRole } from '@clawhq/shared';

export interface ModelSettings {
  chiefModel: AgentModel;
  defaultModelByRole: Record<AgentRole, AgentModel>;
}

export const AVAILABLE_MODELS: AgentModel[] = [
  'claude-opus-4-6',
  'claude-sonnet-4',
  'openai-codex/o3',
  'openai-codex/gpt-5.3-codex',
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  chiefModel: 'claude-opus-4-6',
  defaultModelByRole: {
    pm: 'claude-opus-4-6',
    developer: 'openai-codex/gpt-5.3-codex',
    reviewer: 'claude-opus-4-6',
    designer: 'claude-sonnet-4',
    devops: 'openai-codex/o3',
    qa: 'claude-sonnet-4',
  },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

function isValidModel(value: unknown): value is AgentModel {
  return typeof value === 'string' && AVAILABLE_MODELS.includes(value as AgentModel);
}

function sanitizeSettings(input: unknown): ModelSettings {
  const parsed = (input && typeof input === 'object') ? (input as Partial<ModelSettings>) : {};
  const roleInput = parsed.defaultModelByRole && typeof parsed.defaultModelByRole === 'object'
    ? parsed.defaultModelByRole as Partial<Record<AgentRole, AgentModel>>
    : {};

  return {
    chiefModel: isValidModel(parsed.chiefModel) ? parsed.chiefModel : DEFAULT_MODEL_SETTINGS.chiefModel,
    defaultModelByRole: {
      pm: isValidModel(roleInput.pm) ? roleInput.pm : DEFAULT_MODEL_SETTINGS.defaultModelByRole.pm,
      developer: isValidModel(roleInput.developer) ? roleInput.developer : DEFAULT_MODEL_SETTINGS.defaultModelByRole.developer,
      reviewer: isValidModel(roleInput.reviewer) ? roleInput.reviewer : DEFAULT_MODEL_SETTINGS.defaultModelByRole.reviewer,
      designer: isValidModel(roleInput.designer) ? roleInput.designer : DEFAULT_MODEL_SETTINGS.defaultModelByRole.designer,
      devops: isValidModel(roleInput.devops) ? roleInput.devops : DEFAULT_MODEL_SETTINGS.defaultModelByRole.devops,
      qa: isValidModel(roleInput.qa) ? roleInput.qa : DEFAULT_MODEL_SETTINGS.defaultModelByRole.qa,
    },
  };
}

export function getSettings(): ModelSettings {
  try {
    if (!existsSync(SETTINGS_PATH)) return DEFAULT_MODEL_SETTINGS;
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return sanitizeSettings(parsed);
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

export function saveSettings(input: unknown): ModelSettings {
  const next = sanitizeSettings(input);
  mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function getChiefModel(): AgentModel {
  return getSettings().chiefModel;
}

export function getDefaultModelByRole(): Record<AgentRole, AgentModel> {
  return getSettings().defaultModelByRole;
}
