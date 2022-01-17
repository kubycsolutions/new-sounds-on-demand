// GONK: Database being moved into an instance of DominoDB,
// loaded/maintained/accessed through the episodedb module.
// This may be obsolete code.

'use strict;'

import got from 'got'

// TODO: Sounds-like processing, for tag searches, eventually.
// ISSUE: TS is turning these imports into requires, and then
// Jovo/JS complains that they needed to be imports. Some combination
// of Typescript config options is needed to fix this, I assume.
// import {metaphone} from 'metaphone'
// import {stemmer} from 'stemmer'

// Filesystem access, so we can write out updates to the "reload cache"
// copy of the episode tables.
const fs = require('fs')

////////////////////////////////////////////////////////////////
// URI-related constants:
//
// TODO REVIEW: URI constants should probably be loaded from a config
// file, since I *think* this code could handle the sibling shows too.
// (One *could* have a unified skill and/or database for all of
// them. I'm not sure that makes sense for user navigation, but we'll
// see.)
//
// TODO REVIEW: We could cheat the livestream into our normal tables,
// treating it as an Episode with null date and episodeNumber
// zero. Unclear that would actually be much cleaner; app.js still
// needs to special-case it since we can't navigate to/from/within it.
const LIVE_STREAM_URI="https://q2stream.wqxr.org/q2-web?nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
const LIVE_STREAM_DATE=0 // Reserved slot. Don't try to navigate it!
const LIVE_STREAM_METADATA_URI="http://api.wnyc.org/api/v1/whats_on/q2"

// TODO: Should probably have a constant for the DB query format

// Politeness: Tell the station's servers (and the tracking systems
// they're using) where these HTTP(S) queries are coming from, for
// debugging and statistics. (And no, skipping the trackers does *not*
// avoid the underwriting and identification boilerplate being
// prepended to episode MP3s... and the length of those varies enough
// that we can't get away with cheating the offset forward a known
// amount.)
//
// TODO REVIEW: export/import addUriUsage, refactor as needed?
const APP_URI_PARAMETERS="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"

// URI to query the station's episode database. Pages start from 1, ordered
// newest-first. Page size can be up to 100 episodes per query. NOTE that this
// doesn't issue the query, just produces the URI.
//
// This is currently an anonymous function/function-pointer because I
// think we want to refactor it into the per-show configuration, and
// that *may* be a clean way to do it. Or may not.
const formatEpisodeDatabaseQueryURI=function(page:number,page_size:number) {
    return "https://api.wnyc.org/api/v3/story/?item_type=episode&ordering=-newsdate&show=newsounds&"+APP_URI_PARAMETERS+"&page="+page+"&page_size="+page_size
}

////////////////////////////////////////////////////////////////
// TODO: Replace episodesFile with a database, to make sure it stays
// reentrant under update/usage. More important as we add users.
// Performance of incremental update is important if we're calling it
// on every forward/get-latest request; might want to reduce chunk
// size of update.
const EPISODES_FILE='./episodes.json'

export interface EpisodeRecord {
    number: number;
    title: string;
    tease: string;
    broadcastDatesMsec: (number|null)[]; // Should never be null, but for type compatibility...
    tags: string[];
    url: string;
}
// Typescript representation of a hashtable
// Could make it array of days-since-epoch, converting; that would still have nulls for missing episodes, though.
export interface EpisodeNumbersByDateMsec {
    [index: string]: number|null; // This will be null if datestamp not in keys
}
export interface EpisodesCache {
    episodesByNumber: (EpisodeRecord|null)[]
    episodeNumbersByDateMsec: EpisodeNumbersByDateMsec
}

