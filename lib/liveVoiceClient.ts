

type RobotState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

interface LiveVoiceClientOptions {
  onStateChange: (state: RobotState) => void;
  onUserTranscript: (text: string) => void;
  onRobotTranscript: (text: string) => void;
  onError: (message: string) => void;
}

interface AudioLevels {
  speechLevel: number;
  micLevel: number;
}

export class LiveVoiceClient {
  private options: LiveVoiceClientOptions;

  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;

  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;

  // Audio output amplification
  private playbackGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  // Default volume: 250%
  private masterVolume = 2.5;

  private stopped = true;
  private starting = false;

  private micLevel = 0;
  private speechLevel = 0;

  private nextPlaybackTime = 0;

  private activeSources = new Set<AudioBufferSourceNode>();

  constructor(options: LiveVoiceClientOptions) {
    this.options = options;
  }

  private setState(state: RobotState) {
    this.options.onStateChange(state);
  }

  getAudioLevels(): AudioLevels {
    return {
      speechLevel: this.speechLevel,
      micLevel: this.micLevel,
    };
  }

  // Set output volume from 0% to 250%
  setVolume(percent: number): void {
    const safeVolume = Math.max(0, Math.min(250, percent));

    this.masterVolume = safeVolume / 100;

    if (this.playbackGain && this.audioContext) {
      this.playbackGain.gain.setTargetAtTime(
        this.masterVolume,
        this.audioContext.currentTime,
        0.05
      );
    }
  }

  // Get current volume percentage
  getVolume(): number {
    return Math.round(this.masterVolume * 100);
  }

  async start(): Promise<void> {
    if (this.starting || !this.stopped) return;

    this.starting = true;
    this.stopped = false;

    this.setState("connecting");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Trình duyệt không hỗ trợ micro. Hãy mở ứng dụng bằng HTTPS."
        );
      }

      const protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";

      const wsUrl = `${protocol}//${window.location.host}/api/live`;

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Hết thời gian kết nối AI ROBOT."));
        }, 20000);

        ws.onopen = () => {
          // Wait for Gemini Live ready message.
        };

        ws.onmessage = (event: MessageEvent) => {
          let message: {
            type?: string;
            text?: string;
            data?: string;
            message?: string;
          };

          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }

          if (message.type === "ready") {
            window.clearTimeout(timeout);
            resolve();
            return;
          }

          if (message.type === "error") {
            window.clearTimeout(timeout);
            reject(
              new Error(
                message.message || "Không thể kết nối Gemini."
              )
            );
            return;
          }

          this.handleServerMessage(message);
        };

        ws.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Không thể kết nối máy chủ AI ROBOT."));
        };

        ws.onclose = () => {
          window.clearTimeout(timeout);

          if (!this.stopped) {
            this.stop();
            this.options.onError("Kết nối AI ROBOT đã bị ngắt.");
          }
        };
      });

      if (this.stopped) return;

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (this.stopped) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
        return;
      }

      this.audioContext = new AudioContext({
        sampleRate: 16000,
      });

      await this.audioContext.resume();

      // Output gain
      this.playbackGain = this.audioContext.createGain();

      this.playbackGain.gain.value = this.masterVolume;

      // Dynamic compressor to reduce excessive peaks
      this.compressor = this.audioContext.createDynamicsCompressor();

      this.compressor.threshold.value = -6;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;

      this.playbackGain.connect(this.compressor);

      this.compressor.connect(this.audioContext.destination);

      this.source = this.audioContext.createMediaStreamSource(
        this.stream
      );

      this.processor = this.audioContext.createScriptProcessor(
        4096,
        1,
        1
      );

      this.silentGain = this.audioContext.createGain();

      this.silentGain.gain.value = 0;

      this.processor.onaudioprocess = (event) => {
        if (
          this.stopped ||
          this.ws?.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);

        let sum = 0;

        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }

        const rms = Math.sqrt(sum / input.length);

        this.micLevel = Math.min(1, rms * 5);
        this.speechLevel = Math.min(1, rms * 7);

        const pcm = new Int16Array(input.length);

        for (let i = 0; i < input.length; i++) {
          const sample = Math.max(-1, Math.min(1, input[i]));

          pcm[i] =
            sample < 0
              ? sample * 32768
              : sample * 32767;
        }

        const bytes = new Uint8Array(pcm.buffer);

        let binary = "";

        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }

        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "audio",
              audio: btoa(binary),
            })
          );
        }
      };

      this.source.connect(this.processor);

      this.processor.connect(this.silentGain);

      this.silentGain.connect(this.audioContext.destination);

      this.setState("listening");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Không thể khởi động micro.";

      this.options.onError(message);

      this.stop();

      this.setState("error");
    } finally {
      this.starting = false;
    }
  }

  private handleServerMessage(message: {
    type?: string;
    text?: string;
    data?: string;
    message?: string;
  }) {
    if (this.stopped) return;

    switch (message.type) {
      case "inputTranscript":
        if (message.text) {
          this.options.onUserTranscript(message.text);
          this.setState("thinking");
        }
        break;

      case "outputTranscript":
        if (message.text) {
          this.options.onRobotTranscript(message.text);
          this.setState("speaking");
        }
        break;

      case "audio":
        if (message.data) {
          void this.playAudio(message.data);
        }
        break;

      case "interrupted":
        this.stopPlayback();
        this.setState("listening");
        break;

      case "turnComplete":
        this.setState("listening");
        break;

      case "error":
        this.options.onError(
          message.message || "Lỗi kết nối Gemini."
        );
        this.setState("error");
        break;

      case "closed":
        if (!this.stopped) {
          this.stop();
          this.setState("idle");
        }
        break;
    }
  }

  private async playAudio(base64: string): Promise<void> {
    if (
      this.stopped ||
      !this.audioContext ||
      !this.playbackGain
    ) {
      return;
    }

    try {
      const binary = atob(base64);

      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const pcm = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2)
      );

      if (pcm.length === 0) return;

      const audioBuffer = this.audioContext.createBuffer(
        1,
        pcm.length,
        24000
      );

      const channel = audioBuffer.getChannelData(0);

      for (let i = 0; i < pcm.length; i++) {
        channel[i] = pcm[i] / 32768;
      }

      const source = this.audioContext.createBufferSource();

      source.buffer = audioBuffer;

      source.connect(this.playbackGain);

      this.activeSources.add(source);

      source.onended = () => {
        this.activeSources.delete(source);
      };

      const now = this.audioContext.currentTime;

      if (this.nextPlaybackTime < now) {
        this.nextPlaybackTime = now;
      }

      source.start(this.nextPlaybackTime);

      this.nextPlaybackTime += audioBuffer.duration;

      this.setState("speaking");
    } catch (error) {
      console.error("Audio playback error:", error);
    }
  }

  private stopPlayback() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Source may already have stopped.
      }
    }

    this.activeSources.clear();

    if (this.audioContext) {
      this.nextPlaybackTime = this.audioContext.currentTime;
    }
  }

  stop(): void {
    if (this.stopped) return;

    this.stopped = true;

    this.micLevel = 0;
    this.speechLevel = 0;

    this.stopPlayback();

    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }

    this.source?.disconnect();
    this.source = null;

    this.silentGain?.disconnect();
    this.silentGain = null;

    this.playbackGain?.disconnect();
    this.playbackGain = null;

    this.compressor?.disconnect();
    this.compressor = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;

      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    }

    if (this.audioContext) {
      const context = this.audioContext;

      this.audioContext = null;

      void context.close().catch(() => {});
    }

    this.setState("idle");
  }
}
