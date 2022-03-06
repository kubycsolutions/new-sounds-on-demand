// GONK: Database being moved into an instance of DominoDB,
// loaded/maintained/accessed through the episodedb module.
// This requires rewriting from synchronous form to Promise/async.
// Note that this will affect callers too.

'use strict;'

import got from 'got'

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
// treating it as an Episode with null date and episode
// number. Unclear that would actually be much cleaner; app.js still
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

////////////////////////////////////////////////////////////////
// Switching from local FileDB to DynamoDB instance
// GONK: DYNAMO INSTANCE SHOULD BE SETTABLE.
// GONK: TABLE INSTANCE SHOULD BE SETTABLE (for debug vs. live)
// GONK: Currently hardwired to one program. Eventually may want several.
import {set_AWS_endpoint,
	EpisodeRecord,
	getItemForDate,
	getItemForEarliestDate,
	getItemForLatestDate,
	getItemForLowestEpisode,
	getItemForHighestEpisode,
	getItemsForEpisode,
	getNextItemByDate,
	getPreviousItemByDate,
	getNextItemByEpisode,
	getPreviousItemByEpisode,
	getRandomItem
       } from './episodesdb'

// GONK: CONSTANTS FOR NOW, WILL WANT OVERRIDES
const TABLENAME="episodes"
const PROGRAM="newsounds"
set_AWS_endpoint()


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

    static async getMostRecentBroadcastDate():Promise<number> {
	try {
	    var record=await getItemForLatestDate(TABLENAME,PROGRAM)
	    return record.broadcastDateMsec
	} catch(err) {
	    console.error("ERROR in getMostRecentBroadcastDate: date not found")
	    return Promise.resolve(-1);
	}
    };
    static async getHighestEpisodeNumber():Promise<number> {
	try {
	    var record=await getItemForHighestEpisode(TABLENAME,PROGRAM)
	    return record.broadcastDateMsec
	} catch(err) {
	    console.error("ERROR in getMostRecentBroadcastDate: date not found")
	    return Promise.resolve(-1);
	}
    };
    static async getLatestEpisodeIndex():Promise<number> {
        return this.getMostRecentBroadcastDate()
    };
    
    static async getFirstEpisodeNumber():Promise<number> {
	// Really shouldn't assume we have #1 and there is no #0.
	try {
	    var record=await getItemForLowestEpisode(TABLENAME,PROGRAM)
	    return Promise.resolve(record.episode)
	} catch(err) {
	    console.error("ERROR in getFirstEpisodeNumber: date not found")
	    return Promise.resolve(-1);
	}
    };
    static async getOldestEpisodeDate():Promise<number> {
	try {
	    var record=await getItemForEarliestDate(TABLENAME,PROGRAM)
	    return Promise.resolve(record.broadcastDateMsec)
	} catch(err) {
	    console.error("ERROR in getOldestEpisodeDate: date not found")
	    return Promise.resolve(-1);
	}
    };
    static async getFirstEpisodeIndex():Promise<number> {
	return this.getOldestEpisodeDate()
    };
    
    static async getNextEpisodeNumber(index:number):Promise<number> {
	if (index==null)
	    return Promise.resolve(-1) // Can't navigate from livestream
	try {
	    var record=await getNextItemByEpisode(TABLENAME,PROGRAM,index)
	    return record.episode
	} catch(err) {
	    console.error("ERROR in getNextEpisodeNumber: not found")
	    return -1;
	}
    };
    static async getNextEpisodeDate(index:number):Promise<number> {
	if (index==null)
	    return -1 // Can't navigate from livestream
	try {
	    var record=await getNextItemByDate(TABLENAME,PROGRAM,index)
	    return record.broadcastDateMsec
	} catch(err) {
	    console.error("ERROR in getNextEpisodeByDate: not found")
	    return -1;
	}
    };
    static async getNextEpisodeIndex(index:number):Promise<number> {
	return this.getNextEpisodeDate(index)
    };

    static async getPreviousEpisodeNumber(index:number):Promise<number> {
	if (index==null) 
	    return -1 // Can't navigate from livestream
	if (index==null)
	    return -1 // Can't navigate from livestream
	try {
	    var record=await getPreviousItemByEpisode(TABLENAME,PROGRAM,index)
	    return record.episode
	} catch(err) {
	    console.error("ERROR in getPreviousEpisodeNumber: not found")
	    return -1;
	}
    };
    static async getPreviousEpisodeDate(index:number):Promise<number> {
	if (index==null)
	    return -1 // Can't navigate from livestream
	try {
	    var record=await getPreviousItemByDate(TABLENAME,PROGRAM,index)
	    return record.episode
	} catch(err) {
	    console.error("ERROR in getPreviousEpisodeDate: not found")
	    return -1;
	}
    };
    static async getPreviousEpisodeIndex(index:number):Promise<number> {
	return this.getPreviousEpisodeDate(index)
    };

    static getEpisodeNumber(episodeRecord:EpisodeRecord):number {
	if(episodeRecord==null || episodeRecord==undefined)
	    return -1
        return episodeRecord.episode
    };
    static getEpisodeDate(episodeRecord:EpisodeRecord):number {
	if(episodeRecord==null || episodeRecord==undefined)
	    return -1
	return episodeRecord.broadcastDateMsec
    };
    static getEpisodeIndex(episodeRecord:EpisodeRecord):number {
	return this.getEpisodeDate(episodeRecord)
    };

    static async getEpisodeByNumber(index:number):Promise<EpisodeRecord|null> {
	if (index<=0)
	    return null // Can't navigate from livestream
	else try {
	    // Multiple records may exist if rebroadcast.
	    // Return earliest instance (default sort order)
	    var records=await getItemsForEpisode(TABLENAME, PROGRAM, index)
	    if(records.Items.length >= 1)
		return records.Items[0]
	    else {
		console.error("ERROR in getEpisodeByNumber: empty")
		return null
	    }
	} catch(err) {
	    console.error("ERROR in getEpisodeByNumber: not found")
	    return null;
	}
    };

    static async getEpisodeByDate(index:number):Promise<EpisodeRecord|null> {
	if (index<=0)
	    return null // Can't navigate from livestream
        else try {
	    var record = await getItemForDate(TABLENAME,PROGRAM,index)
	    return record.Item
	} catch(err) {
	    console.error("ERROR in getEpisodeByDate: not found")
	    return null;
	}
	
    };
    static async getEpisodeByIndex(index:number):Promise<EpisodeRecord|null> {
        return this.getEpisodeByDate(index);
    };

    static async getRandomEpisodeNumber():Promise<number> {
	var record=await getRandomItem(TABLENAME,PROGRAM)
	return record.episode
    };
    static async getRandomEpisodeDate():Promise<number> {
	var record=await getRandomItem(TABLENAME,PROGRAM)
	return record.broadcastDateMsec
    };
    static async getRandomEpisodeIndex():Promise<number> {
	return this.getRandomEpisodeDate()
    };

// Update refactored to episodesdb

} // end exported module functions
