import { LLMProvider } from './base.js';
import {
  LLMGenerateParams,
  LLMGenerateResponse,
  EmbeddingParams,
  EmbeddingResponse,
} from '../types/index.js';

export class MockLLMProvider extends LLMProvider {
  async generate(params: LLMGenerateParams): Promise<LLMGenerateResponse> {
    return {
      content: `[MOCK] Response to: ${params.messages[params.messages.length - 1].content}`,
      tokensUsed: 50,
      model: 'mock-model',
    };
  }

  async embedding(params: EmbeddingParams): Promise<EmbeddingResponse> {
    const texts = Array.isArray(params.text) ? params.text : [params.text];
    return {
      embeddings: texts.map(() => Array(1536).fill(0.1)),
      model: 'mock-embedding',
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
