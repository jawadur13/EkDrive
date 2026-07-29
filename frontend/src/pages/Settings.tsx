export function Settings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Settings</h2>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="font-medium mb-4">Connected Drives</h3>
        <p className="text-gray-500 text-sm">No drives connected yet.</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="font-medium mb-4">Storage Mode</h3>
        <p className="text-gray-500 text-sm">Balanced</p>
      </div>
    </div>
  );
}