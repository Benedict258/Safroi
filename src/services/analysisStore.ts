import { Analysis } from '../db/models';
import { isDbConnected } from '../db/index';

export interface StoredAnalysis {
  _id: string;
  userId: string;
  type?: string;
  title?: string;
  url?: string;
  summary?: string;
  risk_score?: number;
  risks?: any[];
  actions?: any[];
  key_points?: any[];
  original_text?: string;
  cachedResult?: any;
  cacheExpiry?: Date;
  created_at?: Date;
}

interface AnalysisGlobalStore {
  analyses: Map<string, StoredAnalysis>;
  cache: Map<string, { data: any; expiry: number }>;
}

const globalStore: AnalysisGlobalStore = (global as any).__safroi_analysis_store || {
  analyses: new Map<string, StoredAnalysis>(),
  cache: new Map<string, { data: any; expiry: number }>(),
};
(global as any).__safroi_analysis_store = globalStore;

export const analysisStore = {
  cacheKey(type: string, value: string): string {
    const n = value.replace(/\/+$/, '').toLowerCase().trim().slice(0, 200);
    return `${type}:${n}`;
  },

  async getCached(key: string): Promise<any | null> {
    const mem = globalStore.cache.get(key);
    if (mem && mem.expiry > Date.now()) {
      return mem.data;
    }

    if (isDbConnected()) {
      try {
        const cached = await (Analysis as any).findOne({
          _id: `cache_${key}`,
          cacheExpiry: { $gt: new Date() }
        }).lean();
        if (cached && cached.cachedResult) {
          globalStore.cache.set(key, { data: cached.cachedResult, expiry: Date.now() + 86400000 });
          return cached.cachedResult;
        }
      } catch (err) {
        // Safe fail - don't crash analysis on cache lookup
      }
    }
    return null;
  },

  async setCache(key: string, data: any): Promise<void> {
    globalStore.cache.set(key, { data, expiry: Date.now() + 86400000 });
    if (isDbConnected()) {
      try {
        await (Analysis as any).findOneAndUpdate(
          { _id: `cache_${key}` },
          {
            _id: `cache_${key}`,
            type: 'cache',
            userId: 'system',
            title: 'Cached',
            summary: '',
            risk_score: 0,
            risks: [],
            cachedResult: data,
            cacheExpiry: new Date(Date.now() + 86400000)
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (err) {
        // Safe fail - ignore cache save error
      }
    }
  },

  async saveAnalysis(record: StoredAnalysis): Promise<StoredAnalysis> {
    globalStore.analyses.set(record._id, record);
    if (isDbConnected()) {
      try {
        await (Analysis as any).findOneAndUpdate(
          { _id: record._id },
          record,
          { upsert: true, new: true }
        );
      } catch (err) {
        console.warn('[AnalysisStore] DB save error, saved in-memory:', err);
      }
    }
    return record;
  },

  async findByUser(userId: string): Promise<any[]> {
    if (isDbConnected()) {
      try {
        const items = await (Analysis as any).find({ userId })
          .select('_id type title url risk_score created_at')
          .sort({ created_at: -1 })
          .limit(50)
          .lean();
        if (items && items.length > 0) {
          for (const item of items) {
            globalStore.analyses.set(item._id, item);
          }
          return items;
        }
      } catch (err) {
        console.warn('[AnalysisStore] DB fetch error, falling back to memory:', err);
      }
    }

    return Array.from(globalStore.analyses.values())
      .filter(a => a.userId === userId && a.type !== 'cache')
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .map(({ _id, type, title, url, risk_score, created_at }) => ({
        _id, type, title, url, risk_score, created_at
      }));
  },

  async findById(id: string, userId?: string): Promise<StoredAnalysis | null> {
    if (isDbConnected()) {
      try {
        const query: any = { _id: id };
        if (userId) query.userId = userId;
        const item = await (Analysis as any).findOne(query).lean();
        if (item) {
          globalStore.analyses.set(item._id, item);
          return item;
        }
      } catch (err) {
        console.warn('[AnalysisStore] DB detail error, checking memory:', err);
      }
    }

    const item = globalStore.analyses.get(id);
    if (!item) return null;
    if (userId && item.userId !== userId) return null;
    return item;
  },

  async deleteById(id: string, userId?: string): Promise<boolean> {
    globalStore.analyses.delete(id);
    if (isDbConnected()) {
      try {
        const query: any = { _id: id };
        if (userId) query.userId = userId;
        await (Analysis as any).deleteOne(query);
      } catch (err) {
        console.warn('[AnalysisStore] DB delete error:', err);
      }
    }
    return true;
  }
};
