import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  'https://claudevahantag-production.up.railway.app/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

// ── REQUEST: attach token ─────────────────────────────────────────
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('adminAccessToken');
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {}

    // 🔥 DEBUG LOG
    if (config.method === 'post') {
      console.log('🚀 API:', config.url);
      console.log('📦 PAYLOAD:', config.data);
    }

    return config;
  },
  (err) => Promise.reject(err)
);

// ── RESPONSE: handle 401 ─────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    console.log('❌ API ERROR:', err?.response?.data || err.message);

    if (err?.response?.status === 401) {
      try {
        await SecureStore.deleteItemAsync('adminAccessToken');
        await SecureStore.deleteItemAsync('adminRefreshToken');
        await SecureStore.deleteItemAsync('adminUser');
      } catch {}

      if (typeof global.logout === 'function') {
        global.logout();
      }
    }

    return Promise.reject(err);
  }
);

// ── NORMALIZER ───────────────────────────────────────────────────
const norm = (res) => res?.data?.data ?? res?.data ?? null;
const normArr = (res) => {
  const d = norm(res);
  return Array.isArray(d) ? d : [];
};

// ── ANALYTICS ────────────────────────────────────────────────────
export const getDashboardStats = async () => {
  try {
    const res = await api.get('/admin/analytics');
    const d = norm(res);

    return {
      totalTags: Number(d?.totalTags ?? 0),
      activeTags: Number(d?.activeTags ?? 0),
      expiredTags: Number(d?.expiredTags ?? 0),
      agents: Number(d?.activeAgents ?? d?.agents ?? 0),
      revenue: Number(d?.revenue ?? 0),
      scans: Number(d?.totalScans ?? d?.scans ?? 0),
      orders: Number(d?.totalOrders ?? 0),
    };
  } catch {
    return null;
  }
};

// ── AGENTS ───────────────────────────────────────────────────────
export const getAgents = async () => {
  try {
    const res = await api.get('/admin/agents?limit=200');
    return normArr(res);
  } catch {
    return [];
  }
};

export const getAgentDetail = async (id) => {
  try {
    const res = await api.get(`/admin/agents/${id}`);
    return norm(res);
  } catch {
    return null;
  }
};

// ── CREATE AGENT (🔥 FINAL FIXED) ────────────────────────────────
export const createAgent = async (payload) => {
  try {
    // ✅ FORCE FULL STRUCTURE (NO DATA LOSS)
    const body = {
      name: payload.name || '',
      phone: payload.phone || '',
      businessName: payload.businessName || '',
      ownerName: payload.ownerName || '',
      city: payload.city || '',
      state: payload.state || '',
      address: payload.address || '',
    };

    console.log('📦 FINAL BODY:', body);

    // ✅ CORRECT ENDPOINT
    const res = await api.post('/admin/agents', body);

    return norm(res);
  } catch (err) {
    console.log('❌ CREATE AGENT FAILED:', err?.response?.data || err.message);
    throw err;
  }
};

// ── ORDERS ───────────────────────────────────────────────────────
export const getOrders = async (status = '') => {
  try {
    const url = status
      ? `/admin/orders?status=${status}`
      : '/admin/orders?limit=100';

    const res = await api.get(url);
    return normArr(res);
  } catch {
    return [];
  }
};

export const generateTags = async (orderId) => {
  const res = await api.post('/admin/tags/generate', { orderId });
  return norm(res);
};

// ── TAGS ─────────────────────────────────────────────────────────
export const getTags = async (params = {}) => {
  try {
    const q = new URLSearchParams({ limit: 50, ...params }).toString();
    const res = await api.get(`/admin/tags?${q}`);

    const raw = res?.data;

    return {
      tags: Array.isArray(raw?.data) ? raw.data : [],
      total: raw?.pagination?.total ?? raw?.data?.length ?? 0,
    };
  } catch {
    return { tags: [], total: 0 };
  }
};

// ── CATEGORIES ───────────────────────────────────────────────────
export const getCategories = async () => {
  try {
    const res = await api.get('/admin/categories');
    return normArr(res);
  } catch {
    return [];
  }
};

export const createCategory = async (payload) => {
  const res = await api.post('/admin/categories', payload);
  return norm(res);
};

export const updateCategory = async (id, payload) => {
  const res = await api.put(`/admin/categories/${id}`, payload);
  return norm(res);
};

// ── SUBSCRIPTIONS ────────────────────────────────────────────────
export const getSubscriptions = async (status = 'active') => {
  try {
    const res = await api.get(`/admin/subscriptions?status=${status}`);
    return normArr(res);
  } catch {
    return [];
  }
};

// ── USERS ────────────────────────────────────────────────────────
export const getUsers = async () => {
  try {
    const res = await api.get('/admin/users?limit=100');
    return normArr(res);
  } catch {
    return [];
  }
};

export { BASE_URL };
export default api;