import mongoose from 'mongoose';

// Disable buffering to fail fast and not hang when MongoDB is offline
mongoose.set('bufferCommands', false);

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/safroi';

let cached = (global as any).mongoose;
if (!cached) cached = (global as any).mongoose = { conn: null, promise: null };

export function isDbConnected(): boolean {
  return Boolean(mongoose.connection && mongoose.connection.readyState === 1);
}

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
  }
  try {
    cached.conn = await cached.promise;
    console.log('[MongoDB] Connected.');
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[MongoDB] Connection failed (running with in-memory fallback):', msg);
    return null;
  }
}

export async function testConnection() {
  const conn = await connectDB();
  return conn !== null;
}

