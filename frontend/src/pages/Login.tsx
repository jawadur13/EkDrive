export default function Login() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-blue-600 mb-4">EkDrive</h1>
        <p className="text-gray-500 mb-6">Connect your Google Drive accounts and manage them as one.</p>
        <button className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
          Sign in with Google
        </button>
      </div>
    </div>
  );
}