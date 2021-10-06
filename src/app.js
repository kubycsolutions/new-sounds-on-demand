/* New Sounds On Demand: Archive player, heavily modified from a Jovo
   podcast-player sample to load its tables directly from the database
   driving the newsounds.org website, and to offer enhanced behaviors.

   That db appears to record most broadcast dates, though some dates
   and some episode numbers are missing. Some are known to have been
   pre-empted; I would have expected the episode number (ep#) to still
   exist even if the date was empty, but apparently not.

   Rebroadcasts appear as additional entries with the same episode
   number but different dates. I maintain one record per episode, with
   cross-references for date access.

   NOTE: Dates are being stored in JSON as msec-since-epoch
   because that round-trips more predictably. When used as a hash key,
   that gets stringified during JSON save; my code handles normalizing
   the type and/or rebuilding Date objects when necessary, though not
   necessarily elegantly.

   OPEN TASKS:

   BUG/ISSUE: Possible long delay on resume if not already in Alexa's
   local cache, presumably due to the computational cost of
   decompressing up to offset. Can we avoid that, eg by triggering
   earlier preloading?  I presume Amazon's answer is "not our problem;
   break it up into smaller audio files", which doesn't work for this
   use case. And it's not something we can easily warn the user about,
   though recording timestamp when they stopped as well as the offset
   might let us at least make a guess.

   TODO NITPICK: Strip trailing "," from titles? It occurs
   sometimes. It's probably harmless but might be affecting
   speech-synth inflection.

   TODO: "Highest Numbered Episode" is currently (mis)interpreted as
   EpisodeNumberIntent with "number" having confirmationStatus="NONE".
   I'm not sure anyone but me will want that operation, but... add an Intent?

   TODO: "Who/what are we listening to" and "who/what is this" can't
   be precise for episodes with currently available data, but should
   answer with "New Sounds On Demand is playing Episode..." (and the
   tease). For the livestream, we can invoke the whos-on query -- but
   be prepared to say "I'm not sure yet" if timestamp is before now;
   it updates a bit slowly.  (And consider which fields to
   provide/queries to support; do the minimum, dump it all, have
   alternative queries, do a "more?" interaction?) This _ought_ to be
   a standard Amazon music-player Intent... there are multiple
   categories of Music intents, mostly tied into Amazon's assumed
   music indexing object types and based on AMAZON.SearchAction,
   though they aren't a *great* match for what I want to offer.

   TODO: Continue to improve speech interactions. I'm using
   https://www.wbur.org/citrus/2020/07/27/alexa-utterances-python-auml-amazon
   to generate some of the combinatorics, but ideally we should allow
   slot completion dialogs, especially after "open" when users may not
   realize they can/should specify date or ep#.

   TODO: Continue to Improve speech interactions. It's supposedly
   possible to add nonprefixed commands for Alexa skill context. See
   https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-name-free-interaction-for-custom-skills.html.
   No idea what's possible in Google.

   TODO: Review Jovo docs and bring up the Google version. (And others?)
   How much of this actually ports?

   TODO: Forward/back (ff/rw, skip f/b, etc) duration.

   TODO: Can we announce ep# when we auto-advance via queue without
   sometimes causing a glitch in the audio? Haven't found a perfect
   incantation yet. May require giving up using the Alexa queue.

   TODO: Generalize database lookup to support other shows?
   (Specifically, make sure this code can run against Soundcheck and
   bring up an instance for that. I don't know that I want to get into
   fully parameterizing the feed reader or making it a plug-in...)
   RELATED TO THIS: Refactoring show config into a setup file would
   permit publishing code without the full details of how to access
   the New Sounds back-end servers... though that wasn't hard to
   discover by running the web pages in a debugger; they haven't
   really tried to obscure it so they may not care.

   TODO: Set, and return to, named state bookmarks.
   Poor man's alternative to search, sort of.

   TODO MAYBE: Track chrono play separately, permitting "resume with ones I
   haven't heard yet" not disturbed by explicit navigation, without
   the full tracking-every-slot or user having to say "since yesterday"

   TODO MAYBE: Can we leverage the fact that we're using the index as the
   playback context tag to avoid recomputing during navigation?

   TODO MAYBE: deHTML handling of accented character escapes (to
   unicode)?  Unclear if needed; I don't know how the smartspeaker
   systems handle rich text (they may already tolerate HTML; I
   *presume* they tolerate unicode... but gods know whether their
   pronunciation of less-obvious names is at all close.)

   TODO MAYBE: Play single ep? (Doable via sleep timer, so probably
   not, but "stop after this episode" might be worthwhile.) Repeat??
   (probably not) Basically additions to the inter-ep navigation
   modes.

   TODO MAYBE: Alternate navigation modes, persistent per user: Date, ep#,
   livestream, fwd/bkwd, shuffle. WORK ON LANGUAGE; can we distinguish
   "most recently released" vs. "most recently broadcast", or does
   that just want to be explicit mode? Currently, ep# implies earliest
   broadcast of that episode, and random actually randomizes date so
   rebroadcasts may show up under any of their dates.

   TODO SOMEDAY: "Play one I haven't heard before" as part of
   random/surprise. More like a genuine shuffle, but requires tracking
   all usage for every user... Doesn't have to be obscenely huge if
   it's a bitvector, but JSON will blow that up again even if we do
   base 64 encoding of the bitvector. Count partial plays?

   TODO SOMEDAY: Smartspeakers with displays. The tease is probably
   wanted for this. Could capture the episode cover-pic too, if we
   want to grow the data. Extracting the playlist from the HTML is not
   impossible...

   TODO SOMEDAY: Tag searchability. Metaphone(stemmer())? Is there 
   something better we can tap in the smartspeaker back ends? How do
   the other skills handle fuzzy search?

   TODO SOMEDAY: MAYBE handle combined shows (needs different incr,
   same-date handling), or show selection. Probably easier to just
   clone the skill. See above refactoring comments.

   REJECTED: Drop stored URI, use date and rework addURIUsage to
   synth the rest? Saves some bytes, but probably not worth doing
   unless needed to facilitate code reuse.
*/

