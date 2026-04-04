import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICoachSegment {
  windowStart: number;
  windowEnd: number;
  timeLabel: string; // e.g. "0:00 – 1:00"
  bullets: string[];
  focusTags: string[];
}

export interface ICoachReport extends Document {
  sessionId: string;
  speakerName: string;
  topic: string;
  segments: ICoachSegment[];
  overallSummary: string;
  topStrengths: string[];
  topImprovements: string[];
  createdAt: Date;
}

const CoachSegmentSchema = new Schema<ICoachSegment>({
  windowStart:  { type: Number, required: true },
  windowEnd:    { type: Number, required: true },
  timeLabel:    { type: String, default: '' },
  bullets:      { type: [String], default: [] },
  focusTags:    { type: [String], default: [] },
}, { _id: false });

const CoachReportSchema = new Schema<ICoachReport>({
  sessionId:        { type: String, required: true, unique: true, index: true },
  speakerName:      { type: String, default: '' },
  topic:            { type: String, default: '' },
  segments:         { type: [CoachSegmentSchema], default: [] },
  overallSummary:   { type: String, default: '' },
  topStrengths:     { type: [String], default: [] },
  topImprovements:  { type: [String], default: [] },
  createdAt:        { type: Date, default: Date.now },
});

const CoachReport: Model<ICoachReport> =
  mongoose.models.CoachReport ??
  mongoose.model<ICoachReport>('CoachReport', CoachReportSchema);

export default CoachReport;