// I keep forgetting js/ts instantiate struct objects with inline {} syntax,
// rather than needing 'new' or c'tors. Those come back in with classes.
// Which I could have used, but since I was learning the language as I went
// I found it easier to work with basic structs.
//
// Meanwhile, just as a temporary conceptual bridge, I'm wrapping a
// function around the inline constructor.
function newEpisodeRecord(epNumber:number,title:string,tease:string,timestamps:number[],tags:string[],url:string):EpisodeRecord {
    var er:EpisodeRecord={
	number: epNumber,
	title: title,
	tease: tease,
	broadcastDatesMsec: timestamps,
	tags: tags,
	url: url
    }
    return er
}

// TODO: Replace episodesCache and its file with database
//var episodesCache = require(EPISODES_FILE); // Initialize from local cache
import * as episodesCache from './episodes.json'
var episodesByNumber:(EpisodeRecord|null)[] = episodesCache.episodesByNumber!
var episodeNumbersByDateMsec:EpisodeNumbersByDateMsec = episodesCache.episodeNumbersByDateMsec!

///////////////////////////////////////////////////////////////////////////
// Utility functions

// Rough JSONification of object, useful when debugging
//
// TODO: EXPOSE AND IMPORT
function objToString(obj:any, ndeep:number=0):string {
    const MAX_OBJTOSTRING_DEPTH=10 // circular refs are possible

    if(obj == null){ return String(obj); }
    if(ndeep > MAX_OBJTOSTRING_DEPTH) {return "...(elided; recursion guard)..." }
    switch(typeof obj){
    case "string": return '"'+obj+'"';
    case "function": return obj.name || obj.toString();
    case "object":
	let indent = Array(ndeep||1).join('  '), isArray = Array.isArray(obj);
	return '{['[+isArray] 
	    + Object.keys(obj).map(
		function(key){
		    return '\n' 
			+ indent 
			+ key + ': ' 
			+ objToString(obj[key], (ndeep||1)+1);
		}).join(',') 
	    + '\n' 
	    + indent 
	    + '}]'[+isArray];
    default: return obj.toString();
    }
}

// Convert HTML escapes to speakable. Note RE syntax in .replace().
function deHTMLify(text:string):string {
    return text
	.replace(/<.*>/gi," ")
	.replace(/&nbsp;/gi," ")
	.replace(/&amp;/gi," & ")
	.replace(/&[lr]squo;/gi,"'")
	.replace(/&[lr]dquo;/gi,'"')
	.replace(/&[lr]ndash;/gi," -- ")
    // TODO: (case sensitive?) aelig, eacute, aacute, iacute, oacute,
    // hellip, Uuml, uacute, auml, oslash -- unless speech synths
    // handle them.
}

// Javascript Date.setDate() handles day-number overflow/underflow.
// For clarity, I'm handling everything as UTC.
//
// TODO: Functional sanity-check against dates as I've parsed and
// recorded them.
function todayMS():number { // round off UTC to day. Handles leapyears.
    let d=new Date(Date.now());
    d.setUTCHours(0)
    d.setUTCMinutes(0)
    d.setUTCSeconds(0)
    d.setUTCMilliseconds(0)
    return d.getTime()
}
// TODO REFACTOR: JSON serializes key ms as strings; Date ctor from
// msec value wants int. Arguably that should be being normalized at
// the time we retrieve the datestamp rather than here.
function nextDayMS(datestamp:number):number {
    if(typeof datestamp=="string")
	datestamp=parseInt(datestamp)
    let d=new Date(datestamp);
    d.setUTCHours(0) // redundant?
    d.setUTCMinutes(0)
    d.setUTCSeconds(0)
    d.setUTCMilliseconds(0)
    d.setUTCDate(d.getUTCDate()+1)
    return d.getTime()
}


// TODO REFACTOR: JSON serializes key ms as strings; Date ctor from
// msec value wants int. Arguably that should be being normalized at
// the time we retrieve the datestamp rather than here.
function nextEpisodeDateMS(datestamp:number):number {
    for(let dateMS=nextDayMS(datestamp);dateMS<=todayMS();dateMS=nextDayMS(dateMS)) {
	let ep=episodeNumbersByDateMsec[dateMS.toString()]
	if(ep!=null && ep!=undefined) { // JS novice paranoia
	    return dateMS
	}
    }
    console.log("No nextEpisodeDateMS after",new Date(datestamp).toUTCString())
    return -1
}

