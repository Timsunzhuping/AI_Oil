export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMGenerateParams {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMGenerateResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
}

export interface EmbeddingParams {
  text: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model?: string;
}

export enum LLMProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  LOCAL = 'local',
  MOCK = 'mock',
}

export interface FormulaAnalysis {
  formulaId: string;
  ingredients: string[];
  suggestions: string[];
  riskFactors: string[];
  estimatedYield?: number;
  confidence: number;
}
