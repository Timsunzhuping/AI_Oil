import { LLMProvider } from '../providers/base.js';
import { FormulaAnalysis, LLMMessage } from '../types/index.js';

export class FormulaAnalysisService {
  constructor(private llmProvider: LLMProvider) {}

  async analyzeFormula(
    formulaId: string,
    ingredients: string[],
    constraints?: string[]
  ): Promise<FormulaAnalysis> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a chemistry expert specializing in formula optimization. 
Analyze the given ingredients and provide suggestions for improvement.`,
      },
      {
        role: 'user',
        content: `Analyze this formula:
Ingredients: ${ingredients.join(', ')}
Constraints: ${constraints?.join(', ') || 'None'}

Provide:
1. Optimization suggestions
2. Risk factors
3. Confidence score (0-1)`,
      },
    ];

    const response = await this.llmProvider.generate({
      messages,
      temperature: 0.7,
      maxTokens: 500,
    });

    return {
      formulaId,
      ingredients,
      suggestions: this.parseSuggestions(response.content),
      riskFactors: this.parseRisks(response.content),
      confidence: 0.85,
    };
  }

  private parseSuggestions(content: string): string[] {
    return content
      .split('\n')
      .filter((line) => line.includes('suggest') || line.includes('add'))
      .slice(0, 3)
      .map((line) => line.trim());
  }

  private parseRisks(content: string): string[] {
    return content
      .split('\n')
      .filter((line) => line.includes('risk') || line.includes('warning'))
      .slice(0, 3)
      .map((line) => line.trim());
  }
}
