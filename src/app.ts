/* New Sounds On Demand: Archive player, drastically reimplemented and
   expanded from a Jovo podcast-player sample to load its tables from
   the data driving the newsounds.org website, and to offer enhanced
   behaviors.

   CAVEAT: This started as whittled code (as opposed to architected),
   in a language and framework I was learning as I went.  Cleanup is
   progressing as I continue to work on it, but some inelegance should
   be expected to persist.

   CURRENT STATUS: Running as public Alexa skill, backed by a pair of
   AWS Lambdas and a DynamoDB database. 

   GONK CONVENTION: When the word GONK appears in my files, that's an
   eyecatcher which usually flags something I consider an unsolved
   design issue but probably haven't included in this list. It may
   also flag work currently in progress.


   OPEN TASKS:

   BUG: The inProgress flag can get confused if user was playing on
   multiple devices, then stopped one. We could keep a counter, but
   I'm nervous about it getting out of synch. For now, I'm disabling
   the test, which means that when stopped we'll reply with whatever
   was last requested -- not necessarily on this device, and not
   necessarily currently playing.
   
	POSSIBLE FIXES: Maintaining a count could get messy, though
	the failure modes aren't worse than what we have now.  I could
	have a ResetAction, but that's kluge, not fix. Ideal would be
	to track _which_ devices are playing what, in addition to
	user; does Jovo expose where request came from? (Do the
	platforms, for that matter?)

   BUG/ISSUE: Possible long delay on resume IF not already in Alexa's
   local cache, presumably due to the computational cost of
   decompressing up to offset. Can we avoid that, eg by triggering
   earlier preloading?  I presume Amazon's answer is "not our problem;
   break it up into smaller audio files", which doesn't work for this
   use case. And it's not something we can easily warn the user about,
   though recording clocktime when they stopped might let us at least
   make a guess about whether other work might have intervened and
   flushed that cache. Is there any way to ask the device what has
   been preloaded?
https://alexa.uservoice.com/forums/906892-alexa-skills-developer-voice-and-vote/suggestions/44933392-loading-audio-with-offset-can-be-slow-losing-audi

   TODO: (Investigating) Can custom slots be used as a better way to
   express synonym combinatorics? (Yes, but does that blow up Alexa's
   attempts to match synonyms?)

   TODO: Display cards for DialogIntent, Incomplete intents, others? Can
   we pop a card up at queued-playback rollover? At stream metadata update?

        BUG: "Generic" skill card appears at unexpected times.

	Stream cards would have to be updated on timer, since there
	isn't any event available when stream changes tracks. Need to
	handle clock-skew issue. BUT: Needs to come through as a Jovo
	event so we have the right 'this' to respond with. ASK how
	best to handle that in Jovo.

	Attempting to update display at starting-new-track doesn't
	seem to be working. Just cover this with the stream-style
	timed update?

   TODO: Metadata improvements. Full dump or specific response to
   individual questions?  Stop/pause/end should set user flag saying
   _not_ playing so we can report that.

   TODO: Continue to improve speech interactions. Name-Free
   Interaction, if/when possible (including meta
   queries/searches). Figure out what Google can do; different
   parser/capabilities.

   TODO: Forward/back (ff/rw, etc) by duration.  Note the open ISSUE
   of possible long delay... though knowing the audio is in cache may
   reduce that risk to some degree, and if user asks for long jump
   they arguably know what they are getting themselves into.

   TODO: Can we announce ep# when we auto-advance via queue without
   causing a glitch in the audio? Haven't found a perfect incantation
   yet.  Doing this really cleanly might require giving up using the
   Alexa queue to preload audio, though that would slow ep-to-ep
   transition. See above re display cards.

   TODO: Parameterize for New Sounds' other programs. Most elegant
   would be to work out VUI dialogs which let us navigate across them
   through a single skill, but multiple skills would certainly do the
   job. Could even share DB, possibly, since showname is part of keys.
	VUI design required. BUT NOTE that much of the good stuff from
	Soundcheck, New Sounds Live, and Le Poisson Rouge does
	eventually wind up in the New Sounds feed, so it isn't clear
	accessing them directly is higher priority than keyword search.

   TODO MAYBE: Poor man's "play episodes I haven't heard yet" based on
   "play released since the most recent I've listened to".
   Only requires tracking one value, most recent episode user has ever
   listened to. Effectively, podcastish behavior. Does partial play
   need to be tracked, or do we count it as heard or not-heard?

   TODO MAYBE: Shuffle? Just starting with random has most of the
   desired effect, with some risk of noticable repeats.  Does shuffle
   imply immediate random start, or only when the next Next occurs?
       Actually, shuffle is relatively easy since it only requires
       changing the next/auto-next logic. Can't back up (previous)
       with that unless a history of this shuffle is maintained;
       that's not impossible, though, and failing to do so is not
       intolerable.

   TODO: Set, and return to, named state bookmarks.  Poor man's
   alternative to search?

   TODO MAYBE: Play single ep? (Doable via sleep timer, so probably
   not, but "stop after this episode" might be worthwhile.) Repeat?
   (Probably not.) Unfortunately there's no builtin for do/don't stop,
   just shuffle and repeat. I don't want to abuse repeat for this.

   TODO MAYBE: Alternate auto-next modes, persistent per user: Date,
   ep#, livestream, fwd/bkwd, shuffle (see above). Biggest challenge
   is letting the user express their wishes cleanly. Note that ep#
   currently implies earliest broadcast of that episode and so works
   as publication-order, and random actually randomizes date so
   rebroadcasts may show up under any of their dates and is biased in
   favor of first episodes after long date gaps.

   TODO SOMEDAY: Tag searchability. Other music skills seem to handle
   bandname/recordname/trackname surprisingly well; is there something
   we can tap there, or is sounds-like matching the best we've got?
   Ties into playlists, unless this is a single selection and user has
   to work through the offerings.

   TODO EVENTUALLY: At the moment I'm using the same zipfile for both
   skill and database-update lambdas, with different entry-point
   calls. That's massive overkill for the latter. But frankly,
   AWS gives me no incentive to optimize it; it wouldn't cut my
   operating cost, and any additional load time is invisible since this
   runs out of the user's sight.
*/

