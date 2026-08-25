import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAiModeStore } from '../store/useAiModeStore';
import { useModalStackStore } from '../store/useModalStackStore';
import Sidebar from '../components/layout/Sidebar';
import Chat from '../components/chat/Chat';
import { AssistantPill } from '../components/assistant/AssistantPill';
import { cn } from '../lib/utils';

/**
 * The in-app shell: a fixed left nav rail (no top bar) beside a main region that
 * never scrolls itself, plus the floating assistant mounted at the layout root.
 * Every rail item carries its label under its icon, so there is nothing to
 * expand into and no collapse control. Below 768px the rail leaves the flow as
 * an off-canvas drawer behind a hamburger.
 */
export default function AppLayout() {
  const { isChatOpen, openChat, assistantEnabled } = useAiModeStore();
  const isModalOpen = useModalStackStore(state => state.ids.length > 0);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={cn('app', navOpen && 'nav-open')}>
      <div className='nav-backdrop' onClick={() => setNavOpen(false)} />
      <button
        type='button'
        className='nav-hamburger'
        aria-label='Open navigation'
        onClick={() => setNavOpen(true)}
      >
        <Menu size={19} />
      </button>

      <Sidebar onNavigate={() => setNavOpen(false)} />

      <div className='main'>
        <main className='main-scroll'>
          <Outlet />
        </main>
      </div>

      {/* Floating assistant — only where a page has opted in, since the agent
          answers from the page context and has nothing to say without one. The
          panel renders when open, the launcher pill when closed; both are
          position:fixed siblings.

          Both sit above every modal scrim, so a modal hides whichever is showing.
          Hidden, never unmounted: the panel owns the conversation. */}
      {assistantEnabled && (
        <>
          <Chat isHidden={isModalOpen} />
          {!isChatOpen && <AssistantPill isHidden={isModalOpen} onClick={openChat} />}
        </>
      )}
    </div>
  );
}
