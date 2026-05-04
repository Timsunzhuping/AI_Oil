import type { Adapter, SourceType } from '../types.js';
import { MockSapAdapter } from './sap.js';
import { MockLimsAdapter } from './lims.js';
import { MockFileAdapter } from './file.js';

/**
 * Adapter registry.
 *
 * In production you'd register a real `SapOdataAdapter`, `LabwareLimsAdapter`,
 * `S3FileAdapter`, etc. — but the rest of the system only depends on this
 * `Adapter` interface, so swapping is mechanical.
 */
export class AdapterRegistry {
  private adapters = new Map<SourceType, Adapter>();

  constructor(initial?: Adapter[]) {
    const defaults: Adapter[] = initial ?? [
      new MockSapAdapter(),
      new MockLimsAdapter(),
      new MockFileAdapter(),
    ];
    for (const a of defaults) this.adapters.set(a.sourceType, a);
  }

  register(adapter: Adapter): void {
    this.adapters.set(adapter.sourceType, adapter);
  }

  resolve(sourceType: SourceType): Adapter {
    const a = this.adapters.get(sourceType);
    if (!a) throw new Error(`No adapter registered for source_type='${sourceType}'`);
    return a;
  }

  list(): Array<{ source_type: SourceType; capabilities: ReturnType<Adapter['capabilities']> }> {
    return Array.from(this.adapters.values()).map((a) => ({
      source_type: a.sourceType,
      capabilities: a.capabilities(),
    }));
  }
}
