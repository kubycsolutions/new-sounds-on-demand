**New Sounds On Demand** -- smartspeaker access to the archives, and livestream, of https://newsounds.org.

**About this Skill**

New Sounds, produced at the WNYC/WQXR studios, is "A daily showcase of weird and wonderful music from artists, composers and traditional musicians — all gleefully oblivious of their genres." It's an excellent resource for learning about music and performers that American radio stations don't (or didn't) often play. Each episode is centered around playing examples which meet that day's theme, ranging from historic to ultramodern, traditional to avant-garde, soloists to orchestras. Where else can you hear everything from Tuvan throat singing to krautrock to Laurie Anderson to Robert Fripp to Philip Glass to resampled/recomposed Monteverdi, sometimes in a single show?

There have been over 4500 unique episodes since the early 1980s, with new ones still being added, and almost all of them can now be retrieved from the station's servers. This skill lets Alexa-family smart speakers access those archives, selecting them by broadcast date or episode number or asking for oldest/newest/random. We can also tune in the New Sounds live stream, a 24-hour mix with the same wide variety.

**Platform**

Currently Alexa support is being alpha-tested, with Google in development. Since this code is based on the Jovo Version 3 Framework (https://www.jovo.tech), we should be able to bring it up on some of the other smartspeaker platforms with a minimum of rewriting.

Jovo Version 4 has been released since I started this project, and I expect to have a minimally-migrated version of my code Any Day Now (preferably before 2023). Restructuring to Jovo v4's new preferred structure (which does look promising) may be delayed.

Jovo prefers JavaScript (or TypeScript) as its development language, and the examples I used while learning it were JavaScript based. I was learning both Jovo and JavaScript as I went, so this is far from the cleanest or most idiomatic code I've ever written. 

**Usage**

Once the **New Sounds On Demand** skill has been enabled on the smartspeaker, I suggest your first action be "**{alexa-wake-word}, open New Sounds On Demand**" or "**{google-wake-word}, talk to New Sounds On Demand**". This entry path prompts you with some of the available operations. It isn't fully conversational yet, but at least it reminds you what the options are.

On Alexa/Echo devices, most of the usual music-player navigation commands are available, and the core commands can work without having to be explicitly routed to this skill. Simply say the wake-word followed by **Next**, **Previous**, **Stop**, **Pause**, **Resume**, or **Restart**.

For other commands, you will either have to Open the skill first, or explicitly say "**{wake-word}, ask New Sounds On Demand ...**" followed by what you want to do. In addition to the above commands, we support many synonyms of **Play the most recent broadcast**, **Play the oldest episode**, **Play episode {episode-number}**, **Play the show from {date}**, **Play the live stream**, and **Surprise me**. You can also ask it to **read the credits**. 

** Known issues **

IN DEVELOPMENT: The prototype `player.ts` was/is saving its local cache database of episodes and indexes in a FileDB instance, and updating when an action is taken that needs to check for newer episodes. That doesn't work for Lambdas, since they don't have a writable filesystem and lose in-memory tables when they shut down. We are moving toward a model based on a DynamoDB instance on AWS, which avoids those limitations plus allowing daily updates to run asynchronously as a scheduled daily operation. That code will also take the first step toward supporting multiple shows; I want to at least think about integrating the *Sound Check* in-studio sessions.

KNOWN LIMITATION: Alexa's default handling of numbers understands "twenty-nine oh three" and similar constructions, and its default handling of dates can accept things like "last Tuesday". Google Dialogflow may not be quite that clever, but we hope to make those work on Google at some point.

SOMEWHAT-EXPECTED ERROR MESSAGE

If the alpha release responds to a voice command with
`Connection error. Your Jovo webhook endpoint is not running. Please run Jovo Run.`
that usually means a developer has shut down the semantics server (the code checked in here) for debugging or to bring up a new release, though a crash is not completely impossible. Try again in an hour or so, to give us time to work on it; if the outage persists more than a day, open an issue.

Yes, this error can interfere with the **Stop** and **Pause** commands. If that happens, the simplest workaround is usually to ask the smartspeaker to begin doing something else, then issue **Stop** to that.

**What's New**

This skill is a skunkworks project, still in Alpha testing -- it's brand new, the back-end code is running on the developer's account and may be down at times, and we are still actively refining its capabilities and implementation. Alpha testing is in progress now, by invitation; I hope to submit it for approval as an official Alexa skill before the end of 2021.

There's a long wishlist of known bugs and desired features in the comments at the front of **source/app.js**. Now that I'm posting this on Github those are likely to move to a more official issues-tracker.

**Building and Running the New Sounds On Demand grammar and semantics service**

Details to follow. If you don't want to wait for me, look at the instructions for building and running [Jovo's sample podcast player](https://www.jovo.tech/courses/project-3-podcast-player), which supplied the initial framework from which this code was derived.
