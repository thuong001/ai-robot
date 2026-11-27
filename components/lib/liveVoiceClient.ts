
import type { RobotState } from "../types/robot";

interface LiveVoiceClientOptions {
  onStateChange: (state: RobotState) => void;
  onUserTranscript: (text: string) => void;
  onRobotTranscript: (text: string) => void;
  onError: (message: string) => void;
}

export class LiveVoiceClient {
  private options: LiveVoiceClientOptions;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micLevel = 0;
  private speechLevel = 0;
  private nextPlayTime = 0;
  private isActive = false;
  private audioSources = new Set<AudioBufferSourceNode>();

  constructor(options: LiveVoiceClientOptions) {
    this.options = options;
  }

  getAudioLevels() {
    return {
      micLevel: this.micLevel,
      speechLevel: this.speechLevel,
    };
  }

  private setState(state: RobotState) {
    this.options.onStateChange(state);
  }

  private getSocketUrl() {
    const protocol =
      window.location.protocol === "https:" ? "wss:" : "ws:";

    return `${protocol}//${window.location.host}/api/live`;
  }

  async start() {
    if (this.isActive) return;

    this.isActive = true;
    this.setState("connecting");

    try {
      const ws = new WebSocket(this.getSocketUrl());
      this.ws = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Không nhận được phản hồi từ máy chủ."));
        }, 20000);

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);

          if (message.type === "ready") {
            window.clearTimeout(timeout);
            resolve();
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
          if (!this.isActive) return;

          this.isActive = false;
          this.setState("error");
        };
      });

      if (!this.isActive) return;

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      this.audioContext = new AudioContext({
        sampleRate: 16000,
      });

      await this.audioContext.resume();

      this.source = this.audioContext.createMediaStreamSource(
        this.mediaStream
      );

      this.processor = this.audioContext.createScriptProcessor(
        4096,
        1,
        1
      );

      this.processor.onaudioprocess = (event) => {
        if (!this.isActive || this.ws?.readyState !== WebSocket.OPEN) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }

        this.micLevel = Math.min(
          1,
          Math.sqrt(sum / input.length) * 5
        );

        const pcm = this.convertToPCM16(
          input,
          this.audioContext!.sampleRate,
          16000
        );

        this.ws.send(
          JSON.stringify({
            type: "audio",
            audio: this.arrayBufferToBase64(pcm),
          })
        );

        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.setState("listening");
    } catch (error) {
      console.error("AI ROBOT start error:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Không thể khởi động micro.";

      this.options.onError(
        message.includes("Permission") ||
          message.includes("NotAllowed")
          ? "Bạn cần cấp quyền sử dụng micro cho trình duyệt."
          : message
      );

      this.stop();
      this.setState("error");
    }
  }

  private handleServerMessage(message: {
    type?: string;
    text?: string;
    data?: string;
    message?: string;
  }) {
    switch (message.type) {
      case "ready":
        break;

      case "inputTranscript":
        if (message.text) {
          this.options.onUserTranscript(message.text);
          this.setState("thinking");
        }
        break;

      case "outputTranscript":
        if (message.text) {
          this.options.onRobotTranscript(message.text);
        }
        break;

      case "audio":
        if (message.data) {
          void this.playAudio(message.data);
        }
        break;

      case "turnComplete":
        if (this.isActive && this.audioSources.size === 0) {
          this.setState("listening");
        }
        break;

      case "interrupted":
        this.stopAudio();
        if (this.isActive) this.setState("listening");
        break;

      case "error":
        this.options.onError(
          message.message || "Lỗi kết nối AI ROBOT."
        );
        this.setState("error");
        break;

      case "closed":
        if (this.isActive) this.setState("error");
        break;
    }
  }

  private convertToPCM16(
    input: Float32Array,
    inputRate: number,
    outputRate: number
  ): ArrayBuffer {
    const ratio = inputRate / outputRate;
    const length = Math.floor(input.length / ratio);
    const buffer = new ArrayBuffer(length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < length; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const fraction = position - index;

      const sample =
        input[index] * (1 - fraction) +
        (input[index + 1] ?? input[index]) * fraction;

      const value = Math.max(-1, Math.min(1, sample));
      const pcm = value < 0
        ? value * 32768
        : value * 32767;

      view.setInt16(i * 2, pcm, true);
    }

    return buffer;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, i + chunkSize)
      );
    }

    return btoa(binary);
  }

  private async playAudio(base64: string) {
    if (!this.audioContext || !this.isActive) return;

    try {
      const binary = atob(base64);
      const samples = new Int16Array(binary.length / 2);

      for (let i = 0; i < samples.length; i++) {
        const low = binary.charCodeAt(i * 2);
        const high = binary.charCodeAt(i * 2 + 1);
        let value = low | (high << 8);

        if (value >= 32768) value -= 65536;
        samples[i] = value;
      }

      const audioBuffer = this.audioContext.createBuffer(
        1,
        samples.length,
        24000
      );

      const channel = audioBuffer.getChannelData(0);

      for (let i = 0; i < samples.length; i++) {
        channel[i] = samples[i] / 32768;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      this.audioSources.add(source);

      const startTime = Math.max(
        this.audioContext.currentTime + 0.02,
        this.nextPlayTime
      );

      this.nextPlayTime = startTime + audioBuffer.duration;

      this.setState("speaking");

      source.onended = () => {
        this.audioSources.delete(source);

        if (
          this.isActive &&
          this.audioSources.size === 0 &&
          this.nextPlayTime <= this.audioContext!.currentTime + 0.05
        ) {
          this.speechLevel = 0;
          this.setState("listening");
        }
      };

      source.start(startTime);
      this.speechLevel = 0.7;
    } catch (error) {
      console.error("Audio playback error:", error);
    }
  }

  private stopAudio() {
    for (const source of this.audioSources) {
      try {
        source.stop();
      } catch {
        // Audio may already have stopped.
      }
    }

    this.audioSources.clear();
    this.nextPlayTime = 0;
    this.speechLevel = 0;
  }

  stop() {
    this.isActive = false;
    this.micLevel = 0;

    this.stopAudio();

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    this.source?.disconnect();
    this.source = null;

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
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

    this.setState("idle");
  }
}
