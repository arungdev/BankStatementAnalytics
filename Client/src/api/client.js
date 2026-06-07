import axios from "axios";

const base = "/api";

const api = axios.create({
  baseURL: base,
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;
