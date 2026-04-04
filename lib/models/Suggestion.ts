import mongoose, { Schema, Document, Model } from 'mongoose';

export type SuggestionUrgency = 'urgent' | 'medium' | 'low';

export interface ISuggestionHistoryEntry {
  urgency: SuggestionUrgency;
  reason: string;       // why urgency changed
  ts: Date;
}

export interface ISuggestion extends Document {
  sessionId: string;
  message: string;
  detail: string;
  urgency: SuggestionUrgency;
  category: string;     // e.g. 'pacing', 'clarity', 'engagement'
  triggerTranscript: string;  // the transcript snippet that triggered this
  history: ISuggestionHistoryEntry[];  // escalation trail
  dismissed: boolean;
  dismissedAt?: Date;
  createdAt: Date;
}

const HistorySchema = new Schema<ISuggestionHistoryEntry>({
  urgency: String,
  reason:  String,
  ts:      { type: Date, default: Date.now },
}, { _id: false });

const SuggestionSchema = new Schema<ISuggestion>({
  sessionId:         { type: String, required: true, index: true },
  message:           { type: String, required: true },
  detail:            { type: String, default: '' },
  urgency:           { type: String, enum: ['urgent', 'medium', 'low'], default: 'low' },
  category:          { type: String, default: 'general' },
  triggerTranscript: { type: String, default: '' },
  history:           { type: [HistorySchema], default: [] },
  dismissed:         { type: Boolean, default: false },
  dismissedAt:       Date,
  createdAt:         { type: Date, default: Date.now },
});

SuggestionSchema.index({ sessionId: 1, createdAt: -1 });

const Suggestion: Model<ISuggestion> =
  mongoose.models.Suggestion ??
  mongoose.model<ISuggestion>('Suggestion', SuggestionSchema);

export default Suggestion;
