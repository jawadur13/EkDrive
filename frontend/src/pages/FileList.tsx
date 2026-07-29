import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export default function FileList() {
  const [folderId, setFolderId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['files', folderId],
    queryFn: () => api.get('/files').then((r) => r.data),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><span className="text-gray-400">Loading...</span></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Files</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          Upload
        </button>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Modified</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Drive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.files?.map((file: any) => (
              <tr key={file.id} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 text-sm">{file.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{file.size_bytes}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{file.updated_at}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{file.drive_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}