# Sampling vs. calling a model directly

A tool that needs an LLM has two options: hold its own API key and call a
provider directly, or ask the client to do it via `sampling/createMessage`.

Sampling's pitch: the server never sees or pays for a model — the client,
which is already holding credentials and paying for its own inference,
handles it. The server describes what it needs (`messages`, `systemPrompt`,
`maxTokens`, optional `modelPreferences`) and gets text back. The client
keeps a human in the loop if it wants — reviewing or editing a sampling
request before it goes anywhere is explicitly part of the design, not a
workaround.

The trade-off: it's an optional capability. A server that leans on sampling
for a core feature needs a real fallback for clients that don't declare it —
see `summarize-note` in this repo for one shape of that fallback.
