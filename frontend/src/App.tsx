import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { useAuthStore } from './stores/authStore';

const FileList = lazy(() => import('./pages/FileList'));
const Login = lazy(() => import('./pages/Login'));
const Settings = lazy(() => import('./pages/Settings'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Checking authentication...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {isAuthenticated && (
        <>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Header />
            <main className="flex-1 overflow-auto p-6 lg:p-8">
              <div className="max-w-7xl mx-auto">
                <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="flex items-center gap-2 text-gray-400"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /><span className="text-sm">Loading...</span></div></div>}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/files" replace />} />
                    <Route path="/files" element={<ProtectedRoute><FileList /></ProtectedRoute>} />
                    <Route path="/files/:folderId" element={<ProtectedRoute><FileList /></ProtectedRoute>} />
                    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                  </Routes>
                </Suspense>
              </div>
            </main>
          </div>
        </>
      )}
      {!isAuthenticated && (
        <div className="flex-1 flex items-center justify-center">
          <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="flex items-center gap-2 text-gray-400"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /><span className="text-sm">Loading...</span></div></div>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default App;