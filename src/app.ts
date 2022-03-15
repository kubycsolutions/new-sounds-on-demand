/* New Sounds On Demand: Archive player, heavily modified from a Jovo
   podcast-player sample to load its tables from the data driving the
   newsounds.org website, and to offer enhanced behaviors.

   In the process of copying the website's database into my own, some
   workarounds are applied to rectify deficits and irregularities.

   OPEN TASKS:

   TODO #1: Confirm that episodedb rewrite is functioning, retarget to
   hosted DynamoDB rather than local, then cut over to /new/ code.

   TODO #2: Now that we're working from database, clean up the
   Episode-versus-Index coding; always work with Episode object and
   let Player do the mapping back to episodedb access.

   BUG/ISSUE: Possible long delay on resume IF not already in Alexa's
   local cache, presumably due to the computational cost of
   decompressing up to offset. Can we avoid that, eg by triggering
   earlier preloading?  I presume Amazon's answer is "not our problem;
   break it up into smaller audio files", which doesn't work for this
   use case. And it's not something we can easily warn the user about,
   though recording clocktime when they stopped might let us at least
   make a guess about whether other work might have intervened and
   flushed that cache.

   TODO CLEANLINESS: Get rid of the TS ! non-null assertions; do
   explicit tests. It isn't _likely_ that these will ever be null, but
   better to have clean recovery in that case.

   TODO NITPICK: Strip trailing "," from titles? It occurs
   sometimes. It's probably harmless but might be affecting
   speech-synth inflection.

   TODO: "Highest Numbered Episode" seems to be (mis)interpreted as
   EpisodeNumberIntent ("number episode"?) with "episodeNumber" having
   confirmationStatus="NONE".  I'm not sure anyone but me will want
   that operation, but clean up that intent handling.

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

   TODO: Continue to improve speech interactions. It's supposedly
   possible to add nonprefixed commands for Alexa skill context, once
   the skill has been accepted. No idea what's possible in Google. See
   https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-name-free-interaction-for-custom-skills.html.

   TODO: Review Jovo docs and bring up the Google version on
   lambda. (And others?)  How much of this actually ports?

   TODO: Forward/back (ff/rw, skip f/b, etc) by duration.

   TODO: Can we announce ep# when we auto-advance via queue without
   sometimes causing a glitch in the audio? Haven't found a perfect
   incantation yet. May require giving up using the Alexa queue, though
   that would slow ep-to-ep transition.

   TODO: Generalize database lookup to support other shows?
   (Specifically, make sure this code can run against Soundcheck and
   bring up an instance for that. I don't know that I want to get into
   fully parameterizing the feed reader or making it a plug-in...)

   TODO: Set, and return to, named state bookmarks.  Poor man's
   alternative to search and since, and being able to distinguish
   between resuming stream, context, newest?

   TODO MAYBE: Track chrono play separately, permitting "resume with ones I
   haven't heard yet" not disturbed by explicit navigation, without
   the full tracking-every-slot or user having to say "since yesterday"

   TODO MAYBE: deHTML handling of accented character escapes (to
   unicode)?  Unclear if needed; I don't know how the smartspeaker
   systems handle rich text (they may already tolerate HTML; I
   *presume* they tolerate unicode... but gods know whether their
   pronunciation of less-obvious names is at all close.)

   TODO MAYBE: Play single ep? (Doable via sleep timer, so probably
   not, but "stop after this episode" might be worthwhile.) Repeat??
   (Probably not.) Playlist? (Probably needed for keyword search.)
   ... Basically additions to the inter-ep navigation modes.

   TODO MAYBE: Alternate navigation modes, persistent per user: Date,
   ep#, livestream, fwd/bkwd, shuffle. WORK ON COMMAND LANGUAGE; can
   we distinguish "most recently released" vs. "most recently
   broadcast", or does that just want to be explicit mode? Currently,
   ep# implies earliest broadcast of that episode, and random actually
   randomizes date so rebroadcasts may show up under any of their
   dates.

   TODO SOMEDAY: "Play one I haven't heard before" as part of
   random/surprise. More like a genuine shuffle, but requires tracking
   all usage for every user... Doesn't have to be obscenely huge if
   it's a bitvector... How to handle partial plays?

   TODO SOMEDAY: Smartspeakers with displays. The tease is probably
   wanted for this. Episode cover-pic too. Extracting the playlist
   from the HTML body is not impossible but is ugly... or just render
   that body?

   TODO SOMEDAY: Tag searchability. Other music skills seem to handle
   bandname/recordname/trackname surprisingly well; is there something
   we can tap there, or is sounds-like matching the best we've got?

   TODO SOMEDAY: MAYBE handle combined shows (needs different incr,
   same-date handling), or show selection. Initially easier to just
   clone the skill, but with combined database "next" over multiple
   becomes more possible.
*/