'use strict';

////////////////////////////////////////////////////////////////
const ShowCredits="New Sounds is produced by New York Public Radio, W N Y C and W Q X R. The host and creator of the show is John Schaefer. His team includes Helga Davis, Rosa Gollan, Caryn Havlik, Justin Sergi, and Irene Trudel. More information about these folks, and about the show, can be found on the web at New Sounds dot org."
const AppCredits="The New Sounds On Demand player for smart speakers is being developed by Joe Kesselman and Cubic Solutions, K u b y c dot solutions. Source code is available on github."
////////////////////////////////////////////////////////////////
// DEBUGGING
function objToString(obj, ndeep) {
    const MAX_OBJTOSTRING_DEPTH=10 // circular refs are possible
    if(obj == null){ return String(obj); }
    if(ndeep > MAX_OBJTOSTRING_DEPTH) {return "...(elided; might recurse)..." }
    switch(typeof obj){
    case "string": return '"'+obj+'"';
    case "function": return obj.name || obj.toString();
    case "object":
	var indent = Array(ndeep||1).join('  '), isArray = Array.isArray(obj);
	return '{['[+isArray] + Object.keys(obj).map(function(key){
	    return '\n' + indent + key + ': ' + objToString(obj[key], (ndeep||1)+1);
        }).join(',') + '\n' + indent + '}]'[+isArray];
    default: return obj.toString();
    }
}

// ------------------------------------------------------------------
// APP INITIALIZATION
// ------------------------------------------------------------------

const { App } = require('jovo-framework');
const { Alexa } = require('jovo-platform-alexa');
const { GoogleAssistant } = require('jovo-platform-googleassistant');
const { JovoDebugger } = require('jovo-plugin-debugger');
const { FileDb } = require('jovo-db-filedb');
const { format } = require('date-fns');

