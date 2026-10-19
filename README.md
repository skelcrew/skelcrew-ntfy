# skelcrew-ntfy

A Skelcrew hook that sends a push to your phone or desktop when a task needs you. An agent
asks a question, and your phone shows "shop #142 asks", with "Should an empty list throw?"
below it. It goes through [ntfy](https://ntfy.sh), which needs no account.

## Tutorial: your first push in five minutes

You need Skelcrew with `skel plugin`, Bun on your PATH, and a phone or a browser.

### 1. Get the ntfy app

Install ntfy on your phone from the App Store or Google Play. You can also use
https://ntfy.sh/app in a browser, which shows desktop notifications.

### 2. Make a topic only you know

A topic is like a channel name. Anyone who knows it can read what is sent to it, and
ntfy.sh is a public server, so make it impossible to guess. This makes one:

```sh
echo "skel-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
```

It prints something like `skel-3f9a1c0e7b2d84a6c5e1f0d2`. In the ntfy app, tap **+**
("Subscribe to topic"), paste the name, and subscribe. Leave the server as `ntfy.sh`.

### 3. Install the plugin

```sh
skel plugin install skelcrew/skelcrew-ntfy
```

Skelcrew shows what the plugin will run and asks before installing. Answer `y`.

### 4. Tell it your topic

```sh
mkdir -p ~/.skelcrew/plugin-config/skelcrew.ntfy
echo "NTFY_TOPIC=skel-3f9a1c0e7b2d84a6c5e1f0d2" > ~/.skelcrew/plugin-config/skelcrew.ntfy/.env
```

Use your own topic from step 2, not this one.

### 5. Send a test push

```sh
skel plugin hook skelcrew.ntfy task.held
```

It prints `bun notify.ts: exited with code 0` and `Sent.`. Your phone shows a push
titled `[sample] <folder> #1 is held`. `[sample]` marks a test, so you can tell it from a
real task. Try `task.asked` too, to see how a question looks.

If no push arrives, see "When no push arrives" below.

### 6. Turn it on for a repository

In the repository's `skelcrew.yaml`, add the plugin under `plugins`:

```yaml
plugins:
  runner: tmux
  workspace: git
  hooks: [skelcrew.ntfy]
```

Keep your other plugin lines as they are. Then run `skel stop`. The daemon reads
`skelcrew.yaml` only when it starts, and the next `skel` command starts it again.

### 7. See it work

Add a task and pause it:

```sh
skel add "Try the ntfy plugin"
skel pause 1
```

Your phone shows `<repo> #1 is paused`. A pause is quiet, at low priority. A question,
a sign-off or a hold comes at high priority, so your phone makes a sound. Use `skel resume 1`
or `skel kill 1` to tidy up.

That's it. From now on, you hear about each task that needs you, wherever you are.

## What it sends

| Event | Title | Priority |
|---|---|---|
| an agent asks you a question | `shop #142 asks`, with the question and its options | high |
| a task waits for your sign-off | `shop #142 waits for your sign-off`, with why | high |
| a task is held | `shop #142 is held`, with why and what to do | high |
| a task you paused | `shop #142 is paused` | low |
| a task is delivered | `shop #142 is delivered`, with its branch, or where its report is | normal |
| a task ends without delivering | `shop #142 ended: declined`, with the reason | low |
| a task is added | `shop #142 added`, only if `NTFY_EVENTS` names `task.added` | lowest |

`shop` is the repository's folder name, so several repositories can share one topic.

## Settings

In `~/.skelcrew/plugin-config/skelcrew.ntfy/.env`, one `KEY=value` a line. `#` starts a
comment, on a line of its own or after a space. Put a value in quotes to keep a ` #` in it.
An unknown key is refused, so a typo never goes unnoticed.

| Key | What it is | Default |
|---|---|---|
| `NTFY_TOPIC` | the topic to send to | required |
| `NTFY_SERVER` | your own ntfy server, if you run one | `https://ntfy.sh` |
| `NTFY_TOKEN` | an access token, for a server that needs a login. Use an `https://` server, or the token travels in the clear. | none |
| `NTFY_EVENTS` | the events to send, separated by commas | every event but `task.added` |

For example, to hear only about questions and sign-offs:

```sh
NTFY_TOPIC=skel-3f9a1c0e7b2d84a6c5e1f0d2
NTFY_EVENTS=task.asked, task.approval
```

A change to `.env` applies from the next push. It needs no restart.

## When no push arrives

- **`skel plugin hook` says "No ntfy topic"**: the `.env` file is missing, or has no
  `NTFY_TOPIC`. The message names the file it looked for.
- **It says `Sent.` but the phone shows nothing**: the app is subscribed to a different
  topic, or a different server. Compare the topic letter by letter.
- **It says "Not sent: NTFY_EVENTS leaves out ..."**: `NTFY_EVENTS` doesn't name that event.
- **Real tasks send nothing, but the try works**: check `hooks: [skelcrew.ntfy]` is in
  `skelcrew.yaml`, and that you ran `skel stop` after adding it.
- **Anything else**: `~/.skelcrew/plugin-state/skelcrew.ntfy/hooks.log` has each real run's
  event, exit code and last lines, newest last.

## What it can see

Each message holds the task's title, and its question or hold message. An agent wrote some
of that text, and it goes to the ntfy server you name. Run your own server with
`NTFY_SERVER` if your task titles shouldn't leave your machine.

Skelcrew runs the hook in a sandbox. It can read its own folders and the rest of your home,
but no Skelcrew key or repository, and it has no token to act on Skelcrew. It installs
nothing and has no dependencies. The code is one file, `notify.ts`.

## Working on it

```sh
bun install
bun run check   # typecheck and tests
skel plugin uninstall skelcrew.ntfy && skel plugin link .   # use your copy instead
```

The tests run `notify.ts` as Skelcrew does, against a stand-in ntfy server, so none reaches
the internet.
