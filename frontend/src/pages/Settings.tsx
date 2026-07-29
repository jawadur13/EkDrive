import { useState } from 'react';
import api from '../services/api';

export default function Settings() {
  const [connecting, setConnecting] = useState(false);

  const handleConnectDrive = async () => {
    setConnecting(true);
    try {
      const response = await api.post('/auth/connect');
      window.location.href = response.data.authUrl;
    } catch {
      window.location.href = '/api/v1/auth/login';
    }
    setConnecting(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your connected drives and storage preferences.</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-base font-semibold text-gray-900">Connected Drives</h2>
        </div>
        <div className="card-body">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">No drives connected</h3>
            <p className="text-sm text-gray-400 mb-4">Connect your Google Drive accounts to get started.</p>
            <button onClick={handleConnectDrive} disabled={connecting} className="btn-primary">
              {connecting ? 'Connecting...' : 'Connect Drive'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-base font-semibold text-gray-900">Storage Mode</h2>
        </div>
        <div className="card-body">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-gray-900">Balanced</p>
              <p className="text-sm text-gray-400">Distribute files evenly across drives</p>
            </div>
            <span className="badge badge-online">Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}