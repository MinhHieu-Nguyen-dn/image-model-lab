# Security policy

## Scope and threat model

Image Model Lab is a single-user app that runs on your own machine. By design it:

- listens only on `127.0.0.1` and rejects any `Host` or `Origin` it does not recognise (protection against DNS rebinding and cross-site requests from web pages you visit);
- serves files only from `images/projects/`;
- never returns a full API key from its API, and stores keys in plain text in `images/credentials.json` with mode `0600`.

It has no login and is not meant to be exposed to a network or run as a hosted service. Putting it behind a reverse proxy or binding it to another interface is unsupported and removes its main protection.

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue with exploit details.

Include what you found, how to reproduce it, and the impact. You can expect an acknowledgement within a few days. Reports about a hosted or networked deployment are out of scope unless the flaw also affects the default loopback setup.

## Handling your own data

- Never commit or share the `images/` folder; it contains your API keys and generated content.
- Rotate any API key you suspect has been exposed.