// TODO REFACTOR: JSON serializes key ms as strings; Date ctor from
// msec value wants int. Arguably that should be being normalized at
// the time we retrieve the datestamp rather than here.
function previousDayMS(datestamp:number):number {
    if (typeof datestamp === 'string') 
	datestamp=parseInt(datestamp)
    let d=new Date(datestamp);
    d.setUTCHours(0) // redundant?
    d.setUTCMinutes(0)
    d.setUTCSeconds(0)
    d.setUTCMilliseconds(0)
    d.setUTCDate(d.getUTCDate()-1)
    return d.getTime()
}

function previousEpisodeDateMS(datestamp:number):number {
    var showEpoch=firstBroadcastDateMS(1) // Guaranteed to return number, not str.
    for(let dateMS=previousDayMS(datestamp);dateMS>=showEpoch;dateMS=previousDayMS(dateMS)) {
	let ep=episodeNumbersByDateMsec[dateMS.toString()]
	if(ep!=null && ep!=undefined) { // JS novice paranoia
	    return dateMS
	}
    }
    console.log("No previousEpisodeDateMS before",new Date(datestamp).toUTCString())
    return -1
}

// There may be multiple broadcast dates for an episode. Get the
// earliest. Note NUMERIC minimum value, not string-compare.
// Also note that this expects EPISODE NUMBER, not episode object.
//
// TODO GONK: Risk of confusion about expected parameter here. Does
// Javascript/typescript allow overloading, or would I have to do
// instanceof/typeof to support both (for robustness)?
function firstBroadcastDateMS(epNumber:number):number {
    let ep=episodesByNumber[epNumber]!
    return Math.min.apply(null,
			  ep.broadcastDatesMsec.filter( // drop nulls
			      (x): x is number => x !== null)
			 )

}

///////////////////////////////////////////////////////////////////////////
// Player logic: mechanisms for navigating and extracting our tables
// of episodes (by date and/or by episode number).
//
// The "index" calls are backward-compatibility residue of a change
// from prototype (using episode number as index) to production (using
// date as index).
// 
// If we want to support both playing sequences, we may need to
// recreate a routing layer, so I'm retaining these stubs for
// now. Proper way to do that would be to better encapsulate the
// concept of current-episode, possibly tracking both but knowing
// which is currently in use. (Of course, the really ugly solution is
// to keep it as integer and declare any int smaller than 100,000 must
// be an episode number.)

export class Player {
    static getLiveStreamURI():string { return LIVE_STREAM_URI };
    static getLiveStreamDate():number { return LIVE_STREAM_DATE };

    static getMostRecentBroadcastDate():number {
	let newSoundsEpochMS=this.getOldestEpisodeDate()
	// Loop should terminate quickly; this is overkill for robustness.
	for(let date=todayMS(); date>=newSoundsEpochMS; date=previousDayMS(date)) {
	    let ep=episodeNumbersByDateMsec[date.toString()]
	    if(ep!=null && ep!=undefined) { // JS novice paranoia
		return date
	    }
	}
	// Should never fall out of that loop
	console.error("ERROR in getMostRecentBroadcastDate: date not found")
	return -1;
    };
    static getHighestEpisodeNumber():number {
	// Relies on the fact that our auto-expanding array will always
	// have top index non-empty, unless we step on that.
	// TODO: Review periodically.
        return episodesByNumber.length-1;
    };
    static getLatestEpisodeIndex():number {
        return this.getMostRecentBroadcastDate()
    };
    