const app = new App();

app.use(
    new Alexa(),
    new GoogleAssistant(),
    new JovoDebugger(),
    new FileDb()
);

const Player = require('./player.js');

// Launch asynchronous startup refresh, to help keep later refreshes short.
// (Can't use await here, but if episodes/update is safely reeentrant that
// would be OK. In any case, this will generally run well before user requests.)
Player.updateEpisodes(-1) // Incremental load (usually preferred)

////////////////////////////////////////////////////////////////

// Politeness: Tell the station's servers (and any tracking system
// they're using) where these HTTP(S) queries are coming from, for
// debugging and statistics.
//
// TODO REVIEW: refactor into Player? And/or per-show config?
function addUriUsage(uri) { 
    const app_uri_parameters="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
    if (uri.includes("?"))
	return uri+"&"+app_uri_parameters
    else
	return uri+"?"+app_uri_parameters
}

const AlexaHandler = require('./alexa/handler.js');
const GoogleHandler = require('./google/handler.js');

////////////////////////////////////////////////////////////////
// We'll need duration parsing if we implement
// rewind/fast-forward. The following is adapted into
// nodejs-compatable form from
// https://stackoverflow.com/questions/14934089/convert-iso-8601-duration-with-javascript/29153059

var iso8601DurationRegex = /(-)?P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/;

function parseISO8601Duration (iso8601Duration) {
    var matches = iso8601DurationRegex.exec(iso8601Duration);

    return {
        sign: matches[1] === undefined ? '+' : '-',
        years: matches[2] === undefined ? 0 : matches[2],
        months: matches[3] === undefined ? 0 : matches[3],
        weeks: matches[4] === undefined ? 0 : matches[4],
        days: matches[5] === undefined ? 0 : matches[5],
        hours: matches[6] === undefined ? 0 : matches[6],
        minutes: matches[7] === undefined ? 0 : matches[7],
        seconds: matches[8] === undefined ? 0 : matches[8]
    };
};

// ------------------------------------------------------------------
// APP LOGIC
// ------------------------------------------------------------------

