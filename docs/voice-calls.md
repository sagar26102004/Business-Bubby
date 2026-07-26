# Live voice calls (LiveKit)

Localo's in-app voice calls are **real audio** now, not simulated. The call
*signaling* (ringing / join / decline / leave, the participant list) runs on the
`calls` table as before; the **audio** rides on top via [LiveKit](https://livekit.io).

- When a participant is `joined`, the call screen connects to the LiveKit room
  `call_<callId>`, publishes the mic, and plays everyone else's audio.
- **Mute** toggles the real microphone.
- Leaving / the call ending disconnects cleanly.
- It **degrades gracefully**: on Expo Go (no native WebRTC) or before LiveKit is
  configured, the call still connects for signaling and the screen shows a note
  that audio is simulated — nothing crashes.

## Where it lives

| Piece | File |
| --- | --- |
| Audio hook (connect / mic / mute) | `src/features/calls/useCallAudio.ts` |
| Native WebRTC bootstrap (dev build) | `src/features/calls/livekitNative.native.ts` (native impl); base `livekitNative.ts` is the web/no-op fallback |
| Call screen wiring | `src/app/call/session/[callId].tsx` |
| Token mint (Path A) | `supabase/functions/dynamic-responder/index.ts` (deployed slug `dynamic-responder`, display name "livekit-token") |
| Repo method | `CallRepository.getAudioToken(callId)` — Supabase impl in `src/data/supabase/calls.ts` |
| Path B (Express) | queued in `backend/SYNC_QUEUE.md` → `[SYNC-001]` |

The signing secret never touches the client: the app calls `getAudioToken`, the
edge function verifies the caller's JWT + call membership, then signs the token.

## One-time setup

### 1. Create a LiveKit Cloud project

1. Sign up at <https://cloud.livekit.io> (free tier is plenty for testing).
2. Create a project. From its **Settings → Keys**, note:
   - **Server URL** — looks like `wss://<name>.livekit.cloud`
   - **API Key**
   - **API Secret**

### 2. Deploy the token edge function (Path A — current backend)

```bash
# from the repo root, logged into the Supabase CLI for project mzxslzouzmiswnrolcaq
# NOTE: the deployed slug is `dynamic-responder` (Supabase's default name, locked
# at creation; the dashboard display name is "livekit-token"). The frontend
# invokes it by that slug, so deploy the folder as-is.
supabase functions deploy dynamic-responder

# give it the LiveKit credentials (kept server-side only)
supabase secrets set \
  LIVEKIT_URL=wss://<name>.livekit.cloud \
  LIVEKIT_API_KEY=<key> \
  LIVEKIT_API_SECRET=<secret>
```

That's all the app on `EXPO_PUBLIC_BACKEND=supabase` needs. No client env var —
the URL comes back with the token.

### 3. Web — works immediately

Browsers ship WebRTC, so `npx expo start --web` gives real audio once step 2 is
done. Open the same call in two browser tabs (or two devices) as the two
participants and you'll hear each other.

### 4. Phone — needs a dev build (not Expo Go)

Real WebRTC is a native module, so **Expo Go can't run the audio** — you need a
custom dev build once:

```bash
# Android (device plugged in / emulator running)
npx expo run:android
# or a cloud build
# eas build --profile development --platform android
```

Install that dev build instead of Expo Go; from then on it has the microphone
and WebRTC baked in and voice calls are fully live. (The rest of the app runs in
it exactly like Expo Go.)

### 5. Path B (Express API backend), when you switch to it

The Supabase edge function covers `EXPO_PUBLIC_BACKEND=supabase`. If/when you run
on `EXPO_PUBLIC_BACKEND=api`, run `/update-backend` to apply `[SYNC-001]`, which
adds the equivalent `POST /calls/:callId/token` route to `backend/` (reads the
same `LIVEKIT_*` env vars).

## Troubleshooting

- **Screen says "Live audio needs the dev build…"** on the phone → you're in Expo
  Go. Build a dev client (step 4).
- **Same note on web / "not configured"** → the edge function isn't deployed or
  the `LIVEKIT_*` secrets aren't set (step 2). The function returns 501 until they are.
- **"Couldn't connect the audio"** → network/firewall to `*.livekit.cloud` (the
  same class of restriction that blocks Expo's HMR on locked-down Wi-Fi). Try a
  different network / mobile hotspot.