    static getFirstEpisodeNumber():number {
	// TODO: Really shouldn't assume we have #1 and there is no #0.
        return 1;
    };
    static getOldestEpisodeDate():number {
	return firstBroadcastDateMS(1);
    };
    static getFirstEpisodeIndex():number {
	return this.getOldestEpisodeDate()
    };
    
    static getNextEpisodeNumber(index:number):number {
	if (index==null)
	    return -1 // Can't navigate from livestream
	// Skip nulls (episodes we don't have indexed)
	while(!episodesByNumber[++index] && index < episodesByNumber.length)
	    ;
	return index;
    };
    static getNextEpisodeDate(index:number):number {
	if (index==null)
	    return -1 // Can't navigate from livestream
	return nextEpisodeDateMS(index)
    };
    static getNextEpisodeIndex(index:number):number {
	return this.getNextEpisodeDate(index)
    };

    static getPreviousEpisodeNumber(index:number):number {
	if (index==null) 
	    return -1 // Can't navigate from livestream
	// Skip nulls (episodes we don't have indexed)
	while(episodesByNumber[--index]==null && index > 0)
	    ;
	return index;
    };
    static getPreviousEpisodeDate(index:number):number {
	if (index==null)
	    return -1 // Can't navigate from livestream
	return previousEpisodeDateMS(index)
    };
    static getPreviousEpisodeIndex(index:number):number {
	return this.getPreviousEpisodeDate(index)
    };

    static getEpisodeNumber(episodeRecord:EpisodeRecord):number {
	if(episodeRecord==null || episodeRecord==undefined)
	    return -1
        return episodeRecord.number
    };
    static getEpisodeDate(episodeRecord:EpisodeRecord):number {
	if(episodeRecord==null || episodeRecord==undefined)
	    return -1
	let episodeDateMS=firstBroadcastDateMS(episodeRecord.number)
	return episodeDateMS
    };
    static getEpisodeIndex(episodeRecord:EpisodeRecord):number {
	return this.getEpisodeDate(episodeRecord)
    };

    static getEpisodeByNumber(index:number):EpisodeRecord|null {
	if (index<=0)
	    return null // Can't navigate from livestream
	else
            return episodesByNumber[index];
    };
    static getEpisodeByDate(index:number):EpisodeRecord|null {
	if (index<=0)
	    return null // Can't navigate from livestream
        else {
	    let epNumber=episodeNumbersByDateMsec[index.toString()]
	    if (epNumber)
		return episodesByNumber[epNumber];
	    else
		return null
	}
    };
    static getEpisodeByIndex(index:number):EpisodeRecord|null {
        return this.getEpisodeByDate(index);
    };

    static getRandomEpisodeNumber():number {
	// ep# are sparse, but if we have a date we know the episode exists,
	// so random-select in that space and then map.
	let randate=this.getRandomEpisodeDate()
	return episodeNumbersByDateMsec[randate]! // Known non-null
    };
    static getRandomEpisodeDate():number {
	// Hashtable keyed by dateMS, so pick from existing keys.
	let dates=Object.keys(episodeNumbersByDateMsec) // Sparse, so string[]
	let choice=Math.floor(Math.random()*dates.length)
	return parseInt(dates[choice])
    };
    static getRandomEpisodeIndex():number {
	return this.getRandomEpisodeDate()
    };


///////////////////////////////////////////////////////////////////////////
// Table updates: Synchronization with the show's official database.

