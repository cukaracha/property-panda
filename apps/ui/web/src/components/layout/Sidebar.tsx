import { NavLink } from 'react-router-dom';
import { Building2, EyeOff, Heart, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BrandLogo } from '../BrandLogo';
import { ThemeToggle } from '../ThemeToggle';
import { cn } from '../../lib/utils';

export interface SidebarProps {
  /** Closes the mobile off-canvas drawer (called on any nav click). */
  onNavigate: () => void;
}

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  cn('nav-item', isActive && 'is-active');

/**
 * The fixed left nav rail (there is no top bar): the brand mark, the nav, and a
 * footer with the theme control and the identity chip that links to the profile
 * page. Every item carries an icon over a short label in the rail and the full
 * destination name in the mobile drawer; `title` always carries the full name.
 */
export default function Sidebar({ onNavigate }: SidebarProps) {
  const { name, userAttributes } = useAuth();
  const email = userAttributes?.email ?? '';
  const subLabel = email && email !== name ? email : 'Local';

  return (
    <aside className='sidebar'>
      <div className='sidebar-head'>
        <NavLink to='/' className='sidebar-brand' onClick={onNavigate}>
          <BrandLogo />
        </NavLink>
      </div>

      <nav className='nav'>
        <NavLink to='/search' className={navItemClass} title='Property search' onClick={onNavigate}>
          <span className='ni-icon'>
            <Building2 size={20} />
          </span>
          <span className='ni-short'>Search</span>
          <span className='ni-label'>Property search</span>
        </NavLink>
        <NavLink to='/shortlist' className={navItemClass} title='Shortlist' onClick={onNavigate}>
          <span className='ni-icon'>
            <Heart size={20} />
          </span>
          <span className='ni-short'>Shortlist</span>
          <span className='ni-label'>Shortlist</span>
        </NavLink>
        <NavLink to='/hidden' className={navItemClass} title='Always hidden' onClick={onNavigate}>
          <span className='ni-icon'>
            <EyeOff size={20} />
          </span>
          <span className='ni-short'>Hidden</span>
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
            <User size={20} />
          </span>
          <span className='ni-short'>Profile</span>
          <span className='u-main'>
            <span className='u-name'>{name || 'Member'}</span>
            <span className='u-sub'>{subLabel}</span>
          </span>
        </NavLink>
      </div>
    </aside>
  );
}
