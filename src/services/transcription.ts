// S2 STT spike (D87 as amended by D88h): the transcription SEAM and nothing
// else. No whisper library is imported anywhere — by design. The JS-native
// attempt was evaluated and is PARKED; the exit memo (with measured costs and
// the Python-sidecar alternative) lives at docs/prior-art/stt-spike-memo.md.
//
// When voice input un-benches (D87 rung 2 trigger: paying users + demand
// signal), an implementation lands BEHIND this interface and nothing else
// changes: the turn loop already accepts text.

export interface TranscriptionInput {
  audio: ArrayBuffer;
  mimeType?: string; // audio/webm | audio/wav | audio/mp4 …
}

export interface TranscriptionResult {
  text: string;
  latencyMs: number;
  engine: string;
}

export interface TranscriptionAdapter {
  readonly engine: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export class TranscriptionParkedError extends Error {
  constructor() {
    super(
      "STT input is parked (D87/D88h): JS-native spike exited with a cost memo; voice returns at the rung-2 trigger"
    );
    this.name = "TranscriptionParkedError";
  }
}

/** The seam. Ships parked: callers get an honest error, never a silent no-op. */
export function getTranscriptionAdapter(): TranscriptionAdapter {
  return {
    engine: "parked",
    async transcribe(): Promise<TranscriptionResult> {
      throw new TranscriptionParkedError();
    },
  };
}
