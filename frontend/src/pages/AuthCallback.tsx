import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const errorParam = params.get('error');

    if (errorParam) {
      setError('Authentication was denied. Please try again.');
      return;
    }

    if (code) {
      // Backend will handle the code exchange — redirect to callback API
      window.location.href = `/api/v1/auth/callback?code=${encodeURIComponent(code)}`;
      return;
    }

    // No code in URL — might be a redirect from backend after successful auth
    // Check if we're now authenticated
    checkAuth().then(() => {
      navigate('/files', { replace: true });
    });
  }, [location.search, navigate, checkAuth]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <svg className="w-12 h-12 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <h3 className="text-sm font-medium text-gray-900 mb-2">Authentication Failed</h3>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button onClick={() => navigate('/login')} className="btn-primary">Try Again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-2 text-gray-400">
        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Completing sign in...</span>
      </div>
    </div>
  );
}
