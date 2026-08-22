import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Home as HomeIcon,
  MessageSquare,
  Library,
  FileText,
  Network,
  User,
  Users,
  LogOut,
  PanelLeft,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { TOPICS } from '../../data/topics';
import { BrandLogo } from '../BrandLogo';
import { NavGroup } from './NavGroup';
import { ThemeToggle } from '../ThemeToggle';
import { cn } from '../../lib/utils';

export interface SidebarProps {
  /** Collapses to the 76px icon rail (persisted by AppLayout). */
  onToggleCollapse: () => void;
  /** Closes the mobile off-canvas drawer (called on any nav click). */
  onNavigate: () => void;
}

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  cn('nav-item', isActive && 'is-active');

const navSubItemClass = ({ isActive }: { isActive: boolean }) =>
  cn('nav-item', 'nav-subitem', isActive && 'is-active');

/**
 * The fixed left sidebar (there is no top bar): the app brand lockup, the Home /
 * Knowledge Base nav group, an admin-only section, and a footer with the theme
 * toggle, the user chip (the link to the profile page), and the sign-out wiring.
 * Collapses to an icon rail on desktop and becomes an off-canvas drawer on mobile.
 */
export default function Sidebar({ onToggleCollapse, onNavigate }: SidebarProps) {
  const { name, userAttributes, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const topicsActive = location.pathname.startsWith('/topics/');
  const email = userAttributes?.email ?? '';
  const subLabel = email && email !== name ? email : 'Signed in';

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <aside className='sidebar'>
      <div className='sidebar-head'>
        <NavLink to='/' className='sidebar-brand' onClick={onNavigate}>
          <BrandLogo />
        </NavLink>
        <button
          type='button'
          className='nav-toggle'
          aria-label='Toggle sidebar'
          onClick={onToggleCollapse}
        >
          <PanelLeft size={18} />
        </button>
      </div>

      <nav className='nav'>
        <NavLink to='/' end className={navItemClass} title='Home' onClick={onNavigate}>
          <span className='ni-icon'>
            <HomeIcon size={18} />
          </span>
          <span className='ni-label'>Home</span>
        </NavLink>

        <NavLink
          to='/conversations'
          className={navItemClass}
          title='Conversations'
          onClick={onNavigate}
        >
          <span className='ni-icon'>
            <MessageSquare size={18} />
          </span>
          <span className='ni-label'>Conversations</span>
        </NavLink>

        <NavGroup icon={Library} label='Knowledge Base' isActive={topicsActive}>
          {TOPICS.map(topic => (
            <NavLink
              key={topic.id}
              to={`/topics/${topic.id}`}
              className={navSubItemClass}
              title={topic.title}
              onClick={onNavigate}
            >
              <span className='ni-icon'>
                <topic.icon size={18} />
              </span>
              <span className='ni-label'>{topic.title}</span>
            </NavLink>
          ))}
        </NavGroup>

        <NavLink to='/converter' className={navItemClass} title='Converter' onClick={onNavigate}>
          <span className='ni-icon'>
            <FileText size={18} />
          </span>
          <span className='ni-label'>Converter</span>
        </NavLink>
        <NavLink to='/ontology' className={navItemClass} title='Ontology' onClick={onNavigate}>
          <span className='ni-icon'>
            <Network size={18} />
          </span>
          <span className='ni-label'>Ontology</span>
        </NavLink>
      </nav>

      {isAdmin() && (
        <div className='nav-section'>
          <div className='nav-section__label'>Admin</div>
          <NavLink
            to='/admin'
            className={navItemClass}
            title='User Management'
            onClick={onNavigate}
          >
            <span className='ni-icon'>
              <Users size={18} />
            </span>
            <span className='ni-label'>User Management</span>
          </NavLink>
        </div>
      )}

      <div className='sidebar-spacer' />

      <div className='sidebar-foot'>
        <ThemeToggle variant='row' />
        <NavLink
          to='/profile'
          className={({ isActive }) => cn('nav-item', 'user-chip', isActive && 'is-active')}
          title='Profile'
          onClick={onNavigate}
        >
          <span className='ni-icon'>
            <User size={18} />
          </span>
          <span className='u-main'>
            <span className='u-name'>{name || 'Member'}</span>
            <span className='u-sub'>{subLabel}</span>
          </span>
        </NavLink>
        <button type='button' className='nav-item' title='Sign out' onClick={handleSignOut}>
          <span className='ni-icon'>
            <LogOut size={18} />
          </span>
          <span className='ni-label'>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
