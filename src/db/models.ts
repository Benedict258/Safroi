import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  password: { type: String, required: true },
  photoURL: String,
  resetToken: String,
  resetTokenExpiry: Number,
  plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
  planActive: { type: Boolean, default: true },
  paymentProvider: { type: String, enum: ['paystack', 'lemonsqueezy', null], default: null },
  paystackCustomerId: { type: String, default: null },
  paystackSubscriptionCode: { type: String, default: null },
  lemonsqueezyCustomerId: { type: String, default: null },
  lemonsqueezySubscriptionId: { type: String, default: null },
  planExpiresAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
});

userSchema.pre('save', async function (this: any) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

userSchema.methods.comparePassword = async function (this: any, candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);

const documentSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  sourceType: { type: String, enum: ['upload','url','text','image','analysis'], required: true },
  sourceUrl: String,
  fileName: String,
  mimeType: String,
  status: { type: String, enum: ['processing','ready','failed'], default: 'processing' },
  text: String,
  tokenCount: Number,
  created_at: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: false });

const chunkSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  documentId: { type: String, required: true, index: true },
  chunkIndex: { type: Number, required: true },
  text: { type: String, required: true },
  embedding: [{ type: Number }],
  tokenCount: Number
}, { versionKey: false, timestamps: false });

const chatSessionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  documentId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  title: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: false });

const chatMessageSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sessionId: { type: String, required: true, index: true },
  role: { type: String, enum: ['user','assistant'], required: true },
  content: { type: String, required: true },
  sources: [{
    chunkId: String,
    text: String,
    score: Number
  }],
  created_at: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: false });

export const Document = mongoose.models.Document || mongoose.model('Document', documentSchema);
export const Chunk = mongoose.models.Chunk || mongoose.model('Chunk', chunkSchema);
export const ChatSession = mongoose.models.ChatSession || mongoose.model('ChatSession', chatSessionSchema);
export const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', chatMessageSchema);
  title: String,
  description: String,
  severity: { type: String, enum: ['low', 'medium', 'high'] },
  clause: String,
}, { _id: false });

const analysisSchema = new mongoose.Schema({
  _id: String,
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true, enum: ['website', 'contract'] },
  title: { type: String, required: true },
  url: String,
  summary: { type: String, required: true },
  risk_score: { type: Number, required: true, min: 1, max: 10 },
  risks: [riskSchema],
  key_points: [String],
  original_text: String,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
  versionKey: false,
});

analysisSchema.index({ userId: 1, created_at: -1 });
export const Analysis = mongoose.models.Analysis || mongoose.model('Analysis', analysisSchema);
