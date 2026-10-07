import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".pgdata/**",
      "out/**",
      ".v2c/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
