'use strict;'

// Sounds-like processing, for tag searches eventually
// NOTE: These require the code be a Module, apparently...?
//import {metaphone} from 'metaphone'
//import {stemmer} from 'stemmer'

// GONK GONK: Episodes and dates tables should be moved into a
// database when running on lambda. Which DB depends on environment,
// as we saw in the jovo initialization.
const fs = require('fs')

////////////////////////////////////////////////////////////////
// URI-related constants:
//
// TODO REVIEW: URI constants should probably be loaded from a config
// file, since I *think* this code could handle the sibling shows too.
// (One *could* have a unified skill for all of them. But there's
// sufficient need to track state separately that I'm not sure it's
// worth the complexity vs. firing up a skill for each.)
//
// TODO REVIEW: Add the application-ID parameters with
// app.addUriUsage? Would require refactoring that down here.
//
// TODO REVIEW: We could cheat the livestream into our normal tables,
// treating it as an Episode with null date and episodeNumber
// zero. Unclear that would actually be much cleaner; app.js still
// needs to special-case it since we can't navigate to/from/within it.
const LIVE_STREAM_URI="https://q2stream.wqxr.org/q2-web?nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
const LIVE_STREAM_DATE=null // Make sure we don't try to navigate it!
const LIVE_STREAM_METADATA_URI="http://api.wnyc.org/api/v1/whats_on/q2"

// TODO: Should probably have a constant for the DB query format


// Politeness: Tell the station's servers (and any tracking system
// they're using) where these HTTP(S) queries are coming from, for
// debugging and statistics.
//
// TODO REVIEW: refactor addUriUsage from app into Player? And/or into
// per-show config?
const APP_URI_PARAMETERS="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"

// URI to query the station's episode database. Pages start from 1, ordered
// newest-first. Page size can be up to 100 episodes per query. NOTE that this
// doesn't issue the query, just produces the URI.
//
// This is currently an anonymous function/function-pointer because I
// think we want to refactor it into the per-show configuration, and
// that *may* be a clean way to do it. Or may not.
const formatEpisodeDatabaseQueryURI=function(page,page_size) {
    return "https://api.wnyc.org/api/v3/story/?item_type=episode&ordering=-newsdate&show=newsounds&"+APP_URI_PARAMETERS+"&page="+page+"&page_size="+page_size
}

////////////////////////////////////////////////////////////////
// TODO: Replace episodesFile with a database, to make sure it stays
// reentrant under update/usage. More important as we add users.
// Performance of incremental update is important if we're calling it
// on every forward/get-latest request; might want to reduce chunk
// size of update.
const EPISODES_FILE='./episodes.json'

function Episode(number,title,tease,timestamps,tags,url) {
    this.episodeNumber=number;
    this.title=title
    this.tease=tease
    this.broadcastDatesMsec=timestamps
    this.tags=tags
    this.url=url
}

var episodesCache = require(EPISODES_FILE); // Initialize from local cache
var episodesByNumber = episodesCache.episodesByNumber
var episodeNumbersByDateMsec = episodesCache.episodeNumbersByDateMsec

///////////////////////////////////////////////////////////////////////////
// Utility functions

