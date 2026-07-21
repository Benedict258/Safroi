import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/safroi';

let cached = (global as any).mongoose;
if (!cached) cached = (global as any).mongoose = { conn: null, promise: null };

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
    });
  }
  try {
    cached.conn = await cached.promise;
    console.log('[MongoDB] Connected.');
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[MongoDB] Connection failed:', msg);
    return null;
  }
}

export async function testConnection() {
  const conn = await connectDB();
  return conn !== null;
}
