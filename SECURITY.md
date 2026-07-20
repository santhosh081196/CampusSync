# Security

## Sensitive data

This app uses a Canvas personal access token and Google OAuth tokens. Never commit or share these values.

The current personal-use release stores settings through `electron-store` in the user's application-data directory. Before broad public distribution, migrate secrets to operating-system-backed secure storage such as Windows Credential Manager or macOS Keychain.

## Reporting a vulnerability

Please report security issues privately to the repository owner instead of opening a public issue containing exploit details or credentials.