// Rough JSONification of object, useful when debugging
//
// REVIEW: Does JSON permit overloading or default args so
// objToString(obj) could imply ndeep=0? Cleaner...
function objToString(obj, ndeep) {
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
function deHTMLify(text) {
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
function todayMS() { // round off UTC to day. Handles leapyears.
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
function nextDayMS(datestamp) {
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
function nextEpisodeDateMS(datestamp) {
    for(let dateMS=nextDayMS(datestamp);dateMS<=todayMS();dateMS=nextDayMS(dateMS)) {
	let ep=episodeNumbersByDateMsec[dateMS]
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
function previousDayMS(datestamp) {
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

function previousEpisodeDateMS(datestamp) {
    var showEpoch=firstBroadcastDateMS(1) // Guaranteed to return number, not str.
    for(let dateMS=previousDayMS(datestamp);dateMS>=showEpoch;dateMS=previousDayMS(dateMS)) {
	let ep=episodeNumbersByDateMsec[dateMS]
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
function firstBroadcastDateMS(epNumber) {
    return Math.min.apply(null,episodesByNumber[epNumber].broadcastDatesMsec)
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

module.exports = {
    getLiveStreamURI: function() { return LIVE_STREAM_URI },
    getLiveStreamDate: function() { return LIVE_STREAM_DATE },

    getMostRecentBroadcastDate: function() {
	let newSoundsEpochMS=this.getOldestEpisodeDate()
	// Loop should terminate quickly; this is overkill for robustness.
	for(let date=todayMS(); date>=newSoundsEpochMS; date=previousDayMS(date)) {
	    let ep=episodeNumbersByDateMsec[date]
	    if(ep!=null && ep!=undefined) { // JS novice paranoia
		return date
	    }
	}
	// Should never fall out of that loop
	console.error("ERROR in getMostRecentBroadcastDate: date not found")
	return -1;
    },
    getHighestEpisodeNumber: function() {
	// Relies on the fact that our auto-expanding array will always
	// have top index non-empty, unless we step on that.
	// TODO: Review periodically.
        return episodesByNumber.length-1;
    },
    getLatestEpisodeIndex: function() {
        return this.getMostRecentBroadcastDate()
    },
    
    getFirstEpisodeNumber: function() {
	// TODO: Really shouldn't assume we have #1 and there is no #0.
        return 1;
    },
    getOldestEpisodeDate: function() {
	return firstBroadcastDateMS(1);
    },
    getFirstEpisodeIndex: function() {
	return this.getOldestEpisodeDate()
    },
    
    getNextEpisodeNumber: function(index) {
	if (index==null)
	    return -1 // Can't navigate from livestream
	// Skip nulls (episodes we don't have indexed)
	while(episodesByNumber[++index]==null && index < episodesByNumber.length)
	    ;
	return index;
    },
    getNextEpisodeDate: function(index) {
	if (index==null)
	    return -1 // Can't navigate from livestream
	return nextEpisodeDateMS(index)
    },
    getNextEpisodeIndex: function(index) {
	return this.getNextEpisodeDate(index)
    },

    getPreviousEpisodeNumber: function(index) {
	if (index==null) 
	    return -1 // Can't navigate from livestream
	// Skip nulls (episodes we don't have indexed)
	while(episodesByNumber[--index]==null && index > 0)
	    ;
	return index;
    },
    getPreviousEpisodeDate: function(index) {
	if (index==null)
	    return -1 // Can't navigate from livestream
	return previousEpisodeDateMS(index)
    },
    getPreviousEpisodeIndex: function(index) {
	return this.getPreviousEpisodeDate(index)
    },

    getEpisodeNumber: function(episodeRecord) {
	if(episodeRecord==null || episodeRecord==undefined)
	    return -1
        return episodeRecord.number
    },
    getEpisodeDate: function(episodeRecord) {
	if(episodeRecord==null || episodeRecord==undefined)
	    return -1
	let episodeDateMS=firstBroadcastDateMS(episodeRecord.number)
	return episodeDateMS
    },
    getEpisodeIndex: function(episodeRecord) {
	return this.getEpisodeDate(episodeRecord)
    },

    getEpisodeByNumber: function(index) {
	if (index==null)
	    return -1 // Can't navigate from livestream
        return index<0 ? null : episodesByNumber[index];
    },
    getEpisodeByDate: function(index) {
	if (index==null)
	    return -1 // Can't navigate from livestream
        return index<0 ? null : episodesByNumber[episodeNumbersByDateMsec[index]];
    },
    getEpisodeByIndex: function(index) {
        return this.getEpisodeByDate(index);
    },

    getRandomEpisodeNumber: function() {
	// ep# are sparse, but if we have a date we know the episode exists,
	// so random-select in that space and then map.
	let randate=this.getRandomEpisodeDate()
	return episodeNumbersByDateMsec[randate].number
    },
    getRandomEpisodeDate: function() {
	// Hashtable keyed by dateMS, so pick from existing keys.
	let dates=Object.keys(episodeNumbersByDateMsec)
	let choice=Math.floor(Math.random()*dates.length)
	return dates[choice]
    },
    getRandomEpisodeIndex: function() {
	return this.getRandomEpisodeDate()
    },


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
    updateEpisodes: async function(maxdepth) {
	console.log("Checking server for new episodes...")
	const axios=require('axios')

	// Run Axios query, returning a Promise
	const getEpisodeData = (page) => {
	    console.log("  Fetch index page",page)
	    const page_size=10 // Number of results per fetch
	    return new Promise((resolve, reject) => {
		// Fetch a page from the list of episodes,
		// date-descending order This uses a function variable
		// because I think I want to move it out to a per-show
		// initialization file.
		var uri=formatEpisodeDatabaseQueryURI(page,page_size)
		axios.get(uri)
		    .then(response => {
			return resolve(response.data);
		    })
		    .catch(error => {
			return reject(error.message)
		    })
	    })
	};

	const handlePage = async() => {
	    var hasMore=true
	    var page=1
	    while(hasMore) {
		// Issue query, wait for Promise to be completed,
		// and handle. The await is needed so we can determine
		// when incremental load has reached already-known data.
		await getEpisodeData(page)
		    .then((data) => {
			// Note that requesting data from most recent
			// down means episodesByNumber, if not sparse,
			// gets preallocated during the first pass
			// through this list.
			
			var episodes=data.data
			// PROCESS EPISODES IN THIS CHUNK
			// TODO: Incrementality
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
				// in odd format,
				// ['https://pdst.fm/e/www.podtrac.com/pts/redirect.mp3/audio.wnyc.org/newsounds/newsounds050610apod.mp3?awCollectionId=385&awEpisodeId=66200']
				// Be prepared to unpack that.
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
				// In at least one case the database reports a
				// URI ending with
				// .../newsounds050610apod.mp3?awCollectionId=385&awEpisodeId=66200
				// so be prepared to truncate after datestamp
				var urlDateFields=mp3url
				    .replace(/.*\/newsounds([0-9]+)/i,"$1")
				    .match(/.{1,2}/g)
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
				// to recognize and skip.
				//
				// NOTE: Episodes are broadcast out of order
				// and repeated so incremental can't just stop
				// scanning when [episodeNumber] is already filled.
				// It will need to look at broadcast
				// dates. Which is TODO anyway.
				//
				// NOTE: There is at least one un-episodeNumbered
				// episode (deep archive, with Ravi Shankar).
				// 

				if(episodeNumber > 0) { // we lose the pre-numbering ep
				    if(episodesByNumber[episodeNumber]==null) {
					var tempObject=new Episode(
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
				    else if (episodesByNumber[episodeNumber]
					     .broadcastDatesMsec
					     .includes(broadcastDate.getTime())
					    ) {
					if(maxdepth<0 && hasMore) {
					    console.log("Scan found known episode ",episodeNumber,"with known date",broadcastDate)
					    console.log("Stopping incremental database update.")
					    hasMore=false
					}
				    }					
				    else {
					// GONK: As we move to database
					// there is the question of whether
					// broadcastDatesMsec remains an
					// array of values (more compact), or
					// if we wind up with a row per date
					// (fewer transactions?)
					episodesByNumber[episodeNumber]
					    .broadcastDatesMsec
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
		    .catch(error => {
			console.error("Update failed on Page",page,"\n",error)
			// TODO: Diagnostics?
			// Recovery: Run with what we've previously loaded
		    }) 
	    } // end while

	    let numberOfEpisodes=episodesByNumber.length
	    console.log("Highest numbered:",episodesByNumber[numberOfEpisodes-1].title)
	    let mostRecentDate=this.getMostRecentBroadcastDate()
	    let mostRecentNumber=episodeNumbersByDateMsec[mostRecentDate]
	    console.log("Most recent daily:",episodesByNumber[mostRecentNumber].title,"at",new Date(mostRecentDate).toUTCString())

	    // Cache to local file
	    fs.writeFile(EPISODES_FILE,
			 JSON.stringify(episodesCache,null,2), // prettyprint
			 "utf8",
			 function (err) {
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
