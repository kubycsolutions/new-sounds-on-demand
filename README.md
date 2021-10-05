**New Sounds On Demand** -- smartspeaker access to the archives, and livestream, of https://newsounds.org.

**About this Skill**

New Sounds, produced at the WNYC/WQXR studios, is "A daily showcase of weird and wonderful music from artists, composers and traditional musicians — all gleefully oblivious of their genres." It's an excellent resource for learning about music and performers that American radio stations don't (or didn't) often play. Each episode is centered around playing examples which meet that day's theme, ranging from historic to ultramodern, traditional to avant-garde, soloists to orchestras.

There have been over 4500 unique episodes since the early 1980s, with new ones still being added, and almost all of them can now be retrieved from the station's servers. This skill lets Alexa-family smart speakers access those archives, selecting them by broadcast date or episode number or asking for oldest/newest/random.

**Platform**

Currently only Alexa support is being alpha-tested. But this code is based on the Jovo Framework (https://www.jovo.tech), which should let us bring it up on other smartspeaker platforms with a minimum of rewriting.

Jovo prefers JavaScript (or TypeScript) as its development language, and the examples I used while learning it were JavaScript based. I was learning both Jovo and JavaScript as I went, so this is far from the cleanest or most idiomatic code I've ever written. Also, Jovo is in the processs of releasing a new set of APIs and a new preferred architecture for Jovo applications. Major restructuring and rewriting is likely before it settles down.

**Usage**

Once the **New Sounds On Demand** skill has been enabled on the smartspeaker, I suggest your first action be "**{wake-word}, open New Sounds On Demand**". This prompts you with some of the available operations.

On Alexa/Echo devices, most of the usual music-player navigation commands are available, and the core commands can work without having to be explicitly routed to this skill. Simply say the wake-word followed by **Next**, **Previous**, **Stop**, **Pause**, **Resume**, or **Restart**.

For other commands, you will either have to Open the skill first, or explicitly say "**{wake-word}, ask New Sounds On Demand ...**" followed by what you want to do. In addition to the above commands, we support many synonyms of **Play the most recent broadcast**, **Play the oldest episode**, **Play episode {episode-number}**, **Play the show from {date}**, **Play the live stream**, and **Surprise me**. You can also ask it to **play the credits**. 

**What's New**

This skill is a skunkworks project, still in Alpha testing -- it's brand new, the back-end code is running on the developer's account and may be down at times, and we are still actively refining its capabilities and implementation. Alpha testing is in progress now, by invitation; I hope to submit it for approval as an official Alexa skill before the end of 2021.

There's a long wishlist of known bugs and desired features in the comments at the front of **source/app.js**. Now that I'm posting this on Github those are likely to move to a more official issues-tracker.

**Building and Running the New Sounds On Demand grammar and semantics service**

Details to follow. If you don't want to wait for me, look at the instructions for building and running [Jovo's sample podcast player](https://www.jovo.tech/courses/project-3-podcast-player), which supplied the initial framework from which this code was derived.