# Contributing

Contributions that improve local usability, reliability, accessibility, tests,
or documentation are welcome.

Before opening a pull request:

1. Keep all test data synthetic and local. Do not commit browser captures,
   reservation references, diagnostics, cookies, or personal information.
2. Preserve the extension's safety boundaries: it must not bypass CAPTCHA,
   Cloudflare, rate limits, order limits, or other site protections.
3. Run the offline check:

   ```sh
   node tests/request-pacing.cjs
   ```

4. Describe the change and its verification in the pull request.

By contributing, you agree that your contribution is licensed under the
[Apache-2.0 license](LICENSE).
