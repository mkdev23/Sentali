// src/BlendshapeController.ts
// Minimal, hardened mapping controller that mirrors C# version,
// with defensive copy, normalization, and read-only exposure.

export type BlendshapeMapInput = Record<string, number> | Map<string, number>;

export class BlendshapeController {
  private readonly map: Map<string, number>;

  constructor(input?: BlendshapeMapInput) {
    this.map = new Map<string, number>();
    if (!input) return;

    // Defensive copy with normalization
    if (input instanceof Map) {
      for (const [k, v] of input.entries()) {
        const key = normalizeKey(k);
        if (key) this.map.set(key, toIndex(v));
      }
    } else if (isPlainObject(input)) {
      for (const [k, v] of Object.entries(input)) {
        const key = normalizeKey(k);
        if (key) this.map.set(key, toIndex(v));
      }
    }
  }

  // Returns the mapped index or -1 when not found
  public getBlendshapeIndex(expression: string): number {
    const key = normalizeKey(expression);
    if (!key) return -1;
    return this.map.get(key) ?? -1;
  }

  // Optional helpers (read-only style)
  public has(expression: string): boolean {
    const key = normalizeKey(expression);
    return !!key && this.map.has(key);
  }

  public get size(): number {
    return this.map.size;
  }

  public entries(): Array<{ name: string; index: number }> {
    const out: Array<{ name: string; index: number }> = [];
    for (const [name, index] of this.map.entries()) out.push({ name, index });
    return out;
  }

  // Factory from untrusted JSON (defensive)
  public static fromJSON(json: unknown): BlendshapeController {
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      return new BlendshapeController(json as Record<string, number>);
    }
    return new BlendshapeController();
  }
}

// ————— internal helpers —————

function normalizeKey(k: string): string | null {
  if (typeof k !== 'string') return null;
  const key = k.trim().toLowerCase();
  return key.length ? key : null;
}

function toIndex(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return -1;
  const i = Math.floor(n);
  return i >= 0 ? i : -1;
}

function isPlainObject(o: unknown): o is Record<string, unknown> {
  if (o === null || typeof o !== 'object') return false;
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

// Note: Ensure this file is included in tsconfig.json under "files" or "include"