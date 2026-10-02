import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="login">
      <div className="card login-card">
        <p className="brand-mark">Waste2Light</p>
        <h1>Green Corner Quote Tool</h1>
        <p className="muted">Internal. Power. Learn. Build.</p>
        <LoginForm />
      </div>
    </main>
  );
}
