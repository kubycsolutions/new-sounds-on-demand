/** Substantially rewritten from Amazon.com sample code by
    keshlam@Kubyc.Solutions

    Currently stateless; table and program names must be passed in every
    time. Could wrap in object and keep those in context, or at least table
    if we may intermix programs. TODO: review.

    TODO GONK: Keep actual timestamps, since we know how to query for 
    nearest-after. Question is whether there's a field we can reliably
    get them from; first thought didn't always work.
 */

import got from 'got'

// TODO: Sounds-like processing, for tag searches, eventually.
/* NOTE: These are now "pure ESM" packages. Either make your own code
   fully ESM (multiple configuration details; not sure if that's
   compatible with Jovo), or use "await import()" ugly workaround.
   See
   https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c
*/
// import {metaphone} from 'metaphone'
// import {stemmer} from 'stemmer'

const DEBUG="DEBUG"==process.env.EPISODESDB_CFG


////////////////////////////////////////////////////////////////
// Open the box of Dominos. I mean, Dynamos.
// Basic database interface config.
//
// NOTE: to read from ~/.aws/config, the Javascript SDK requires
// env AWS_SDK_LOAD_CONFIG=1
// Otherwise:
// env AWS_ACCESS_KEY_ID=...
// env AWS_SECRET_ACCESS_KEY=...
// env AWS_DEFAULT_REGION=us-east-1 

const AWS = require("aws-sdk");
set_AWS_endpoint(); // Must default or be set before initializing the DynamoDB

// Set default, but allow for overriding later
export function set_AWS_endpoint(endpoint="http://localhost:8000",region="us-east-1") {
    AWS.config.update({
	"endpoint": endpoint,
	"region": region,
    });
    return AWS // mostly for testing
}

var dynamodb = new AWS.DynamoDB();
var docClient = new AWS.DynamoDB.DocumentClient();

const ITEM_BY_EPISODE_INDEX="ITEM_BY_EPISODE" // Just for static checking

export interface EpisodeRecord {
    program: string;
    episode: number;
    title: string;
    tease: string;
    broadcastDateMsec: number
    tags: string[];
    url: string;
    imageurl: string|null;
}

export interface QueryUniqueResult {
    Item: EpisodeRecord
}

export interface QueryMultipleResults {
    Items: EpisodeRecord[]
}

