import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';

const FileList = lazy(() => import('./pages/FileList'));
const Login = lazy(() => import('./pages/Login'));
const Settings = lazy(() => import('./pages/Settings'));

function App() {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 ml-60">
        <Header />
        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="flex items-center gap-2 text-gray-400"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /><span className="text-sm">Loading...</span></div></div>}>
              <Routes>
                <Route path="/" element={<Navigate to="/files" replace />} />
                <Route path="/files" element={<FileList />} />
                <Route path="/files/:folderId" element={<FileList />} />
                <Route path="/login" element={<Login />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;