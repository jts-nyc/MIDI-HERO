# Simple mode: a 10-minute student test

Simple mode is a stripped-down MIDI Hero for early student feedback: five song cards, an
automatic keyboard check, a count-in, a results screen and four one-tap questions. The one
choice a student can make is Easy or Normal. The full game at the root URL is unchanged.

- Student link: `https://jts-nyc.github.io/MIDI-HERO/simple/`
- Teacher view (same machine, same browser): `https://jts-nyc.github.io/MIDI-HERO/simple/?teacher=1`
- Without the site: `npm run dev`, then `http://localhost:5173/simple/`

Teacher defaults are fixed: 25-key window, relaxed timing, note names on the keys and the
falling notes, the computer sounds the song's note on a hit, no fail-out, no penalty for
holding a key, and the game's quiet cues for star power, streaks and level-ups (none during
First Lights). On Easy the right note in any octave counts, so a bumped octave button does
not stop a beginner; Normal (the game's Medium level) wants the exact key. First Lights runs
under the student-trial conditions in [STUDENT-TRIAL-READINESS](STUDENT-TRIAL-READINESS.md)
(exact C4/E4/G4, normal timing) and ignores Easy/Normal.

## Setup, per machine (2 minutes)

1. Chrome only, signed in the way the students will use it. **Not Incognito or Guest**: those
   wipe the answers when the window closes.
2. Plug the Oxygen 25 into USB **before** opening the link. Wired headphones or speakers
   (Bluetooth adds a delay students will notice).
3. Open the student link. When Chrome asks to use MIDI devices, click **Allow**. The bottom of
   the song screen should name the keyboard.
4. Play one card yourself: the keyboard check should show a green letter and "It works!".
5. Open the teacher view: it should say 0 responses. If old ones are there, download them,
   then clear.

**Chromebooks with student logins:** answers are stored per Chrome profile. If each student
signs in to their own account, each account holds only its own answers, and the teacher view
under your login will show none of them. Either run the test on the lab iMacs (or one shared
login), or have each student open the teacher link at the end and download the CSV to where
you collect it. A file turned in through Classroom carries the student's account name, even
though the file itself has none.

## What to tell the students

"This is an early test of a music game, so it's the game being tested, not you. Play a song,
then tap your answers to four quick questions, and please don't type your name."

## Session plan (10 minutes)

| Time | What happens |
|---|---|
| 0–1 | The two sentences above. Point at the link. |
| 1–2 | Students open it and pick a card. The keyboard check runs on its own. |
| 2–8 | Two or three songs, each followed by the questions (about a minute to play, 30 seconds to answer). Suggest First Lights or Warm-up first. |
| 8–9 | Anyone who said "too easy" tries Normal. |
| 9–10 | You export from each machine (below). |

## What to watch for

Write observations against a machine number, not a name.

- **The check.** Does "press the first key on the left" make sense? Who gets stuck, and on what?
- **Finding the notes.** Do they look at the falling notes, the key names, or their hands? Do
  they notice a note is coming before it lands?
- **Lag.** Faces after a press. The "did the game match what you played?" answer is the
  number to compare against what you saw.
- **Sound.** Can they hear their notes over the backing on their headphones?
- **Where they stop.** A Stop mid-song is recorded as "finished: false". Note why.
- **First Lights.** If the check says the keyboard is shifted, do they find the octave button?
- **Chromebook performance.** Stutter or dropped frames on the highway.
- **Questions they ask you.** Each one is a gap in the screens.

## Collecting the answers

On each machine, open the teacher view and click **Download CSV** (and **Download JSON** if
you want a full copy). File names carry the browser's random id and the date, so files from
different machines don't collide. Put them in one Drive folder; every CSV has the same
columns, so they stack in one sheet. Only after the files are safe, click **Clear all
responses** (it asks to confirm).

What is stored: the four answers, the optional comment, the song, Easy/Normal, whether it was
played to the end, notes on time out of total, MIDI or computer keyboard, a timestamp and one
random id per browser. Nothing leaves the machine: no network requests, no analytics. Students
may still type a name into the comment box despite the label; read the comments before
sharing a file.

## Before you rely on it

- Nobody has run this on a real Oxygen 25 or a school Chromebook yet; the checks so far are
  headless Chrome with the computer keyboard. Do one run yourself on the actual hardware first.
- If this is a preview deploy and the pull request has not been merged, the next push to `main`
  redeploys the site from `main` and removes `/simple/`. Answers already on a machine stay
  there, but the page that shows them is gone until it is deployed again.
