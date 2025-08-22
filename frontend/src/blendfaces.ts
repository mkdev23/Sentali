// src/blendfaces.ts
import { VRM } from '@pixiv/three-vrm';

type Source = 'rest' | 'timeline' | 'live';

type Cue =
  | { type: 'blendshape'; name: string; weight: number }
  | { type: 'blendshapes'; values: Record<string, number> }
  | { type: 'viseme'; name: string; weight: number }; // e.g., aa, ih, oh

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

  // state[name] = { current, target, source, ttl }
  private state = new Map<string, { current: number; target: number; source: Source; ttl: number }>();

  // timeline
  private timeline: TimelineKey[] = [];
  private tlIndex = 0;
  private tlStart = 0;
  private tlAudio?: HTMLAudioElement;

  constructor(vrm: VRM, opts: BlendfacesOptions = {}) {
    this.vrm = vrm;
    this.map = opts.expressionMap ?? {};
    this.smooth = opts.smooth ?? 0.25;
    this.decay = opts.decay ?? 2.0;
    this.rest = opts.rest ?? { blink: 0.0, neutral: 1.0 };

    // seed rest values
    Object.entries(this.rest).forEach(([raw, w]) => this.set(raw, w, 'rest'));
  }

  // Public API
  set(rawName: string, weight: number, source: Source = 'live', ttlMs = 150): void {
    const name = this.map[rawName.toLowerCase()] ?? rawName;
    const s = this.state.get(name) ?? { current: 0, target: 0, source: 'rest', ttl: 0 };
    // Priority: live > timeline > rest
    const prio = (src: Source) => (src === 'live' ? 3 : src === 'timeline' ? 2 : 1);
    if (prio(source) >= prio(s.source)) {
      s.target = weight;
      s.source = source;
      s.ttl = ttlMs;
      this.state.set(name, s);
    }
  }

  setMany(values: Record<string, number>, source: Source = 'live', ttlMs = 150): void {
    Object.entries(values).forEach(([k, v]) => this.set(k, v, source, ttlMs));
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
  }

  playTimeline(startTime = 0, audio?: HTMLAudioElement): void {
    this.tlStart = performance.now() / 1000 - startTime;
    this.tlAudio = audio;
  }

  stopTimeline(): void {
    this.timeline = [];
    this.tlIndex = 0;
    this.tlAudio = undefined;
  }

  // Call each frame with delta seconds
  update(delta: number): void {
    // 1) Advance timeline
    if (this.timeline.length) {
      const now = this.tlAudio ? this.tlAudio.currentTime : performance.now() / 1000 - this.tlStart;
      while (this.tlIndex < this.timeline.length && this.timeline[this.tlIndex].t <= now) {
        const k = this.timeline[this.tlIndex++];
        if ('name' in k) this.set(k.name, k.weight, 'timeline', 120);
        else this.setMany(k.values, 'timeline', 120);
      }
    }

    // 2) Decay TTL and blend toward targets
    for (const [name, s] of this.state) {
      s.ttl -= delta * 1000;
      if (s.ttl <= 0 && s.source !== 'rest') {
        // fall back to rest target
        s.target = this.rest[name] ?? 0;
        s.source = 'rest';
      }

      // smooth blend
      const alpha = 1 - Math.pow(1 - this.smooth, delta * 60); // framerate-compensated
      const decayed = s.current + (s.target - s.current) * alpha;

      // gentle auto-decay per second toward rest even if target lagging
      const restTarget = this.rest[name] ?? 0;
      const towardRest = decayed + (restTarget - decayed) * Math.min(1, this.decay * delta);

      s.current = Math.max(0, Math.min(1, Math.max(decayed, towardRest))); // clamp [0,1]
      this.state.set(name, s);

      // push to VRM
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