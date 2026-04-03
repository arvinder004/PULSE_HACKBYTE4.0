import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISignal {
  id: string;
  type: 'confused' | 'clear' | 'excited' | 'slow_down' | 'question';
  audienceId: string;
  fingerprint: string;
  weight: number;
  createdAt: Date;
}

export interface IQuestion {
  id: string;
  text: string;
  audienceId: string;
  upvotes: number;
  dismissed: boolean;
  answered: boolean;
  createdAt: Date;
}

export interface IIntervention {
  id: string;
  message: string;
  suggestion: string;
  urgency: 'high' | 'medium' | 'low';
  acknowledged: boolean;
  createdAt: Date;
}

export interface ISession extends Document {
  sessionId: string;
  speakerId: string;       // ref to User._id
  speakerName: string;
  topic: string;
  active: boolean;
  createdAt: Date;
  endedAt?: Date;
  signals: ISignal[];
  questions: IQuestion[];
  interventions: IIntervention[];
}

const SignalSchema = new Schema<ISignal>({
  id:          String,
  type:        String,
  audienceId:  String,
  fingerprint: String,
  weight:      Number,
  createdAt:   { type: Date, default: Date.now },
}, { _id: false });

const QuestionSchema = new Schema<IQuestion>({
  id:         String,
  text:       String,
  audienceId: String,
  upvotes:    { type: Number, default: 0 },
  dismissed:  { type: Boolean, default: false },
  answered:   { type: Boolean, default: false },
  createdAt:  { type: Date, default: Date.now },
}, { _id: false });

const InterventionSchema = new Schema<IIntervention>({
  id:           String,
  message:      String,
  suggestion:   String,
  urgency:      String,
  acknowledged: { type: Boolean, default: false },
  createdAt:    { type: Date, default: Date.now },
}, { _id: false });

const SessionSchema = new Schema<ISession>({
  sessionId:     { type: String, required: true, unique: true },
  speakerId:     { type: String, required: true },
  speakerName:   { type: String, required: true },
  topic:         { type: String, required: true },
  active:        { type: Boolean, default: true },
  createdAt:     { type: Date, default: Date.now },
  endedAt:       Date,
  signals:       { type: [SignalSchema], default: [] },
  questions:     { type: [QuestionSchema], default: [] },
  interventions: { type: [InterventionSchema], default: [] },
});

const Session: Model<ISession> = mongoose.models.Session ?? mongoose.model<ISession>('Session', SessionSchema);
export default Session;
