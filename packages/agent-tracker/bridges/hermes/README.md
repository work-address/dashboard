# work-address-hermes

A [Hermes Agent](https://github.com/NousResearch/hermes-agent) plugin that
records how long each agent turn runs, for time tracking and invoicing in
[Work Address](https://address.work).

It is an observer only: it registers `pre_llm_call`, `on_session_end` and
`api_request_error` (a non-retryable request error fails the turn), never returns
context or directives, and hands only session and turn identity, the schema
version, outcome flags and the prompt that starts a turn (`user_message`, up to
4,000 characters) to the Work Address collector
(`npm install -g @work-address/agent-tracker`). Set `WORK_ADDRESS_PROMPTS=off` to
keep the prompt on the server. No response text leaves the process. Only root
turns are recorded.

## Install

```sh
npm install -g @work-address/agent-tracker
pip install "$(npm root -g)/@work-address/agent-tracker/bridges/hermes"
```

The plugin is not on PyPI yet, so this installs the copy the collector ships;
once it is published, `pip install work-address-hermes` does the same. Install it in the same Python environment as Hermes, add `work-address` to
`plugins.enabled` in Hermes configuration, and set the collector up with the
command the Work Address dashboard gives when you add a server agent.

Hermes Agent support is experimental until its live check passes (on 2026.9.24
an interrupted one-shot `hermes -z` stayed open): set
`WORK_ADDRESS_EXPERIMENTAL_ADAPTERS=1` in Hermes's environment. See
[SERVER-RUNTIMES.md](https://github.com/work-address/app/blob/main/packages/agent-tracker/SERVER-RUNTIMES.md#hermes-agent).
