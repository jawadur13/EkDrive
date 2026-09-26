import axios from 'axios';

// The session lives in an HttpOnly cookie, sent automatically; JS never reads it.
const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(error: unknown, fallback = 'Something went wrong') {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message ?? error.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export default api;
