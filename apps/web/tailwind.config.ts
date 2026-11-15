import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1220",
        muted: "#3e4a5c",
        line: "#e1e4ea",
        canvas: "#f5f6f8",
        accent: "#1d4ed8",
      },
    },
  },
  plugins: [],
} satisfies Config;
