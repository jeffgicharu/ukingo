import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore marks something left unused on purpose.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Guest pages are followed as whole documents, on purpose: every page a
    // visitor opens comes fresh from the server, with nothing kept from the
    // page before. So their links are plain links.
    files: [
      "src/app/(site)/**",
      "src/components/site/**",
      "src/app/not-found.tsx",
      "src/app/error.tsx",
      // The pages staff see before they are signed in stand alone in the same way.
      "src/app/desk/sign-in/**",
      "src/app/desk/forgot/**",
      "src/app/desk/reset/**",
    ],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts"]),
]);

export default eslintConfig;
