# skelcrew-ntfy

A Skelcrew hook that sends a push to your phone or
desktop when a task needs you. An agent asks a question, and your phone shows
"shop #142 asks: Should an empty list throw?". It goes through
[ntfy](https://ntfy.sh), which needs no account.

## Set it up

1. Install the ntfy app on your phone, or open https://ntfy.sh/app in a browser.
2. Pick a topic name that nobody could guess, such as `skel-` and 20 random letters.
   **Anyone who knows the topic can read your messages,** and ntfy.sh is a public server.
   The app's "Subscribe to topic" takes the name.
3. Install the plugin, and tell it the topic:

   ```sh
   skel plugin install skelcrew/skelcrew-ntfy
   mkdir -p ~/.skelcrew/plugin-config/skelcrew.ntfy
   echo "NTFY_TOPIC=skel-your-random-letters" > ~/.skelcrew/plugin-config/skelcrew.ntfy/.env
   ```

4. Try it: `skel plugin hook skelcrew.ntfy task.held` sends a sample, marked `[sample]`.
5. Add it to your repository's `skelcrew.yaml`, then run `skel stop` so the daemon reads it
   on its next start:

   ```yaml
   plugins:
     hooks: [skelcrew.ntfy]
   ```

## What it sends

| Event | Title | Priority |
|---|---|---|
| an agent asks you a question | `shop #142 asks`, with the question and its options | high |
| a task waits for your sign-off | `shop #142 waits for your sign-off`, with why | high |
| a task is held | `shop #142 is held`, with why and what to do | high |
| a task you paused | `shop #142 is paused` | low |
| a task is delivered | `shop #142 is delivered`, with its branch | normal |
| a task ends without delivering | `shop #142 ended: killed` | low |
| a task is added | `shop #142 added`, only if `NTFY_EVENTS` names `task.added` | lowest |

`shop` is the repository's folder name, so several repositories can share one topic.

## Settings

In `~/.skelcrew/plugin-config/skelcrew.ntfy/.env`, one `KEY=value` a line. `#` starts a
comment. An unknown key is refused, so a typo never goes unnoticed.

| Key | What it is | Default |
|---|---|---|
| `NTFY_TOPIC` | the topic to send to | required |
| `NTFY_SERVER` | your own ntfy server, if you run one | `https://ntfy.sh` |
| `NTFY_TOKEN` | an access token, for a server that needs a login | none |
| `NTFY_EVENTS` | the events to send, separated by commas | every event but `task.added` |

## What it can see

Each message holds the task's title, and its question or hold message. An agent wrote some
of that text, and it goes to the ntfy server you name. Run your own server with
`NTFY_SERVER` if your task titles shouldn't leave your machine.

Skelcrew runs the hook in a sandbox. It can read its own folders and the rest of your home,
but no Skelcrew key or repository, and it has no token to act on Skelcrew. It installs
nothing and has no dependencies. The code is one file, `notify.ts`.

If a push never arrives, `~/.skelcrew/plugin-state/skelcrew.ntfy/hooks.log` has each run's
exit code and last lines.

## Working on it

```sh
bun install
bun run check   # typecheck and tests
skel plugin uninstall skelcrew.ntfy && skel plugin link .   # use your copy instead
```

The tests run `notify.ts` as Skelcrew does, against a stand-in ntfy server, so none reaches
the internet.
