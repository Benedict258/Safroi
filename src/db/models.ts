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
