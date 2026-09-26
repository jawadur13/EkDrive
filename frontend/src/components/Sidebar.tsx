import { NavLink, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z' },
  { to: '/files', label: 'Files', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  { to: '/trash', label: 'Trash', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' },
  { to: '/activity', label: 'Activity', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

interface SidebarProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ isCollapsed = false, onToggle = () => {} }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const initial = (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  return (
    <aside className={`bg-white border-r border-gray-100 flex flex-col fixed inset-y-0 left-0 z-20 transition-all duration-300 ${isCollapsed ? 'w-[72px]' : 'w-60'}`}>
      <div className={`py-4 border-b border-gray-100 flex items-center ${isCollapsed ? 'justify-center' : 'px-5'}`}>
        <Link to="/" className="flex items-center gap-3">
          <img src="/ek-drive-logo.png" alt="EkDrive Logo" className="w-8 h-8 object-contain flex-shrink-0" />
          {!isCollapsed && <span className="text-lg font-bold text-gray-900 tracking-tight whitespace-nowrap">EkDrive</span>}
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isCollapsed ? 'justify-center px-0' : 'px-3'
                  } ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
                title={isCollapsed ? item.label : undefined}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
                {!isCollapsed && <span>{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="px-3 py-3 border-t border-gray-100 flex flex-col gap-2">
        <button onClick={onToggle} className={`flex items-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors ${isCollapsed ? 'justify-center p-2' : 'px-3 py-2 gap-3'}`} title="Toggle Sidebar">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isCollapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 19l7-7-7-7m-8 14l7-7-7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            )}
          </svg>
          {!isCollapsed && <span className="text-sm font-medium">Collapse</span>}
        </button>
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center py-2' : 'px-3 py-2'}`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 overflow-hidden">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : initial}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.displayName ?? user?.email}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
          )}
          {!isCollapsed && (
            <button onClick={() => logout()} className="text-xs text-gray-400 hover:text-red-600" title="Sign out">
              Sign out
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
