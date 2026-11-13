import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../session/AuthContext";

function AuthForm({ isSignUp }: { isSignUp: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (isSignUp) {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        setLoading(false);
        return;
      }
      const result = await signUp(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        navigate("/");
      }
    } else {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        navigate("/");
      }
    }
    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>{isSignUp ? "Create Account" : "Sign In"}</h1>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={styles.input}
              disabled={loading}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={8}
              style={styles.input}
              disabled={loading}
            />
          </div>

          {isSignUp && (
            <div style={styles.field}>
              <label htmlFor="confirmPassword" style={styles.label}>
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
                style={styles.input}
                disabled={loading}
              />
            </div>
          )}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>

        <p style={styles.switch}>
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <Link to={isSignUp ? "/signin" : "/signup"} style={styles.link}>
            {isSignUp ? "Sign In" : "Create Account"}
          </Link>
        </p>

        <div style={styles.note}>
          <p><strong>Development Mode:</strong> Using mock authentication.</p>
          <p>Set <code>SUPABASE_URL</code> and keys in <code>.env</code> for real auth.</p>
        </div>
      </div>
    </div>
  );
}

export function SignInScreen() {
  return <AuthForm isSignUp={false} />;
}

export function SignUpScreen() {
  return <AuthForm isSignUp={true} />;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: "#f5f5f5",
  },
  card: {
    width: "100%",
    maxWidth: "400px",
    background: "white",
    borderRadius: "12px",
    padding: "32px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  },
  title: {
    margin: "0 0 24px",
    fontSize: "24px",
    fontWeight: 600,
    textAlign: "center",
    color: "#1a1a1a",
  },
  error: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#374151",
  },
  input: {
    padding: "12px 16px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "16px",
    outline: "none",
    transition: "border-color 0.2s",
  },
  button: {
    marginTop: "8px",
    padding: "14px",
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.2s",
  },
  switch: {
    marginTop: "24px",
    textAlign: "center",
    fontSize: "14px",
    color: "#6b7280",
  },
  link: {
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 500,
  },
  note: {
    marginTop: "24px",
    padding: "16px",
    background: "#fef3c7",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#92400e",
  },
};