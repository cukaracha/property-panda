import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAiModeStore } from '../store/useAiModeStore';
import Sidebar from '../components/layout/Sidebar';
import Chat from '../components/chat/Chat';
import { AssistantPill } from '../components/assistant/AssistantPill';
import { cn } from '../lib/utils';

const NAV_COLLAPSED_KEY = 'la-nav-collapsed';

/** Initial collapse state: the persisted choice, else collapsed on narrow screens. */
function initialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(NAV_COLLAPSED_KEY);
    if (stored != null) return stored === '1';
    return window.matchMedia('(max-width: 1099px)').matches;
  } catch {
    return false;
  }
}

/**
 * The in-app shell: a fixed left sidebar (no top bar) beside a single scrolling
 * main column on the canvas, plus the floating assistant mounted at the layout
 * root. The sidebar collapses to an icon rail on desktop (persisted) and becomes
 * an off-canvas drawer behind a hamburger on mobile.
 */
export default function AppLayout() {
  const { isChatOpen, openChat, topicId } = useAiModeStore();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [navOpen, setNavOpen] = useState(false);

  const toggleCollapse = () => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setNavOpen(false);
      return;
    }
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // persistence is best-effort
      }
      return next;
    });
  };

  return (
    <div className={cn('app', collapsed && 'nav-collapsed', navOpen && 'nav-open')}>
      <div className='nav-backdrop' onClick={() => setNavOpen(false)} />
      <button
        type='button'
        className='nav-hamburger'
        aria-label='Open navigation'
        onClick={() => setNavOpen(true)}
      >
        <Menu size={19} />
      </button>

      <Sidebar onToggleCollapse={toggleCollapse} onNavigate={() => setNavOpen(false)} />

      <div className='main'>
        <main className='main-scroll'>
          <Outlet />
        </main>
      </div>

      {/* Floating assistant — only on topic-scoped pages, where the agent has a
          topicId to scope the course knowledge base. Home is a full-page chat of
          its own, so the floating panel is hidden there. The panel renders when
          open, the launcher pill when closed; both are position:fixed siblings. */}
      {topicId && (
        <>
          <Chat />
          {!isChatOpen && <AssistantPill onClick={openChat} />}
        </>
      )}
    </div>
  );
}