// I chose to parameterize tableName. Overkill, but for now...
function getEpisodesSchema(tableName:string) {
    return {
	TableName : tableName,
	// Primary key must be unique identifier for Item record, so use date
	KeySchema: [       
	    { AttributeName: "program", KeyType: "HASH"},
	    { AttributeName: "broadcastDateMsec", KeyType: "RANGE" }
	],
	
	// CAVEAT: Secondary Indexes are implemented as child tables,
	// NOT as side-table indexing. (Storage cost vs. CPU cost
	// JOINish tradeoff again; not a decision that feels natural
	// to me.)  Depending on use cases, it may be desirable to
	// Project only columns actually used, to reduce copying (and
	// returned network traffic, as with fetch-time projection).
	//
	// Probably insignificant in my application, given AWS's
	// billing structure and relatively small table(s).
	// Still. Ugh.
	//
	// Note that since secondaries are tested via expression
	// rather than by full hash (!?), it's possible to test the
	// "hash" alone as a pseudo-Simple key to get all contents of
	// that Region sorted by the sort key, then use Limit to pick
	// off just first or last to get reasonably efficient
	// retrieval by secondary sort.  May be any of the Items which
	// match that Secondary, of course, unless you impose
	// filtering before limiting. It's a kluge, but useful. (Or
	// you could test sort alone to get cross- Region results, eg
	// most recent broadcast among all programs.)  Similar for
	// "since"; test sort key but don't set Limit.
	LocalSecondaryIndexes: [
	    {
		// Note: NOT unique if there are multiple dates
		IndexName: ITEM_BY_EPISODE_INDEX, 
		KeySchema: [ 
		    // Must hash be declared even for local? Believe so,
		    // despite the requirement that local shares partition
		    // with primary key.
		    { AttributeName: "program", KeyType: "HASH"},
		    { AttributeName: "episode", KeyType: "RANGE" }
		],
		Projection: { 
		    ProjectionType: "ALL" // vs KEYS_ONLY or INCLUDE
		    // Iff INCLUDE:
		    //NonKeyAttributes: [STRING_VALUE', ],
		}
	    },
	],
	GlobalSecondaryIndexes: [
	    {
		// Sort key may not be useful here; consider dropping.
		IndexName: 'ALL_PROGRAMS_FOR_DATE',
		KeySchema: [ 
		    { AttributeName: "broadcastDateMsec", KeyType: "HASH" },
		    { AttributeName: "program", KeyType: "RANGE"},
		],
		Projection: { 
		    ProjectionType: "ALL" // vs KEYS_ONLY or INCLUDE
		    /// Iff INCLUDE:
		    // NonKeyAttributes: [ 'STRING_VALUE', ],
		}
	    },
	],
	// Only need to define attributes EXPLICITLY REFERENCED IN INDEXES.
	AttributeDefinitions: [       
	    { AttributeName: "program", AttributeType: "S" },
	    { AttributeName: "episode", AttributeType: "N" }, // number
	    { AttributeName: "broadcastDateMsec", AttributeType: "N" } // number
	],
	// CONSIDER PROVISIONED for throttling just to establish upper
	// limit of billing if malfunction (or attack?) occurs
	BillingMode: "PAY_PER_REQUEST", // or PROVISIONED
	/* Now must only be specified in PROVISIONED billing mode
	ProvisionedThroughput: {   // Throttled max per second
	    ReadCapacityUnits: 1, // Apparently must now be >0
	    WriteCapacityUnits: 1
	}
	*/
    }
}

