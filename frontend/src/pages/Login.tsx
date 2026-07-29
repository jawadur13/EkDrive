export default function Login() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/ek-drive-logo.png" alt="EkDrive Logo" className="w-20 h-20 object-contain mb-4 mx-auto drop-shadow-md" />
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">EkDrive</h1>
          <p className="mt-2 text-sm text-gray-500">Connect your Google Drive accounts and manage them as one unified storage.</p>
        </div>

        <div className="card p-8">
          <button className="btn-primary w-full py-3 text-base">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z" />
            </svg>
            Sign in with Google
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Secure access with Google OAuth 2.0
        </p>
      </div>
    </div>
  );
}