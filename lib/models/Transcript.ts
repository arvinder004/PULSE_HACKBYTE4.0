import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITranscriptChunk {
  text: string;
  ts: number; // epoch ms
}

export interface ITranscript extends Document {
  sessionId: string;
  chunks: ITranscriptChunk[];
  fullText: string;       // concatenated, rebuilt on each upsert
  wordCount: number;
  updatedAt: Date;
  createdAt: Date;
}

const ChunkSchema = new Schema<ITranscriptChunk>(
  { text: String, ts: Number },
  { _id: false }
);

const TranscriptSchema = new Schema<ITranscript>({
  sessionId: { type: String, required: true, unique: true },
  chunks:    { type: [ChunkSchema], default: [] },
  fullText:  { type: String, default: '' },
  wordCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

const Transcript: Model<ITranscript> =
  mongoose.models.Transcript ?? mongoose.model<ITranscript>('Transcript', TranscriptSchema);

export default Transcript;
