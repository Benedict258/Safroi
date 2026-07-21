import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  _id: String,
  email: { type: String, required: true },
  displayName: String,
  photoURL: String,
}, {
  timestamps: true,
  versionKey: false,
});

userSchema.index({ email: 1 });
export const User = mongoose.models.User || mongoose.model('User', userSchema);

const riskSchema = new mongoose.Schema({
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
