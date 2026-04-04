import mongoose, { Schema, Document, Model } from 'mongoose';

type QuestionSnapshot = {
  id: string;
  text: string;
  upvotes: number;
};

export interface ISegmentSummary extends Document {
  sessionId: string;
  ts: number;
  audioFileId?: string;
  transcript?: string;
  transcriptProvider?: string;
  transcriptError?: string;
  summary?: string;
  improvement?: string;
  focusTags?: string[];
  summaryProvider?: string;
  summaryError?: string;
  signalCounts?: Record<string, number> | null;
  questions?: QuestionSnapshot[];
  createdAt: Date;
}

const QuestionSchema = new Schema<QuestionSnapshot>({
  id: String,
  text: String,
  upvotes: Number,
}, { _id: false });

const SegmentSummarySchema = new Schema<ISegmentSummary>({
  sessionId: { type: String, index: true, required: true },
  ts: { type: Number, required: true },
  audioFileId: String,
  transcript: String,
  transcriptProvider: String,
  transcriptError: String,
  summary: String,
  improvement: String,
  focusTags: { type: [String], default: [] },
  summaryProvider: String,
  summaryError: String,
  signalCounts: { type: Schema.Types.Mixed, default: null },
  questions: { type: [QuestionSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const SegmentSummary: Model<ISegmentSummary> = mongoose.models.SegmentSummary
  ?? mongoose.model<ISegmentSummary>('SegmentSummary', SegmentSummarySchema);

export default SegmentSummary;