    //================================================================
    // Check the newsounds.org database to find out which (if any) new
    // episodes have been published. This can be run in three modes,
    // depending on the value of maxdepth:
    //
    // <0 incremental, ==0 rescan all, N>0 check only first N pages
    //
    // Incremental is most common mode of operation. Rescan is mostly
    // used when I'm adding a field to the table, though it may be
    // worth running periodically just in case a missing episode
    // appears. First-N is mostly used as a debug tool when testing
    // new update logic.
    //
    // Note sequenced invocation of asynchronous fetch and process,
    // since we want to support incremental to reduce delay and server
    // load.  (Before you ask: No, I don't trust Javascript to
    // optimize tail-recursion.)
    //
    // TODO REVIEW: Move this into a separate file for easier
    // replacement, to handle other sources? Update *is* closely linked to
    // the cache database and player code...
    static async updateEpisodes(maxdepth:number) {
	console.log("Checking server for new episodes...")

	// Run Got HTTP query, returning object via a Promise
	const getStationEpisodeData = (page:number) => {
	    console.log("  Fetch index page",page)
	    const page_size=10 // Number of results per fetch
	    return new Promise((resolve, reject) => {
		// Fetch a page from the list of episodes,
		// date-descending order This uses a function variable
		// because I think I want to move it out to a per-show
		// initialization file.
		var uri=formatEpisodeDatabaseQueryURI(page,page_size)
		got.get(uri) // default content-type is 'text'
		    .then( (response:any) => {
			return resolve(JSON.parse(response.body));
		    })
		    .catch( (e:any) => {
			console.log(e)
			if(e instanceof Error) {
			    let error:Error=e
			    return reject(error.message)
			}
			else {
			    return reject(e.toString())
			}
		    })
	    })
	};

	// NOTE: For validation purposes, I believe we can comment out
	// any fields we aren't actually using and gain performance thereby.
	// I'm already leaving some stuff typed as any because I don't need
	// it and don't want to spend time spelling it out/validating it.
	interface StationEpisodeAttributes {
	    "analytics-code": string;
	    appearances: any;
	    audio: string|string[]; // uri; occasionally an array (past error?)
	    "audio-available": boolean;
	    "audio-eventually": boolean;
	    "audio-may-download": boolean;
	    "audio-may-embed": boolean;
	    "audio-may-stream": boolean;
	    // Body is an (X?)HTML string. Parsing out the
	    // text description and playlist may be possible;
	    // or we might want to display it on units with screens.
	    // Unfortunately playlist gives only run lengths; not
	    // offsets; so even if parsed we can't derive
	    // "what's playing now" from it. And unfortunately the
	    // recording-source URIs are of varying types (bandcamp;
	    // store; etc) and are not all current; so we can't
	    // easily implement "hey; put that on my shopping list".
	    body: string;
	    "canonical-url": null|string;
	    channel: null|string;
	    "channel-title": null|string;
	    chunks: any; // ...
	    "cms-pk": number;
	    "comments-count": number;
	    "enable-comments": boolean;
	    "date-line-ts": number; // msec since epoch?
	    "edit-link": string; // protected; I hope!
	    "embed-code": string; // HTML for the iframe
	    "estimated-duration": number; // seconds?
	    headers: any; // ... 
	    "header-donate-chunk": any; // null|string?
	    "image-caption": null|string;
	    "image-main": {
		"alt-text": null|string;
		name: null|string;
		source: null|string;
		url: null|string; // TODO: May want to display
		h: number;
		"is-display": boolean;
		crop: string; // containing number
		caption: string;
		"credits-url": string; // TODO: Display?
		template: string; // URI with substitution slots?
		w: number;
		id: number;
		"credits-name": string; // eg "courtesy of the artist"
	    };
	    "item-type": string;
	    "item-type-id": number;
	    newscast: string;
	    newsdate: string; // containing ISO date/time/offset stamp
	    "npr-analytics-dimensions": string[]; // mostly replicates
	    playlist: any[]; // ?
	    "podcast-links": any[]; //?
	    "producing-organizations": [{
		url: string;
		logo: any; // often null
		name: string
	    }];
	    "publish-at": string; // containing ISO date/time/offset stamp
	    "publish-status": string;
	    show: string; // "newsounds"
	    "show-tease": string; // HTML for "teaser" description of SHOW
	    "show-title": string; // "New Sounds"
	    "show-producing-orgs": [{ // TODO: Make org an interface?
		url: string;
		logo: any; // often null
		name: string;
	    }];
	    series: any[] // often empty
	    segments: any[] // often empty
	    "short-title": string // often empty
	    "site-id": number
	    slug: string // Brief description eg "4569-late-night-jazz"
	    slideshow: any[] // often empty
	    tags: string[] // "artist_name", "music", ...
	    tease: string // NON-HTML brief description of EPISODE
	    template: string // editing guidance
	    title: string // Brief description eg "#4569, Late Night Jazz",
	    transcript: string // usually empty for New Sounds
	    "twitter-headline": string // usually === title
	    "twitter-handle": string // eg "newsounds"
	    url: string // for episode description page. Display?
	    video: null|string // usually null
	}
	interface StationEpisodeDescription{
	    type: string;
	    id: string; // containing number
	    attributes: StationEpisodeAttributes
	}
	interface StationEpisodeData {
	    links: {
		first:string;
		last:string;
		next:string|null;
		prev:string|null;
	    };
	    data: StationEpisodeDescription[] // interface for clarity
	    meta: {
		pagination: {
		    page: number
		    pages: number
		    count: number
		}
	    }
	}
	// Type Guard for above interface, TS's answer to ducktype downcasting.
	// (http://www.typescriptlang.org/docs/handbook/advanced-types.html)
	function isStationEpisodeData(toBeDetermined: any): toBeDetermined is StationEpisodeData {
	    if((toBeDetermined as StationEpisodeData).data){
		return true
	    }
	    console.log("vvvvv DEBUG vvvvv")
	    console.log("DEBUG: Type guard unhappy")
	    console.log(objToString(toBeDetermined))
	    console.log("^^^^^ DEBUG ^^^^^")
	    return false
	}

	const handlePage = async() => {
	    var hasMore=true
	    var page=1
	    while(hasMore) {
		// Issue query, wait for Promise to be completed,
		// and handle. The await is needed so we can determine
		// when incremental load has reached already-known data.
		await getStationEpisodeData(page)
		    .then( data => {
			// Typescript's approach to downcasting is
			// apparently to condition upon a Type Guard.
			if(! (isStationEpisodeData(data))) {
			    console.error("UNEXPECTED DATA STRUCTURE FROM STATION")
			    return;
			}

			// Note that episodesByNumber array will be mostly
			// preallocated during the first pass through
			// this list, since highest numbered will usually be
			// among most recent.

			// PROCESS EPISODES IN THIS CHUNK
			var episodes=data.data
			for (let ep of episodes) {
			    var attributes=ep.attributes;
			    // Shows may be in database before release;
			    // skip if not playable. (TODO: Someday we
			    // might have a "what's coming soon" feature,
			    // but that's very future.)
			    if(attributes.audio!="" && attributes.audio!=undefined) {
				// Some titles have unusual boilerplate that
				// we need to adapt.
				//
				// I'm not bothering to process
				// "pre-empted" shows; I trust that
				// they will have no audio and be
				// dropped later.  (In some cases
				// those had special podcasts
				// available, though, which I don't see
				// a way to recover an ep# or title for.)
				var title=attributes.title
				    .replace(/The Undead # ?[0-9]*/gi," ")
				    .replace(/The Undead/gi,"")
				    .replace(/Undead # ?[0-9]*/gi," ")
				    .replace(/ Pt. /gi," Part ")
				if(!title.startsWith("#"))
				    title=title.replace(/(^[^#].*)(#.*)/i,"$2, $1")
				
				// Nominally, number is easier to parse off
				// attributes.slug. But that doesn't produce
				// the right results for the "undead"
				// episodes; slug puts those up in the 60K
				// range but we really want the human number,
				// and title processing should ensure it's at
				// the start of that string (after '#').
				// Exception: pre-empted 
				var episodeNumber=parseInt(title.slice(1))

				// New Sounds prefers to route these
				// as podtrac URIs, though the direct
				// URI can be extracted therefrom if
				// one had reason to cheat. As of this
				// writing the database hasn't
				// included URI parameters, but I'm
				// not ruling that out.
				//
				// For New Sounds, this can actually be reconstructed from
				// broadcast date, in form 
				// "https://pdst.fm/e/www.podtrac.com/pts/redirect.mp3/audio.wnyc.org/newsounds/newsounds072521.mp3"
				// Haven't verified for Sound Check etc.
				// Consider saving just show ID and ep#?
				// 
				// Occasionally coming thru as array
				// in odd format (historical
				// accident?), be prepared to unpack
				// that.
				// 
				var mp3url=attributes.audio
				if(Array.isArray(mp3url)) {
				    mp3url=mp3url[0]
				}

				// Trim off time to work just with dates.
				// Convert to real date value now, or later?
				// See also newsdate, "(First Aired...)" in descr
				// Publication date is not actually useful;
				// that's when it was added to the DB.
				// published=attributes["publish-at"].replace(/T.*/,'')
				// publishedDate=new Date(published)

				var now=new Date()
				// Take broadcast date from mp3url,
				// rather that other fields; applied
				// paranoia.  Note: In at least one
				// case the database reports an
				// unusually formed URI
				// .../newsounds050610apod.mp3?awCollectionId=385&awEpisodeId=66200
				// so be prepared to truncate after
				// datestamp.
				var urlDateFields=mp3url
				    .replace(/.*\/newsounds([0-9]+)/i,"$1")
				    .match(/.{1,2}/g)
				if(! urlDateFields) {
				    // Should never happen but Typescript
				    // wants us to promise it won't.
				    throw new RangeError("invalid date in: "+mp3url)
				}
				// Sloppy mapping of 2-digit year to 4-digit
				var year=parseInt(urlDateFields[2])+2000
				if(year > now.getUTCFullYear())
				    year=year-100
				var broadcastDate=new Date(
				    Date.UTC(
					year,
					parseInt(urlDateFields[0])-1, // 0-based
					parseInt(urlDateFields[1])
				    )
				)

				// For Echo View and the like, long
				// description is attributes.body, and
				// attributes["image-main"] can be
				// used for the image. TODO

				// The database has &nbsp; and
				// similar. Clean up for voice.
				//
				// For spoken description, use tease
				// rather than body. But NOTE: Tease
				// sometimes truncates long text with
				// "...", which is not ideal for
				// humans. Workaround: If that is
				// seen, take the first sentence of
				// body instead.
				var tease=deHTMLify(attributes.tease)
				if (tease.endsWith("..."))
				    tease=deHTMLify(attributes.body+" ")
					.split(". ")[0]+"."

				// TODO: Someday, is it worth parsing
				// out the ARTIST/WORK/SOURCE/INFO
				// <span/>s from the body? Alas, can't
				// map durations to offsets, since the
				// duration table doesn't include
				// John's commentary.
				
				// TODO: Tag searchability some day.
				// Note processing into sounds-like
				// match form.  Other music skills
				// seem to handle this; I'm not sure
				// what their approach is.
				//
				// We want to both handle "redbone" finding
				// Martha Redbone, and distinguish
				// Kronos Quartet from
				// Mivos Quartet.
				var tags=[]
				for(let tag of attributes.tags) {
				    // TODO: Should we make this array
				    // for direct matching, or reconcatentate
				    // into a string for contains matching?
				    // Unclear which is more robust given
				    // possibly fuzzy matching. String is
				    // more human-readable in JSON.
				    var tagset=" " // For ease of exact-matching
				    for(let token of tag.split("_")) {
					// TODO: Match on sounds-like.
					// token=metaphone(stemmer(token))
					tagset=tagset+token+" "
				    }
				    tags.push(tagset)
				}

				// Some array entries may be missing
				// and the array will contain the null
				// value if so.  JSON is content with
				// that, but our navigation will need
				// to recognize and skip those slots.
				//
				// NOTE: Episodes are broadcast out of
				// order and repeated, so incremental
				// must continue until it sees a
				// broadcast date we already know
				// about. (Reminder: we're still
				// handling only one radio show at a
				// time, hence one added entry per
				// date.)
				//
				// NOTE: There is at least one
				// un-episodeNumbered episode of New
				// Sounds ("With Ravi Shankar"). For
				// now, I'm simply dropping that,
				// which will unfortunately drop
				// rebroadcasts as well. (A pity; it's
				// a good interview!) The general case
				// of rediscovered early archives will
				// have to be dealt with if we want to
				// let users access these.
				if(episodeNumber > 0) {
				    // Some juggling here to get types right...
				    // Unfortunately while Typescript realizes
				    // that after the first test ep is non-null,
				    // Javascript needs manual help.
				    let ep = episodesByNumber[episodeNumber]
				    if(ep===null) {
					var tempObject=newEpisodeRecord(
					    episodeNumber,
					    title,
					    tease,
					    [broadcastDate.getTime()],
					    tags,
					    mp3url
					)
					episodesByNumber[episodeNumber]=tempObject
					// maintain broadcast dates index
					episodeNumbersByDateMsec[broadcastDate.getTime()]=episodeNumber
				    }
				    else if (ep!=null && ep.broadcastDatesMsec
					     .includes(broadcastDate.getTime())
					    ) {
					if(maxdepth<0 && hasMore) {
					    console.log("Scan found known episode ",episodeNumber,"with known date",broadcastDate)
					    console.log("Stopping incremental database update.")
					    hasMore=false
					}
				    }					
				    else if (ep!=null) { // MUST be true!!!
					// GONK: As we move to database
					// there is the question of whether
					// broadcastDatesMsec remains an
					// array of values (more compact), or
					// if we wind up with a row per date
					// (fewer transactions?)
					ep.broadcastDatesMsec
					    .push(broadcastDate.getTime())
					// maintain broadcast dates index
					episodeNumbersByDateMsec[broadcastDate.getTime()]=episodeNumber
				    }
				} // end if numbered
			    } // end if released audio exists.
			} // end for episodes in this fetch

			if(page == maxdepth) hasMore=false
			
			if(page == data.meta.pagination.pages)
			    hasMore=false;// can't use break in async loop
			++page
		    }) // end await.then
		    .catch(e => {
			var stack;
			if(e instanceof Error)
			    stack=e.stack
			else
			    stack="(not Error, so no stack)"
			console.error("Update failed on Page",page,"\n",e,stack)
			// Recovery: Run with what we've previously loaded
			throw e
		    }) 
	    } // end while

	    let numberOfEpisodes=episodesByNumber.length
	    let ep=episodesByNumber[numberOfEpisodes-1]
	    // Really could/should use non-null assertion here?
	    console.log("Highest numbered:",ep===null ? null : ep.title)
	    let mostRecentDate=this.getMostRecentBroadcastDate()
	    let mostRecentNumber=episodeNumbersByDateMsec[mostRecentDate.toString()]! // Should never be null
	    let lastep=episodesByNumber[mostRecentNumber]
	    console.log("Most recent daily:",
			lastep===null ? null : lastep.title,
			"at",new Date(mostRecentDate).toUTCString())

	    // Cache to local file
	    fs.writeFile(EPISODES_FILE,
			 JSON.stringify(episodesCache,null,2), // prettyprint
			 "utf8",
			 function (err:any) {
			     if (err) {
				 console.error("An error occured while writing updates to",EPISODES_FILE);
				 console.error(err);
			     }
			 }
			)
	} // end handlePage

	// Launch sequenced async queries, eventually updating ep list.
	//
	// Eventually we'll probably want to generalize this to handle
	// Soundcheck etc. Just a matter of setting the show name, I think,
	// and having the app run against the right index files.
	await handlePage()
    } // end update

} // end exported module functions