//================================================================
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
    headers: any; // ... Not relevant right now
    "header-donate-chunk": any; // null|string?
    "image-caption": null|string;
    "image-main": { // We may want to display this on SHOW-like devices
	"alt-text": null|string;
	name: null|string;
	source: null|string;
	url: null|string; // TODO: May want to display
	h: number;
	"is-display": boolean;
	crop: string; // typ. containing number
	caption: string;
	"credits-url": string; 
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
    "producing-organizations": [{ // TODO: Make org an interface?
	url: string;
	logo: any; // often null
	name: string
    }];
    "publish-at": string; // containing ISO date/time/offset stamp
    "publish-status": string;
    show: string; // PROGRAM
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
    tease: string // NON-HTML brief episode descr. May be absent or truncated.
    template: string // editing guidance
    title: string // Includes ep#, eg "#4569, Late Night Jazz",
    transcript: string // usually empty for New Sounds
    "twitter-headline": string // usually == title
    "twitter-handle": string // usually == show
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
// Type Guard for above interface, Typescript's answer to ducktype downcasting.
// (http://www.typescriptlang.org/docs/handbook/advanced-types.html)
function isStationEpisodeData(duckObject: any): duckObject is StationEpisodeData {
    if((duckObject as StationEpisodeData).data){
	return true
    }
    console.error("\nERROR: isStationEpisodeData failed on:")
    console.error(JSON.stringify(duckObject,null,2)+"\n")
    return false
}

//================================================================
// DynamoDB calls. Generally these return Promises which can be handled/chained
// to manage asynchronous logic flow. 
//
// Note that we are running in Eventually Consistent mode; if stronger
// time sequencing was needed across threads, we'd have to explicitly
// request it.

export function createTable(tableName:string): Promise<Object> {
    var episodesSchema=getEpisodesSchema(tableName);
    return dynamodb.createTable(episodesSchema).promise()
}

export function waitForTable(tableName:string): Promise<Object> {
    var params = {
	TableName : tableName
    };
    return dynamodb.waitFor("tableExists",params).promise()	
}
export function waitForNoTable(tableName:string): Promise<Object> {
    var params = {
	TableName : tableName
    };
    return dynamodb.waitFor("tableNotExists",params).promise()	
}

export function describeTable(tableName:string): Promise<Object> {
    var params = {
	TableName : tableName
    };
    return dynamodb.describeTable(params).promise()	
}

export function deleteTable(tableName:string): Promise<Object> {
    var params = {
	TableName : tableName
    };
    return dynamodb.deleteTable(params).promise()
}

// program+date main key is unique, though multiple records may exist
// per episode.
//
// TODO GONK: Rework as query for most recent before timestamp?
// Before timestamp+almost_24_hours? Think about how that resolves.
// (Goal would be to switch to using straight timestamps and rational
// matching. Complication in how we are obtaining the datestamps; I
// don't know that we have the additional UTC precision needed to make
// this work in reality.)
export function getItemForDate(tableName:string,program:string,date:number): Promise<QueryUniqueResult> {
    var params = {
	TableName: tableName,
	Key:{
	    "program": program,
	    "broadcastDateMsec": date
	}
    }
    return docClient.get(params).promise()
}

// Scan sorted, take single result
export function getItemForEarliestDate(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByDate(tableName,program,true)
}
export function getItemForLatestDate(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByDate(tableName,program,false)
}

export function getTerminalItemByDate(tableName:string,program:string, forward:boolean): Promise<EpisodeRecord> {
    // All for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	KeyConditionExpression: "program = :program",
	ExpressionAttributeValues: {
	    ":program": program,
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

export function getNextItemByDate(tableName:string,program:string,date:number): Promise<EpisodeRecord> {
    return getAdjacentItemByDate(tableName,program,date,true)
}      
export function getPreviousItemByDate(tableName:string,program:string,date:number): Promise<EpisodeRecord> {
    return getAdjacentItemByDate(tableName,program,date,false)
}      
export function getAdjacentItemByDate(tableName:string,program:string,date:number,forward:boolean): Promise<EpisodeRecord> {
    // All for program, in desired order, but return only first found
    var params = {
	TableName: tableName,
	KeyConditionExpression: "program = :program AND broadcastDateMsec"+(forward?">":"<")+":date",
	ExpressionAttributeValues: {
	    ":program": program,
	    ":date": date
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

// Multiple records may exist per episode number.
//
// This is a secondary-index query. It is claimed that, even though an
// expression is used rather than TLU, this should still be faster than
// a Scan with equivalent conditions.
// 
// TODO: Note that ordering here is by the episode number ... which
// we're currently doing exact match on, so it's irrelevant. It
// might be useful to have the group natively ordered by date, but
// that gets a bit messy; to do episode#date as key it has to be
// string, and to make that sort properly we'd need to left-pad both
// numeric values. So optimization is possible, but arguably is overkill
// for our needs.
export function getItemsForEpisode(tableName:string,program:string,episode:number,maxresults:number=Number.MAX_SAFE_INTEGER): Promise<QueryMultipleResults> {
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program and episode = :episode",
	ExpressionAttributeValues: {
	    ":program": program,
	    ":episode": episode
	},
	// I'd prefer to assert Limit only if specified, but Typescript
	// is happier with it not being appended later.
	Limit: maxresults
    }
    return docClient.query(params).promise()
}

export function getItemForLowestEpisode(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByEpisode(tableName,program,true)
}
export function getItemForHighestEpisode(tableName:string,program:string): Promise<EpisodeRecord> {
    return getTerminalItemByEpisode(tableName,program,false)
}
export function getTerminalItemByEpisode(tableName:string,program:string, forward:boolean): Promise<EpisodeRecord> {
    // Query all for program, in desired order, but return only first
    // found ... which, since the sort key is episode, will yield an
    // item for first or last episode number. NOTE that there might be
    // multiple dates for that episode; I don't think there's any
    // promise that .data will contain more than one, or which one.
    // You can get the others by getting from the found episode
    // number.
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program",
	ExpressionAttributeValues: {
	    ":program": program,
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

export function getNextItemByEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getAdjacentItemByEpisode(tableName,program,episode,true)
}
export function getPreviousItemByEpisode(tableName:string,program:string,episode:number): Promise<EpisodeRecord> {
    return getAdjacentItemByEpisode(tableName,program,episode,false)
}
// Given an episode number, find the next lower or higher.  There may
// be several instances with different dates; this arbitrarily grabs
// the first found.
export function getAdjacentItemByEpisode(tableName:string,program:string,episode:number, forward:boolean): Promise<EpisodeRecord> {
    var params = {
	TableName: tableName,
	IndexName: ITEM_BY_EPISODE_INDEX, 
	KeyConditionExpression: "program = :program AND espisode"+(forward?">":"<")+":episode",
	ExpressionAttributeValues: {
	    ":program": program,
	    ":episode": episode
	},
	ScanIndexForward: forward,
	Limit: 1
    }
    return docClient.query(params).promise()
	.then( (data:QueryMultipleResults) => data.Items[0])
}

const EARLY_DATE_CACHE:Map<string,number>=new Map();
export function getRandomItem(tableName:string,program:string): Promise<EpisodeRecord> {
    // We know the first broadcast date of first episode.  We know
    // today's date. Randomize within that range. Be prepared for risk that
    // any given date's show may be preempted.
    //
    // Could do the same between episode numbers 1 and most-recent, but has
    // the issue of knowing what most-recent is.
    // ---
    //
    // TODO REVIEW: Double-fetch is inefficient. Running in lambda, we
    // can't easily cache the first fetch either.
    // 
    // There are magic DynamoDB randomizations involving GUID hash
    // keys and "ExclusiveStartKey = lastKeyEvaluated", but I don't
    // think they translate well to my data.
    //
    // There's also one using total COUNT of items (supposedly a free
    // query???), SCAN with number of segments set to that number,
    // randomize the segment number in that range, take first...
    // I'm not highly convinced.
    return getItemForEarliestDate(tableName,program)
	.then( ep => {
	    var earliest=ep.broadcastDateMsec-1 // Back up since we'll get Next
	    var latest=Date.now() - 7*24*60*60*1000 // Roll back one day, paranoia
	    var pickDate=Math.floor(earliest +Math.random()*(latest-earliest))
	    return getNextItemByDate(tableName,program,pickDate)
	})
}

// program+date must be unique, but multiple Items/records per episode
// with different timestamps are common due to rebroadcasts.
// This will overwrite.
export function putItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    var params = {
	TableName:tableName,
	Item:record
    }
    return docClient.put(params).promise()
}

// program+date must be unique, but multiple Items/records per episode
// with different timestamps are common due to rebroadcasts.  This
// version will NOT overwrite -- it tests for prior presence of the
// (required!)  Hash Key.
export function putNewItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    var params = {
	TableName:tableName,
	Item:record,
	ConditionExpression: "attribute_not_exists(#p)",
	ExpressionAttributeNames: { "#p": "program" }
    }
    return docClient.put(params).promise()
}

// Removes only one record. Same episode may still be present on other dates.
// If you want to remove them all, use the secondary key.
export function deleteItemForDate(tableName:string,program:string,date:number): Promise<Object> {
    var params = {
	TableName: tableName,
	Key:{
	    "program": program,
	    "broadcastDateMsec": date
	}
    }
    return docClient.delete(params).promise()
}

// Convenience, if you have the record on hand.
export function deleteItem(tableName:string,record:EpisodeRecord): Promise<Object> {
    return deleteItemForDate(tableName,record.program,record.broadcastDateMsec)
}

// Consider searching tags. Can contains() be used in keyCondition
// without givin up Query efficiency? If not, can we leverage
// attributeExists on structured data with sparse properties (keys
// rather than values)? 
//
// Unfortunately playlists don't have usable offsets even when we do
// have the track lengths; talk between/over isn't accounted for.

//================================================================
// Read published episode data from the newsounds.org database.  This
// can be run in three modes, depending on the value of maxdepth:
//
// <0 incremental, ==0 rescan all, N>0 check only first N pages
//
// Incremental from most recent date is most common mode of
// operation. Rescan is mostly used when I'm adding a field to the
// table or developing, though it may be worth running periodically
// just in case a missing episode appears. First-N is mostly used as a
// debug tool when testing new update logic.
//
// NOTE: I _don't_ fully trust Javascript to optimize tail-recursion
// of Promises/asyncs.  But this is the simplest way to structure the
// logic unless I go back to explicit awaits and an enclosing loop (which
// was my original sketch, and which is apparently considered better
// form these days...)
export async function updateEpisodes(table:string,maxdepth:number) {
    console.log("Checking server for new episodes...")

    // Run Got HTTP query, returning object via a Promise
    const getStationEpisodeData = (page:number) => {
	console.log("  Fetch index page",page)
	const page_size=50 // Number of results per fetch
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
		    console.error(e)
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

    function handlePage(table:string,page:number=1): Promise<any> {
	// Issue query, wait for Promise to be completed,
	// and handle. The while/await was needed so we could determine
	// when incremental load had reached already-known data.
	//
	// NOTE AWAIT attempting to make the loop synchronous.
	// (GONK May not be playing well with the promise rewrite.)
	// There may be a clean way to change this to fully async,
	// since in theory conditional tail-calls without wait _ought_ to not
	// stack unreasonably.
	return getStationEpisodeData(page)
	    .then( data => {
		// Typescript's approach to ducktype-downcasting is
		// apparently to condition upon a Type Guard.
		if(! (isStationEpisodeData(data))) {
		    console.error("vvvvvvvvvvvvvv")
		    console.error("UNEXPECTED DATA STRUCTURE FROM STATION")
		    console.error(JSON.stringify(data,null,2))
		    console.error("^^^^^^^^^^^^^")
		    return Promise.reject("unexpected");
		}

		// PROCESS EPISODES IN THIS CHUNK
		var episodes=data.data
		//for (let ep of episodes) {
		var promises:Promise<string>[] = episodes.map( ep => {
		    return new Promise<string> ( (resolve,reject) => {
			if(ep==null) 
			    resolve("null record")
			else {
			    var episodeRecord:(EpisodeRecord|null) =
				attributesToEpisodeRecord(ep.attributes)
			    
			    if(episodeRecord!=null)
			    {
				// If doing a full-depth scan, force replacement
				// (because we may be restructuring data)
				var putOperation= maxdepth==0 ? putItem : putNewItem
				return putOperation(table,episodeRecord)
				    .then(() => {
					return resolve("NEW")
				    })
				    .catch( (err:any) => {
					return reject(err) 
				    })
			    } // end if episodeRecord converted OK
			    else {
				return reject("Unconvertable data from station server.")
			    }
			}
		    }) // end new Promise
		}) // end episodes.map
		return Promise.allSettled(promises)
		    .then(results => {
			if(results.some(r => r.status=="rejected"))
			{
			    // Some rejection is normal when in overwrite mode.
			    // In incremental, it means stop.
			    if(maxdepth >=0 &&
			       page!=maxdepth &&
			       page!=data.meta.pagination.pages) { // more
				return handlePage(table,page+1)
				    .catch(err => {
					Promise.reject("handlePage("+(page+1)+") failed a recursion: "+err)
				    })
			    }
			    else return Promise.resolve("done")
			}
			else {
			    // All successful. Stop only on depth or no-more
			    if(page!=maxdepth && 
			       page!=data.meta.pagination.pages) {
				return handlePage(table,page+1)
				    .catch( (err) => {
					Promise.reject("handlePage("+(page+1)+") failed an update: "+err)
				    })
			    }
			}
			return Promise.resolve("done")
		    })
		    .catch(err => {
			console.error("\nPaErr:",err)
			// Should we continue scanning (full, and more remain)?
			// ... I'm voting no for now; this is unexpected
			return Promise.reject("Unexpected update failure: "+err)
		    })
	    }) // end Promise.all.then
	    .catch(e => {
		var stack;
		if(e instanceof Error)
		    stack=e.stack
		else
		    stack="(not Error, so no stack)"
		console.error("Update failed on Page",page,"\n",e,stack)
		// Recovery: Leave DB running with what we've previously loaded
		return Promise.reject("Update failed on Page"+page+"\n"+e+stack)
	    }) // end Promise.all.catch 
    } // end handlePage

    // Launch sequenced async queries, eventually updating ep list.
    //
    // Eventually we'll probably want to generalize this to handle
    // Soundcheck etc. Just a matter of setting the show name, I think,
    // and having the app run against the right index files.
    handlePage(table)
	.then( () => reportSnapshotStats(table))
} // end update

function reportSnapshotStats(table:string,program:string="newsounds") {
    // Probe the updated table. Diagnostic logging. 
    console.log("STATISTICS DUMP for",program+":")
    getItemForHighestEpisode(table,program)
	.then (ep => {
	    console.log("\tHighest numbered:",ep.title)
	})
    getItemForLowestEpisode(table,program)
	.then (ep => {
	    console.log("\tLowest numbered:",ep.title)
	})
    getItemForLatestDate(table,program)
	.then (ep => {
	    console.log("\tMost recent daily:",
			ep.title,
			"at",new Date(ep.broadcastDateMsec).toUTCString())
	})
    getItemForEarliestDate(table,program)
	.then (ep => {
	    console.log("\tEarliest daily:",
			ep.title,
			"at",
			new Date(ep.broadcastDateMsec).toUTCString()
		       )
	})
    for(let i in [1,2,3,4,5]) {
	getRandomItem(table,program)
	    .then (ep => {
		console.log("\tRandom:",
			    ep.title,
			    "at",
			    new Date(ep.broadcastDateMsec).toUTCString()
			   )
	    })
    }
}

// Convert HTML escapes to speakable. Note RE syntax in .replace().
function deHTMLify(text:string):string {
    return text
	.replace(/<.*>/gi," ") // Discard markup
	.replace(/&nbsp;/gi," ")
	.replace(/&amp;/gi," & ")
	.replace(/&[lr]squo;/gi,"'")
	.replace(/&[lr]dquo;/gi,'"')
	.replace(/&[lr]ndash;/gi," -- ")
    // TODO: (case sensitive?) aelig, eacute, aacute, iacute, oacute,
    // hellip, Uuml, uacute, auml, oslash -- unless speech synths
    // handle them properly.

    // While we're here, convert newlines to spaces, then drop repeated spaces
	.replace(/\n/g," ")
	.replace(/ */g," ")
}

const APP_URI_PARAMETERS="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"

// URI to query the station's episode database. Pages start from 1, ordered
// newest-first. Page size can be up to 100 episodes per query. NOTE that this
// doesn't issue the query, just produces the URI.
//
// TODO: Parameterize by show name?
function formatEpisodeDatabaseQueryURI(page:number,page_size:number) {
    return "https://api.wnyc.org/api/v3/story/?item_type=episode&ordering=-newsdate&show=newsounds&"+APP_URI_PARAMETERS+"&page="+page+"&page_size="+page_size
}

// Read a broadcast record returned by the station's database, convert
// it into our representation
function attributesToEpisodeRecord(attributes:StationEpisodeAttributes):(EpisodeRecord|null) {
    // If no audio, they don't help my application. Skip 'em for now.
    if(!attributes.audio || attributes.audio==undefined || attributes.audio=="") {
	console.log("(Skipping record, no audio:",attributes.title+")")
	return null;
    }
    else {
	// Some titles have unusual boilerplate that we need to adapt,
	// or have the episode number buried in the middle.
	//
	// I'm not bothering to process "preempted" shows; I trust
	// that they will have no audio and be dropped later.
	//
	// TODO: Some early titles were just entered in the station
	// database as "Program #1595" and the like. (Many in that
	// range.)  There may be another field we can pull descriptive
	// text from, such as the tease or slug. (See below re
	// tease. Re-order?)
	var title=attributes.title
	    .replace(/The Undead # ?[0-9]*/gi," ")
	    .replace(/The Undead/gi,"")
	    .replace(/Undead # ?[0-9]*/gi," ")
	    .replace(/ Pt. /gi," Part ") // For pronouncability
	// Deal with buried episode number (#nnnn:) by pulling it to
	// front. 
	if(!title.startsWith("#")) {
	    title=title.replace(/(^[^#]*)(#[0-9]+)(.*)/i,"$2: $1 $3")
	}
	title=title.trim()
	if(title.endsWith("-"))
	    title=title.substr(0,title.length-1)
	
	// Nominally, number should be easier to parse off
	// attributes.slug. But that doesn't produce the right results
	// for the "undead" episodes; slug puts those up in the 60K
	// range but we really want the human number, and title
	// processing above should have ensured it's at the start of that
	// string (after '#').
	//
	// However, some episodes don't have the ep# in their title
	// either.  It appears to be present in the MP3's metadata,
	// which would be one way of resolving this if we can't get it
	// from another database field. NOTE that this includes some
	// episodes which are marked as pre-empted but which the
	// database says do have audio -- for example,
	// audio.wnyc.org/newsounds/newsounds012120.mp3 turns out to
	// be #4226.  NOTE TOO that getting a useful title out of this
	// will require handling the "pre-empted" pattern ... and
	// ideally finding another broadcast of this episode and
	// pulling the title from there (unless that too can come from
	// side-data). GONK TODO
	var episodeNumber=parseInt(title.slice(1))

	// New Sounds prefers to route these as podtrac URIs, though
	// the direct URI can be extracted therefrom if one had reason
	// to cheat. As of this writing the database hasn't included
	// URI parameters, but I'm not ruling that out.
	//
	// For New Sounds, this can actually be reconstructed from
	// broadcast date, in form
	// "https://pdst.fm/e/www.podtrac.com/pts/redirect.mp3/audio.wnyc.org/newsounds/newsounds072521.mp3"
	// Haven't verified for Sound Check etc.  Could micro-optimize
	// storage using that fact, but for this size database not worth it
	// (and would violate NoSQL's assertion that storage is cheaper
	// than computation).
	// 
	// Occasionally these come thru as array and/or in odd format
	// (historical accident?).  Be prepared to unpack that.
	// 
	var mp3url=attributes.audio
	if(Array.isArray(mp3url)) {
	    mp3url=mp3url[0]
	}

	// See also publishedDate, newsDate, "First
	// Aired". Publication date is not actually useful; that's
	// when it was added to the DB.

	// Take broadcast date from mp3url, rather that other fields;
	// applied paranoia.  Note: In at least one case the database
	// reports an unusually formed URI
	// .../newsounds050610apod.mp3?awCollectionId=385&awEpisodeId=66200
	// so be prepared to truncate after datestamp.
	//
	// TODO REVIEW: We *could* (probably should) switch to real
	// timestamps and use query to find the one at or before
	// requested. .newsdate appears to sometimes differ from the
	// URL fields by years, so presumably is the wrong
	// field. Which is the way that's clear?
	var urlDateFields=mp3url
	    .replace(/.*\/newsounds([0-9]+)/i,"$1")
	    .match(/.{1,2}/g)
	if(! urlDateFields) {
	    // Should never happen but Typescript wants us to promise
	    // it won't.
	    throw new RangeError("invalid date in: "+mp3url)
	}
	// Sloppy mapping of 2-digit year to 4-digit
	var year=parseInt(urlDateFields[2])+2000
	var now=new Date() // TODO: Factor out would be more efficient
	if(year > now.getUTCFullYear())
	    year=year-100
	var broadcastDate=new Date(
	    Date.UTC(
		year,
		parseInt(urlDateFields[0])-1, // 0-based
		parseInt(urlDateFields[1])
	    )
	)

	// I was considering using the stations's actual airing timestamp,
	// provided as .newsdate, and querying rather than getting.
	// (Nearest ... is it <= or >=?) For some episodes, that works.
	// But for some, I'm seing differences of up to years in both
	// directions. I could take real time when they agree and
	// force the others to A Typical Time On Broadcastdate, or just
	// force them all to A Typical Time, or as now keep them all on
	// just Broadcastdate. TODO: Consider.
	//
	// console.log("DEBUG: diff of ",
	// 	    ( Date.parse(attributes.newsdate)
	// 	     -broadcastDate.getTime() )/1000/60/60/24,
	// 	    "days for #",episodeNumber)
	

	// For spoken description, use tease rather than body. But
	// NOTE: Tease sometimes truncates long text with "...", which
	// is not ideal for humans. Workaround: If that is seen, take
	// the first sentence or two of body instead.
	var tease=deHTMLify(attributes.tease)
	if (tease.endsWith("..."))
	    tease=deHTMLify(attributes.body+" ")
	    .split(". ")[0]+"."

	// TODO: Someday, is it worth parsing out the
	// ARTIST/WORK/SOURCE/INFO <span/>s from the HTML-markup body?
	// Alas, can't map durations to offsets, since the duration
	// table doesn't include John's commentary.
	
	// TODO: Tag searchability some day.  Note processing into
	// sounds-like match form.  Other music skills seem to handle
	// this; I'm not sure what their approach is.
	var tags=[]
	for(let tag of attributes.tags) {
	    // TODO: Should we make this array for direct matching, or
	    // reconcatentate into a string for contains matching?
	    // Unclear which is more robust given possibly fuzzy
	    // matching. String is more human-readable in JSON.
	    //
	    // We want to both handle "redbone" finding Martha
	    // Redbone, and distinguish Kronos Quartet from Mivos
	    // Quartet, so tags currently remain as token sets which are
	    // searched within rather than exploding into individual
	    // tokens. That's subject to redesign as search evolves.
	    var tagset=" " // For ease of exact-matching
	    for(let token of tag.split("_")) {
		// Match on sounds-like.
		// token=metaphone(stemmer(token))
		tagset=tagset+token+" "
	    }
	    tags.push(tagset)
	}

	// image-main.url should be the show banner image, if present.
	var imageurl= attributes["image-main"] ? attributes["image-main"].url : null

	if(episodeNumber > 0) {
	    var newEpisode:EpisodeRecord={
		program: attributes.show,
		episode: episodeNumber,
		title: title,
		tease: tease,
		broadcastDateMsec: broadcastDate.getTime(),
		tags: tags,
		url: mp3url,
		imageurl: imageurl
	    }
	    return newEpisode
	}
	else {
	    console.log("Skipping",broadcastDate,"record, no episode number in",title)
	    console.log("\t but audio at",mp3url)
	    // Example: "In Memoriam 2016: Prince, Bowie, Cohen &
	    // Others", or the before-# episode "With Ravi Shankar".
	    //
	    // We *could* include it in my DB, since DB primary key is
	    // by date rather than ep#. It would sort oddly in
	    // highest/lowest numbered, though, unless we can specialcase
	    // those searches to skip unknowns.
	    //
	    // For now, just don't index. TODO: REVIEW.
	    return null
	}
    }
}

//================================================================
// Drivers should be moved to separate files.
//----------------------------------------------------------------