app.setHandler({
    async NEW_USER() {
        this.$speech.addText('Welcome to New Sounds On Demand!')
            .addText('We can begin listening from the oldest or newest episode, from a specific date or episode number, play the live stream, or I can surprise you with a random selection. Which would you like?')
        return this.ask(this.$speech);
    },

    LAUNCH() {
	return this.DialogIntent()
    },

    DialogIntent() {
        this.$speech.addText('Would you like to resume where you left off, listen to the newest or oldest episode, play from a date or episode number, play a random episode, or play the live stream?')
        this.ask(this.$speech);
    },

    FirstEpisodeIntent() {
        let currentDate = Player.getOldestEpisodeDate();
        let episode = Player.getEpisodeByDate(currentDate);
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+episode.title+".");

        if (this.isAlexaSkill()) {
            this.$alexaSkill.$audioPlayer
                .setOffsetInMilliseconds(0)
                .play(addUriUsage(episode.url), `${currentDate}`)
                .tell(this.$speech)
        } else if (this.isGoogleAction()) {
            this.$googleAction.$mediaResponse.play(addUriUsage(episode.url), episode.title);
            this.$googleAction.showSuggestionChips(['pause', 'start over']);
            this.ask(this.$speech);
        }
    },

    async LatestEpisodeIntent() {
	await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
        let currentDate = Player.getMostRecentBroadcastDate();
        let episode = Player.getEpisodeByDate(currentDate);
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+episode.title+".");

        if (this.isAlexaSkill()) {
            this.$alexaSkill.$audioPlayer
                .setOffsetInMilliseconds(0)
                .play(addUriUsage(episode.url), `${currentDate}`)
                .tell(this.$speech)
        } else if (this.isGoogleAction()) {
            this.$googleAction.$mediaResponse.play(addUriUsage(episode.url), episode.title);
            this.$googleAction.showSuggestionChips(['pause', 'start over']);
            this.ask(this.$speech);
        }
    },

    async ResumeIntent() {
	// If we played to end of last known episode -- flagged by offset<0 --
	// try to advance to next after that, which may have been added
	// since that session.
	var currentOffset = this.$user.$data.offset;
        var currentDate = this.$user.$data.currentDate;
	var episode=null
	if (currentDate==Player.getLiveStreamDate()) {
	    return this.LiveStreamIntent()
	}
	else if(currentOffset<0) { // Stopped at last known ep; is there newer?
	    await Player.updateEpisodes(-1) // Pick up any late additions
	    currentDate=Player.getNextEpisodeDate(currentDate)
            episode = Player.getEpisodeByDate(currentDate);
	    if(!episode) {
		// TODO: This language may need to change depending on whether
		// we are playing in date or ep# sequence.
		return this.tell("You have already heard all of the most recent episode, so we can't resume right now. You can try again after a new episode gets released, or make a different selection.");
		return
	    }
	    currentOffset=0;
	}
	else {
            episode = Player.getEpisodeByDate(currentDate);
	}
        this.$speech.addText('Loading and resuming episode '+episode.title+".")

        if (this.isAlexaSkill()) {
	    let offset = this.$user.$data.offset;
	    let offsetMin=offset/60/1000;
	    if (offsetMin > 30) {
		// BUG TODO: If we need to reload Alexa cache before playing,
		// resume may have a long delay as it decompresses
		// up to the offset point. I haven't thought of a reliable
		// way to advise the user of this without unnecessary
		// warnings (when already in cache, it's fast).
		// Check whether Alexa has a solution, though short of
		// breaking into smaller MP3's so there are more frequent
		// decompression synch points I don't know what one could do.
		// GONK?
	    }
	    this.$alexaSkill.$audioPlayer
                .setOffsetInMilliseconds(offset)
                .play(addUriUsage(episode.url), `${currentDate}`)
                .tell(this.$speech);
        } else if (this.isGoogleAction()) {
	    this.$googleAction.$mediaResponse.play(addUriUsage(episode.url), episode.title);
	    this.$googleAction.showSuggestionChips(['pause', 'start over']);
	    this.ask(this.$speech);
        }
    },

    async NextIntent() {
        let currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
            return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
	await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
        let nextEpisodeDate = Player.getNextEpisodeDate(currentDate);
        let nextEpisode = Player.getEpisodeByDate(nextEpisodeDate);
        if (!nextEpisode) {
	    // TODO: This language may need to change depending on whether
	    // we are playing in date or ep# sequence.
            return this.tell('That was the most recent episode. You will have to wait until a new episode gets released, or ask for a different one.');
        }
        currentDate = nextEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+nextEpisode.title+".");
	this.tell(this.$speech)
        if (this.isAlexaSkill()) {
            this.$alexaSkill.$audioPlayer
		.setOffsetInMilliseconds(0)
		.play(addUriUsage(nextEpisode.url), `${currentDate}`)
        } else if (this.isGoogleAction()) {
            this.$googleAction.$mediaResponse.play(addUriUsage(nextEpisode.url), nextEpisode.title);
            this.$googleAction.showSuggestionChips(['pause', 'start over']);
            this.ask('Enjoy');
        }
    },

    PreviousIntent() {
        let currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
            return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
        let previousEpisodeDate = Player.getPreviousEpisodeDate(currentDate);
        let previousEpisode = Player.getEpisodeByDate(previousEpisodeDate);
        if (!previousEpisode) {
	    // TODO: This language may need to change depending on whether
	    // we are playing in date or ep# sequence.
            return this.tell('You are already at the oldest episode.');
        }
        currentDate = previousEpisodeDate;
        this.$user.$data.currentDate = currentDate;
	// TODO: Can we get this to announce episode title?
        this.$speech.addText('Fetching episode '+previousEpisode.title+".");
	this.tell(this.$speech)
        if (this.isAlexaSkill()) {
            this.$alexaSkill.$audioPlayer
		.setOffsetInMilliseconds(0)
		.play(addUriUsage(previousEpisode.url), `${currentDate}`)
        } else if (this.isGoogleAction()) {
            this.$googleAction.$mediaResponse.play(addUriUsage(previousEpisode.url), previousEpisode.title);
            this.$googleAction.showSuggestionChips(['pause', 'start over']);
            this.ask('Enjoy');
        }
    },

    RewindIntent() {
	// GONK: This one is being surprisingly problematic...
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
            return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
        let duration = this.getInput("duration").value
	console.log(">>> RewindIntent:",duration, typeof(duration))
	let dd=parseISO8601Duration(duration)
	console.log(">>> RewindIntent:",dd)

	return this.tell("Rewinding isn't supported yet. You could ask us to restart the episode instead.")
    },

    // Note: Alexa doesn't want us using the word "shuffle", except as
    // that refers to the handler's Alexa.ShuffleOnIntent. (And Off,
    // of course.) For now, avoid using that term in the language
    // model.
    RandomIntent() {
        let randomEpisodeDate = Player.getRandomEpisodeDate();
        let randomEpisode = Player.getEpisodeByDate(randomEpisodeDate);
        let currentDate = randomEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+randomEpisode.title+".");
	this.tell(this.$speech)
        if (this.isAlexaSkill()) {
            this.$alexaSkill.$audioPlayer
		.setOffsetInMilliseconds(0)
		.play(addUriUsage(randomEpisode.url), `${currentDate}`)
        } else if (this.isGoogleAction()) {
            this.$googleAction.$mediaResponse.play(addUriUsage(randomEpisode.url), randomEpisode.title);
            this.$googleAction.showSuggestionChips(['pause', 'start over']);
            this.ask('Enjoy');
        }
    },

    async DateIntent() {
	// GONK: UTC VERSUS LOCALTIME JUGGLING.
	// Do all date parsing in UTC?
	// Would require a full reload from database to fix timestamps.
        let whichdate = this.getInput("date").value
	let splitdate=whichdate.split("-")
	// Remember that  Month is 0-indexed, gratuitously...
	let spokendate=new Date(splitdate[0],splitdate[1]-1,splitdate[2]) // interpreted as UTC

	let date=new Date() // in local timezone
	date.setFullYear(spokendate.getFullYear())
	date.setMonth(spokendate.getMonth())
	date.setDate(spokendate.getDate())
	date.setHours(-spokendate.getHours()) // GONK: UTC offset fix
	date.setMinutes(0)
	date.setSeconds(0)
	date.setMilliseconds(0)
	
	// Alexa seems to take "Monday" as "coming monday". 
	// And the user *could* say "tomorrow". So roll back...
	let datestamp=date.getTime()
	if(datestamp>Date.now())
	{
	    const days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]
	    this.$speech.addText("That came through as a future date, so I'm assuming you meant last "+days[date.getDay()]+".")
	    // TODO: There are better ways to handle this.
	    while(datestamp>Date.now())
	    {
		date.setDate(date.getDate()-7) // Back up a week
		datestamp=date.getTime()
	    }
	}

	await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
	let episode=Player.getEpisodeByDate(datestamp)
	if(episode!=null && episode !=undefined)
	{
	    let currentDate=Player.getEpisodeDate(episode) // gonk -- clean up
            this.$user.$data.currentDate = currentDate;
            this.$speech.addText("Fetching the show from "+format(date,"PPPP")+": episode "+episode.title+".");
	    this.tell(this.$speech)
            if (this.isAlexaSkill()) {
		this.$alexaSkill.$audioPlayer
		    .setOffsetInMilliseconds(0)
		    .play(addUriUsage(episode.url), `${currentDate}`)
            } else if (this.isGoogleAction()) {
		this.$googleAction.$mediaResponse.play(addUriUsage(episode.url), episode.title);
		this.$googleAction.showSuggestionChips(['pause', 'start over']);
		this.ask('Enjoy');
            }
	}
	else {
	    this.$speech.addText("An episode broadcast on "+format(date,"PPPP")+" does not seem to be available in the vault. What would you like me to do instead?")
	    this.ask(this.$speech)
	}
    },

    async EpisodeNumberIntent() {
	const number=parseInt(this.getInput('number').value) // comes back as string
	await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
	const episode=Player.getEpisodeByNumber(number)
	if(episode!=null && episode !=undefined)
	{
	    const currentDate=Player.getEpisodeDate(episode) // Gonk: Clean up
            this.$user.$data.currentDate = currentDate;
            this.$speech.addText('Fetching episode '+episode.title+".");
	    this.tell(this.$speech)
            if (this.isAlexaSkill()) {
		this.$alexaSkill.$audioPlayer
		    .setOffsetInMilliseconds(0)
		    .play(addUriUsage(episode.url), `${currentDate}`)
            } else if (this.isGoogleAction()) {
		this.$googleAction.$mediaResponse.play(addUriUsage(episode.url), episode.title);
		this.$googleAction.showSuggestionChips(['pause', 'start over']);
		this.ask('Enjoy');
            }
	}
	else {
	    this.$speech.addText("Episode number "+number+" does not seem to be available in the vault. What would you like me to do instead?")
	    this.ask(this.$speech)
	}
    },

    // TODO REVIEW: Should we be able to "resume" livestream?
    // Currently, it's set up so that will work (special index used to
    // flag that state, which also lets us respond appropriately to
    // FF/RW/Next/Prev in the stream). But there's something to be
    // said for maintaining episode playback state separetely, and of
    // course "resume" of livestream is from now rather than from
    // stop, so it's debatable. I lean toward keeping it this way for
    // user convenience after pause (eg for phone call), but this gets
    // back to the "bookmarks" wishlist item.
    //
    // TODO: acess the livestream's playlist, to be able to answer
    // "who/what is this"?.  Note that whos-on updates a bit slowly,
    // so we may need to check timestamps for "ended before now" and
    // be ready to say "I'm not sure yet."
    LiveStreamIntent() {
	const streamURI=addUriUsage(Player.getLiveStreamURI())
	const currentDate=Player.getLiveStreamDate()
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText("Playing the New Sounds livestream.");
        if (this.isAlexaSkill()) {
	    this.$alexaSkill.$audioPlayer
		.setOffsetInMilliseconds(0)
		.play(streamURI, `${currentDate}`)
	        .tell(this.$speech)
            } else if (this.isGoogleAction()) {
		this.$googleAction.$mediaResponse.play(addUriUsage(episode.url), episode.title);
		this.$googleAction.showSuggestionChips(['pause']);
		this.ask('Enjoy');
            }
    },

    HelpIntent() {
        this.$speech.addText('You can ask for the earliest or latest episode, request one by date or episode number, tell us to surprise you with a randomly chosen show, resume where you stopped last time, restart the episode now playing, or play the "live stream" webcast.')
            .addText('Which would you like to do?')
        this.ask(this.$speech);
    },

    CreditsIntent() {
        this.$speech.addText(ShowCredits)
        this.$speech.addText(AppCredits)
	return this.tell(this.$speech)
    },

    // Hook for testing, normally inactive
    DebugIntent() {
        this.$speech.addText('Void where prohibited. Or mandatory.')
	return this.tell(this.$speech)
    }

});

////////////////////////////////////////////////////////////////////

app.setAlexaHandler(AlexaHandler);
app.setGoogleAssistantHandler(GoogleHandler);

module.exports.app = app;
