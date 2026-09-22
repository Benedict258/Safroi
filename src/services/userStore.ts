import bcrypt from 'bcryptjs';
import { User } from '../db/models';
import { isDbConnected } from '../db/index';

export interface StoredUser {
  _id: string;
  email: string;
  displayName: string;
  password?: string;
  photoURL?: string;
  plan?: string;
  planActive?: boolean;
  paymentProvider?: string | null;
  lemonsqueezyCustomerId?: string | null;
  lemonsqueezySubscriptionId?: string | null;
  paystackCustomerId?: string | null;
  paystackSubscriptionCode?: string | null;
  planExpiresAt?: Date | null;
  resetToken?: string | null;
  resetTokenExpiry?: Date | number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const globalUserStore: Map<string, StoredUser> = (global as any).__safroi_user_store || new Map<string, StoredUser>();
(global as any).__safroi_user_store = globalUserStore;

export const userStore = {
  async findById(id: string): Promise<StoredUser | null> {
    if (isDbConnected()) {
      try {
        const user = await (User as any).findById(id).lean();
        if (user) {
          globalUserStore.set(user._id, user);
          return user;
        }
      } catch (err) {
        console.warn('[UserStore] findById DB error, falling back to memory:', err);
      }
    }
    return globalUserStore.get(id) || null;
  },

  async findByEmail(email: string): Promise<StoredUser | null> {
    const lowerEmail = email.toLowerCase().trim();
    if (isDbConnected()) {
      try {
        const user = await (User as any).findOne({ email: lowerEmail }).lean();
        if (user) {
          globalUserStore.set(user._id, user);
          return user;
        }
      } catch (err) {
        console.warn('[UserStore] findByEmail DB error, falling back to memory:', err);
      }
    }
    for (const u of globalUserStore.values()) {
      if (u.email && u.email.toLowerCase() === lowerEmail) {
        return u;
      }
    }
    return null;
  },

  async findByResetToken(tokenHash: string): Promise<StoredUser | null> {
    if (isDbConnected()) {
      try {
        const user = await (User as any).findOne({ resetToken: tokenHash }).lean();
        if (user) {
          globalUserStore.set(user._id, user);
          return user;
        }
      } catch (err) {
        console.warn('[UserStore] findByResetToken DB error, checking memory:', err);
      }
    }
    for (const u of globalUserStore.values()) {
      if (u.resetToken === tokenHash) {
        return u;
      }
    }
    return null;
  },

  async createUser(userData: StoredUser): Promise<StoredUser> {
    globalUserStore.set(userData._id, userData);
    if (isDbConnected()) {
      try {
        await (User as any).findOneAndUpdate(
          { _id: userData._id },
          userData,
          { upsert: true, new: true }
        );
      } catch (err) {
        console.warn('[UserStore] MongoDB write failed, saved in-memory:', err);
      }
    }
    return userData;
  },

  async updateUser(id: string, updates: Partial<StoredUser>): Promise<StoredUser | null> {
    const existing = globalUserStore.get(id) || ({ _id: id } as StoredUser);
    const updated = { ...existing, ...updates };
    globalUserStore.set(id, updated);

    if (isDbConnected()) {
      try {
        const dbUpdated = await (User as any).findByIdAndUpdate(id, updates, { new: true }).lean();
        if (dbUpdated) {
          globalUserStore.set(id, dbUpdated);
          return dbUpdated;
        }
      } catch (err) {
        console.warn('[UserStore] DB updateUser failed, saved in-memory:', err);
      }
    }
    return updated;
  },

  async updateByQuery(query: any, updates: Partial<StoredUser>): Promise<void> {
    for (const [id, u] of globalUserStore.entries()) {
      let match = true;
      for (const [k, v] of Object.entries(query)) {
        if ((u as any)[k] !== v) {
          match = false;
          break;
        }
      }
      if (match) {
        globalUserStore.set(id, { ...u, ...updates });
      }
    }

    if (isDbConnected()) {
      try {
        await (User as any).findOneAndUpdate(query, updates, { new: true });
      } catch (err) {
        console.warn('[UserStore] DB updateByQuery error:', err);
      }
    }
  },

  async verifyPassword(user: StoredUser, candidate: string): Promise<boolean> {
    if (!user.password) return false;
    return bcrypt.compare(candidate, user.password);
  },

  getAll(): StoredUser[] {
    return Array.from(globalUserStore.values());
  },

  get(id: string): StoredUser | undefined {
    return globalUserStore.get(id);
  },

  set(id: string, user: StoredUser): void {
    globalUserStore.set(id, user);
  }
};
