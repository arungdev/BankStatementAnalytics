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
    port: 5007,
    proxy: {
      "/api": {
        // http://localhost:5000 is bound by both the "http" and "https" launch
        // profiles (see Properties/launchSettings.json), so this works regardless
        // of which profile `dotnet run` was started with.
        target: "http://localhost:5000",
        changeOrigin: true,
        secure: false, // Accept self-signed dev certificates from .NET
      },
    },
  },
});
