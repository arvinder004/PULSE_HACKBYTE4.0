import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISegmentSummary extends Document {
  sessionId: string;
  windowStart: number;
  windowEnd: number;
  transcript: string;
  summary: string;
  improvement: string;
  focusTags: string[];
  wordCount: number;
  createdAt: Date;
}

const SegmentSummarySchema = new Schema<ISegmentSummary>({
  sessionId:   { type: String, required: true, index: true },
  windowStart: { type: Number, required: true },
  windowEnd:   { type: Number, required: true },
  transcript:  { type: String, default: '' },
  summary:     { type: String, default: '' },
  improvement: { type: String, default: '' },
  focusTags:   { type: [String], default: [] },
  wordCount:   { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now },
});

SegmentSummarySchema.index({ sessionId: 1, windowStart: 1 }, { unique: true });

const SegmentSummary: Model<ISegmentSummary> =
  mongoose.models.SegmentSummary ??
  mongoose.model<ISegmentSummary>('SegmentSummary', SegmentSummarySchema);

export default SegmentSummary;