'use strict';
import { Alexa } from 'jovo-platform-alexa';
import { AlexaHandler } from './alexa/handler';
import { App } from 'jovo-framework';
import { GoogleAssistant } from 'jovo-platform-googleassistant';
import { GoogleHandler } from './google/handler';
import { JovoDebugger } from 'jovo-plugin-debugger';
import { Player } from './player';
import { Project,Jovo,SpeechBuilder } from 'jovo-framework'
import { set_AWS_endpoint,EpisodeRecord } from './episodesdb'
import { getStreamMetadataText } from "./stream_metadata"
import { format } from 'date-fns'

const DEBUG=("DEBUG"==process.env.APP_DEBUG)

// Nag message. Really should make time.
console.log('TODO: This implementation still uses the outdated Jovo3 Framework. When time permits, we will upgrade to Jovo v4. See https://www.jovo.tech/docs/migration-from-v3');

////////////////////////////////////////////////////////////////
const ShowCredits="New Sounds is produced by New York Public Radio, W N Y C and W Q X R. The host and creator of the show is John Schaefer. His team includes Caryn Havlik, Helga Davis, Rosa Gollan, Justin Sergi, and Irene Trudel. More information about these folks, and about the show, can be found on the web at New Sounds dot org."
const AppCredits="The New Sounds On Demand player for smart speakers is being developed by Joe Kesselman and Cubic Solutions, K u b y c dot solutions. Source code is available on github."

// For use on displays; see https://v3.jovo.tech/docs/output/visual-output
// Better rendering currently requires platform-specific coding again, alas;
// consider wrappering that too.
export const NewSoundsLogoURI="https://media.wnyc.org/i/600/600/l/80/1/ns_showcard-newsounds.png"

