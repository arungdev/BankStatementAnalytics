import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Output the production build directly to the ASP.NET Core wwwroot folder
    outDir: "../BankStatementAnalytics/wwwroot",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://localhost:7123", // NOTE: Update this to match your actual ASP.NET Core backend URL/Port
        changeOrigin: true,
        secure: false, // Set to false to accept self-signed dev certificates from .NET
      },
    },
  },
});
