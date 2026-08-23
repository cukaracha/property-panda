import { NavLink } from 'react-router-dom';
import { Building2, EyeOff, Heart, User, PanelLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BrandLogo } from '../BrandLogo';
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

/**
 * The fixed left sidebar (there is no top bar): the app brand lockup, the nav, and a
 * footer with the theme toggle and the user chip that links to the profile page.
 * Collapses to an icon rail on desktop and becomes an off-canvas drawer on mobile.
 */
export default function Sidebar({ onToggleCollapse, onNavigate }: SidebarProps) {
  const { name, userAttributes } = useAuth();
  const email = userAttributes?.email ?? '';
  const subLabel = email && email !== name ? email : 'Local';

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
        <NavLink
          to='/properties'
          className={navItemClass}
          title='Property search'
          onClick={onNavigate}
        >
          <span className='ni-icon'>
            <Building2 size={18} />
          </span>
          <span className='ni-label'>Property search</span>
        </NavLink>
        <NavLink to='/shortlist' className={navItemClass} title='Shortlist' onClick={onNavigate}>
          <span className='ni-icon'>
            <Heart size={18} />
          </span>
          <span className='ni-label'>Shortlist</span>
        </NavLink>
        <NavLink to='/hidden' className={navItemClass} title='Always hidden' onClick={onNavigate}>
          <span className='ni-icon'>
            <EyeOff size={18} />
          </span>
          <span className='ni-label'>Always hidden</span>
        </NavLink>
      </nav>

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
      </div>
    </aside>
  );
}
