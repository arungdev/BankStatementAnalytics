import axios from "axios";

const base = "/api";

const api = axios.create({
  baseURL: base,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const path = window.location.pathname;
    if (err.response?.status === 401 && path !== "/login" && path !== "/setup") {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
