const BASE_URL = import.meta.env.VITE_API_URL || "";

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  token: string;
  loggedIn: boolean;
}

export async function signup(email: string, password: string, name: string): Promise<AuthUser> {
  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Signup failed");
  persistUser(data);
  return data;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  persistUser(data);
  return data;
}

export async function requestReset(email: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Reset failed");
}

export async function getMe(): Promise<AuthUser | null> {
  const stored = getStoredUser();
  if (!stored?.token) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    });
    if (!res.ok) { clearUser(); return null; }
    const data = await res.json();
    const user = { ...data, token: stored.token };
    persistUser(user);
    return user;
  } catch {
    return stored;
  }
}

export function logout() {
  clearUser();
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("safroi_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistUser(user: AuthUser) {
  localStorage.setItem("safroi_user", JSON.stringify(user));
  localStorage.setItem("safroi_auth_status", JSON.stringify({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    loggedIn: true,
  }));
}

function clearUser() {
  localStorage.removeItem("safroi_user");
  localStorage.removeItem("safroi_auth_status");
}
