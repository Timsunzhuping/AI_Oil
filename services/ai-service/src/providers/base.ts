import {
  LLMGenerateParams,
  LLMGenerateResponse,
  EmbeddingParams,
  EmbeddingResponse,
} from '../types/index.js';

export abstract class LLMProvider {
  abstract generate(params: LLMGenerateParams): Promise<LLMGenerateResponse>;
  abstract embedding(params: EmbeddingParams): Promise<EmbeddingResponse>;
  abstract isHealthy(): Promise<boolean>;
}
