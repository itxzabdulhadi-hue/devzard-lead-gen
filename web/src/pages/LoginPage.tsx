import { useState, type FormEvent } from 'react';
import { Compass } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/primitives';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export default function LoginPage({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const d = await api.post<{ user: SessionUser }>('/api/auth/login', { email, password });
      onLogin(d.user);
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-gold-500/40 bg-gold-500/10">
            <Compass size={22} className="text-gold-400" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Devzard Lead Generator</h1>
          <p className="mt-1.5 text-[13px] text-zinc-500">
            Internal tool — sign in with your Devzard account
          </p>
        </div>
        <form
          onSubmit={submit}
          className="rounded-xl border border-ink-600 bg-ink-850 p-6 shadow-2xl shadow-black/40"
        >
          <div className="mb-4">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@devzard.internal"
            />
          </div>
          <div className="mb-5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="mb-4 rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-[13px] text-red-300">
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Sign in
          </Button>
          <p className="mt-4 text-center text-[11.5px] leading-4 text-zinc-600">
            Seeded dev account: admin@devzard.internal / devzard-admin
            <br />
            (change DEVZARD_ADMIN_PASSWORD before any real deployment)
          </p>
        </form>
      </div>
    </div>
  );
}
