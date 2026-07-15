// Minimal, narrowly-scoped ESLint config.
//
// This project has no prior ESLint setup. Rather than pull in a full
// TypeScript/React "recommended" ruleset (which would likely surface a large,
// unreviewed backlog of pre-existing style/correctness warnings across the
// whole codebase), this config enables only accessibility rules from
// eslint-plugin-jsx-a11y, scoped to the client app. See docs/BUGFIX-LOG.md /
// the 2026-07-15 UX audit for the incident this exists to prevent: icon-only
// buttons shipped with no accessible name.
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "android/**", "ios/**"],
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "jsx-a11y": jsxA11y,
      // Registered (not enabled) so pre-existing `eslint-disable-next-line
      // react-hooks/exhaustive-deps` comments resolve to a real rule instead of
      // erroring as "rule not found" — this config doesn't opt into react-hooks
      // linting itself, that's a separate decision from the a11y scope here.
      "react-hooks": reactHooks,
    },
    settings: {
      "jsx-a11y": {
        // Only map Button — this config is scoped to "every interactive button has
        // an accessible name," not a general form-label audit (Input/Textarea
        // fields without associated <label>s are a real, separate, much larger
        // finding — see the 2026-07-15 UX audit — deliberately out of scope here).
        components: {
          Button: "button",
        },
      },
    },
    rules: {
      // The rule this setup exists for: every button/control must have an
      // accessible name (visible text, aria-label, aria-labelledby, or title).
      "jsx-a11y/control-has-associated-label": [
        "error",
        {
          labelAttributes: ["aria-label", "title"],
          controlComponents: ["Button"],
          // Native form fields are a separate, much larger finding (see settings
          // comment above) — this rule stays scoped to buttons. th/td are
          // structural table cells, not interactive controls, and can be
          // legitimately empty (a spacer column for an actions button, etc).
          ignoreElements: ["input", "textarea", "select", "option", "audio", "video", "th", "td"],
          depth: 3,
        },
      ],
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
    },
  },
);