////////////////////////////////////////////////////////////////
// NOTE: In most cases, JSON.stringify() is a better choice.  The
// minor advantage of this one is that depth can be limited, which is
// sometimes useful. Unclear I need it; retaining it for now. TODO:
// REVIEW
// function objToString(obj:any, ndeep:number=0):string {
//     const MAX_OBJTOSTRING_DEPTH=10 // circular refs are possible
//     if(obj == null){ return String(obj); }
//     if(ndeep > MAX_OBJTOSTRING_DEPTH) {return "...(elided; might recurse)..." }
//     switch(typeof obj){
//     case "string": return '"'+obj+'"';
//     case "function": return obj.name || obj.toString();
//     case "object":
// 	var indent = Array(ndeep||1).join('  '), isArray = Array.isArray(obj);
// 	return '{['[+isArray] + Object.keys(obj).map(function(key){
// 	    return '\n' + indent + key + ': ' + objToString(obj[key], (ndeep||1)+1);
//         }).join(',') + '\n' + indent + '}]'[+isArray];
//     default: return obj.toString();
//     }
// }

// Trying to make sure we report stacks when we catch an exception.
function trystack(obj:any):string {
    if (obj instanceof Error) {
	return JSON.stringify(obj.stack)
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
//
// Note that AWS region must be set before instantiating DynamoDB,
// even if we're running against a local instance, and that since
// we use it both here and in the episodesdb module we really want a
// single shared configuration process. Currently, that's the
// set_AWS_endpoint() operation, which may (safely) re-assert
// existing values.
// TODO: REPEATED INVOCATION IS UGLY. Can we clean up?

const AWS = set_AWS_endpoint()
const { DynamoDb } = require('jovo-db-dynamodb')
app.use(
    new DynamoDb({
	// TODO: Get value as eg process.env.NSOD_USER_TABLE with default;
	// see examples in episodedb.ts.
	tableName: "UserState"
    }),
);

////////////////////////////////////////////////////////////////
// Politeness: Tell the station's servers (and any tracking system
// they're using) where these HTTP(S) queries are coming from, for
// debugging and statistics.
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

////////////////////////////////////////////////////////////////
// Jovo, alas, doesn't fully bury the need to be aware of which platform
// we are interacting with. But we can implement some of that here.
// Alas, Javascript's only marginally OO (or at least I don't know how
// to make it more so), so the Jovo team's best suggestion for
// refactoring was to explicitly pass the handler's "this" value
// into the subroutine.
//
// Note that the responses (.tell etc) act by writing into a Jovo-level
// $output object, which is then acted on appropriately when the handler
// returns control to Jovo.
//
// Note: `${varname}` is a "safe" generic toString idiom -- that is,
// no matter what you throw at it, including null and undefined, the result
// will be a string. Overkill for my needs, inherited from reference code
// and kept because it's a kluge worth remembering.
//
// Note: I'm keeping addUriUsage here because it's universal for my app.
//
// BUG TODO ISSUE: If we need to reload Alexa cache before playing,
// resume may have a long delay as it decompresses up to the offset
// point. I haven't thought of a reliable way to advise the user of
// this without unnecessary warnings (when already in cache, it's
// fast).  Check whether Alexa has a solution, though short of
// breaking into smaller MP3's so there are more frequent
// decompression synch/resume points I don't know what one could do.
//
// Note: Google apparently can't handle offsets. But google handles
// pause/resume without involving us at all, so that should be OK for
// now.
//
// NOTE: There is some evidence that using a unique UUID for each playback
// may reduce the incidence of audio resuming on the wrong device. That would
// of course require storing the current-playback UUID into the user state,
// so we can reference it later when screening out late events from previous
// playback. TODO: REVIEW.
//
// NOTE: Given that many params are all obtained from episode (except
// for livestream), just pass in episode? Might require a separate
// call for livestream, but that's relatively simple. Would make
// adding the tease relatively easy. TODO: REVIEW.
// ISSUE/BUG: At this writing, tease is misformatted (UTF16?)
//
// TODO: Can we improve display card rendering? Portably, if possible?

export function setEpisodeAVResponse(that:Jovo, text:(string|string[]|SpeechBuilder), episode:EpisodeRecord,offset:number) {
    // TODO: Add tease to text? Need multiple append operations...
    // Do we really require the flexibility in arguments?
    setAVResponse(that,text,episode.url,offset,episode.broadcastDateMsec,episode.title,episode.imageurl)
}

export function setAVResponse(that:Jovo, text:(string|string[]|SpeechBuilder), audioURI:string, audioOffset:number, audioDate:number, audioTitle:string, imageURI:(string|null) ) {
    setAudioResponse(that, text, audioURI, audioOffset, audioDate, audioTitle)
    var graphic:string = (imageURI==null) ? NewSoundsLogoURI : imageURI
    that.showImageCard("New Sounds On Demand",audioTitle,graphic)
}

export function setAudioResponse(that:Jovo, text:(string|string[]|SpeechBuilder), audioURI:string, audioOffset:number, audioDate:number, audioTitle:string) {
    var taggedURI=addUriUsage(audioURI)
    if (that.isAlexaSkill()) {
	that.$alexaSkill!.$audioPlayer! // guaranteed non-null by test
            .setOffsetInMilliseconds(audioOffset)
            .play(taggedURI, `${audioDate}`)
            .tell(text)
    } else if (that.isGoogleAction()) {
	// NOTE: We use that.ask(), not that.tell(), because we want
	// google to send us the playback-completed callback, which
	// requires that this not be a Final Response. However, that
	// forces including Suggestion Chips. (Which isn't an awful
	// thing, as we work toward screen support.)
	that.$googleAction! // guaranteed non-null by test
	    .$mediaResponse! // guaranteed non-null
	    .play(taggedURI, audioTitle);
	that.$googleAction!.showSuggestionChips(['pause', 'start over']);
	that.ask(text);
    }
    else {
	console.error("Unexpected action type",JSON.stringify(that))
    }
    that.$user.$data.inProgress=true
}


// ------------------------------------------------------------------
// ------------------------------------------------------------------
// APP LOGIC FOLLOWS
//
// Note: Javascript/Jovo default exception handling may not report stack
// trace. Hence the try/catch{print;rethrow} here.
// ------------------------------------------------------------------

app.setHandler({
    async NEW_USER() {
	try {
            this.$speech.addText('Welcome to New Sounds On Demand!')
		.addText('We can begin listening from the oldest or newest episode, from a specific date or episode number, play the live stream, or I can surprise you with a random selection. Which would you like?')
	    this.showImageCard("New Sounds On Demand","Try: \"Play the newest show\", \"Play episode 4000\", or \"Play the live stream\"",NewSoundsLogoURI)
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
	this.showImageCard("New Sounds On Demand","Try: \"Newest\", \"Oldest\", \"Episode 4000\", \"This Monday's Show\", \"Live Stream\", or \"Surprise Me!\"",NewSoundsLogoURI)
            this.ask(this.$speech);
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("DialogIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    FirstEpisodeIntent: async function() {
	try {
            let episode = await Player.getOldestEpisode();
	    if(episode==null) {
		console.error("FirstEpisodeIntent returned null. Empty DB?")
	    	this.tell("Sorry, but the database appears to be empty right now. That shouldn't happen. Please try again later, and register a complaint if it persists.")
		return;
	    }
	    // Quick note: "var a=b=c" declares a as var, but does NOT
	    // so declare b; it's left in the default scope if not
	    // already bound. Fine in this case, but a hazard to be
	    // aware of.  Have I said recently that I hate Javascript?
            var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
            this.$speech.addText('Fetching episode '+episode.title+".");
	    setEpisodeAVResponse(this,this.$speech,episode,0)
	    if(DEBUG) console.error("DEBUG: FirstEpisodeIntent inProgress=",this.$user.$data.inProgress)
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
	    	this.tell("Sorry, but the database appears to be empty right now. That shouldn't happen. Please try again later, and register a complaint if it persists.")
	    }
	    else
	    {
		var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
		this.$speech.addText('Fetching episode '+episode.title+".");

		setEpisodeAVResponse(this,this.$speech,episode,0)
		if(DEBUG) console.error("DEBUG: LatestEpisodeIntent inProgress=",this.$user.$data.inProgress)
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
	    	this.tell("Sorry, but the database appears to be empty right now. That shouldn't happen. Please try again later, and register a complaint if it persists.")
		return;
	    }
	    // Quick note: "var a=b=c" declares a as var, but does NOT
	    // so declare b; it's left in the default scope if not
	    // already bound. Fine in this case, but a hazard to be
	    // aware of.  Have I said recently that I hate Javascript?
            var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
            this.$speech.addText('Fetching episode '+episode.title+".");
	    setEpisodeAVResponse(this,this.$speech,episode,0)
	    if(DEBUG) console.error("DEBUG: LowestNumberedEpisodeIntent inProgress=",this.$user.$data.inProgress)
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("LowestNumberedEpisodeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    async HighestNumberedEpisodeIntent() {
	try {
            let episode = await Player.getEpisodeWithHighestEpisodeNumber();
	    if(episode==null)
	    {
		console.error("HighestNumberedEpisodeIntent returned null. Empty DB?")
	    	this.tell("Sorry, but the database appears to be empty right now. That shouldn't happen. Please try again later, and register a complaint if it persists.")
	    }
	    else
	    {
		var currentDate = this.$user.$data.currentDate = episode.broadcastDateMsec;
		this.$speech.addText('Fetching episode '+episode.title+".");

		setEpisodeAVResponse(this,this.$speech,episode,0)
		if(DEBUG) console.error("DEBUG: LastEpisodeIntent inProgress=",this.$user.$data.inProgress)
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
		episode = await Player.getNextEpisodeByDate(currentDate); // May be null
		if(!episode) {
		    // TODO: This language may need to change if/when
		    // we offer the option of playing in date or ep#
		    // order, or reverse order. It will definitely
		    // need to be adapted if/when we support
		    // search/playlist.
		    return this.tell("You have already heard all of the most recent episode, so we can't resume right now. You can try again after a new episode gets released, or make a different request.");
		}
		currentDate=episode.broadcastDateMsec
		currentOffset=0;
	    }
	    else {
		// Resume stored date, at stored offset if possible
		// (Google appears to have limitations in that regard.)
		episode = await Player.getEpisodeByDate(currentDate);
		if(episode==null)
		{
		    console.error("getEpisodeByDate for known date returned null.")
	    	    return this.ask("Sorry, but the I can't retrieve the last episode you were playing right now. That shouldn't happen, and I'll ask the programmers to investigate. Meanwhile, what else can I do for you?")
		}
	    }
            this.$speech.addText('Loading and resuming episode '+episode.title+".")

	    let offset = this.$user.$data.offset;
	    setEpisodeAVResponse(this,this.$speech,episode,offset)
	    if(DEBUG) console.error("DEBUG: ResumeIntent inProgress=",this.$user.$data.inProgress)
	} catch(e) {
	    this.tell("Sorry, but I am having trouble doing that right now. Please try again later.")
	    console.error("ResumeIntent caught: ",e,trystack(e))
	    throw e;
	}
    },

    async NextIntent() {
        let currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	    return
	}
        let nextEpisode = await Player.getNextEpisodeByDate(currentDate);
        if (!nextEpisode) {
	    // TODO: See above re this possibly changing if we allow
	    // other orderings/playlists.
	    this.tell('That was the most recent episode. You will have to wait until a new episode gets released, or ask for a different one.');
	    return
        }
        let nextEpisodeDate = nextEpisode.broadcastDateMsec
        currentDate = nextEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+nextEpisode.title+".");
	setEpisodeAVResponse(this,this.$speech,nextEpisode,0)
	if(DEBUG) console.error("DEBUG: NextIntent inProgress=",this.$user.$data.inProgress)
    },

    PreviousIntent: async function() {
	// Tells may need to be Asks for this to run as intended
	// in Google. More multiple-path coding. Really wish Jovo
	// encapsulated that.
        let currentDate = this.$user.$data.currentDate;
	if (currentDate==Player.getLiveStreamDate()) {
	    this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	    return
	}
        let previousEpisode = await Player.getPreviousEpisodeByDate(currentDate);
        if (!previousEpisode) {
	    // TODO: See above re this possibly changing if we allow
	    // other orderings/playlists.
	    this.tell('You are already at the oldest episode.');
	    return
        }
        let previousEpisodeDate = previousEpisode.broadcastDateMsec
        currentDate = previousEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+previousEpisode.title+".");
	setEpisodeAVResponse(this,this.$speech,previousEpisode,0)
	if(DEBUG) console.error("DEBUG: PreviousIntent inProgress=",this.$user.$data.inProgress)
    },

    FastForwardIntent() {
	// GONK: Alexa apprently suggests prefixless next/previous
	// intents with a slot: next/previous/skip/skip forward/skip
	// back <duration>. However: "Note: The standard built-in
	// intents can't include any slots. If you need slots, you
	// create a custom intent and write your own sample
	// utterances." On the other other hand, predefined intents in
	// other categories (not "standard") may have slots. TODO
	// REVIEW: CONFUSING!
	//
	// GONK: This one was being surprisingly problematic...
	// Theoretically, it *should* just be a matter of playing from
	// a recalculated offset.
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
    // of course.) And Random isn't quite Shuffle yet. I could make it so
    // by saving that in user state and using it in the auto-advance
    // code... TODO: REVIEW.
    //
    // Sigh: Currently "Shuffle off to Buffalo" is interpreted by Alexa as
    // "play My Soundtrack", not "Shuffle Off" or even "Play Shuffle Off To
    // Buffalo". That's what happens when you try too hard to guess what the
    // user might have intended...
    RandomIntent: async function() {
        let randomEpisode = await Player.getRandomEpisode()
	if(!randomEpisode) {
	    console.error("RandomIntent returned null. Empty DB?")
	    this.tell("Sorry, but I can't fetch a random episode right now. That shouldn't happen. Please try again later, and register a complaint if it persists.")
	}
        let randomEpisodeDate = randomEpisode.broadcastDateMsec
        let currentDate = randomEpisodeDate;
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText('Fetching episode '+randomEpisode.title+".");
	setEpisodeAVResponse(this,this.$speech,randomEpisode,0)
	if(DEBUG) console.error("DEBUG: RandomIntent inProgress=",this.$user.$data.inProgress)
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
	// a future date, though we won't have anything for
	// those. Simplest recovery is to ask them to rephrase when
	// it's a date we don't know anything about. That avoids the
	// risk of our guessing differently from other apps, but at the
	// cost of making the user jump through arguably unnecessary hoops.
	//
	// (At a low level, Alexa supposedly makes raw-ish forms available
	// as such, eg 3031-SU or XX:01:2021. I don't see any way to access
	// those in Jovo's intent object.)
	if(utcDatestamp>Date.now())
	{
	    this.$speech.addText("That came through as a future date. Could you rephrase your request?")
	    this.ask(this.$speech)
	    return
	}

	let episode=await Player.getEpisodeByDate(utcDatestamp)
	if(episode!=null && episode !=undefined)
	{
	    let currentDate=episode.broadcastDateMsec
	    this.$user.$data.currentDate = currentDate;

	    this.$speech.addText("Fetching the show from "+format(localDate,"PPPP")+": episode "+episode.title+".");

	    setEpisodeAVResponse(this,this.$speech,episode,0)
	    if(DEBUG) console.error("DEBUG: DateIntent inProgress=",this.$user.$data.inProgress)
	}
	else {
	    this.$speech.addText("An episode broadcast on "+format(localDate,"PPPP")+" does not seem to be available in the vault. What would you like me to do instead?")
	    this.ask(this.$speech)
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
	    setEpisodeAVResponse(this,this.$speech,episode,0)
	    if(DEBUG) console.error("DEBUG: NumberIntent inProgress=",this.$user.$data.inProgress)
	}
	else {
	    this.$speech.addText("Episode number "+episodeNumber+" does not seem to be available in the vault. What would you like me to do instead?")
	    this.ask(this.$speech)
	}
    },

    // Currently, resuming livestream works as expected.  But there's
    // something to be said for maintaining episode playback state
    // separetely, and of course "resume" of livestream is from now
    // rather than from stop, so it's debatable. I lean toward keeping
    // it this way for user convenience after pause (eg for phone
    // call), but this gets back to the "bookmarks" wishlist item.
    LiveStreamIntent() {
	const currentDate=Player.getLiveStreamDate()
        this.$user.$data.currentDate = currentDate;
        this.$speech.addText("Playing the New Sounds livestream.");
	setAVResponse(this,this.$speech,Player.getLiveStreamURI(),0,currentDate,"New Sounds Live Stream",null)
	this.showImageCard("New Sounds On Demand -- Live Stream","Try: \"Ask New Sounds On Demand what we are listening to.\""
,NewSoundsLogoURI)
	if(DEBUG) console.error("DEBUG: LiveIntent inProgress=",this.$user.$data.inProgress)
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

    // Hook for testing
    async DebugIntent() {
        this.$speech.addText("Debug hook baited. Awaiting micro fishies.")
	this.showImageCard("New Sounds On Demand","Open your ears and say ahhh!",NewSoundsLogoURI)
	return this.ask(this.$speech)
    },
   
    ////////////////////////////////////////////////////////////////
    // There are currently two entry points for metadata requests:
    // the standard "ask NSOD", plus the one called by Amazon's
    // builtin grammar if/when prefixless can be enabled. It may
    // be possible to combine them. TODO:REVIEW
    //
    // TODO: Implement name-free when Amazon lets me do so.

    async FullMetadataIntent() {
	// TODO: Probably want to refactor this into a subroutine, and have
	// it and getStreamMetadataText() take parameters saying which
	// field(s) have been requested.

	// BUG: When using multiple devices, Alexa can get confused
	// about whether and where New Sounds is running. For now,
	// the safer solution is to disable the inProgress test.
	// TODO: We could try to maintain a counter rather than a
	// simple flag, but I'm unreasonably nervous about that
	// getting out of synch. Or we can investigate whether
	// inProgress can be maintained on a device basis rather
	// than only on user.
	var inProgress:boolean = this.$user.$data.inProgress
	if(inProgress)
	{
	    var currentDate = this.$user.$data.currentDate;
	    if (currentDate==Player.getLiveStreamDate()) {
		let response=await getStreamMetadataText()
		this.showImageCard("New Sounds On Demand -- Live Stream",response,NewSoundsLogoURI)
		this.$speech.addText(response)
	    } else {
		var episode=await Player.getEpisodeByDate(currentDate)
		if(episode==null) {
		    let response="Sorry, but I'm not sure what you are listening to right now."
		    this.showImageCard("New Sounds On Demand",response,NewSoundsLogoURI)
		    this.$speech.addText(response)
		}
		else {
		    // TODO REVIEW: Add date to episode meta response? 
	    	    let response="Now playing Episode "+episode.title+"."
		    var graphic:string= (episode.imageurl==null) ? NewSoundsLogoURI : episode.imageurl
		    this.showImageCard("New Sounds On Demand -- Daily Show",response,graphic)
		    this.$speech.addText(response)
		}
	    }
	} else {
	    this.$speech.addText("I don't think New Sounds On Demand is playing anything on this device right now. But I may be confused.")
	}
	return this.tell(this.$speech)
    },

    // Amazon's "who sings this song".  For our purposes, we may want
    // to make this synonymous with "who is playing this song"... or
    // we may want to report only vocalist.
    async "AMAZON.SearchAction<object@MusicRecording[byArtist.musicGroupMember]>"() {
	return this.toIntent('QuerySingerIntent')
    },
    async QuerySingerIntent() {
	return this.toIntent("FullMetadataIntent") // stopgap
    },
 
    // Amazon's "who is playing this song". For our purposes, we may want
    // to make this synonymous with "who sings this song".
    async "AMAZON.SearchAction<object@MusicRecording[byArtist]>"() {
	return this.toIntent('QueryArtistIntent')
    },
    async QueryArtistIntent() {
	return this.toIntent('FullMetadataIntent')
    },

    // Amazon's "how long is this song"
    async "AMAZON.SearchAction<object@MusicRecording[duration]>"() {
	return this.toIntent('QueryDurationIntent')
    },
    async QueryDurationIntent() {
	return this.toIntent('FullMetadataIntent')
    },

    // Amazon's "what album is this song on"
    async "AMAZON.SearchAction<object@MusicRecording[inAlbum]>"() {
	return this.toIntent('QueryAlbumIntent')
    },
    async QueryAlbumIntent() {
	return this.toIntent('FullMetadataIntent')
    },

    // Amazon's "who produced this song"
    async "AMAZON.SearchAction<object@MusicRecording[producer]>"() {
	return this.toIntent('QueryProducerIntent')
    },
    async QueryProducerIntent() {
	return this.toIntent('FullMetadataIntent')
    }
});

////////////////////////////////////////////////////////////////////

app.setAlexaHandler(AlexaHandler);
app.setGoogleAssistantHandler(GoogleHandler);

module.exports.app = app
