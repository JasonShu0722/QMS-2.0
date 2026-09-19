# Secret input diagnostics regression

Run `node --test playwright-security/secret-input.test.mjs` from `apps/web`.
The same check runs before `test:e2e`; it requires the installed Playwright Chromium browser and does not use the gateway, PostgreSQL or seed passwords.

The regression launches the real Playwright runner with list and JSON reporters. A random, non-sensitive canary first demonstrates the original disabled-password `fill` leak. The protected run must still fail on the disabled input, succeed on the enabled input with a trusted browser input event, and omit the canary from terminal output and the complete JSON report, including nested steps. Child output is captured in memory; temporary reports and browser output directories are removed in `finally`.

`fillSecret` is specific to the Chromium acceptance suite. It uses an empty `fill` for normal visibility, enabled and editable checks and clearing/focusing, then the public CDP `Input.insertText` command for actual browser input. A boolean value comparison verifies delivery without exposing the expected value. The CDP session is detached in `finally`, and failures retain a phase-specific redacted error. Playwright's ordinary `fill` and keyboard insertion both include their arguments in reporter step titles; catching those errors alone cannot remove the nested diagnostic.

Trace, screenshots, video and DOM copy prompts remain disabled separately. This helper protects secret input diagnostics; it is not a general scrubber for API payloads, browser console output, arbitrary assertions, enabled recording or custom protocol debugging. Use a label/selector without a secret value, and do not include secrets in assertion messages or test titles. Other browser engines require a separately verified input channel before adding them to the acceptance configuration.
