**New Sounds On Demand** -- smartspeaker access to the archives, and livestream, of https://newsounds.org.

**Live Alexa Skill:** https://www.amazon.com/dp/B09WJ3H657

**About this Skill**

New Sounds, produced at the WNYC/WQXR studios, is "A daily showcase of weird and wonderful music from artists, composers and traditional musicians — all gleefully oblivious of their genres." It's an excellent resource for learning about music and performers that American radio stations don't (or didn't) often play. Each episode is centered around playing examples which meet that day's theme, ranging from historic to ultramodern, traditional to avant-garde, soloists to orchestras. Where else can you hear everything from Tuvan throat singing to krautrock to Laurie Anderson to Robert Fripp to Philip Glass to resampled/recomposed Monteverdi, sometimes in a single show?

There have been over 4500 unique episodes since the early 1980s, with new ones still being added, and almost all of them can now be retrieved from the station's servers. This skill lets Alexa-family smart speakers access those archives, selecting them by broadcast date or episode number or asking for oldest/newest/random. We can also tune in the New Sounds live stream, a 24-hour mix with the same wide variety.

**Platform**

Currently Alexa support is publicly available, with Google in development. Since this code is based on the Jovo Version 3 Framework (https://v3.jovo.tech), we should be able to bring it up on some of the other smartspeaker platforms with a minimum of rewriting.

Jovo Version 4 (https://www.jovo.tech) has been released since I started this project, and I hope to have a migrated version of my code Any Day Now (preferably before 2023). Restructuring to Jovo v4's new preferred structure (which does look promising) may be delayed.

Jovo prefers JavaScript or TypeScript as its development language, and the examples I used while learning it were JavaScript based. I was learning both Jovo and JavaScript as I went, so this is far from the cleanest or most idiomatic code I've ever written. Consider it "whittled" more than designed; stylistic cleanup would be worthwhile at some point.

**Usage**

Once the **New Sounds On Demand** skill has been enabled on the smartspeaker, I suggest your first action be "**{alexa-wake-word}, open New Sounds On Demand**" or "**{google-wake-word}, talk to New Sounds On Demand**". This entry path prompts you with some of the available operations. It isn't fully conversational yet, but at least it reminds you what the options are.

On Alexa/Echo devices, most of the usual music-player navigation commands are available, and the core commands can work without having to be explicitly routed to this skill. Simply say the wake-word followed by **Next**, **Previous**, **Stop**, **Pause**, **Resume**, or **Restart**.

For other commands, you will either have to Open the skill first, or explicitly say "**{wake-word}, ask New Sounds On Demand ...**" followed by what you want to do. In addition to the above commands, we support many synonyms of **Play the most recent broadcast**, **Play the oldest episode**, **Play episode {episode-number}**, **Play the show from {date}**, **Play the live stream**, and **Surprise me**. You can also ask it to **read the credits**. 


**Known issues**

KNOWN LIMITATION ON ALEXA: Alexa's default parsing of incomplete is biased toward assuming "next" instance of the described date -- "Tuesday" is taken as "next Tuesday." This skill is always backward-looking, so that is the wrong default. Until/unless we can fix this, we have to rely on the skill's checking the date and, if it's later than today, asking the user to rephrase their request (eg "this Monday").

KNOWN BUG ON ALEXA: "Play the highest numbered episode" is currently being misinterpreted as IncompleteEpisodeNumberRequest rather than HighestEpisodeRequest. It could be worse; the user can recover by just saying "Highest" again when asked which episode they want... but it would be good to analyse why the grammar causes this misinterpretation and get it fixed.


**What's New**

This skill is now live in the Alexa app collection, at https://www.amazon.com/dp/B09WJ3H657 ! Now "all I need to do" is get the attention of users. I've done a bit of low-key announcement on social media, but it's probably not going to take off -- if it ever does -- until the show's producers decide they want to publicize it.

Second release begins taking advantage of displays (if you have an Echo Show or similar). There are some glitches where the card is overwritten; I'm working with the Jovo folks to get that fixed.

Second release also adds **"<wakeword>, ask New Sounds On Demand what's playing"**. This is useful for the livestream, where music plays without being described. It's currently reading all the information we have; I'm considering adding more specific phrases (as in Alexa's music item queries) and may remove some of those categories from the default description. Unfortunately we don't have accurately timed playlists for the individual episodes, so for those all I can do is tell you which one you're listening to.


**Future Goals**

There's a long wishlist of known bugs and desired features in the comments at the front of **source/app.js**. Now that I'm posting this on Github those are likely to move to a more official issues-tracker.

The back-end database can track multiple shows, though it is currently only loading New Sounds. The front-end currently handles a single show at a time; it could be easily retargeted to other shows in that database, or we can work on developing a dialog structure to let the user select among the available shows. Most of the other shows in the New Sounds family do have their best material eventually wind up incorporated into the flagship program, so this isn't a top priority right now.


**Building and Running the New Sounds On Demand grammar and semantics service**

Details to follow. If you don't want to wait for me, look at the scripts in the *windevutils* subdirectory, and/or instructions for building and running [Jovo V3's sample podcast player](https://www.jovo.tech/courses/project-3-podcast-player), which supplied the initial framework from which this code was derived.
