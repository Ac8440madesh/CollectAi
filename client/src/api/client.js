import axios from 'axios';

/**
 * Shared Axios instance.
 *
 * Base URL comes from VITE_API_URL (see client/.env.example). Auth token
 * injection and 401 handling are added in Phase 1.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

export default api;
