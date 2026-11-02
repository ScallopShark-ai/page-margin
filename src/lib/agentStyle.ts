export type AgentStylePreset =
  | 'balanced'
  | 'detailed'
  | 'concise'
  | 'critical'
  | 'socratic'
  | 'custom';

export interface AgentStyle {
  preset: AgentStylePreset;
  custom: string;
}

export const AGENT_STYLE_STORAGE_KEY = 'pagemargin.agentStyle.v1';
export const MAX_CUSTOM_STYLE_CHARS = 3000;

export const AGENT_STYLE_PRESETS: {
  id: AgentStylePreset;
  label: string;
  description: string;
}[] = [
  {
    id: 'balanced',
    label: '平衡',
    description: '清晰、有条理，按问题需要展开',
  },
  {
    id: 'detailed',
    label: '详细',
    description: '补足推导、例子、边界和细节',
  },
  {
    id: 'concise',
    label: '简洁',
    description: '先给结论，短段落，少重复',
  },
  {
    id: 'critical',
    label: '严谨批判',
    description: '区分声称与证据，主动指出局限',
  },
  {
    id: 'socratic',
    label: '导师启发',
    description: '由浅入深，解释直觉并引导思考',
  },
  {
    id: 'custom',
    label: '自定义',
    description: '完全按你的描述控制回答风格',
  },
];

export const DEFAULT_AGENT_STYLE: AgentStyle = {
  preset: 'balanced',
  custom: '',
};

const PRESET_IDS = new Set(AGENT_STYLE_PRESETS.map((preset) => preset.id));

export function normalizeAgentStyle(value: Partial<AgentStyle> | null | undefined): AgentStyle {
  const preset =
    value?.preset && PRESET_IDS.has(value.preset as AgentStylePreset)
      ? (value.preset as AgentStylePreset)
      : DEFAULT_AGENT_STYLE.preset;
  const custom =
    typeof value?.custom === 'string'
      ? value.custom.slice(0, MAX_CUSTOM_STYLE_CHARS)
      : '';
  return { preset, custom };
}

export function loadAgentStyle(): AgentStyle {
  try {
    const raw = localStorage.getItem(AGENT_STYLE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AGENT_STYLE };
    return normalizeAgentStyle(JSON.parse(raw) as Partial<AgentStyle>);
  } catch {
    return { ...DEFAULT_AGENT_STYLE };
  }
}

export function saveAgentStyle(style: AgentStyle): AgentStyle {
  const normalized = normalizeAgentStyle(style);
  try {
    localStorage.setItem(AGENT_STYLE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Keep the in-memory setting for this tab.
  }
  return normalized;
}

export function agentStyleLabel(style: AgentStyle): string {
  return (
    AGENT_STYLE_PRESETS.find((preset) => preset.id === style.preset)?.label ??
    '平衡'
  );
}
