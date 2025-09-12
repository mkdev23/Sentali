// src/blendfaces.ts
import { VRM } from '@pixiv/three-vrm';

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
  private map: Record<string, string>;
  private smooth: number;
  private decay: number;
  private rest: Record<string, number>;

  private state = new Map<string, { current: number; target: number; source: Source; ttl: number }>();
  private timeline: TimelineKey[] = [];
  private tlIndex = 0;
  private tlStart = 0;
  private tlAudio?: HTMLAudioElement;

  constructor(vrm: VRM, opts: BlendfacesOptions = {}) {
    this.vrm = vrm;
    this.map = opts.expressionMap ?? {};
    this.smooth = opts.smooth ?? 0.25;
    this.decay = opts.decay ?? 2.0;
    this.rest = opts.rest ?? { blink: 0.0 };

    // Seed rest values
    Object.entries(this.rest).forEach(([raw, w]) => this.set(raw, w, 'rest'));
  }

  set(rawName: string, weight: number, source: Source = 'live', ttlMs = 150): void {
    const name = this.map[rawName.toLowerCase()] ?? rawName;
    const s = this.state.get(name) ?? { current: 0, target: 0, source: 'rest', ttl: 0 };
    // Priority: live > timeline > rest
    const prio = (src: Source) => (src === 'live' ? 3 : src === 'timeline' ? 2 : 1);
    if (prio(source) >= prio(s.source)) {
      s.target = weight;
      s.source = source;
      s.ttl = ['aa', 'ee', 'ih', 'oh', 'ou'].includes(name) ? 500 : ttlMs; // Longer TTL for visemes
      this.state.set(name, s);
    }
  }

  setMany(values: Record<string, number>, source: Source = 'live', ttlMs = 150): void {
    Object.entries(values).forEach(([k, v]) => {
      // Increase TTL for visemes
      const ttl = ['aa', 'ee', 'ih', 'oh', 'ou'].includes(this.map[k.toLowerCase()] ?? k) ? 500 : ttlMs;
      this.set(k, v, source, ttl);
    });
  }

  attachWS(onMessage: (cb: (cue: Cue) => void) => void): void {
    onMessage((cue) => {
      if (cue.type === 'blendshape') this.set(cue.name, cue.weight, 'live');
      else if (cue.type === 'blendshapes') this.setMany(cue.values, 'live');
      else if (cue.type === 'viseme') this.set(cue.name, cue.weight, 'live');
    });
  }

  loadTimeline(keys: TimelineKey[]): void {
    this.timeline = [...keys].sort((a, b) => a.t - b.t);
    this.tlIndex = 0;
    console.log('[Blendfaces] Loaded timeline:', this.timeline);
  }

  playTimeline(startTime = 0, audio?: HTMLAudioElement): void {
    this.tlStart = performance.now() / 1000 - startTime;
    this.tlAudio = audio;
    console.log('[Blendfaces] Playing timeline at startTime:', startTime);
  }

  stopTimeline(): void {
    this.timeline = [];
    this.tlIndex = 0;
    this.tlAudio = undefined;
    console.log('[Blendfaces] Timeline stopped');
  }

  update(delta: number): void {
    // 1) Advance timeline
    if (this.timeline.length) {
      const now = this.tlAudio ? this.tlAudio.currentTime : performance.now() / 1000 - this.tlStart;
      while (this.tlIndex < this.timeline.length && this.timeline[this.tlIndex].t <= now) {
        const k = this.timeline[this.tlIndex++];
        if ('name' in k) this.set(k.name, k.weight, 'timeline', 500); // Longer TTL for visemes
        else this.setMany(k.values, 'timeline', 500);
        console.log(`[Blendfaces] Applied timeline key at t=${k.t}:`, k);
      }
    }

    // 2) Update blend-shapes
    for (const [name, s] of this.state) {
      s.ttl -= delta * 1000;
      if (s.ttl <= 0 && s.source !== 'rest') {
        s.target = this.rest[name] ?? 0;
        s.source = 'rest';
      }

      // Skip decay for visemes during speaking
      const isViseme = ['aa', 'ee', 'ih', 'oh', 'ou'].includes(name);
      const alpha = 1 - Math.pow(1 - this.smooth, delta * 60);
      let decayed = s.current + (s.target - s.current) * alpha;

      // Apply decay only for non-visemes or when not speaking
      if (!isViseme || !this.tlAudio?.currentTime) {
        const restTarget = this.rest[name] ?? 0;
        decayed += (restTarget - decayed) * Math.min(1, this.decay * delta);
      }

      s.current = Math.max(0, Math.min(1, decayed)); // Clamp [0,1]
      this.state.set(name, s);

      console.log(`[Blendfaces Update] ${name}: target=${s.target}, current=${s.current}, source=${s.source}, ttl=${s.ttl}`);

      // Push to VRM
      if ((this.vrm as any).expressionManager) {
        (this.vrm as any).expressionManager.setValue(name, s.current);
      } else if ((this.vrm as any).blendShapeProxy) {
        (this.vrm as any).blendShapeProxy.setValue(name, s.current);
      }
    }

    // 3) Apply changes
    if ((this.vrm as any).expressionManager) {
      (this.vrm as any).expressionManager.update();
    } else if ((this.vrm as any).blendShapeProxy) {
      (this.vrm as any).blendShapeProxy.update();
    }
  }
}