'use strict';
import { Alexa } from 'jovo-platform-alexa';
import { AlexaHandler } from './alexa/handler';
import { App } from 'jovo-framework';
import { GoogleAssistant } from 'jovo-platform-googleassistant';
import { GoogleHandler } from './google/handler';
import { JovoDebugger } from 'jovo-plugin-debugger';
import { Player } from './player';
import { Project } from 'jovo-framework'
import { format } from 'date-fns'
//import { utcToZonedTime } from 'date-fns-tz' // may be needed to report local date

console.log('TODO: This implementation uses an outdated version of the Jovo Framework. When time permits, we will upgrade to Jovo v4. See https://www.jovo.tech/docs/migration-from-v3');

////////////////////////////////////////////////////////////////
const ShowCredits="New Sounds is produced by New York Public Radio, W N Y C and W Q X R. The host and creator of the show is John Schaefer. His team includes Caryn Havlik, Helga Davis, Rosa Gollan, Justin Sergi, and Irene Trudel. More information about these folks, and about the show, can be found on the web at New Sounds dot org."
const AppCredits="The New Sounds On Demand player for smart speakers is being developed by Joe Kesselman and Cubic Solutions, K u b y c dot solutions. Source code is available on github."

////////////////////////////////////////////////////////////////
// DEBUGGING
// TODO: SHARE THIS via export and import, rather than duplicating.
function objToString(obj:any, ndeep:number=0):string {
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

// Trying to make sure we report stacks when we catch an exception.
function trystack(obj:any):string {
    if (obj instanceof Error) {
	return objToString(obj.stack)
    }
    else return ""
}

// ------------------------------------------------------------------
// APP INITIALIZATION
// ------------------------------------------------------------------

// Referenced by index.ts
export const app = new App();

//prettier-ignore
app.use(
    new Alexa(),
    new GoogleAssistant(),
    new JovoDebugger(),
);

// Tell Jovo to store user state on the DynamoDB instance, rather than
// its default FileDB.
// Note that AWS region must be set before instantiating DynamoDB,
// even if we're running against a local instance.
const AWS_REGION =process.env.DYNAMODB_REGION || "us-east-1"
const AWS = require('aws-sdk');
AWS.config.update({region:AWS_REGION});
const { DynamoDb } = require('jovo-db-dynamodb')
app.use(
    new DynamoDb({
	// TODO: Get value as eg process.env.USER_TABLE with default;
	// in Typescript, add "as string"
	tableName: "UserState"
    }),
);

////////////////////////////////////////////////////////////////
// Politeness: Tell the station's servers (and any tracking system
// they're using) where these HTTP(S) queries are coming from, for
// debugging and statistics.
//
// TODO REVIEW: refactor into Player? And/or per-show config?
function addUriUsage(uri:string):string { 
    const app_uri_parameters="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
    if (uri.includes("?"))
	return uri+"&"+app_uri_parameters
    else
	return uri+"?"+app_uri_parameters
}

////////////////////////////////////////////////////////////////
// We'll need duration parsing if we implement rewind/fast-forward.

interface ParsedDate {
    sign: string
    years: number
    months: number
    weeks: number
    days: number
    hours: number
    minutes: number
    seconds: number
}

var iso8601DurationRegex = /(-)?P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/;

function parseISO8601Duration (iso8601Duration:string):ParsedDate|null {
    var matches = iso8601DurationRegex.exec(iso8601Duration);
    if(matches===null) 
	return null
    else return {
        sign: matches[1] === undefined ? '+' : '-',
        years: matches[2] === undefined ? 0 : parseInt(matches[2]),
        months: matches[3] === undefined ? 0 : parseInt(matches[3]),
        weeks: matches[4] === undefined ? 0 : parseInt(matches[4]),
        days: matches[5] === undefined ? 0 : parseInt(matches[5]),
        hours: matches[6] === undefined ? 0 : parseInt(matches[6]),
        minutes: matches[7] === undefined ? 0 : parseInt(matches[7]),
        seconds: matches[8] === undefined ? 0 : parseInt(matches[8])
    };
};

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// APP LOGIC FOLLOWS
//
// Note: Javascript default exception handling does not report stack
// trace.  It appears that if I want that logged, I need a
// try/catch/print/rethrow in every entry point (and possibly every
// async).
// ------------------------------------------------------------------

app.setHandler({
    async NEW_USER() {
	try {
            this.$speech.addText('Welcome to New Sounds On Demand!')
		.addText('We can begin listening from the oldest or newest episode, from a specific date or episode number, play the live stream, or I can surprise you with a random selection. Which would you like?')
            return this.ask(this.$speech);
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("NEW_USER caught: ",e,trystack(e))
	    throw e;
	}
    },

    LAUNCH() {
	return this.toIntent('DialogIntent')
    },

    DialogIntent() {
	try {
            this.$speech.addText('Would you like to resume where you left off, listen to the newest or oldest episode, play from a date or episode number, play a random episode, or play the live stream?')
            this.ask(this.$speech);
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("DialogIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    FirstEpisodeIntent: async function() {
	try {
            let episode = await Player.getOldestEpisode()!; // never null
	    if(episode==null) {
		console.error("FirstEpisodeIntent returned null. Empty DB?")
	    	this.tell("Sorry, but the database appears to be empty right now. That shoudln't happen. Please try again later, and register a complaint if it persists.")
		return;
	    }
	    // Quick note: "var a=b=c" declares a as var, but does NOT
	    // so declare b; it's left in the default scope if not
	    // already bound. Fine in this case, but a hazard to be
	    // aware of.  Have I said recently that I hate Javascript?
            var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
            this.$speech.addText('Fetching episode '+episode.title+".");

            if (this.isAlexaSkill()) {
		this.$alexaSkill!.$audioPlayer!
                    .setOffsetInMilliseconds(0)
                    .play(addUriUsage(episode!.url), `${currentDate}`)
                    .tell(this.$speech)
            } else if (this.isGoogleAction()) {
		// NOTE: this.ask(), not this.tell(), because we want the
		// playback-completed callback, which requires it not be a
		// Final Response. However, that forces including
		// Suggestion Chips.
		this.$googleAction!.$mediaResponse!.play(addUriUsage(episode!.url), episode!.title);
		this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		this.ask(this.$speech);
            }
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("FirstEpisodeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    async LatestEpisodeIntent() {
	try {
            let episode = await Player.getMostRecentBroadcastEpisode();
	    if(episode==null)
	    {
		console.error("LatestEpisodeIntent returned null. Empty DB?")
	    	this.tell("Sorry, but the database appears to be empty right now. That shoudln't happen. Please try again later, and register a complaint if it persists.")
	    }
	    else
	    {
		var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
		this.$speech.addText('Fetching episode '+episode!.title+".");

		if (this.isAlexaSkill()) {
		    this.$alexaSkill!.$audioPlayer!
			.setOffsetInMilliseconds(0)
			.play(addUriUsage(episode!.url), `${currentDate}`)
			.tell(this.$speech)
		} else if (this.isGoogleAction()) {
		    // NOTE: this.ask(), not this.tell(), because we want the
		    // playback-completed callback, which requires it not be a
		    // Final Response. However, that forces including
		    // Suggestion Chips.
		    this.$googleAction!.$mediaResponse!.play(addUriUsage(episode!.url), episode!.title);
		    this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		    this.ask(this.$speech);
		}
	    }
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("LastEpisodeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    LowestNumberedEpisodeIntent: async function() {
	try {
            let episode = await Player.getEpisodeWithLowestEpisodeNumber();
	    if(episode==null) {
		console.error("LowestNumberedEpisodeIntent returned null. Empty DB?")
	    	this.tell("Sorry, but the database appears to be empty right now. That shoudln't happen. Please try again later, and register a complaint if it persists.")
		return;
	    }
	    // Quick note: "var a=b=c" declares a as var, but does NOT
	    // so declare b; it's left in the default scope if not
	    // already bound. Fine in this case, but a hazard to be
	    // aware of.  Have I said recently that I hate Javascript?
            var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
            this.$speech.addText('Fetching episode '+episode.title+".");

            if (this.isAlexaSkill()) {
		this.$alexaSkill!.$audioPlayer!
                    .setOffsetInMilliseconds(0)
                    .play(addUriUsage(episode!.url), `${currentDate}`)
                    .tell(this.$speech)
            } else if (this.isGoogleAction()) {
		// NOTE: this.ask(), not this.tell(), because we want the
		// playback-completed callback, which requires it not be a
		// Final Response. However, that forces including
		// Suggestion Chips.
		this.$googleAction!.$mediaResponse!.play(addUriUsage(episode!.url), episode!.title);
		this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		this.ask(this.$speech);
            }
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("FirstEpisodeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    async HighestNumberedEpisodeIntent() {
	try {
            let episode = await Player.getEpisodeWithHighestEpisodeNumber();
	    if(episode==null)
	    {
		console.error("HighestNumberedEpisodeIntent returned null. Empty DB?")
	    	this.tell("Sorry, but the database appears to be empty right now. That shoudln't happen. Please try again later, and register a complaint if it persists.")
	    }
	    else
	    {
		// GONK: This is boilerplate, isn't it. REFACTOR!
		// (Sorry -- whittled code is prone to copypasta.)
		var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
		this.$speech.addText('Fetching episode '+episode!.title+".");

		if (this.isAlexaSkill()) {
		    this.$alexaSkill!.$audioPlayer!
			.setOffsetInMilliseconds(0)
			.play(addUriUsage(episode!.url), `${currentDate}`)
			.tell(this.$speech)
		} else if (this.isGoogleAction()) {
		    // NOTE: this.ask(), not this.tell(), because we want the
		    // playback-completed callback, which requires it not be a
		    // Final Response. However, that forces including
		    // Suggestion Chips.
		    this.$googleAction!.$mediaResponse!.play(addUriUsage(episode!.url), episode!.title);
		    this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		    this.ask(this.$speech);
		}
	    }
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("LastEpisodeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    async ResumeIntent() {
	try {
	    // If we played to end of last known episode -- flagged by
	    // offset<0 -- try to advance to next after that, which
	    // may have been added since that session.
	    var currentOffset = this.$user.$data.offset;
            var currentDate = this.$user.$data.currentDate;
	    var episode=null
	    if (currentDate==Player.getLiveStreamDate()) {
		// Resume livestream; can't set offset.
		return this.toIntent('LiveStreamIntent')
	    }
	    else if(currentOffset<0) { // Stopped at last known ep; is there newer?
		episode = await Player.getEpisodeByDate(currentDate); // May be null
		if(!episode) {
		    // TODO: This language may need to change depending on whether
		    // we are playing in date or ep# sequence.
		    return this.tell("You have already heard all of the most recent episode, so we can't resume right now. You can try again after a new episode gets released, or make a different request.");
		}
		currentDate=episode.broadcastDateMsec
		currentOffset=0;
	    }
	    else {
		// Resume stored date, at stored offset if possible
		// (Google appears to have limitations in that regard.)
		episode = await Player.getEpisodeByDate(currentDate);
	    }
            this.$speech.addText('Loading and resuming episode '+episode!.title+".")

            if (this.isAlexaSkill()) {
		let offset = this.$user.$data.offset;
		let offsetMin=offset/60/1000;
		if (offsetMin > 30) {
		    // BUG TODO: If we need to reload Alexa cache
		    // before playing, resume may have a long delay as
		    // it decompresses up to the offset point. I
		    // haven't thought of a reliable way to advise the
		    // user of this without unnecessary warnings (when
		    // already in cache, it's fast).  Check whether
		    // Alexa has a solution, though short of breaking
		    // into smaller MP3's so there are more frequent
		    // decompression synch points I don't know what
		    // one could do.  GONK?
		}
		this.$alexaSkill!.$audioPlayer!
                    .setOffsetInMilliseconds(offset)
                    .play(addUriUsage(episode!.url), `${currentDate}`)
                    .tell(this.$speech);
            } else if (this.isGoogleAction()) {
		// NOTE: this.ask(), not this.tell(), because we want the
		// playback-completed callback, which requires it not be a
		// Final Response. However, that forces including
		// Suggestion Chips.
		console.log("GOOGLE: Resume,",addUriUsage(episode!.url))
		this.$googleAction!.$mediaResponse!.play(addUriUsage(episode!.url), episode!.title);
		this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		this.ask(this.$speech);
            }
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("ResumeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    async NextIntent() {
        let currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
        let nextEpisode = await Player.getNextEpisodeByDate(currentDate);
        if (!nextEpisode) {
	    // TODO: This language may need to change depending on whether
	    // we are playing in date or ep# sequence.
	    return this.tell('That was the most recent episode. You will have to wait until a new episode gets released, or ask for a different one.');
        }
        let nextEpisodeDate = nextEpisode.broadcastDateMsec
        currentDate = nextEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+nextEpisode!.title+".");
        if (this.isAlexaSkill()) {
	    this.tell(this.$speech)
	    return this.$alexaSkill!.$audioPlayer!
		.setOffsetInMilliseconds(0)
		.play(addUriUsage(nextEpisode!.url), `${currentDate}`)
        } else if (this.isGoogleAction()) {
	    // NOTE: this.ask(), not this.tell(), because we want the
	    // playback-completed callback, which requires it not be a
	    // Final Response. However, that forces including
	    // Suggestion Chips.
	    console.log("GOOGLE: Next,",addUriUsage(nextEpisode!.url))
	    this.$googleAction!.$mediaResponse!.play(addUriUsage(nextEpisode!.url), nextEpisode!.title);
	    this.$googleAction!.showSuggestionChips(['pause', 'start over']);
	    return this.ask(this.$speech);
        }
	else {
	    console.error("Unexpected action type",objToString(this))
	    return this; // should never happen, but for type consistency
	}
    },

    PreviousIntent: async function() {
	// GONK: Tells may need to be Asks for this to run as intended
	// in Google. More multiple-path coding. Really wish Jovo
	// encapsulated that.
        let currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
        let previousEpisode = await Player.getPreviousEpisodeByDate(currentDate);
        if (!previousEpisode) {
	    // TODO: This language may need to change depending on whether
	    // we are playing in date or ep# sequence.
	    return this.tell('You are already at the oldest episode.');
        }
        let previousEpisodeDate = previousEpisode.broadcastDateMsec
        currentDate = previousEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+previousEpisode.title+".");
        if (this.isAlexaSkill()) {
	    this.tell(this.$speech)
	    return this.$alexaSkill!.$audioPlayer!
		.setOffsetInMilliseconds(0)
		.play(addUriUsage(previousEpisode!.url), `${currentDate}`)
        } else if (this.isGoogleAction()) {
	    // NOTE: this.ask(), not this.tell(), because we want the
	    // playback-completed callback, which requires it not be a
	    // Final Response. However, that forces including
	    // Suggestion Chips.
	    this.$googleAction!.$mediaResponse!.play(addUriUsage(previousEpisode!.url), previousEpisode!.title);
	    this.$googleAction!.showSuggestionChips(['pause', 'start over']);
	    return this.ask(this.$speech);
        }
	else {
	    console.error("Unexpected action type",objToString(this))
	    return this; // should never happen, but for type consistency
	}
    },

    FastForwardIntent() {
	// GONK: This one is being surprisingly problematic...
	// GONK: Tells may need to be Asks for this to run as intended
	// in Google. More multiple-path coding. Really wish Jovo
	// encapsulated that.
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
        let duration = this.getInput("duration").value
	console.log(">>> FastForwardIntent:",duration, typeof(duration))
	let dd=parseISO8601Duration(duration)
	console.log(">>> FastForwardIntentIntent:",dd)

	return this.tell("Fast forward isn't supported yet. You could ask us to skip to the next episode instead.")
    },

    // Note: Alexa doesn't want us using the word "shuffle", except as
    // that refers to the handler's Alexa.ShuffleOnIntent. (And Off,
    // of course.) For now, avoid using that term in the language
    // model.
    RandomIntent: async function() {
        let randomEpisode = await Player.getRandomEpisode()
	if(!randomEpisode) {
	    console.error("RandomIntent returned null. Empty DB?")
	    return this.tell("Sorry, but I can't fetch a random episode right now. That shoudln't happen. Please try again later, and register a complaint if it persists.")
	}
        let randomEpisodeDate = randomEpisode.broadcastDateMsec
        let currentDate = randomEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+randomEpisode.title+".");
        if (this.isAlexaSkill()) {
	    this.tell(this.$speech)
	    return this.$alexaSkill!.$audioPlayer!
		.setOffsetInMilliseconds(0)
		.play(addUriUsage(randomEpisode.url), `${currentDate}`)
        } else if (this.isGoogleAction()) {
	    // NOTE: this.ask(), not this.tell(), because we want the
	    // playback-completed callback, which requires it not be a
	    // Final Response. However, that forces including
	    // Suggestion Chips.
	    this.$googleAction!.$mediaResponse!.play(addUriUsage(randomEpisode.url), randomEpisode.title);
	    this.$googleAction!.showSuggestionChips(['pause', 'start over']);
	    return this.ask(this.$speech)
        }
	else {
	    console.error("Unexpected action type",objToString(this))
	    return this; // should never happen, but for type consistency
	}
    },

    IncompleteDateIntent() {
	this.$speech.addText("Which date do you want to select?")
	return this.ask(this.$speech)
    },

    IncompleteEpisodeNumberIntent() {
	this.$speech.addText("OK, which episode number do you want to select?")
	return this.ask(this.$speech)
    },

    async DateIntent() {
	// Note: For clarity, it's best to treat all dates as UTC,
	// avoiding server-specific zone adjustments.  That may
	// occasionally cause confusion about "today", but I think
	// that's Mostly Harmless.
	var whichdate;
	console.log("DateIntent:",this.getInput("date"))
        if (this.isAlexaSkill()) {
	    whichdate = this.getInput("date").value
        } else if (this.isGoogleAction()) {
	    // May include timestamp; trim that off.
	    // (This is a bit inefficient but robust against missing Time.)
	    whichdate=this.getInput("date").key!.split("T")[0]
	}
	// Remember that JS Month is 0-indexed
	// Year will be provided in 4-digit form.
	let splitdate=whichdate.split("-")
	let localDate=new Date(splitdate[0],splitdate[1]-1,splitdate[2])
	let utcDate=new Date(Date.UTC(splitdate[0],splitdate[1]-1,splitdate[2]))
	console.error(">>>> DateIntent local:",localDate)
	console.error(">>>> DateIntent utc:",utcDate)
	let utcDatestamp=utcDate.getTime()

	// Alexa seems to take "Monday" as "coming monday".  Google
	// takes "the second" as "the next 2nd of whatever-month". It
	// may not be clear to the user whether "last Monday" means
	// this week or last week. And the user could actually ask for
	// a future date. Simplest recovery is to ask them to rephrase
	// when it's a date we don't know anything about. That avoids
	// the risk of our guessing differently from other apps.
	if(utcDatestamp>Date.now())
	{
	    this.$speech.addText("That came through as a future date. Could you rephrase your request?")
	    return this.ask(this.$speech)
	}

	let episode=await Player.getEpisodeByDate(utcDatestamp)
	if(episode!=null && episode !=undefined)
	{
	    let currentDate=episode.broadcastDateMsec
	    this.$user.$data.currentDate = currentDate;

	    this.$speech.addText("Fetching the show from "+format(localDate,"PPPP")+": episode "+episode.title+".");

	    if (this.isAlexaSkill()) {
		this.tell(this.$speech)
		return this.$alexaSkill!.$audioPlayer!
		    .setOffsetInMilliseconds(0)
		    .play(addUriUsage(episode!.url), `${currentDate}`)
	    } else if (this.isGoogleAction()) {
		// NOTE: this.ask(), not this.tell(), because we want the
		// playback-completed callback, which requires it not be a
		// Final Response. However, that forces including
		// Suggestion Chips.
		this.$googleAction!.$mediaResponse!.play(addUriUsage(episode!.url), episode!.title);
		this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		return this.ask(this.$speech)
	    }
	    else {
		console.error("Unexpected action type",objToString(this))
		return this; // should never happen, but for type consistency
	    }
	}
	else {
	    this.$speech.addText("An episode broadcast on "+format(localDate,"PPPP")+" does not seem to be available in the vault. What would you like me to do instead?")
	    return this.ask(this.$speech)
	}
    },

    async EpisodeNumberIntent() {
	const episodeNumber=parseInt(this.getInput('episodeNumber').value) // comes back as string
	const episode=await Player.getEpisodeByNumber(episodeNumber)
	if(episode!=null && episode !=undefined)
	{
	    const currentDate=episode.broadcastDateMsec
	    this.$user.$data.currentDate = currentDate;
	    this.$speech.addText('Fetching episode '+episode.title+".");
	    if (this.isAlexaSkill()) {
		this.tell(this.$speech)
		return this.$alexaSkill!.$audioPlayer!
		    .setOffsetInMilliseconds(0)
		    .play(addUriUsage(episode!.url), `${currentDate}`)
	    } else if (this.isGoogleAction()) {
		// NOTE: this.ask(), not this.tell(), because we want the
		// playback-completed callback, which requires it not be a
		// Final Response. However, that forces including
		// Suggestion Chips.
		this.$googleAction!.$mediaResponse!.play(addUriUsage(episode.url), episode.title);
		this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		return this.ask(this.$speech)
	    }
	    else {
		console.error("Unexpected action type",objToString(this))
		return this; // should never happen, but for type consistency
	    }
	}
	else {
	    this.$speech.addText("Episode number "+episodeNumber+" does not seem to be available in the vault. What would you like me to do instead?")
	    return this.ask(this.$speech)
	}
    },

    // Currently, resuming livestream works as expected.  But there's
    // something to be said for maintaining episode playback state
    // separetely, and of course "resume" of livestream is from now
    // rather than from stop, so it's debatable. I lean toward keeping
    // it this way for user convenience after pause (eg for phone
    // call), but this gets back to the "bookmarks" TODO item.
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
	    return this.$alexaSkill!.$audioPlayer!
		.setOffsetInMilliseconds(0)
		.play(streamURI, `${currentDate}`)
	        .tell(this.$speech)
        } else if (this.isGoogleAction()) {
	    // NOTE: this.ask(), not this.tell(), because we want the
	    // playback-completed callback, which requires it not be a
	    // Final Response. However, that forces including
	    // Suggestion Chips.
	    this.$googleAction!.$mediaResponse!.play(streamURI,"New Sounds On Demand Live Stream");
	    this.$googleAction!.showSuggestionChips(['pause']);
	    return this.ask(this.$speech)
        }
	else {
	    console.error("Unexpected action type",objToString(this))
	    return this; // should never happen, but for type consistency
	}
    },

    HelpIntent() {
        this.$speech.addText('You can ask for the earliest or latest episode, request one by date or episode number, tell us to surprise you with a randomly chosen show, resume where you stopped last time, restart the episode now playing, or play the "live stream" webcast.')
	    .addText('Which would you like to do?')
        this.ask(this.$speech);
    },

    CreditsIntent() {
	// GONK: Tells may need to be Asks for this to run as intended
	// in Google. More multiple-path coding. Really wish Jovo
	// encapsulated that.
        this.$speech.addText(ShowCredits)
        this.$speech.addText(AppCredits)
	return this.tell(this.$speech)
    },

    // Hook for testing, normally inactive
    DebugIntent() {
	// GONK: Tells may need to be Asks for this to run as intended
	// in Google. More multiple-path coding. Really wish Jovo
	// encapsulated that.
        this.$speech.addText("Debug hook baited. Awaiting fishies.")
	return this.ask(this.$speech)
    },

    // Amazon's "who sings this song"
    "AMAZON.SearchAction<object@MusicRecording[byArtist.musicGroupMember]>"() {
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.$speech.addText("I'm sorry, I haven't yet learned how to answer that.")
	} else {
	    this.$speech.addText("I'm afraid I can only get that metadata for the livestream.")
	}
	return this.tell(this.$speech)
    },
    // Amazon's "who is playing this song"
    "AMAZON.SearchAction<object@MusicRecording[byArtist]>"() {
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.$speech.addText("I'm sorry, I haven't yet learned how to answer that.")
	} else {
	    this.$speech.addText("I'm afraid I can only get that metadata for the livestream.")
	}
	return this.tell(this.$speech)
    },
    // Amazon's "how long is this song"
    "AMAZON.SearchAction<object@MusicRecording[duration]>"() {
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.$speech.addText("I'm sorry, I haven't yet learned how to answer that.")
	} else {
	    this.$speech.addText("I'm afraid I can only get that metadata for the livestream.")
	}
	return this.tell(this.$speech)
    },
    // Amazon's "what album is this song on"
    "AMAZON.SearchAction<object@MusicRecording[inAlbum]>"() {
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.$speech.addText("I'm sorry, I haven't yet learned how to answer that.")
	} else {
	    this.$speech.addText("I'm afraid I can only get that metadata for the livestream.")
	}
	return this.tell(this.$speech)
    },
    // Amazon's "who produced this song"
    "AMAZON.SearchAction<object@MusicRecording[producer]>"() {
        var currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.$speech.addText("I'm sorry, I haven't yet learned how to answer that.")
	} else {
	    this.$speech.addText("I'm afraid I can only get that metadata for the livestream.")
	}
	return this.tell(this.$speech)
    }

});

////////////////////////////////////////////////////////////////////

app.setAlexaHandler(AlexaHandler);
app.setGoogleAssistantHandler(GoogleHandler);

module.exports.app = app
