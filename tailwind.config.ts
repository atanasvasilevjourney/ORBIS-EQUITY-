import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="neon"]'],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--surface)",
          alt: "var(--surface-alt)",
        },
        accent: {
          bull: "var(--accent-bull)",
          bear: "var(--accent-bear)",
          neutral: "var(--accent-neutral)",
          info: "var(--accent-info)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
