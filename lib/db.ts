import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) throw new Error('MONGODB_URI is not set in .env.local');

// Reuse connection across hot reloads in dev
const g = globalThis as typeof globalThis & { _mongooseConn?: typeof mongoose };

export async function connectDB() {
  if (g._mongooseConn && mongoose.connection.readyState === 1) return;
  g._mongooseConn = await mongoose.connect(MONGODB_URI);
}
