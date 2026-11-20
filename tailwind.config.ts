import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#f0f7f1", 100: "#d9ecdc", 500: "#3f8a55", 600: "#2f7043", 700: "#265a37", 900: "#14301d" },
      },
    },
  },
  plugins: [],
} satisfies Config;
