import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITranscriptChunk extends Document {
  sessionId:    string;
  chunkIndex:   number;   // 0, 1, 2, ... — order within the session
  startTs:      number;   // epoch ms — when this window started
  endTs:        number;   // epoch ms — when this window ended
  audioFileId:  string;   // GridFS file _id
  audioFilename:string;
  text:         string;   // Gemini transcript for this window
  wordCount:    number;
  status:       'pending' | 'transcribed' | 'failed';
  createdAt:    Date;
}

const TranscriptChunkSchema = new Schema<ITranscriptChunk>({
  sessionId:     { type: String, required: true, index: true },
  chunkIndex:    { type: Number, required: true },
  startTs:       { type: Number, required: true },
  endTs:         { type: Number, required: true },
  audioFileId:   { type: String, required: true },
  audioFilename: { type: String, required: true },
  text:          { type: String, default: '' },
  wordCount:     { type: Number, default: 0 },
  status:        { type: String, enum: ['pending', 'transcribed', 'failed'], default: 'pending' },
  createdAt:     { type: Date, default: Date.now },
});

// Unique per session + chunk window
TranscriptChunkSchema.index({ sessionId: 1, chunkIndex: 1 }, { unique: true });

const TranscriptChunk: Model<ITranscriptChunk> =
  mongoose.models.TranscriptChunk ??
  mongoose.model<ITranscriptChunk>('TranscriptChunk', TranscriptChunkSchema);

export default TranscriptChunk;
