/**
 * Parser registry + factory.
 *
 *   const registry = new ParserRegistry([new MockOcrAdapter()]);
 *   registry.resolve('application/pdf')   // → adapter
 *
 * Adapters are tried in registration order; the first whose `supports(mime)`
 * returns true wins. The factory `buildOcrRegistry()` honours
 * `OCR_MODE=mock|real` so production wiring can flip to real adapters
 * without code changes.
 */
import { MockOcrAdapter } from './mock.js';
import type { ParserAdapter } from './types.js';

export class ParserRegistry {
  constructor(private readonly adapters: ParserAdapter[]) {}

  resolve(mime: string): ParserAdapter {
    const a = this.adapters.find((x) => x.supports(mime));
    if (!a) {
      throw new Error(`No parser adapter registered for mime '${mime}'`);
    }
    return a;
  }

  list(): ReadonlyArray<ParserAdapter> {
    return this.adapters;
  }

  register(adapter: ParserAdapter): void {
    this.adapters.unshift(adapter);
  }
}

export interface BuildOcrRegistryOptions {
  /** Inject a fully-built registry (e.g. with real adapters). */
  registry?: ParserRegistry;
  /** Forwarded to MockOcrAdapter when in mock mode. */
  mock?: { parserName?: string; parserVersion?: string };
}

export function buildOcrRegistry(opts: BuildOcrRegistryOptions = {}): ParserRegistry {
  if (opts.registry) return opts.registry;
  // No real-mode adapter is shipped in this round; mock is the default.
  return new ParserRegistry([new MockOcrAdapter(opts.mock)]);
}

export { MockOcrAdapter } from './mock.js';
export type { ParserAdapter, ParserInput, ParserOutput } from './types.js';
