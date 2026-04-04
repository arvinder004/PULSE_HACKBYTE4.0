import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) throw new Error('MONGODB_URI is not set in .env.local');

// Reuse connection across hot reloads in dev
const g = globalThis as typeof globalThis & { _mongooseConn?: typeof mongoose };

export async function connectDB() {
  if (g._mongooseConn && mongoose.connection.readyState === 1) return;
  g._mongooseConn = await mongoose.connect(MONGODB_URI);
}

// GridFS helper — returns a GridFSBucket for storing audio blobs
import { GridFSBucket } from 'mongodb';

export function getGridFSBucket(bucketName = 'audio') {
  if (!mongoose.connection.db) throw new Error('mongoose not connected');
  return new GridFSBucket(mongoose.connection.db, { bucketName });
}
