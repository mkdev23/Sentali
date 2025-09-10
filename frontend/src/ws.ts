export type WSOpts = {
  url?: string;
  onMessage?: (json: any) => void;
  onOpen?: () => void;
  onClose?: () => void;
  protocols?: string | string[];
};

export class WSClient {
  private url: string;
  private protocols?: string | string[];
  private onMessage?: (json: any) => void;
  private onOpen?: () => void;
  private onClose?: () => void;
  private ws?: WebSocket;
  private retry = 0;
  private timer?: number;
  private maxRetries = 10;

constructor(opts: WSOpts = {}) {
  // Build a default URL based on the current page location
  const defaultUrl =
    window.location.protocol === 'https:'
      ? `wss://${window.location.host}/ws`
      : `ws://${window.location.host}/ws`;

  this.url = opts.url ?? defaultUrl;
  this.protocols = opts.protocols;
  this.onMessage = opts.onMessage;
  this.onOpen = opts.onOpen;
  this.onClose = opts.onClose;
}


  connect() {
    try {
      this.ws = this.protocols
        ? new WebSocket(this.url, this.protocols)
        : new WebSocket(this.url);

      this.ws.onopen = () => {
        this.retry = 0;
        this.onOpen?.();
      };

      this.ws.onmessage = (e) => {
        // console.log('[WS] raw:', e.data);
        try {
          const json = JSON.parse(e.data);
          this.onMessage?.(json);
        } catch (err) {
          console.warn('WSClient: Invalid JSON received', err);
        }
      };

      this.ws.onclose = () => {
        this.onClose?.();
        if (this.retry < this.maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, this.retry++), 10000);
          this.timer = window.setTimeout(() => this.connect(), backoff);
        } else {
          console.error('WSClient: Max retries reached. Connection aborted.');
        }
      };

      this.ws.onerror = (err) => {
        console.error('WSClient: WebSocket error', err);
      };
    } catch (err) {
      console.error('WSClient: Failed to initialize WebSocket', err);
    }
  }

  send(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(text);
    } else {
      console.warn('WSClient: Cannot send — socket not open');
    }
  }

  localTest(name: string) {
    this.send(`localtest:${name}`);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}