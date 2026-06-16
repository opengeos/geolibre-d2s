import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Emit declarations to dist/types (matching the package.json "exports"
    // map). CSS side-effect imports are stripped automatically. bundleTypes
    // rolls each entry into a single self-contained .d.ts so consumers under
    // Node16 module resolution have no unresolved relative imports, and the
    // cjs outDir adds matching .d.cts files for the "require" condition.
    dts({
      tsconfigPath: resolve(__dirname, "tsconfig.build.json"),
      entryRoot: resolve(__dirname, "src"),
      bundleTypes: true,
      outDirs: ["dist/types", { dir: "dist/types", moduleFormat: "cjs" }],
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  // Dev-only workaround for D2S CORS. The D2S API serves
  // `Access-Control-Allow-Origin: *` without `Allow-Credentials`, so a browser
  // on another origin cannot send the auth cookie cross-origin. During local
  // development we proxy `/api` and `/static` to the D2S instance so the browser
  // sees same-origin requests (cookies flow normally). To use it, set the
  // plugin's "Server" field to the dev origin, e.g. `http://localhost:5173`.
  // Override the upstream with `D2S_PROXY_TARGET=https://your.d2s.org npm run dev`.
  // This proxy does NOT exist in the GeoLibre build; production needs server-side
  // CORS (see README).
  server: {
    proxy: {
      "/api": {
        target: process.env.D2S_PROXY_TARGET || "https://ps2.d2s.org",
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: "",
      },
      "/static": {
        target: process.env.D2S_PROXY_TARGET || "https://ps2.d2s.org",
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: "",
      },
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        react: resolve(__dirname, "src/react.ts"),
      },
      name: "GeoLibrePluginTemplate",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "mjs" : "cjs";
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external: ["react", "react-dom", "maplibre-gl"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "maplibre-gl": "maplibregl",
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css")
            return "geolibre-d2s.css";
          return assetInfo.name || "";
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
    minify: false,
  },
});
