import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Search,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Compass,
} from 'lucide-react';
import { cn } from '../lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/discover', label: 'Discover', icon: Search, end: false },
  { to: '/leads', label: 'Leads', icon: Users, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export function Layout({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => {
      onLogout();
      navigate('/login');
    };
    window.addEventListener('devzard:unauthorized', handler);
    return () => window.removeEventListener('devzard:unauthorized', handler);
  }, [onLogout, navigate]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold-500/40 bg-gold-500/10">
          <Compass size={16} className="text-gold-400" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-50">Devzard</div>
          <div className="text-[10.5px] font-medium tracking-[0.14em] text-zinc-500 uppercase">
            Lead Generator
          </div>
        </div>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                isActive
                  ? 'bg-gold-500/10 text-gold-300 border border-gold-500/20'
                  : 'text-zinc-400 border border-transparent hover:bg-ink-800 hover:text-zinc-200',
              )
            }
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-ink-700 px-5 py-4">
        <div className="mb-3 text-[13px] font-medium text-zinc-300">{user.name}</div>
        <div className="mb-3 text-[11px] text-zinc-600">
          {user.email} · <span className="capitalize">{user.role}</span>
        </div>
        <button
          onClick={() => {
            onLogout();
            navigate('/login');
          }}
          className="flex items-center gap-2 text-[12.5px] text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-ink-700 bg-ink-900 md:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-ink-700 bg-ink-900 animate-fade-in">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-200"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="text-zinc-400 hover:text-zinc-200" aria-label="Menu">
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold text-zinc-100">Devzard Lead Generator</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
