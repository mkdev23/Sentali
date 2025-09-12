// blendfaces.ts
import { VRM } from '@pixiv/three-vrm';
import { BlendshapeController } from './BlendShapeController';

// Extend VRM interface to include blendShapeProxy for VRM0
declare module '@pixiv/three-vrm' {
  interface VRM {
    blendShapeProxy?: {
      setValue(name: string, weight: number): void;
      update(): void;
      getValue?(name: string): number; // Optional for debugging
    };
  }
}

type Source = 'rest' | 'timeline' | 'live';

type Cue =
  | { type: 'blendshape'; name: string; weight: number }
  | { type: 'blendshapes'; values: Record<string, number> }
  | { type: 'viseme'; name: string; weight: number };

type TimelineKey =
  | { t: number; name: string; weight: number }
  | { t: number; values: Record<string, number> };

export type BlendfacesOptions = {
  expressionMap?: Record<string, string>;
  smooth?: number;      // 0..1; higher = snappier. default 0.25
  decay?: number;       // per-second decay toward rest. default 2.0
  rest?: Record<string, number>; // baseline expression weights
};

export class BlendfacesController {
  private vrm: VRM;
  private readonly map: Map<string, string>; // Changed to Map<string, string>
  private smooth: number;
  private decay: number;
  private rest: Record<string, number>;
  private blendshapeController: BlendshapeController;

  private state = new Map<string, { current: number; target: number; source: Source; ttl: number }>();
  private timeline: TimelineKey[] = [];
  private tlIndex = 0;
  private tlStart = 0;
  private tlAudio?: HTMLAudioElement;

  constructor(vrm: VRM, opts: BlendfacesOptions = {}) {
    this.vrm = vrm;
    this.map = new Map(Object.entries(opts.expressionMap || {}).map(([k, v]) => [k.toLowerCase(), v])); // Convert to Map<string, string>
    this.smooth = opts.smooth ?? 0.25;
    this.decay = opts.decay ?? 2.0;
    this.rest = opts.rest ?? { blink: 0.0 };
    this.blendshapeController = new BlendshapeController(this.map as unknown as any); // Now this.map is Map<string, string>, cast to any to satisfy constructor type

    // Seed rest values
    Object.entries(this.rest).forEach(([raw, w]) => this.set(raw, w, 'rest'));
  }

  set(rawName: string, weight: number, source: Source = 'live', ttlMs = 150): void {
    const lowerName = rawName.toLowerCase();
    const normalizedName = this.blendshapeController.has(lowerName)
      ? lowerName
      : this.map.get(lowerName) ?? rawName; // this.map.get returns string | undefined
    const s = this.state.get(normalizedName) ?? { current: 0, target: 0, source: 'rest', ttl: 0 };
    s.target = Math.max(0, Math.min(1, weight)); // Clamp [0,1]
    s.source = source;
    s.ttl = ttlMs;
    this.state.set(normalizedName, s);
    console.log(`[Blendfaces] Set ${normalizedName} to ${weight} from ${source}, ttl=${ttlMs}ms`);
  }

  setMany(values: Record<string, number>, source: Source = 'live', ttlMs = 150): void {
    for (const [name, weight] of Object.entries(values)) {
      this.set(name, weight, source, ttlMs);
    }
  }

  loadTimeline(keys: TimelineKey[]): void {
    this.timeline = [...keys].sort((a, b) => a.t - b.t); // Defensive copy and sort
    this.tlIndex = 0;
    this.tlStart = performance.now() / 1000;
    console.log('[Blendfaces] Loaded timeline:', this.timeline);
  }

  playTimeline(startTime: number, audio: HTMLAudioElement): void {
    this.tlStart = performance.now() / 1000 - startTime;
    this.tlAudio = audio;
    console.log('[Blendfaces] Playing timeline at startTime:', startTime);
  }

  attachWS(callback: (data: Cue) => void): void {
    console.log('[Blendfaces] WS handler attached');
  }

  update(delta: number): void {
    if (!this.vrm || (!this.timeline.length && !this.state.size)) return;

    // Reset tlStart if audio restarts to avoid drift
    if (this.tlAudio && !this.tlAudio.paused && this.tlAudio.currentTime < 0.1) {
      this.tlStart = performance.now() / 1000 - this.tlAudio.currentTime;
    }

    // Advance timeline if audio is playing
    if (this.tlAudio && !this.tlAudio.paused && this.tlAudio.currentTime >= 0) {
      const now = performance.now() / 1000;
      const elapsed = now - this.tlStart;

      while (this.tlIndex < this.timeline.length && this.timeline[this.tlIndex].t <= elapsed) {
        const k = this.timeline[this.tlIndex++];
        if ('name' in k) this.set(k.name, k.weight, 'timeline', 500);
        else this.setMany(k.values, 'timeline', 500);
        console.log(`[Blendfaces] Applied timeline key at t=${k.t}:`, k);
      }
    }

    // Update blend-shapes
    for (const [name, s] of this.state) {
      s.ttl -= delta * 1000;
      if (s.ttl <= 0 && s.source !== 'rest') {
        s.target = this.rest[name] ?? 0;
        s.source = 'rest';
      }

      const isViseme = ['aa', 'ee', 'ih', 'oh', 'ou'].includes(name.toLowerCase());
      const alpha = 1 - Math.pow(1 - this.smooth, delta * 60);
      let decayed = s.current + (s.target - s.current) * alpha;

      if (!isViseme || !this.tlAudio?.currentTime) {
        const restTarget = this.rest[name] ?? 0;
        decayed += (restTarget - decayed) * Math.min(1, this.decay * delta);
      }

      s.current = Math.max(0, Math.min(1, decayed));
      this.state.set(name, s);

      console.log(`[Blendfaces Update] ${name}: target=${s.target}, current=${s.current}, source=${s.source}, ttl=${s.ttl}`);

      const mgr = this.vrm.blendShapeProxy || this.vrm.expressionManager;
      if (mgr) mgr.setValue(name, s.current);
    }

    // Apply changes
    const mgr = this.vrm.blendShapeProxy || this.vrm.expressionManager;
    if (mgr) mgr.update();
  }
}